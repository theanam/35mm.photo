/** GLSL helpers shared by every pass. Concatenated into each fragment shader. */
export const GLSL_COMMON = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) { return dot(c, LUMA); }

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 toSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  const float E = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + E)), d / (q.x + E), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/** Smooth 0..1 weight for how close \`hue\` sits to \`center\` on the colour wheel. */
float bandWeight(float hue, float center, float halfWidth) {
  float d = abs(hue - center);
  d = min(d, 1.0 - d); // hue wraps
  return 1.0 - smoothstep(halfWidth * 0.5, halfWidth, d);
}

/**
 * Highlight/shadow/white/black recovery with smooth luminance masks, then
 * contrast. Working on a ratio rather than adding a flat offset keeps colour
 * from drifting when a region is pushed hard.
 *
 * Every parameter is passed in rather than read from a uniform, because the
 * same maths runs twice: once globally in the colour pass, and once per pixel
 * in the local pass with whatever the masks there resolved to. One definition
 * means "shadows −40" cannot come to mean two different things depending on
 * whether a mask is involved.
 */
vec3 applyTone(vec3 c, float contrast, float highlights, float shadows, float whites, float blacks) {
  float y = luma(c);

  if (highlights != 0.0) {
    float m = smoothstep(0.45, 1.0, y);
    float target = highlights > 0.0 ? mix(y, 1.0, highlights) : mix(y, y * 0.45, -highlights);
    c *= (y > 1.0e-4) ? mix(1.0, target / y, m) : 1.0;
    y = luma(c);
  }
  if (shadows != 0.0) {
    float m = 1.0 - smoothstep(0.0, 0.55, y);
    float target = shadows > 0.0 ? mix(y, pow(max(y, 1.0e-4), 0.55), shadows)
                                 : mix(y, y * 0.5, -shadows);
    c *= (y > 1.0e-4) ? mix(1.0, target / y, m) : 1.0;
    y = luma(c);
  }
  if (whites != 0.0) {
    c *= 1.0 + whites * 0.35 * smoothstep(0.25, 1.0, y);
    y = luma(c);
  }
  if (blacks != 0.0) {
    c += blacks * 0.18 * (1.0 - smoothstep(0.0, 0.45, y));
  }

  if (contrast != 0.0) {
    // Pivot on middle grey so contrast does not double as an exposure change.
    c = (c - 0.5) * (1.0 + contrast) + 0.5;
  }
  return c;
}

vec3 applySaturation(vec3 c, float vibrance, float saturation) {
  float y = luma(c);
  if (vibrance != 0.0) {
    float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    // Vibrance leans on the least-saturated pixels and mostly spares skin.
    float w = 1.0 - smoothstep(0.1, 0.85, sat);
    c = mix(vec3(y), c, 1.0 + vibrance * w);
    y = luma(c);
  }
  if (saturation != 0.0) {
    c = mix(vec3(y), c, 1.0 + saturation);
  }
  return c;
}
`
