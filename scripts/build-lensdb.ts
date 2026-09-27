/**
 * Build the lens database the app ships, from the Lensfun project's XML.
 *
 *   node --experimental-strip-types scripts/build-lensdb.ts [--commit <sha>]
 *
 * Pulls `data/db/*.xml` from github.com/lensfun/lensfun at a pinned commit —
 * master rather than a release, because releases lag the data by years — and
 * writes:
 *
 *   public/lensdb/index.json            mounts, cameras and the lens index
 *   public/lensdb/shards/<maker>.json   calibrations, fetched by maker on demand
 *   public/lensdb/ATTRIBUTION.md        the credit and the licence the data keeps
 *
 * The output is a derivative of the database and stays CC BY-SA 3.0. It lives
 * in its own directory with its own notice so the app's licence is unaffected.
 * Everything under `public/lensdb/` is generated: edit this script, not it.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseLensfunXml, slug } from '../src/lens/lensfun-xml.ts'
import type { CalibrationSet, DbCamera, DbLensIndex, DbMount, LensDbIndex, LensDbShard } from '../src/lens/types.ts'

/** Bumped by hand, after a look at what changed. */
const PINNED_COMMIT = 'bbd4332a9ec566fd9aa548c9e0d8ced238c56261'

const REPO = 'lensfun/lensfun'
const OUT = join(process.cwd(), 'public', 'lensdb')

async function main() {
  const commit = argValue('--commit') ?? PINNED_COMMIT
  const listing = (await fetchJson(
    `https://api.github.com/repos/${REPO}/contents/data/db?ref=${commit}`,
  )) as { name: string; download_url: string }[]
  const files = listing.filter((f) => f.name.endsWith('.xml')).sort((a, b) => a.name.localeCompare(b.name))
  console.log(`lensfun @ ${commit.slice(0, 10)}: ${files.length} files`)

  const mounts = new Map<string, DbMount>()
  const cameras = new Map<string, DbCamera>()
  const lenses = new Map<string, DbLensIndex & { calibrations: CalibrationSet[] }>()

  for (const file of files) {
    const xml = await fetchText(`https://raw.githubusercontent.com/${REPO}/${commit}/data/db/${file.name}`)
    const db = parseLensfunXml(xml)
    for (const m of db.mounts) if (!mounts.has(m.name)) mounts.set(m.name, m)
    for (const c of db.cameras) {
      const key = `${c.maker}|${c.model}|${c.variant ?? ''}`
      if (!cameras.has(key)) cameras.set(key, c)
    }
    for (const l of db.lenses) {
      const shard = `shards/${slug(l.maker) || 'other'}.json`
      const seen = lenses.get(l.id)
      if (seen) seen.calibrations.push(...l.calibrations)
      else lenses.set(l.id, { ...l, shard })
    }
    process.stdout.write('.')
  }
  console.log()

  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'shards'), { recursive: true })

  const shards = new Map<string, LensDbShard>()
  const index: LensDbIndex = {
    commit,
    generated: new Date().toISOString().slice(0, 10),
    mounts: [...mounts.values()],
    cameras: [...cameras.values()],
    lenses: [...lenses.values()].map(({ calibrations, ...entry }) => {
      const shard = shards.get(entry.shard) ?? new Map()
      const bucket: LensDbShard = shards.get(entry.shard) ?? {}
      bucket[entry.id] = calibrations
      shards.set(entry.shard, bucket)
      void shard
      return entry
    }),
  }

  await writeFile(join(OUT, 'index.json'), JSON.stringify(index))
  let shardBytes = 0
  for (const [path, shard] of shards) {
    const json = JSON.stringify(shard)
    shardBytes += json.length
    await writeFile(join(OUT, path), json)
  }
  await writeFile(join(OUT, 'ATTRIBUTION.md'), attribution(commit, index))

  const indexBytes = (await readFile(join(OUT, 'index.json'))).length
  console.log(
    `${index.cameras.length} cameras, ${index.lenses.length} lenses, ${index.mounts.length} mounts` +
      ` → index ${(indexBytes / 1024).toFixed(0)} KB, ${shards.size} shards ${(shardBytes / 1024).toFixed(0)} KB`,
  )
}

function attribution(commit: string, index: LensDbIndex): string {
  return `# Lens database

The files in this directory are generated from the Lensfun project's lens
database and are **not** part of 35mm's own code. They are a derivative work
of that database and are distributed under its licence, the
[Creative Commons Attribution-Share Alike 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
licence.

| | |
| --- | --- |
| Source | https://github.com/lensfun/lensfun, \`data/db/*.xml\` |
| Commit | \`${commit}\` |
| Generated | ${index.generated} by \`scripts/build-lensdb.ts\` |
| Contents | ${index.cameras.length} cameras, ${index.lenses.length} lenses, ${index.mounts.length} mounts |
| Licence | CC BY-SA 3.0 |

Lensfun is the work of its contributors — the calibrations were measured by
photographers who submitted their own lenses. Corrections to a profile belong
upstream, at https://lensfun.github.io/, where they help every application
that reads the database.
`
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': '35mm build-lensdb' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  return res.text()
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': '35mm build-lensdb', Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  return res.json()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
