import { describe, expect, it } from 'vitest'
import { parseLuaTable } from './lua'

describe('parseLuaTable', () => {
  it('reads named keys and the usual scalar types', () => {
    expect(parseLuaTable(`s = {
      name = "Golden Hour",
      amount = 12,
      negative = -0.25,
      scientific = 1.5e-3,
      enabled = true,
      disabled = false,
      missing = nil,
    }`)).toEqual({
      name: 'Golden Hour',
      amount: 12,
      negative: -0.25,
      scientific: 0.0015,
      enabled: true,
      disabled: false,
      missing: null,
    })
  })

  it('reads a positional table as an array', () => {
    expect(parseLuaTable('s = { curve = { 0, 8, 128, 130, 255, 250 } }'))
      .toEqual({ curve: [0, 8, 128, 130, 255, 250] })
  })

  it('nests tables to any depth', () => {
    const t = parseLuaTable('s = { value = { settings = { Exposure2012 = 0.5 } } }')
    expect((t.value as never as { settings: { Exposure2012: number } }).settings.Exposure2012)
      .toBe(0.5)
  })

  it('reads bracketed string keys', () => {
    expect(parseLuaTable('s = { ["ProcessVersion"] = "11.0" }'))
      .toEqual({ ProcessVersion: '11.0' })
  })

  it('skips line comments, including ones that look like content', () => {
    expect(parseLuaTable(`s = {
      -- Exposure2012 = 99,
      Exposure2012 = 1, -- trailing
    }`)).toEqual({ Exposure2012: 1 })
  })

  it('skips block comments', () => {
    expect(parseLuaTable(`s = {
      --[[ a
      multi-line note ]]
      a = 1,
    }`)).toEqual({ a: 1 })
  })

  it('accepts semicolons as separators and a trailing one', () => {
    expect(parseLuaTable('s = { a = 1; b = 2; }')).toEqual({ a: 1, b: 2 })
  })

  it('reads single-quoted strings and escapes', () => {
    expect(parseLuaTable(`s = { a = 'single', b = "with \\"quotes\\"", c = "tab\\there" }`))
      .toEqual({ a: 'single', b: 'with "quotes"', c: 'tab\there' })
  })

  it('ignores whatever precedes the first brace', () => {
    expect(parseLuaTable('  s   =   \n { a = 1 }')).toEqual({ a: 1 })
  })

  it('allows an empty nested table', () => {
    expect(parseLuaTable('s = { settings = { }, name = "x" }'))
      .toEqual({ settings: [], name: 'x' })
  })

  it('rejects a file with no table at all', () => {
    expect(() => parseLuaTable('return 42')).toThrow(/no Lua table/)
  })

  it('rejects an unclosed table', () => {
    expect(() => parseLuaTable('s = { a = 1,')).toThrow(/unclosed/)
  })

  it('rejects an unterminated string', () => {
    expect(() => parseLuaTable('s = { a = "oops }')).toThrow(/unterminated/)
  })

  it.each(['s = { 1, 2, 3 }', 's = { }'])(
    'rejects %s, which carries no named settings',
    (src) => {
      // A bare or positional top-level table is not a preset. `parseLrTemplate`
      // turns this into the clearer "no value.settings" complaint.
      expect(() => parseLuaTable(src)).toThrow(/no named settings/)
    },
  )
})
