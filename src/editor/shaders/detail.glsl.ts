import { GLSL_COMMON } from './common.glsl'

/**
 * Clarity and sharpening, both unsharp variants against pre-blurred copies at
 * different radii (spec §4.2). Clarity works on luminance only so it does not
 * bloom colour; sharpening is masked away from flat areas so noise does not get
 * amplified along with detail.
 */
export const DETAIL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uWideBlur;   // clarity radius
uniform sampler2D uTightBlur;  // sharpen radius
uniform float uClarity;        // -1..1
uniform float uSharpen;        // 0..1
uniform float uDenoiseLuma;    // 0..1
uniform float uDenoiseChroma;  // 0..1

${GLSL_COMMON}

void main() {
  vec4 src = texture(uImage, vUv);
  vec3 c = src.rgb;

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

  if (uClarity != 0.0) {
    float y = luma(c);
    float base = luma(texture(uWideBlur, vUv).rgb);
    float detail = y - base;
    // Taper in the extremes so clarity does not halo against a blown sky.
    float guard = 1.0 - smoothstep(0.82, 1.0, y) - smoothstep(0.18, 0.0, y);
    float boosted = y + detail * uClarity * 1.6 * clamp(guard, 0.0, 1.0);
    c *= (y > 1.0e-4) ? boosted / y : 1.0;
  }

  if (uSharpen > 0.0) {
    vec3 base = texture(uTightBlur, vUv).rgb;
    vec3 detail = c - base;
    float edge = smoothstep(0.004, 0.05, length(detail));
    c += detail * uSharpen * 2.0 * edge;
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`
