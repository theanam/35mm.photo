import { GLSL_COMMON } from './common.glsl'

/**
 * Grain then vignette, the last two stages of spec §6. Grain is generated
 * rather than sampled from a texture so its size tracks the look and the export
 * resolution without a second asset to ship.
 */
export const FINISH_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uHaloBlur;
uniform vec2  uResolution;
uniform float uHalation;     // 0..1
uniform float uGrain;        // 0..1
uniform float uGrainSize;    // pixels per grain cell
uniform float uGrainShadowBias; // 0..1
uniform float uVignette;     // -1..1
uniform float uSeed;

${GLSL_COMMON}

float hash(vec2 p) {
  p = fract(p * vec2(443.8975, 397.2973));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

/** Value noise, so grain clumps at a controllable size instead of being per-pixel. */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec4 src = texture(uImage, vUv);
  vec3 c = src.rgb;

  /*
   * Halation. On film the bright parts of an image scatter through the emulsion
   * and reflect off the base, and because the red layer sits deepest that glow
   * comes back warm — the red fringe around a light source in a night frame.
   *
   * Screen-blended rather than added, so a highlight that is already near white
   * glows outward instead of clipping harder.
   */
  if (uHalation > 0.0) {
    vec3 bloom = texture(uHaloBlur, vUv).rgb;
    // Starts well down the highlight range: the glow comes from everything
    // bright, not only from what is already clipping.
    float bright = smoothstep(0.42, 1.0, luma(bloom));
    const vec3 TINT = vec3(1.0, 0.34, 0.16);
    vec3 halo = TINT * bloom * bright * uHalation * 1.6;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(halo, 0.0, 1.0));
  }

  if (uGrain > 0.0) {
    vec2 gp = vUv * uResolution / max(uGrainSize, 0.5) + uSeed;
    // Two octaves: the fine one reads as film, the coarse one as clumping.
    float n = valueNoise(gp) * 0.65 + valueNoise(gp * 2.3 + 11.3) * 0.35;
    n = (n - 0.5) * 2.0;

    float y = luma(c);
    // Grain is most visible in the midtones and, per look, the shadows.
    float shape = mix(1.0, 1.0 - smoothstep(0.0, 0.75, y), uGrainShadowBias);
    shape *= 1.0 - smoothstep(0.85, 1.0, y);

    c += n * uGrain * 0.14 * shape;
  }

  if (uVignette != 0.0) {
    // Measure distance in a square aspect so the falloff stays circular.
    vec2 d = (vUv - 0.5) * vec2(max(uResolution.x / uResolution.y, 1.0),
                                max(uResolution.y / uResolution.x, 1.0));
    float r = length(d) * 1.4142;
    float falloff = smoothstep(0.35, 1.05, r);
    c *= 1.0 - uVignette * falloff * 0.85;
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`
