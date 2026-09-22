/**
 * Which build assets belong to which part of the app.
 *
 * The app ships as fingerprinted files, so nothing checked in can name them —
 * the build writes this out, and both the service worker and the prefetcher
 * read it. Grouping matters because the parts have wildly different weights and
 * wildly different claims on someone's connection:
 *
 *   shell    ~0.5 MB   the app itself; useless without it
 *   raw      ~1.6 MB   LibRaw, for camera raw files
 *   heic     ~2.0 MB   libheif, for the photos phones actually take
 *   subject  ~17 MB    the detector and its runtime, which the user is asked
 *                      about before it is ever fetched
 *
 * ## Why this matches names, and why that is guarded
 *
 * Following the import graph would be better, and does not work: Vite builds
 * workers in a second Rollup pass, so the main bundle contains three chunks and
 * no edge to the LibRaw binary, the detector's runtime or libheif. There is no
 * graph to follow.
 *
 * Matching names is therefore the only option, and it is a guess — a guess that
 * has already been wrong twice here. `wasm-bundle` reads like the detector's
 * runtime and is in fact libheif's two megabytes; the detector's runtime turned
 * out to be inlined into its own worker. Both mistakes were silent, and both
 * had the same shape: a binary quietly filed under `shell`, which is the one
 * group that is precached for every visitor.
 *
 * So `verifyGroups` refuses the build if any binary lands in the shell, or if a
 * group that should never be empty is. A rename now breaks the build instead of
 * quietly precaching seventeen megabytes of model weights.
 */

export interface AssetGroups {
  shell: string[]
  raw: string[]
  heic: string[]
  subject: string[]
}

/**
 * The salient object detector. Its ONNX Runtime is compiled into the worker
 * rather than sitting in a chunk of its own, so the worker and the wasm it
 * references are the whole of it, plus the weights from `public/`.
 */
const SUBJECT = /(^|\/)(ort-wasm|subject-worker)|\.onnx$/

/**
 * HEIC. `wasm-bundle` is libheif — verified by reading the built worker, which
 * imports it — and emphatically not the detector's, whatever the name suggests.
 */
const HEIC = /(^|\/)(heic|heic-worker|wasm-bundle)-/

/**
 * Raw development: the LibRaw binary, its own prebuilt worker, and the two
 * small chunks around them.
 *
 * `worker-` is anchored so it matches LibRaw's worker without also catching
 * `subject-worker-`, `heic-worker-` or `histogram-worker-`.
 */
const RAW = /(^|\/)(libraw|decode-raw|preview-worker|worker)-/

/** The worker and the manifest describe the cache; they are never inside it. */
const NEVER = /(^|\/)(sw\.js|precache\.json|sitemap\.xml|chunks\.json)$/

export function groupAssets(files: string[]): AssetGroups {
  const groups: AssetGroups = { shell: [], raw: [], heic: [], subject: [] }

  for (const file of files) {
    if (NEVER.test(file)) continue
    if (SUBJECT.test(file)) groups.subject.push(file)
    else if (HEIC.test(file)) groups.heic.push(file)
    else if (RAW.test(file)) groups.raw.push(file)
    // Anything unrecognised is part of the app. An app that will not start
    // offline is a worse failure than a slightly large precache — and the
    // verification below is what stops that default hiding a binary.
    else groups.shell.push(file)
  }

  for (const key of Object.keys(groups) as (keyof AssetGroups)[]) groups[key].sort()
  return groups
}

/** A compiled binary or a set of model weights — never part of the app shell. */
const BINARY = /\.(wasm|onnx|bin|data)$/

/**
 * Check the grouping against what we know must be true of it, and say plainly
 * what is wrong if it is not. Called by the build, which fails on the message.
 */
export function verifyGroups(groups: AssetGroups): string[] {
  const problems: string[] = []

  for (const file of groups.shell) {
    if (BINARY.test(file)) {
      problems.push(
        `${file} was classified as shell, which precaches it for every visitor. ` +
          'Binaries belong to a feature group — add a pattern for it in asset-groups.ts.',
      )
    }
  }

  for (const key of ['shell', 'raw', 'heic', 'subject'] as const) {
    if (!groups[key].length) {
      problems.push(
        `the "${key}" group is empty, which means its files were renamed and are ` +
          'now being cached as part of the shell.',
      )
    }
  }

  return problems
}
