/**
 * The mat: a flat border around the finished picture.
 *
 * The last thing drawn, and the only pass whose output is larger than the
 * photograph. Everything before it renders at the picture's own size into a
 * texture; this stretches a quad over the framed output, copies that texture
 * across the inner rectangle and fills the rest with one colour.
 *
 * Nothing here is filtered or blended. The inner rectangle is exactly the source
 * texture's pixel size — `frameLayout` guarantees it by deriving both from the
 * same integers — so the copy lands one-to-one, and the border is a constant.
 */
export const FRAME_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
/*
 * The inner rectangle in 0..1 of the framed output, as (x0, y0, x1, y1).
 *
 * Already in this shader's own coordinates, which are y-up: the passthrough
 * vertex shader gives vUv.y == 0 at the *bottom*, so the caller has put the
 * bottom inset into y0 and the top inset into 1 - y1. Doing that conversion in
 * JavaScript keeps the one axis flip in the codebase next to the comment that
 * explains it, rather than hiding a second one down here.
 */
uniform vec4 uInner;
uniform vec3 uColor;

void main() {
  vec2 lo = uInner.xy;
  vec2 hi = uInner.zw;

  // step() rather than a branch: every fragment does the same work either way,
  // and the texture fetch below is clamped to the edge regardless.
  vec2 inside = step(lo, vUv) * step(vUv, hi);
  float photo = inside.x * inside.y;

  vec2 uv = (vUv - lo) / max(hi - lo, vec2(1e-6));
  vec4 src = texture(uImage, clamp(uv, 0.0, 1.0));

  /*
   * Alpha zero on the border, and it is not a transparency.
   *
   * Alpha in this pipeline is the coverage matte — the colour pass writes it
   * from the coverage term to mean "the photograph reached this pixel", and the histogram
   * worker skips every pixel where it is zero. A mat did not reach anywhere; it
   * is not part of the picture being measured. Nothing on screen or in a file
   * changes either way, because the context is created with alpha: false — but
   * saying it here means a framed render that ever found its way into the
   * readback would be excluded from the histogram and the clipping warnings by
   * the rule that is already there, instead of lighting them on a photograph
   * that is not clipping.
   */
  fragColor = mix(vec4(uColor, 0.0), src, photo);
}
`
