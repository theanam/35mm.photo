import { GLSL_COMMON } from './common.glsl'

/**
 * The colour pass: white balance → exposure → tone → curves → HSL →
 * saturation/vibrance → look LUT, in the order spec §6 lays out.
 *
 * Tone and saturation themselves live in `common.glsl`, because the local pass
 * runs the identical maths on whatever the masks resolve to.
 *
 * Geometry can reach outside the source rect — a straighten angle by a hair, a
 * keystone or a distortion correction by a good deal more. Those fragments are
 * blanked rather than clamped to the edge texel; see `coverage`.
 */
export const COLOR_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler3D;

in vec3 vUvH;
out vec4 fragColor;

uniform sampler2D uImage;
/** Where the texture sits in the picture: xy its origin, zw its size, as fractions. (0,0,1,1) is the whole picture. */
uniform vec4  uRegion;
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

// Lens correction, in the stored texture's hugin units: a radius of 1 is half
// its shorter side. See lens/uniforms.ts for where every number comes from.
uniform vec2  uLensNorm;      // (w, h) / min(w, h): uv offsets to hugin units, before the ×2
uniform vec4  uDistK;         // Rd/Ru = 1 + k.x r + k.y r² + k.z r³ + k.w r⁴
uniform float uLensZoom;      // output radii are divided by this first
uniform vec3  uTcaR;          // red:  Rd/Ru = x + y r + z r²
uniform vec3  uTcaB;          // blue: the same
uniform vec3  uVigK;          // darkening 1 + x r² + y r⁴ + z r⁶
uniform float uVigAmount;     // how much of that darkening to divide out

// Colour grading. Each zone is packed hue(0..1), sat(0..1), lum(-1..1).
uniform vec3  uGradeShadows;
uniform vec3  uGradeMidtones;
uniform vec3  uGradeHighlights;
uniform vec3  uGradeGlobal;
uniform float uGradeBalance;   // -1..1
uniform float uGradeBlending;  // 0..1
uniform bool  uHasGrade;

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

/**
 * Tint one zone. The shift is a pure chroma direction — the tint hue with its
 * own luma subtracted — so pushing colour into a zone does not also brighten or
 * darken it. That separation is why lum is a distinct control rather than
 * something the hue smuggles in.
 */
vec3 gradeZone(vec3 c, vec3 zone, float w) {
  if (w <= 0.0) return c;

  if (zone.y > 0.0) {
    vec3 tint = hsv2rgb(vec3(zone.x, 1.0, 1.0));
    vec3 dir = tint - vec3(luma(tint));
    c += dir * zone.y * w * 0.5;
  }
  if (zone.z != 0.0) c *= 1.0 + zone.z * w * 0.5;
  return c;
}

/**
 * Three luminance zones plus a global one. Balance slides the crossover between
 * shadows and highlights; blending widens the ramp so the zones overlap rather
 * than meeting at a hard edge. Shadow and highlight weights always sum to one,
 * which is what lets the midtone weight simply be whatever neither end claims.
 */
vec3 applyGrade(vec3 c) {
  float y = luma(clamp(c, 0.0, 1.0));

  float pivot = clamp(0.5 - uGradeBalance * 0.3, 0.08, 0.92);
  float feather = mix(0.10, 0.45, uGradeBlending);

  float shadowW = 1.0 - smoothstep(pivot - feather, pivot + feather, y);
  float highW = 1.0 - shadowW;
  float midW = 1.0 - abs(shadowW - highW);

  c = gradeZone(c, uGradeShadows, shadowW);
  c = gradeZone(c, uGradeMidtones, midW);
  c = gradeZone(c, uGradeHighlights, highW);
  c = gradeZone(c, uGradeGlobal, 1.0);
  return c;
}

/**
 * Lens geometry, from an output position to where in the source it came from.
 *
 * One radial polynomial covers every model the database has — poly3, poly5,
 * ptlens and the manual slider are all coefficients of the same series — and
 * the zoom is the auto-scale that keeps a straightened frame free of empty
 * corners. Radius is measured from the centre of the stored texture in its
 * own hugin units, which is what the coefficients were converted into.
 */
vec2 toHugin(vec2 uv) { return (uv - 0.5) * uLensNorm * 2.0; }
vec2 fromHugin(vec2 h) { return 0.5 + h / (uLensNorm * 2.0); }

vec2 lensSource(vec2 uv) {
  vec2 h = toHugin(uv) / uLensZoom;
  float r = length(h);
  float k = 1.0 + r * (uDistK.x + r * (uDistK.y + r * (uDistK.z + r * uDistK.w)));
  return fromHugin(h * k);
}

/** A channel's own radius, as a scale on the source position. */
vec2 tcaSample(vec2 h, float r, vec3 t) {
  return fromHugin(h * (t.x + r * (t.y + r * t.z)));
}

/**
 * How much of the source covers this fragment: 1 inside, 0 outside, feathered
 * across one output pixel so the edge a keystone opens up is a clean line
 * rather than a staircase. fwidth is the right width for that feather because
 * it measures the coordinate's own rate of change, which a projective divide
 * makes vary across the frame.
 */
float coverage(vec2 p) {
  vec2 e = max(fwidth(p), vec2(1e-5)) * 0.5;
  vec2 inside = smoothstep(-e, e, p) * (1.0 - smoothstep(1.0 - e, 1.0 + e, p));
  return inside.x * inside.y;
}

/**
 * From a position in the picture to the same position in the texture, which
 * may hold only a region of it — the upscaled crop. Everything above works
 * in the picture's own frame; only the fetch needs to know.
 */
vec2 inRegion(vec2 uv) { return clamp((uv - uRegion.xy) / uRegion.zw, 0.0, 1.0); }

void main() {
  // The divide the vertex shader deliberately did not do. Without a keystone
  // vUvH.z is 1 and this costs nothing.
  vec2 wanted = lensSource(vUvH.xy / vUvH.z);

  // A keystone or a distortion correction asks for source outside the picture,
  // and there is nothing there to show. Clamping alone answers with the edge
  // texel, which smears the last row or column across everything past it; the
  // coverage below blanks that region instead, leaving the empty corners the
  // Scale slider exists to push back over.
  float cover = coverage(wanted);
  vec2 uv = clamp(wanted, vec2(0.0), vec2(1.0));

  // Lateral CA is a per-channel magnification error, so it is undone by
  // sampling red and blue at slightly different radii and leaving green —
  // the channel the lens was focused for — where it is. Measured in the
  // source, because that is where the calibration measured it.
  vec2 hs = toHugin(uv);
  float rs = length(hs);
  vec4 src;
  if (uTcaR != vec3(1.0, 0.0, 0.0) || uTcaB != vec3(1.0, 0.0, 0.0)) {
    vec2 uvR = clamp(tcaSample(hs, rs, uTcaR), vec2(0.0), vec2(1.0));
    vec2 uvB = clamp(tcaSample(hs, rs, uTcaB), vec2(0.0), vec2(1.0));
    src = vec4(
      texture(uImage, inRegion(uvR)).r,
      texture(uImage, inRegion(uv)).g,
      texture(uImage, inRegion(uvB)).b,
      texture(uImage, inRegion(uv)).a
    );
  } else {
    src = texture(uImage, inRegion(uv));
  }

  // White balance and exposure are scene-referred operations — do them in
  // linear light, where they mean what they say.
  vec3 lin = toLinear(clamp(src.rgb, 0.0, 1.0));
  // Vignetting first: the lens darkened the corners before anything else
  // happened to the light, so it is the first thing undone — as a gain, in
  // linear light, on the radius in the source where this sample came from.
  if (uVigAmount != 0.0) {
    float r2 = dot(hs, hs);
    // Half-diagonal units for this one, folded into the coefficients already.
    float dark = 1.0 + r2 * (uVigK.x + r2 * (uVigK.y + r2 * uVigK.z));
    lin *= mix(1.0, 1.0 / max(dark, 0.05), uVigAmount);
  }
  lin *= uWbGain;
  lin *= exp2(uExposure);
  vec3 c = toSrgb(lin);

  c = applyTone(c, uContrast, uHighlights, uShadows, uWhites, uBlacks);
  c = clamp(c, 0.0, 1.0);

  if (uHasCurves) {
    c = vec3(curveLookup(c.r, 1.0), curveLookup(c.g, 2.0), curveLookup(c.b, 3.0));
    c = vec3(curveLookup(c.r, 0.0), curveLookup(c.g, 0.0), curveLookup(c.b, 0.0));
  }

  if (uHasHsl) c = applyHsl(c);
  c = clamp(applySaturation(c, uVibrance, uSaturation), 0.0, 1.0);

  // Camera Raw grades after the basic, curve and HSL block but before the
  // profile look, so this sits between saturation and the LUT.
  if (uHasGrade) c = clamp(applyGrade(c), 0.0, 1.0);

  if (uHasLut && uLookStrength > 0.0) {
    // Half-texel inset: sampling the 3D texture at exactly 0 or 1 straddles the
    // edge texel and darkens the extremes.
    float n = float(textureSize(uLut, 0).x);
    vec3 coord = c * (n - 1.0) / n + 0.5 / n;
    vec3 looked = texture(uLut, coord).rgb;
    c = mix(c, looked, uLookStrength);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0) * cover, src.a * cover);
}
`
