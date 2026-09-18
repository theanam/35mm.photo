import { GLSL_COMMON } from './common.glsl'
import { GLSL_MASK } from './mask.glsl'

/**
 * Local adjustments — the masked half of the colour pass, run straight after it.
 *
 * Every mask is resolved into *one* set of parameters for this pixel, weighted
 * by how strongly each mask covers it, and the tone chain then runs once. The
 * obvious alternative — run the whole chain once per mask and blend the results
 * — costs N times as much and behaves worse where masks overlap: two masks each
 * asking for +1 EV would compound into rather more than +2 EV, and the seam
 * between them would show. Summed parameters simply add up, which is what
 * anyone dragging two sliders expects.
 *
 * It is the same `applyTone` and `applySaturation` the global pass uses, so a
 * value means the same thing whether or not a mask carries it.
 */
export const LOCAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;

// exposure (EV), contrast, highlights, shadows
uniform vec4 uMaskToneA[MAX_MASKS_DECL];
// whites, blacks, saturation, unused
uniform vec4 uMaskToneB[MAX_MASKS_DECL];
// Linear-light RGB gain for this mask's warmth and tint, computed on the CPU
// by the same function the global white balance uses.
uniform vec3 uMaskWb[MAX_MASKS_DECL];

${GLSL_COMMON}
${GLSL_MASK}

void main() {
  vec4 src = texture(uImage, vUv);
  vec3 c = src.rgb;
  vec2 p = maskUv(vUv);

  float exposure = 0.0;
  float contrast = 0.0;
  float highlights = 0.0;
  float shadows = 0.0;
  float whites = 0.0;
  float blacks = 0.0;
  float saturation = 0.0;
  vec3 wb = vec3(1.0);
  float covered = 0.0;

  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= uMaskCount) break;
    float w = maskWeight(i, p, c);
    if (w <= 0.0) continue;

    vec4 a = uMaskToneA[i];
    vec4 b = uMaskToneB[i];
    exposure   += a.x * w;
    contrast   += a.y * w;
    highlights += a.z * w;
    shadows    += a.w * w;
    whites     += b.x * w;
    blacks     += b.y * w;
    saturation += b.z * w;
    // Gains multiply rather than add: two masks warming the same pixel warm it
    // once each, and a mask at half weight warms it half as far.
    wb *= mix(vec3(1.0), uMaskWb[i], w);
    covered += w;
  }

  if (covered > 0.0) {
    // White balance and exposure in linear light, exactly as the global pass
    // does them — the only difference is where the numbers came from.
    vec3 lin = toLinear(clamp(c, 0.0, 1.0)) * wb * exp2(exposure);
    c = toSrgb(lin);
    c = applyTone(c, contrast, highlights, shadows, whites, blacks);
    c = applySaturation(clamp(c, 0.0, 1.0), 0.0, saturation);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`.replace(/MAX_MASKS_DECL/g, '8')
