import type {
  CalibDistortion,
  CalibTca,
  CalibVignetting,
  CalibrationSet,
  DbCamera,
  DbLens,
  DbMount,
} from './types.ts'

/**
 * The Lensfun XML database, read into the shapes in `types.ts`.
 *
 * A small parser of its own rather than a DOM: this runs in the build script
 * under Node, where there is no `DOMParser`, and the format is simple enough —
 * elements, attributes, text, comments — that a general parser would be more
 * code than the data deserves. The attribute names and defaults follow
 * `libs/lensfun/database.cpp`, which is the reference for what each one means.
 */

interface Node {
  tag: string
  attrs: Record<string, string>
  text: string
  children: Node[]
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)

/** Parse one document into its root element. */
export function parseXml(xml: string): Node {
  const root: Node = { tag: '#root', attrs: {}, text: '', children: [] }
  const stack: Node[] = [root]
  const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(xml))) {
    const [, close, open, attrText, selfClose, text] = m
    const top = stack[stack.length - 1]
    if (text !== undefined) {
      top.text += decode(text)
    } else if (close) {
      if (top.tag !== close) throw new Error(`lensfun xml: </${close}> closes <${top.tag}>`)
      stack.pop()
    } else if (open) {
      const attrs: Record<string, string> = {}
      const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"/g
      let a: RegExpExecArray | null
      while ((a = attrRe.exec(attrText ?? ''))) attrs[a[1]] = decode(a[2])
      const node: Node = { tag: open, attrs, text: '', children: [] }
      top.children.push(node)
      if (!selfClose) stack.push(node)
    }
  }
  if (stack.length !== 1) throw new Error(`lensfun xml: <${stack[stack.length - 1].tag}> never closed`)
  return root
}

const child = (n: Node, tag: string) => n.children.find((c) => c.tag === tag)
const children = (n: Node, tag: string) => n.children.filter((c) => c.tag === tag)
const textOf = (n: Node | undefined) => n?.text.trim() ?? ''
const num = (s: string | undefined, fallback = 0) => {
  const v = Number(s)
  return Number.isFinite(v) ? v : fallback
}

/**
 * The untranslated name, which is the canonical one: the database keys its
 * own cross-references on it. An `lang="en"` sibling is kept for display.
 */
function names(n: Node, tag: string): { canonical: string; en?: string } {
  const all = children(n, tag)
  const canonical = textOf(all.find((c) => !c.attrs.lang)) || textOf(all[0])
  const en = textOf(all.find((c) => c.attrs.lang === 'en')) || undefined
  return { canonical, en }
}

/** "3:2" or "1.5", as `database.cpp` reads it. */
function aspectRatio(s: string | undefined, fallback: number): number {
  if (!s) return fallback
  const colon = s.indexOf(':')
  if (colon > 0) return num(s.slice(0, colon)) / (num(s.slice(colon + 1)) || 1)
  return num(s, fallback)
}

export interface ParsedDb {
  mounts: DbMount[]
  cameras: DbCamera[]
  lenses: Omit<DbLens, 'shard'>[]
}

/** A stable id from the canonical maker and model. */
export function lensId(maker: string, model: string): string {
  return slug(`${maker} ${model}`)
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseLensfunXml(xml: string): ParsedDb {
  const doc = parseXml(xml)
  const db = child(doc, 'lensdatabase')
  if (!db) throw new Error('lensfun xml: no <lensdatabase> root')

  const mounts: DbMount[] = children(db, 'mount').map((m) => ({
    name: names(m, 'name').canonical,
    compat: children(m, 'compat').map(textOf).filter(Boolean),
  }))

  const cameras: DbCamera[] = children(db, 'camera').map((c) => {
    const variant = textOf(child(c, 'variant'))
    return {
      maker: names(c, 'maker').canonical,
      model: names(c, 'model').canonical,
      ...(variant ? { variant } : {}),
      mount: textOf(child(c, 'mount')),
      crop: num(textOf(child(c, 'cropfactor')), 1),
    }
  })

  const lenses = children(db, 'lens').map((l) => parseLens(l))
  return { mounts, cameras, lenses }
}

function parseLens(l: Node): Omit<DbLens, 'shard'> {
  const maker = names(l, 'maker').canonical
  const model = names(l, 'model')
  const legacyCrop = num(textOf(child(l, 'cropfactor')), 1)
  const legacyAspect = aspectRatio(textOf(child(l, 'aspect-ratio')) || undefined, 1.5)
  const type = textOf(child(l, 'type')) || undefined

  const calibrations: CalibrationSet[] = children(l, 'calibration').map((cal, i) => {
    // The first set without its own attributes inherits the lens-level ones,
    // which is the pre-0.3.95 layout; later sets always say what sensor they
    // were made on.
    const crop = cal.attrs.cropfactor ? num(cal.attrs.cropfactor, legacyCrop) : i === 0 ? legacyCrop : 1
    const aspect = aspectRatio(cal.attrs['aspect-ratio'], i === 0 ? legacyAspect : 1.5)
    return {
      crop,
      aspect,
      distortion: children(cal, 'distortion').map(parseDistortion).filter((d): d is CalibDistortion => d !== null),
      tca: children(cal, 'tca').map(parseTca).filter((t): t is CalibTca => t !== null),
      vignetting: children(cal, 'vignetting').map(parseVignetting).filter((v): v is CalibVignetting => v !== null),
    }
  })

  const focals = calibrations.flatMap((c) => [
    ...c.distortion.map((d) => d.focal),
    ...c.tca.map((t) => t.focal),
    ...c.vignetting.map((v) => v.focal),
  ])
  const apertures = calibrations.flatMap((c) => c.vignetting.map((v) => v.aperture))

  const has: DbLens['has'] = []
  if (calibrations.some((c) => c.distortion.length)) has.push('distortion')
  if (calibrations.some((c) => c.tca.length)) has.push('tca')
  if (calibrations.some((c) => c.vignetting.length)) has.push('vignetting')

  return {
    id: lensId(maker, model.canonical),
    maker,
    model: model.canonical,
    ...(model.en ? { name: model.en } : {}),
    mounts: children(l, 'mount').map(textOf).filter(Boolean),
    minFocal: focals.length ? Math.min(...focals) : 0,
    maxFocal: focals.length ? Math.max(...focals) : 0,
    ...(apertures.length ? { minAperture: Math.min(...apertures) } : {}),
    crop: legacyCrop,
    ...(type ? { type } : {}),
    has,
    calibrations,
  }
}

function parseDistortion(n: Node): CalibDistortion | null {
  const a = n.attrs
  const focal = num(a.focal, NaN)
  if (!Number.isFinite(focal)) return null
  const realFocal = a['real-focal'] ? num(a['real-focal']) : undefined
  switch (a.model) {
    case 'poly3':
      return { model: 'poly3', focal, ...(realFocal ? { realFocal } : {}), terms: [num(a.k1)] }
    case 'poly5':
      return { model: 'poly5', focal, ...(realFocal ? { realFocal } : {}), terms: [num(a.k1), num(a.k2)] }
    case 'ptlens':
      return { model: 'ptlens', focal, ...(realFocal ? { realFocal } : {}), terms: [num(a.a), num(a.b), num(a.c)] }
    default:
      // "acm" and "none" — neither is implemented, and a lens whose only
      // distortion entries are these simply has no distortion here.
      return null
  }
}

function parseTca(n: Node): CalibTca | null {
  const a = n.attrs
  const focal = num(a.focal, NaN)
  if (!Number.isFinite(focal)) return null
  switch (a.model) {
    case 'linear':
      return { model: 'linear', focal, terms: [num(a.kr, 1), num(a.kb, 1)] }
    case 'poly3':
      return {
        model: 'poly3',
        focal,
        terms: [num(a.vr, 1), num(a.vb, 1), num(a.cr), num(a.cb), num(a.br), num(a.bb)],
      }
    default:
      return null
  }
}

function parseVignetting(n: Node): CalibVignetting | null {
  const a = n.attrs
  if (a.model !== 'pa') return null
  const focal = num(a.focal, NaN)
  if (!Number.isFinite(focal)) return null
  return {
    model: 'pa',
    focal,
    aperture: num(a.aperture, 0),
    distance: num(a.distance, 1000),
    terms: [num(a.k1), num(a.k2), num(a.k3)],
  }
}
