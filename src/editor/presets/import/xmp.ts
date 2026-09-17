import { mapCrsSettings, type CrsResult, type CrsSettings } from './crs'

/**
 * Lightroom Classic / Camera Raw `.xmp` presets — the format Adobe has shipped
 * since 2018, and the same one a raw sidecar uses, so this importer reads both.
 *
 * The settings live in the `crs:` namespace either as attributes on
 * `rdf:Description` or as its child elements; writers pick freely between the
 * two, sometimes within one file, so both are collected.
 */

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const CRS_NS = 'http://ns.adobe.com/camera-raw-settings/1.0/'

export interface ParsedXmp extends CrsResult {
  name: string | null
}

export function parseXmpPreset(text: string): ParsedXmp {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('is not valid XML')
  }

  const rdf = doc.getElementsByTagNameNS(RDF_NS, 'RDF')[0]
  if (!rdf) throw new Error('has no rdf:RDF block — is it really an XMP file?')

  const settings: CrsSettings = {}
  let name: string | null = null

  // Only the top-level descriptions. Going deeper would pull in the parameters
  // of an embedded profile and mix them into the preset's own settings.
  for (const desc of Array.from(rdf.children)) {
    if (desc.namespaceURI !== RDF_NS || desc.localName !== 'Description') continue

    for (const attr of Array.from(desc.attributes)) {
      if (attr.namespaceURI === CRS_NS) settings[attr.localName] = attr.value
    }

    for (const child of Array.from(desc.children)) {
      if (child.namespaceURI !== CRS_NS) continue
      const key = child.localName

      if (key === 'Name') {
        name = altLangValue(child) ?? child.textContent?.trim() ?? null
        continue
      }

      const list = listValue(child)
      if (list) {
        settings[key] = list
        continue
      }
      const alt = altLangValue(child)
      if (alt != null) {
        settings[key] = alt
        continue
      }
      // A structured value — an embedded profile, a mask group. Record that it
      // exists so the importer can report it, without trying to read it.
      if (child.getElementsByTagNameNS(RDF_NS, 'Description').length) {
        settings[key] = true
        continue
      }
      settings[key] = child.textContent?.trim() ?? ''
    }
  }

  if (!Object.keys(settings).length) {
    throw new Error('has no crs: settings — it may be metadata rather than a preset')
  }

  return { name: name || null, ...mapCrsSettings(settings) }
}

function listValue(el: Element): string[] | null {
  const container =
    el.getElementsByTagNameNS(RDF_NS, 'Seq')[0] ?? el.getElementsByTagNameNS(RDF_NS, 'Bag')[0]
  if (!container) return null
  return Array.from(container.getElementsByTagNameNS(RDF_NS, 'li')).map(
    (li) => li.textContent?.trim() ?? '',
  )
}

function altLangValue(el: Element): string | null {
  const alt = el.getElementsByTagNameNS(RDF_NS, 'Alt')[0]
  if (!alt) return null
  const li = alt.getElementsByTagNameNS(RDF_NS, 'li')[0]
  return li?.textContent?.trim() ?? null
}
