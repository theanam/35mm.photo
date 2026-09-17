import { GLSL_COMMON } from './common.glsl'

/**
 * The colour pass: white balance → exposure → tone → curves → HSL →
 * saturation/vibrance → look LUT, in the order spec §6 lays out.
 *
 * Edge sampling is clamped rather than wrapped; with a straighten angle the
 * transform can reach just outside the source rect.
 */
export const COLOR_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform sampler2D uCurves;   // 256 x 4 : row 0 rgb, 1 r, 2 g, 3 b
uniform sampler3D uLut;

uniform vec3  uWbGain;
uniform float uExposure;      // EV
uniform float uContrast;      // -1..1
uniform float uHighlights;    // -1..1
uniform float uShadows;       // -1..1
uniform float uWhites;        // -1..1
uniform float uBlacks;        // -1..1
uniform float uVibrance;      // -1..1
uniform float uSaturation;    // -1..1
uniform bool  uHasCurves;
uniform bool  uHasLut;
uniform float uLookStrength;  // 0..1
uniform float uHslH[8];
uniform float uHslS[8];
uniform float uHslL[8];
uniform bool  uHasHsl;

${GLSL_COMMON}

/** Hue centres of the 8 mixer bands, normalised to 0..1. */
const float BAND_CENTER[8] = float[8](
  0.0,        // red
  0.0833333,  // orange
  0.1666667,  // yellow
  0.3333333,  // green
  0.5,        // aqua
  0.6111111,  // blue
  0.7500000,  // purple
  0.8888889   // magenta
);

float curveLookup(float x, float row) {
  return texture(uCurves, vec2(clamp(x, 0.0, 1.0), (row + 0.5) / 4.0)).r;
}

/**
 * Highlight/shadow/white/black recovery with smooth luminance masks. Working on
 * a ratio rather than adding a flat offset keeps colour from drifting when a
 * region is pushed hard.
 */
vec3 applyTone(vec3 c) {
  float y = luma(c);

  if (uHighlights != 0.0) {
    float m = smoothstep(0.45, 1.0, y);
    float target = uHighlights > 0.0 ? mix(y, 1.0, uHighlights) : mix(y, y * 0.45, -uHighlights);
    c *= (y > 1.0e-4) ? mix(1.0, target / y, m) : 1.0;
    y = luma(c);
  }
  if (uShadows != 0.0) {
    float m = 1.0 - smoothstep(0.0, 0.55, y);
    float target = uShadows > 0.0 ? mix(y, pow(max(y, 1.0e-4), 0.55), uShadows)
                                  : mix(y, y * 0.5, -uShadows);
    c *= (y > 1.0e-4) ? mix(1.0, target / y, m) : 1.0;
    y = luma(c);
  }
  if (uWhites != 0.0) {
    c *= 1.0 + uWhites * 0.35 * smoothstep(0.25, 1.0, y);
    y = luma(c);
  }
  if (uBlacks != 0.0) {
    c += uBlacks * 0.18 * (1.0 - smoothstep(0.0, 0.45, y));
  }

  if (uContrast != 0.0) {
    // Pivot on middle grey so contrast does not double as an exposure change.
    c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  }
  return c;
}

vec3 applyHsl(vec3 c) {
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  float hShift = 0.0;
  float sMul = 1.0;
  float lMul = 1.0;

  for (int i = 0; i < 8; i++) {
    float w = bandWeight(hsv.x, BAND_CENTER[i], 0.115);
    if (w <= 0.0) continue;
    // Weight by saturation: a near-grey pixel has no meaningful hue to shift.
    w *= smoothstep(0.04, 0.22, hsv.y);
    hShift += uHslH[i] * w * 0.0833333;   // ±100 maps to ±30°
    sMul   += uHslS[i] * w;
    lMul   += uHslL[i] * w * 0.6;
  }

  hsv.x = fract(hsv.x + hShift);
  hsv.y = clamp(hsv.y * max(sMul, 0.0), 0.0, 1.0);
  hsv.z = clamp(hsv.z * max(lMul, 0.0), 0.0, 1.0);
  return hsv2rgb(hsv);
}

vec3 applySaturation(vec3 c) {
  float y = luma(c);
  if (uVibrance != 0.0) {
    float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    // Vibrance leans on the least-saturated pixels and mostly spares skin.
    float w = 1.0 - smoothstep(0.1, 0.85, sat);
    c = mix(vec3(y), c, 1.0 + uVibrance * w);
    y = luma(c);
  }
  if (uSaturation != 0.0) {
    c = mix(vec3(y), c, 1.0 + uSaturation);
  }
  return c;
}

void main() {
  vec2 uv = clamp(vUv, vec2(0.0), vec2(1.0));
  vec4 src = texture(uImage, uv);

  // White balance and exposure are scene-referred operations — do them in
  // linear light, where they mean what they say.
  vec3 lin = toLinear(clamp(src.rgb, 0.0, 1.0));
  lin *= uWbGain;
  lin *= exp2(uExposure);
  vec3 c = toSrgb(lin);

  c = applyTone(c);
  c = clamp(c, 0.0, 1.0);

  if (uHasCurves) {
    c = vec3(curveLookup(c.r, 1.0), curveLookup(c.g, 2.0), curveLookup(c.b, 3.0));
    c = vec3(curveLookup(c.r, 0.0), curveLookup(c.g, 0.0), curveLookup(c.b, 0.0));
  }

  if (uHasHsl) c = applyHsl(c);
  c = clamp(applySaturation(c), 0.0, 1.0);

  if (uHasLut && uLookStrength > 0.0) {
    // Half-texel inset: sampling the 3D texture at exactly 0 or 1 straddles the
    // edge texel and darkens the extremes.
    float n = float(textureSize(uLut, 0).x);
    vec3 coord = c * (n - 1.0) / n + 0.5 / n;
    vec3 looked = texture(uLut, coord).rgb;
    c = mix(c, looked, uLookStrength);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`
