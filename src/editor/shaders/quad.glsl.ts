/**
 * Shared vertex shader. Crop, straighten, 90° rotation, flips and perspective
 * are folded into `uUvTransform`, so geometry costs nothing beyond the UV the
 * colour pass already samples (spec §6).
 *
 * The homogeneous coordinate is passed through undivided. Everything except
 * perspective is affine, where w is 1 everywhere and dividing in the vertex
 * shader would be free — but a keystone makes w vary across the frame, and
 * interpolating u/v after dividing at three corners is not the same as dividing
 * the interpolated values. Getting that wrong bends straight lines, which is
 * precisely what this correction exists to fix.
 */
export const QUAD_VERT = /* glsl */ `#version 300 es
in vec2 aPos;
uniform mat3 uUvTransform;
out vec3 vUvH;

void main() {
  // Image space is y-down: the texture is uploaded with UNPACK_FLIP_Y off, so
  // row 0 is the top of the picture. Clip space is y-up. Flipping here is what
  // lets the crop rectangle, the EXIF matrices and the source texture all agree
  // on y-down; without it the whole photo renders upside down.
  vec2 uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vUvH = uUvTransform * vec3(uv, 1.0);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** Vertex shader for intermediate passes, which never re-transform geometry. */
export const PASSTHROUGH_VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`
