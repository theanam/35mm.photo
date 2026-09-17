export interface GpuCapabilities {
  webgl2: boolean
  /** Reported for the progressive-enhancement path in spec §2; the active
   *  backend is still WebGL2. */
  webgpu: boolean
  offscreenCanvas: boolean
  maxTextureSize: number
  max3dTextureSize: number
  renderer?: string
}

let cached: GpuCapabilities | null = null

export function detectCapabilities(): GpuCapabilities {
  if (cached) return cached

  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  const debug = gl?.getExtension('WEBGL_debug_renderer_info')

  cached = {
    webgl2: Boolean(gl),
    webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0,
    max3dTextureSize: gl ? gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) : 0,
    renderer: debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : undefined,
  }

  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  return cached
}
