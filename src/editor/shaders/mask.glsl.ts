/**
 * The mask block: uniforms describing every mask, and the one function that
 * turns a pixel into a 0..1 weight for each of them. Concatenated into the
 * local pass (which acts on the weight), the detail pass (which does too) and
 * the finish pass (which paints the overlay), so all three agree exactly on
 * where a mask falls — an overlay that disagreed with the render by even a
 * feather's width would be worse than no overlay at all.
 *
 * Masks are evaluated in *upright image* uv, which is why `uMaskTransform` is
 * here rather than a varying: the intermediate passes draw a plain quad and
 * have no geometry of their own, so each one maps its output position back to
 * the picture itself. Lens distortion is not undone in that mapping. It shifts
 * a sample by a pixel or two at the very edge of the frame, which is orders of
 * magnitude below the softest edge a mask can have.
 */
export const GLSL_MASK = /* glsl */ `
const int MAX_MASKS = 8;

uniform int   uMaskCount;
uniform mat3  uMaskTransform;  // output uv (y-down) → upright image uv
uniform float uMaskAspect;     // upright width ÷ height

// 0 radial, 1 linear, 2 luminance, 3 colour.
uniform int  uMaskKind[MAX_MASKS];
// radial: centre.xy, radii.zw | linear: from.xy, to.zw
// luminance: lo, hi | colour: hue (turns), half-width (turns)
uniform vec4 uMaskGeom[MAX_MASKS];
// angle (radians), feather 0..1, invert 0/1, amount 0..1
uniform vec4 uMaskShape[MAX_MASKS];

/**
 * Where this fragment sits on the picture. The intermediate passes interpolate
 * a y-up uv over the drawing buffer; the transform expects the y-down output uv
 * that the crop rectangle and every matrix in transform.ts are written in.
 */
vec2 maskUv(vec2 uv) {
  vec3 h = uMaskTransform * vec3(uv.x, 1.0 - uv.y, 1.0);
  return h.xy / h.z;
}

float maskWeight(int index, vec2 p, vec3 c) {
  int kind = uMaskKind[index];
  vec4 g = uMaskGeom[index];
  vec4 s = uMaskShape[index];
  float feather = s.y;
  float w = 0.0;

  if (kind == 0) {
    // Aspect-corrected, so the ellipse turns about its own axes rather than
    // shearing — a circle stays a circle at every angle.
    vec2 d = (p - g.xy) * vec2(uMaskAspect, 1.0);
    float ca = cos(s.x);
    float sa = sin(s.x);
    d = vec2(d.x * ca + d.y * sa, -d.x * sa + d.y * ca);

    vec2 r = max(g.zw, vec2(1.0e-4)) * vec2(uMaskAspect, 1.0);
    float dist = length(d / r);
    // Feather eats inward from the boundary, so the edge the handles draw is
    // always where the mask ends, whatever the feather is set to.
    float inner = min(1.0 - feather, 0.999);
    w = 1.0 - smoothstep(inner, 1.0, dist);
  } else if (kind == 1) {
    // Full effect at the first point, none at the second. The run between them
    // *is* the feather, which is why a linear mask has no feather control.
    vec2 a = g.xy * vec2(uMaskAspect, 1.0);
    vec2 b = g.zw * vec2(uMaskAspect, 1.0);
    vec2 ab = b - a;
    float t = clamp(dot(p * vec2(uMaskAspect, 1.0) - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
    w = 1.0 - smoothstep(0.0, 1.0, t);
  } else if (kind == 2) {
    float y = luma(clamp(c, 0.0, 1.0));
    float f = max(feather * 0.25, 0.002);
    w = smoothstep(g.x - f, g.x + f, y) * (1.0 - smoothstep(g.y - f, g.y + f, y));
  } else {
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float d = abs(hsv.x - g.x);
    d = min(d, 1.0 - d); // hue wraps
    float halfWidth = max(g.y, 0.002);
    float f = max(feather * 0.25, 0.002);
    w = 1.0 - smoothstep(halfWidth, halfWidth + f, d);
    // A near-grey pixel has no hue worth matching, so it is not "blue".
    w *= smoothstep(0.03, 0.16, hsv.y);
  }

  if (s.z > 0.5) w = 1.0 - w;
  return clamp(w, 0.0, 1.0) * s.w;
}
`
