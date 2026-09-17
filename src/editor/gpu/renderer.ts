import { CURVE_LUT_SIZE, isIdentityCurve, sampleCurve } from '../presets/curve'
import { HSL_BANDS, type EditState } from '../edit-stack/types'
import { NEUTRAL_TEMPERATURE, identityCurves } from '../edit-stack/defaults'
import type { Lut3D } from '../presets/lut3d'
import type { LookConfig } from '../presets/types'
import { BLUR_FRAG } from '../shaders/blur.glsl'
import { COLOR_FRAG } from '../shaders/color.glsl'
import { DETAIL_FRAG } from '../shaders/detail.glsl'
import { FINISH_FRAG } from '../shaders/finish.glsl'
import { PASSTHROUGH_VERT, QUAD_VERT } from '../shaders/quad.glsl'
import { RenderTarget, SCRATCH_UNIT, Uniforms, createProgram, createQuad } from './gl'
import { buildUvTransform, mat3Identity, uprightSize } from './transform'
import type { Orientation } from '../../io/exif'
import { whiteBalanceGain } from './whitebalance'

export interface RenderOptions {
  edits: EditState
  look: LookConfig | null
  /** 0..1 — everything left of this shows the unedited original. */
  splitAt?: number | null
  /** Render the original only, ignoring every adjustment. */
  beforeOnly?: boolean
}

type Canvas = HTMLCanvasElement | OffscreenCanvas

/**
 * The render graph of spec §6. One WebGL2 context drives both the live preview
 * and the full-resolution export; the only difference is the size of the
 * drawing buffer and whether the result is read back.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext

  private quad: { vao: WebGLVertexArrayObject; buffer: WebGLBuffer }
  private colorProgram: WebGLProgram
  private blurProgram: WebGLProgram
  private detailProgram: WebGLProgram
  private finishProgram: WebGLProgram
  private colorU: Uniforms
  private blurU: Uniforms
  private detailU: Uniforms
  private finishU: Uniforms

  private rtColor: RenderTarget
  private rtPing: RenderTarget
  private rtWide: RenderTarget
  private rtTight: RenderTarget
  private rtDetail: RenderTarget
  private rtRead: RenderTarget

  private imageTexture: WebGLTexture | null = null
  private curveTexture: WebGLTexture
  private lutTexture: WebGLTexture | null = null
  private lutSize = 0

  /** Dimensions of the image the right way up — what the transform works in. */
  private uprightWidth = 0
  private uprightHeight = 0
  private orientation: Orientation = 1
  private disposed = false

  constructor(canvas: Canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null

    if (!gl) {
      throw new Error(
        'This browser has no WebGL2. 35mm needs it to process photos on your machine.',
      )
    }
    if (gl.isContextLost()) {
      throw new Error('The WebGL2 context for this canvas has been lost.')
    }
    this.gl = gl

    this.quad = createQuad(gl)
    this.colorProgram = createProgram(gl, QUAD_VERT, COLOR_FRAG)
    this.blurProgram = createProgram(gl, PASSTHROUGH_VERT, BLUR_FRAG)
    this.detailProgram = createProgram(gl, PASSTHROUGH_VERT, DETAIL_FRAG)
    this.finishProgram = createProgram(gl, PASSTHROUGH_VERT, FINISH_FRAG)
    this.colorU = new Uniforms(gl, this.colorProgram)
    this.blurU = new Uniforms(gl, this.blurProgram)
    this.detailU = new Uniforms(gl, this.detailProgram)
    this.finishU = new Uniforms(gl, this.finishProgram)

    const mk = () => new RenderTarget(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    this.rtColor = mk()
    this.rtPing = mk()
    this.rtWide = mk()
    this.rtTight = mk()
    this.rtDetail = mk()
    this.rtRead = mk()

    this.curveTexture = this.createCurveTexture()
  }

  /** Upright size, i.e. the photo as the user sees it. */
  get imageSize() {
    return { width: this.uprightWidth, height: this.uprightHeight }
  }

  get hasImage() {
    return this.imageTexture !== null
  }

  /* ─────────────────────────── resources ─────────────────────────── */

  setImage(
    source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
    orientation: Orientation = 1,
  ) {
    const gl = this.gl
    if (this.imageTexture) gl.deleteTexture(this.imageTexture)

    const tex = gl.createTexture()
    if (!tex) throw new Error('WebGL: could not allocate the image texture')

    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.imageTexture = tex
    this.orientation = orientation

    const upright = uprightSize(source.width, source.height, orientation)
    this.uprightWidth = upright.width
    this.uprightHeight = upright.height
  }

  setLut(lut: Lut3D | null) {
    const gl = this.gl
    if (!lut) {
      if (this.lutTexture) {
        gl.deleteTexture(this.lutTexture)
        this.lutTexture = null
        this.lutSize = 0
      }
      return
    }

    if (!this.lutTexture) {
      this.lutTexture = gl.createTexture()
      if (!this.lutTexture) throw new Error('WebGL: could not allocate the LUT texture')
    }

    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture)
    // RGBA16F with LINEAR filtering gives hardware trilinear interpolation, so
    // the shader gets a smooth lookup for one fetch (spec §4.3).
    const rgba = new Float32Array(lut.size ** 3 * 4)
    for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4) {
      rgba[j] = lut.data[i]
      rgba[j + 1] = lut.data[i + 1]
      rgba[j + 2] = lut.data[i + 2]
      rgba[j + 3] = 1
    }
    gl.texImage3D(
      gl.TEXTURE_3D, 0, gl.RGBA16F, lut.size, lut.size, lut.size, 0,
      gl.RGBA, gl.FLOAT, rgba,
    )
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)

    this.lutSize = lut.size
  }

  private createCurveTexture(): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()
    if (!tex) throw new Error('WebGL: could not allocate the curve texture')

    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // NEAREST: R32F is not linearly filterable without an extension, and 256
    // steps is finer than the 8-bit output can show anyway.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F, CURVE_LUT_SIZE, 4, 0,
      gl.RED, gl.FLOAT, new Float32Array(CURVE_LUT_SIZE * 4),
    )
    return tex
  }

  private uploadCurves(edits: EditState): boolean {
    const gl = this.gl
    const { rgb, r, g, b } = edits.curves
    const identity =
      isIdentityCurve(rgb) && isIdentityCurve(r) && isIdentityCurve(g) && isIdentityCurve(b)
    if (identity) return false

    const data = new Float32Array(CURVE_LUT_SIZE * 4)
    data.set(sampleCurve(rgb), 0)
    data.set(sampleCurve(r), CURVE_LUT_SIZE)
    data.set(sampleCurve(g), CURVE_LUT_SIZE * 2)
    data.set(sampleCurve(b), CURVE_LUT_SIZE * 3)

    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture)
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, CURVE_LUT_SIZE, 4,
      gl.RED, gl.FLOAT, data,
    )
    return true
  }

  /* ─────────────────────────── drawing ─────────────────────────── */

  private draw() {
    const gl = this.gl
    gl.bindVertexArray(this.quad.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  private bindTexture(unit: number, target: number, texture: WebGLTexture | null) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target, texture)
  }

  /** Colour pass — writes the geometry-corrected, graded image into `rtColor`. */
  private colorPass(width: number, height: number, edits: EditState, look: LookConfig | null) {
    const gl = this.gl
    const hasCurves = this.uploadCurves(edits)

    this.rtColor.resize(width, height)
    this.rtColor.bind()
    gl.useProgram(this.colorProgram)

    this.bindTexture(0, gl.TEXTURE_2D, this.imageTexture)
    this.bindTexture(1, gl.TEXTURE_2D, this.curveTexture)
    this.bindTexture(2, gl.TEXTURE_3D, this.lutTexture)
    this.colorU.i('uImage', 0)
    this.colorU.i('uCurves', 1)
    this.colorU.i('uLut', 2)

    this.colorU.mat3(
      'uUvTransform',
      this.uprightWidth
        ? buildUvTransform(this.uprightWidth, this.uprightHeight, edits.crop, this.orientation)
        : mat3Identity(),
    )

    const [gr, gg, gb] = whiteBalanceGain(edits.temperature, edits.tint)
    this.colorU.v3('uWbGain', gr, gg, gb)
    this.colorU.f('uExposure', edits.exposure)
    this.colorU.f('uContrast', edits.contrast / 100)
    this.colorU.f('uHighlights', edits.highlights / 100)
    this.colorU.f('uShadows', edits.shadows / 100)
    this.colorU.f('uWhites', edits.whites / 100)
    this.colorU.f('uBlacks', edits.blacks / 100)
    this.colorU.f('uVibrance', edits.vibrance / 100)
    this.colorU.f('uSaturation', edits.saturation / 100)
    this.colorU.b('uHasCurves', hasCurves)

    const hue: number[] = []
    const sat: number[] = []
    const lum: number[] = []
    let hasHsl = false
    for (const band of HSL_BANDS) {
      const a = edits.hsl[band]
      hue.push(a.hue / 100)
      sat.push(a.sat / 100)
      lum.push(a.lum / 100)
      if (a.hue || a.sat || a.lum) hasHsl = true
    }
    this.colorU.fv('uHslH', hue)
    this.colorU.fv('uHslS', sat)
    this.colorU.fv('uHslL', lum)
    this.colorU.b('uHasHsl', hasHsl)

    const lookActive = Boolean(look && this.lutTexture && this.lutSize > 0)
    this.colorU.b('uHasLut', lookActive)
    this.colorU.f('uLookStrength', lookActive ? edits.look.strength / 100 : 0)

    this.draw()
  }

  private blurInto(
    dest: RenderTarget,
    source: WebGLTexture,
    width: number,
    height: number,
    radius: number,
  ) {
    const gl = this.gl
    gl.useProgram(this.blurProgram)
    this.blurU.i('uImage', 0)
    this.blurU.v2('uTexel', 1 / width, 1 / height)
    this.blurU.f('uRadius', radius)

    this.rtPing.resize(width, height)
    this.rtPing.bind()
    this.bindTexture(0, gl.TEXTURE_2D, source)
    this.blurU.v2('uDirection', 1, 0)
    this.draw()

    dest.resize(width, height)
    dest.bind()
    this.bindTexture(0, gl.TEXTURE_2D, this.rtPing.texture)
    this.blurU.v2('uDirection', 0, 1)
    this.draw()
  }

  private detailPass(width: number, height: number, edits: EditState): RenderTarget {
    const needsDetail =
      edits.clarity !== 0 || edits.sharpen > 0 || edits.denoiseLuma > 0 || edits.denoiseChroma > 0
    if (!needsDetail) return this.rtColor

    const gl = this.gl
    // Clarity works on a wide radius that scales with the image; sharpening and
    // denoise want a radius near one pixel regardless of size.
    const wideRadius = Math.max(3, Math.min(width, height) / 90)
    this.blurInto(this.rtWide, this.rtColor.texture, width, height, wideRadius)
    this.blurInto(this.rtTight, this.rtColor.texture, width, height, 1.1)

    this.rtDetail.resize(width, height)
    this.rtDetail.bind()
    gl.useProgram(this.detailProgram)

    this.bindTexture(0, gl.TEXTURE_2D, this.rtColor.texture)
    this.bindTexture(1, gl.TEXTURE_2D, this.rtWide.texture)
    this.bindTexture(2, gl.TEXTURE_2D, this.rtTight.texture)
    this.detailU.i('uImage', 0)
    this.detailU.i('uWideBlur', 1)
    this.detailU.i('uTightBlur', 2)
    this.detailU.f('uClarity', edits.clarity / 100)
    this.detailU.f('uSharpen', edits.sharpen / 100)
    this.detailU.f('uDenoiseLuma', edits.denoiseLuma / 100)
    this.detailU.f('uDenoiseChroma', edits.denoiseChroma / 100)
    this.draw()

    return this.rtDetail
  }

  private finishPass(
    source: RenderTarget,
    width: number,
    height: number,
    edits: EditState,
    look: LookConfig | null,
    destFramebuffer: WebGLFramebuffer | null,
    scissor?: { x: number; y: number; width: number; height: number },
  ) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, destFramebuffer)
    if (scissor) {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height)
    }
    gl.viewport(0, 0, width, height)
    gl.useProgram(this.finishProgram)

    this.bindTexture(0, gl.TEXTURE_2D, source.texture)
    this.finishU.i('uImage', 0)
    this.finishU.v2('uResolution', width, height)
    this.finishU.f('uGrain', edits.grain / 100)
    // Grain size is in output pixels, scaled so 0..100 spans fine to chunky.
    this.finishU.f('uGrainSize', 1 + (edits.grainSize / 100) * 5)
    this.finishU.f('uGrainShadowBias', look?.grain.shadowBias ?? 0.5)
    this.finishU.f('uVignette', edits.vignette / 100)
    // Tie the noise field to the crop so panning the crop does not shimmer.
    this.finishU.f('uSeed', edits.crop.x * 31.7 + edits.crop.y * 17.3)
    this.draw()

    if (scissor) gl.disable(gl.SCISSOR_TEST)
  }

  /**
   * Run the whole chain once, landing in `destFramebuffer` (null = canvas). Any
   * scissor is applied to the final pass only: the intermediate targets have to
   * be written in full, or the blur taps beside the split would read stale
   * pixels from the previous pass.
   */
  private runChain(
    width: number,
    height: number,
    edits: EditState,
    look: LookConfig | null,
    destFramebuffer: WebGLFramebuffer | null,
    scissor?: { x: number; y: number; width: number; height: number },
  ) {
    this.colorPass(width, height, edits, look)
    const detail = this.detailPass(width, height, edits)
    this.finishPass(detail, width, height, edits, look, destFramebuffer, scissor)
  }

  /**
   * Render to the bound canvas. When `splitAt` is set, the chain runs twice and
   * the scissor box keeps the original on the left — the design's split compare.
   */
  render(width: number, height: number, options: RenderOptions) {
    if (!this.imageTexture || width <= 0 || height <= 0) return
    const gl = this.gl
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)

    const { edits, look, splitAt, beforeOnly } = options
    const original = originalEdits(edits)

    if (beforeOnly) {
      this.runChain(width, height, original, null, null)
      return
    }

    this.runChain(width, height, edits, look, null)

    if (splitAt != null && splitAt > 0) {
      const cut = Math.round(width * Math.min(splitAt, 1))
      this.runChain(width, height, original, null, null, { x: 0, y: 0, width: cut, height })
    }
  }

  /**
   * Render off-screen and read the pixels back. Used for the histogram at a
   * small size and for export at full resolution.
   */
  renderToPixels(
    width: number,
    height: number,
    edits: EditState,
    look: LookConfig | null,
  ): Uint8ClampedArray {
    // A dedicated target: the chain writes through rtColor/rtWide/rtDetail, so
    // reading back from any of those would alias a texture the chain samples.
    this.rtRead.resize(width, height)
    this.runChain(width, height, edits, look, this.rtRead.framebuffer)

    const gl = this.gl
    const pixels = new Uint8ClampedArray(width * height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtRead.framebuffer)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return pixels
  }

  /**
   * Release this renderer's GPU objects.
   *
   * `loseContext` force-kills the whole WebGL context, which frees it
   * immediately instead of waiting for the canvas to be collected. That is what
   * a short-lived renderer on its own throwaway canvas wants — browsers cap the
   * number of live contexts, and an export that leaked one per run would
   * eventually push the viewport's context out.
   *
   * It must stay *off* by default: a renderer attached to a canvas that outlives
   * it (the viewport's, which React re-initialises on every StrictMode remount
   * and every fast refresh) would hand the next renderer a dead context, where
   * shaders silently fail to compile with a null info log.
   */
  dispose(options: { loseContext?: boolean } = {}) {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl

    for (const rt of [this.rtColor, this.rtPing, this.rtWide, this.rtTight, this.rtDetail, this.rtRead]) {
      rt.dispose()
    }
    for (const p of [this.colorProgram, this.blurProgram, this.detailProgram, this.finishProgram]) {
      gl.deleteProgram(p)
    }
    if (this.imageTexture) gl.deleteTexture(this.imageTexture)
    if (this.lutTexture) gl.deleteTexture(this.lutTexture)
    gl.deleteTexture(this.curveTexture)
    gl.deleteVertexArray(this.quad.vao)
    gl.deleteBuffer(this.quad.buffer)

    if (options.loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/**
 * The "before" state: geometry kept, every adjustment dropped. Comparing
 * against an uncropped frame would just look like a different photo.
 */
function originalEdits(edits: EditState): EditState {
  return {
    ...edits,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: NEUTRAL_TEMPERATURE,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    curves: identityCurves(),
    hsl: Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 0, sat: 0, lum: 0 }])) as EditState['hsl'],
    look: { id: null, strength: 0 },
    clarity: 0,
    sharpen: 0,
    denoiseLuma: 0,
    denoiseChroma: 0,
    grain: 0,
    vignette: 0,
  }
}
