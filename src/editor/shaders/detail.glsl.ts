import { GLSL_COMMON } from './common.glsl'
import { GLSL_MASK } from './mask.glsl'

/**
 * Clarity and sharpening, both unsharp variants against pre-blurred copies at
 * different radii (spec §4.2). Clarity works on luminance only so it does not
 * bloom colour; sharpening is masked away from flat areas so noise does not get
 * amplified along with detail.
 *
 * Masks reach this pass because clarity, texture and sharpening are the three
 * local adjustments that need a blurred copy to work against, and those copies
 * belong to this stage. Each one adds its masked amount to the global slider
 * before the maths runs, so a mask asking for +40 clarity over a frame already
 * set to +20 gets +60 there and +20 everywhere else.
 */
export const DETAIL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uWideBlur;   // clarity radius, and the dehaze veil estimate
uniform sampler2D uToneBlur;   // much wider: the local tone operator's neighbourhood
uniform sampler2D uMidBlur;    // texture radius
uniform sampler2D uTightBlur;  // sharpen radius
uniform float uClarity;        // -1..1
uniform float uTexture;        // -1..1
uniform float uDehaze;         // -1..1
uniform float uSharpen;        // 0..1
uniform float uDenoiseLuma;    // 0..1
uniform float uDenoiseChroma;  // 0..1
uniform float uDynamicRange;   // -1..1

// clarity, texture, sharpen, unused
uniform vec4 uMaskDetail[8];

${GLSL_COMMON}
${GLSL_MASK}

void main() {
  vec4 src = texture(uImage, vUv);
  vec3 c = src.rgb;

  // Resolved against the incoming picture, so a luminance or colour range mask
  // measures what came out of the colour pass rather than something the
  // sharpening in this pass has already moved.
  float clarity = uClarity;
  float texAmount = uTexture;
  float sharpen = uSharpen;
  if (uMaskCount > 0) {
    vec2 p = maskUv(vUv);
    for (int i = 0; i < MAX_MASKS; i++) {
      if (i >= uMaskCount) break;
      float w = maskWeight(i, p, src.rgb);
      if (w <= 0.0) continue;
      vec4 d = uMaskDetail[i];
      clarity   += d.x * w;
      texAmount += d.y * w;
      sharpen   += d.z * w;
    }
  }

  if (uDenoiseLuma > 0.0 || uDenoiseChroma > 0.0) {
    // Blend toward the tight blur, splitting luma and chroma so chroma noise
    // can be crushed hard while detail survives.
    vec3 smoothed = texture(uTightBlur, vUv).rgb;
    float yS = luma(smoothed);
    float yC = luma(c);
    vec3 chroma = c - vec3(yC);
    vec3 chromaS = smoothed - vec3(yS);
    float y = mix(yC, yS, uDenoiseLuma * 0.85);
    chroma = mix(chroma, chromaS, uDenoiseChroma);
    c = vec3(y) + chroma;
  }

  /*
   * Dehaze. Haze is a bright, low-contrast veil that lifts the darkest channel
   * everywhere it covers, so the minimum channel of a heavily blurred copy is a
   * usable estimate of how much veil sits over each region — the dark-channel
   * prior, with the blur standing in for the local minimum filter.
   *
   * Recovering with J = (I - A) / t + A is the standard atmospheric-scattering
   * inversion. t is floored well above zero because the transmission estimate
   * is least trustworthy exactly where it is smallest, and dividing by a bad
   * small number is how dehaze earns its reputation for blotchy skies.
   */
  if (uDehaze != 0.0) {
    vec3 veilRgb = texture(uWideBlur, vUv).rgb;
    float veil = min(min(veilRgb.r, veilRgb.g), veilRgb.b);

    if (uDehaze > 0.0) {
      const float A = 1.0; // atmospheric light, near white for daylight haze
      float t = clamp(1.0 - uDehaze * 0.82 * veil, 0.28, 1.0);
      vec3 recovered = (c - A) / t + A;
      // Clearing the veil reveals colour that the haze was washing out.
      float y = luma(recovered);
      recovered = mix(vec3(y), recovered, 1.0 + uDehaze * 0.22);
      c = clamp(recovered, 0.0, 1.0);
    } else {
      // Negative dehaze puts atmosphere back: lift toward the veil and flatten.
      c = mix(c, max(c, vec3(veil)), -uDehaze * 0.55);
      c = mix(c, vec3(mix(luma(c), 0.62, 0.35)), -uDehaze * 0.18);
    }
  }

  /*
   * Local tone mapping.
   *
   * Highlights and shadows decide how much to move a pixel from that pixel's
   * own luminance, which means they cannot tell a dark face in a bright room
   * from a dark night sky — push shadows far enough and both lift, and the
   * picture goes flat. This asks a different question: how bright is the *area*
   * around this pixel? A wide blur answers it, so a dark region opens while a
   * bright one is held, and the picture keeps its overall shape.
   *
   * The wide radius is the halo control. A tight neighbourhood makes the
   * operator stronger and edgier, and puts a bright rim along every skyline —
   * the thing that gives HDR its reputation. This one is deliberately broad,
   * and backs off further wherever the pixel is far from its surroundings,
   * which is exactly where a halo would otherwise form. It is a cheaper answer
   * than an edge-aware blur and it fails in the right direction: toward acting
   * globally, which is merely ordinary rather than ugly.
   */
  if (uDynamicRange != 0.0) {
    float y = luma(c);
    float around = luma(texture(uToneBlur, vUv).rgb);

    // How much this region wants moving: up where it is dark, down where bright.
    float open = 1.0 - smoothstep(0.0, 0.55, around);
    float hold = smoothstep(0.45, 1.0, around);

    // Near a strong edge the neighbourhood is not describing this pixel, so
    // trust it less.
    float edge = 1.0 - smoothstep(0.18, 0.52, abs(y - around));

    float lift = uDynamicRange * edge * (open * 0.30 - hold * 0.26);
    float target = clamp(y + lift * (uDynamicRange > 0.0 ? (1.0 - y) : y), 0.0, 1.0);

    /*
     * Move the level, and only *some* of the colour with it.
     *
     * Scaling the whole pixel by target/y is the obvious way and it is what
     * makes opened shadows go neon: a pixel at 0.05 lifted to 0.25 has its
     * colour difference multiplied by five as well as its brightness, so every
     * shadow that had a hint of green in it arrives fluorescent. Holding the
     * chroma offset and letting it grow by a fractional power of the lift keeps
     * the colour that genuinely comes with the light, and none of the colour
     * that does not.
     */
    float gain = target / max(y, 1.0e-4);
    vec3 chroma = c - vec3(y);
    c = vec3(target) + chroma * pow(max(gain, 0.0), 0.4);
  }

  /*
   * Texture sits between clarity and sharpening: a wider radius than the
   * sharpen pass, so it works on detail rather than edges, but far tighter than
   * clarity, so it does not shift the tonal balance of a whole region. Like
   * clarity it runs on luminance only, which is what keeps it from turning
   * skin blotchy.
   */
  if (texAmount != 0.0) {
    float y = luma(c);
    float base = luma(texture(uMidBlur, vUv).rgb);
    float detail = y - base;
    // Negative texture smooths, and smoothing wants no edge guard at all.
    float guard = texAmount > 0.0 ? 1.0 - smoothstep(0.86, 1.0, y) : 1.0;
    float shaped = y + detail * texAmount * 1.25 * guard;
    c *= (y > 1.0e-4) ? shaped / y : 1.0;
  }

  if (clarity != 0.0) {
    float y = luma(c);
    float base = luma(texture(uWideBlur, vUv).rgb);
    float detail = y - base;
    // Taper in the extremes so clarity does not halo against a blown sky.
    float guard = 1.0 - smoothstep(0.82, 1.0, y) - smoothstep(0.18, 0.0, y);
    float boosted = y + detail * clarity * 1.6 * clamp(guard, 0.0, 1.0);
    c *= (y > 1.0e-4) ? boosted / y : 1.0;
  }

  if (sharpen > 0.0) {
    vec3 base = texture(uTightBlur, vUv).rgb;
    vec3 detail = c - base;
    float edge = smoothstep(0.004, 0.05, length(detail));
    c += detail * sharpen * 2.0 * edge;
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`
