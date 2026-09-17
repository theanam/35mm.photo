/** Thin WebGL2 helpers. Everything here is allocation-aware — the renderer
 *  reuses programs and framebuffers across frames rather than rebuilding them. */

export function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string) {
  const vert = compile(gl, gl.VERTEX_SHADER, vertSrc)
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  const program = gl.createProgram()
  if (!program) throw new Error('WebGL: could not create program')

  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.bindAttribLocation(program, 0, 'aPos')
  gl.linkProgram(program)
  gl.deleteShader(vert)
  gl.deleteShader(frag)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`WebGL: program link failed\n${log}`)
  }
  return program
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('WebGL: could not create shader')
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
    // A lost context fails every compile with an empty log; say so, rather than
    // sending the reader hunting for a syntax error that is not there.
    if (gl.isContextLost()) {
      throw new Error(`WebGL: the context was lost before the ${kind} shader could compile`)
    }
    throw new Error(`WebGL: ${kind} shader failed to compile\n${log || '(no log)'}`)
  }
  return shader
}

/** Caches uniform locations; `gl.getUniformLocation` is not free per frame. */
export class Uniforms {
  private cache = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private gl: WebGL2RenderingContext,
    private program: WebGLProgram,
  ) {}

  loc(name: string): WebGLUniformLocation | null {
    let l = this.cache.get(name)
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name)
      this.cache.set(name, l)
    }
    return l
  }

  f(name: string, v: number) { this.gl.uniform1f(this.loc(name), v) }
  i(name: string, v: number) { this.gl.uniform1i(this.loc(name), v) }
  b(name: string, v: boolean) { this.gl.uniform1i(this.loc(name), v ? 1 : 0) }
  v2(name: string, x: number, y: number) { this.gl.uniform2f(this.loc(name), x, y) }
  v3(name: string, x: number, y: number, z: number) { this.gl.uniform3f(this.loc(name), x, y, z) }
  fv(name: string, v: Float32Array | number[]) { this.gl.uniform1fv(this.loc(name), v) }
  mat3(name: string, m: Float32Array) { this.gl.uniformMatrix3fv(this.loc(name), false, m) }
}

/**
 * Texture unit reserved for mutating textures (resizes, uploads). Binding on a
 * scratch unit means housekeeping can never disturb a unit a sampler is using.
 */
export const SCRATCH_UNIT = 7

/** A colour-only framebuffer that can be resized in place. */
export class RenderTarget {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width = 0
  height = 0

  constructor(
    private gl: WebGL2RenderingContext,
    private internalFormat: number,
    private format: number,
    private type: number,
  ) {
    const tex = gl.createTexture()
    const fb = gl.createFramebuffer()
    if (!tex || !fb) throw new Error('WebGL: could not allocate render target')
    this.texture = tex
    this.framebuffer = fb

    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  resize(width: number, height: number) {
    if (this.width === width && this.height === height) return
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, this.internalFormat, width, height, 0,
      this.format, this.type, null,
    )
    this.width = width
    this.height = height
  }

  bind() {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer)
    gl.viewport(0, 0, this.width, this.height)
  }

  dispose() {
    this.gl.deleteTexture(this.texture)
    this.gl.deleteFramebuffer(this.framebuffer)
  }
}

/** Fullscreen triangle-strip quad in clip space, shared by every pass. */
export function createQuad(gl: WebGL2RenderingContext) {
  const vao = gl.createVertexArray()
  const buffer = gl.createBuffer()
  if (!vao || !buffer) throw new Error('WebGL: could not allocate quad')

  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  )
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  return { vao, buffer }
}
