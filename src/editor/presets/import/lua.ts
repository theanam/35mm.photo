/**
 * A reader for the restricted Lua that `.lrtemplate` files are written in:
 * one top-level table of nested tables, strings, numbers and booleans. No
 * expressions, no function calls, no metatables — Lightroom only ever wrote
 * data here, so a tokeniser and a recursive descent over values is the whole
 * job, and nothing in it can execute.
 */

export type LuaValue = string | number | boolean | null | LuaValue[] | LuaTable
export interface LuaTable {
  [key: string]: LuaValue
}

export function parseLuaTable(src: string): LuaTable {
  const p = new Parser(src)
  p.skipToTable()
  const value = p.table()
  if (Array.isArray(value)) throw new Error('has no named settings at the top level')
  return value
}

class Parser {
  private i = 0

  constructor(private readonly src: string) {}

  /** Step over the `s = ` preamble to the opening brace. */
  skipToTable() {
    this.ws()
    const at = this.src.indexOf('{', this.i)
    if (at === -1) throw new Error('contains no Lua table')
    this.i = at
  }

  table(): LuaValue[] | LuaTable {
    this.expect('{')
    const array: LuaValue[] = []
    const named: LuaTable = {}
    let hasNamed = false

    for (;;) {
      this.ws()
      if (this.peek() === '}') {
        this.i++
        break
      }
      if (this.i >= this.src.length) throw new Error('has an unclosed table')

      const key = this.tryKey()
      const value = this.value()
      if (key == null) {
        array.push(value)
      } else {
        named[key] = value
        hasNamed = true
      }

      this.ws()
      if (this.peek() === ',' || this.peek() === ';') this.i++
    }

    return hasNamed ? named : array
  }

  /** `name =`, `["name"] =` or nothing, in which case this is an array entry. */
  private tryKey(): string | null {
    const start = this.i
    this.ws()

    if (this.peek() === '[') {
      this.i++
      this.ws()
      const key = this.value()
      this.ws()
      this.expect(']')
      this.ws()
      this.expect('=')
      return String(key)
    }

    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.i))
    if (m) {
      const after = this.i + m[0].length
      const rest = this.src.slice(after)
      // `name = value` is a key; a bare identifier is a keyword value.
      if (/^\s*=(?!=)/.test(rest)) {
        this.i = after
        this.ws()
        this.expect('=')
        return m[0]
      }
    }

    this.i = start
    return null
  }

  private value(): LuaValue {
    this.ws()
    const c = this.peek()

    if (c === '{') return this.table()
    if (c === '"' || c === "'") return this.string(c)

    const rest = this.src.slice(this.i)
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(rest)
    if (num) {
      this.i += num[0].length
      return Number.parseFloat(num[0])
    }

    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)
    if (word) {
      this.i += word[0].length
      if (word[0] === 'true') return true
      if (word[0] === 'false') return false
      if (word[0] === 'nil') return null
      return word[0]
    }

    throw new Error(`has an unreadable value at character ${this.i}`)
  }

  private string(quote: string): string {
    this.i++ // opening quote
    let out = ''
    while (this.i < this.src.length) {
      const c = this.src[this.i]
      if (c === '\\') {
        const next = this.src[this.i + 1]
        out += ESCAPES[next] ?? next
        this.i += 2
        continue
      }
      if (c === quote) {
        this.i++
        return out
      }
      out += c
      this.i++
    }
    throw new Error('has an unterminated string')
  }

  private ws() {
    for (;;) {
      while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++
      if (this.src.startsWith('--[[', this.i)) {
        const end = this.src.indexOf(']]', this.i)
        this.i = end === -1 ? this.src.length : end + 2
        continue
      }
      if (this.src.startsWith('--', this.i)) {
        const end = this.src.indexOf('\n', this.i)
        this.i = end === -1 ? this.src.length : end + 1
        continue
      }
      return
    }
  }

  private peek(): string {
    return this.src[this.i] ?? ''
  }

  private expect(ch: string) {
    this.ws()
    if (this.src[this.i] !== ch) {
      throw new Error(`expected "${ch}" at character ${this.i}`)
    }
    this.i++
  }
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  '"': '"',
  "'": "'",
}
