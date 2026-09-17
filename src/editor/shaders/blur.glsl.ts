/**
 * Separable Gaussian, used as the low-pass half of the unsharp mask that drives
 * both clarity (wide radius) and sharpening (tight radius).
 */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;
uniform vec2 uTexel;      // 1 / textureSize
uniform vec2 uDirection;  // (1,0) horizontal, (0,1) vertical
uniform float uRadius;    // in pixels

void main() {
  // 9 taps with linear-sampling offsets — 17 pixels of reach for 9 fetches.
  const float W[5] = float[5](0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);

  // Not named step: that would shadow the built-in of the same name.
  vec2 stride = uTexel * uDirection * max(uRadius, 0.0001);
  vec4 sum = texture(uImage, vUv) * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = stride * float(i);
    sum += texture(uImage, vUv + off) * W[i];
    sum += texture(uImage, vUv - off) * W[i];
  }
  fragColor = sum;
}
`
