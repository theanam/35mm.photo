import { create } from 'zustand'
import { cloneEdits, defaultEdits, editsEqual } from './defaults'
import { emptyHistory, pushHistory, shouldPush, touchHistory, type History } from './history'
import { countEdits, type PanelId } from './summary'
import { createMask, neutralMaskAdjust, replaceMask, replaceMaskAdjust } from './masks'
import {
  DETECT_VERSION,
  forgetSubjects,
  modelIsWarm,
  rememberSubject,
  subjectFor,
} from '../../subject/detect'
import { fitAspect, offsetBounds, subjectBounds } from '../../subject/bounds'
import { displaySize } from '../gpu/transform'
import { parseAspectRatio } from './aspect'
import { applySyncScope, type SyncGroup } from './sync'
import { MAX_MASKS, type EditState, type Frame, type ImageMeta, type Mask, type MaskAdjust, type MaskKind } from './types'
import type { Orientation } from '../../io/exif'
import { MAX_PREVIEW_EDGE, decodeFile, makeThumbnail } from '../../io/decode'
import { developFor, developFullSource } from '../../io/develop'
import type { DecodeStage } from '../../io/decode'
import { extensionOf, isRawFile } from '../../io/formats'
import type { OpenedFile } from '../../io/file-system'
import { DEFAULT_EXPORT, type ExportSettings } from '../../io/export'
import {
  canBatchExport,
  pickExportDirectory,
  runBatchExport,
  type BatchStatus,
} from '../../io/batch-export'
import { getLook, setCustomPresets } from '../presets/catalogue'
import { forgetLut } from '../presets/lutCache'
import { importPresetFiles } from '../presets/import'
import type { CustomPreset } from '../presets/types'
import type { StoredFramePreset } from '../../storage/indexeddb'
import type { InputSpace } from '../presets/inputSpace'
import type { HistogramData } from '../histogram'
import * as db from '../../storage/indexeddb'

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'warn' | 'error'
}

export type ZoomMode = 'fit' | number

/** How a subject crop should be placed, once the subject itself is found. */
export interface SubjectCropOptions {
  /** Breathing room around the subject, as a fraction of its own box. */
  margin?: number
  /** Shift off the subject, as a fraction of the box. Negative is left/up. */
  offsetX?: number
  offsetY?: number
}

export interface OpenPhoto {
  frameId: string
  key: string
  meta: ImageMeta
  /** Full-resolution decode, kept for export. */
  source: ImageBitmap
  /** Possibly downscaled copy the viewport renders (spec §5). */
  preview: ImageBitmap
  /**
   * True when `source` is really the preview, because this open came from the
   * develop cache and there are no full-resolution pixels in hand. Export asks
   * for them before it writes anything.
   */
  sourceIsPreview?: boolean
  /** The file itself, for readers that want the bytes rather than the pixels. */
  file: File
  handle?: FileSystemFileHandle
}

interface EditorState {
  /* Library */
  frames: Frame[]
  activeFrameId: string | null
  /** Frames picked out for a batch action. The active frame is not implicitly
   *  part of it — selecting is a separate gesture from opening. */
  selection: string[]
  /** Where a shift-click measures from — the last frame picked deliberately. */
  selectionAnchor: string | null
  photo: OpenPhoto | null
  recents: db.StoredEdit[]

  /* Edits */
  edits: EditState
  history: History
  clipboard: EditState | null

  /** LUTs and presets the user has imported (spec §4.3.1). */
  presets: CustomPreset[]
  /** Frames the user has saved, newest first. Kept in this browser only. */
  framePresets: StoredFramePreset[]

  /* UI */
  loading: boolean
  loadingLabel: string
  /** File the loader names, so a slow open says which photo it is waiting on. */
  loadingName: string
  splitCompare: boolean
  splitAt: number
  zoom: ZoomMode
  /** Collapsed/expanded state of the right rail's panels. */
  openPanels: Record<PanelId, boolean>
  focusedPanel: PanelId | null
  /** The toolbar tool holding the right rail, or null when the toolbar is idle. */
  activeTool: PanelId | null
  /**
   * Edit state as it was when the current tool was opened. Discard restores it,
   * which is what makes the per-tool Apply/Discard pair mean anything while the
   * pipeline stays purely parametric.
   */
  toolSnapshot: EditState | null
  cropping: boolean
  /**
   * Which mask the tool is editing. UI state rather than edit state: it decides
   * what the panel shows and what the overlay draws, and nothing about it
   * belongs in a sidecar.
   */
  activeMaskId: string | null
  /**
   * True while a crop handle is under the pointer. The viewport scales itself
   * to the crop box, and rescaling mid-drag would slide the picture out from
   * under the finger doing the dragging — so the zoom settles on release.
   */
  cropDragging: boolean
  /**
   * True while the phone's tool sheet is being dragged between its heights.
   * Same problem as `cropDragging`, one level up: the sheet shortens the stage
   * as it grows, and re-fitting the picture on every frame of the drag would
   * reallocate the drawing buffer sixty times a second. The stage measurement
   * is held still and re-read once, on release.
   */
  sheetDragging: boolean
  /** Paint the selected mask over the picture while the tool is open. */
  maskOverlay: boolean
  /**
   * Bumped when a derived mask map changes. Subject coverage lives outside the
   * edit stack — it is pixels, not numbers — so there is nothing in `edits` for
   * the viewport to notice, and nothing that should reach undo either.
   */
  maskMapsAt: number
  exportOpen: boolean
  aboutOpen: boolean
  batch: BatchState
  syncOpen: boolean
  exifOpen: boolean
  /** Confirmation for "reset everything", which throws away the whole stack. */
  resetOpen: boolean
  exportSettings: ExportSettings
  histogram: HistogramData | null
  /** Published by the viewport so the bottom bar can show the zoom level. */
  viewScale: number
  fitScale: number
  toasts: Toast[]

  /* Derived */
  canUndo: () => boolean
  canRedo: () => boolean
  dirty: () => boolean
  /** True when the open tool has changed anything since it was opened. */
  toolChanged: () => boolean

  /* Actions */
  openFiles: (files: OpenedFile[], options?: { replace?: boolean }) => Promise<void>
  selectFrame: (id: string) => Promise<void>
  toggleFrameSelected: (id: string) => void
  /** Shift-click: the contiguous run from the anchor to `id`. `within` is the
   *  ids currently on screen, so a range never reaches through a filter. */
  selectRangeTo: (id: string, within?: string[]) => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  /** Copy the open photo's chosen groups onto every selected frame. */
  syncToSelection: (groups: SyncGroup[]) => Promise<number>
  /** Render photos into a folder chosen once, up front. Defaults to the
   *  selection; pass ids to export a different set, such as every edited one. */
  exportSelection: (ids?: string[]) => Promise<void>
  /** Take photos out of the filmstrip. The files and their saved edits stay. */
  removeFrames: (ids: string[]) => void
  cancelBatchExport: () => void
  closePhoto: () => void
  /** Record that the open photo's edits have been written to a sidecar. */
  markSidecarSaved: () => void
  refreshRecents: () => Promise<void>
  clearRecents: () => Promise<void>

  loadPresets: () => Promise<void>
  loadFramePresets: () => Promise<void>
  saveFramePreset: (name: string) => Promise<void>
  deleteFramePreset: (id: string) => Promise<void>
  importPresets: (files: File[]) => Promise<void>
  deletePreset: (id: string) => Promise<void>
  setPresetInputSpace: (id: string, space: InputSpace) => Promise<void>

  update: (patch: Partial<EditState>, coalesceKey?: string) => void
  updateCrop: (patch: Partial<EditState['crop']>, coalesceKey?: string) => void
  updateFrame: (patch: Partial<EditState['frame']>, coalesceKey?: string) => void
  applyLook: (id: string | null) => void
  /** Change a develop setting and run the decoder again. */
  updateRawDevelop: (patch: Partial<EditState['raw']>) => void
  /** Full-resolution pixels, developing them first if this open came from cache. */
  ensureFullSource: () => Promise<ImageBitmap | null>
  addMask: (kind: MaskKind) => void
  /** Run the detector for a subject mask, or re-run it after a model change. */
  detectSubjectMask: (id: string) => Promise<void>
  /** Find every subject this photo's masks ask for, if the model is loaded. */
  autoDetectSubjects: () => Promise<void>
  /** Set the crop rectangle to the subject of the photograph. */
  cropToSubject: (options?: SubjectCropOptions) => Promise<void>
  /** True while a detection is in flight, so the tool can say so. */
  detecting: boolean
  removeMask: (id: string) => void
  selectMask: (id: string | null) => void
  updateMask: (id: string, patch: Partial<Mask>, coalesceKey?: string) => void
  updateMaskAdjust: (id: string, patch: Partial<MaskAdjust>, coalesceKey?: string) => void
  setCropDragging: (on: boolean) => void
  setSheetDragging: (on: boolean) => void
  setMaskOverlay: (on: boolean) => void
  replaceEdits: (edits: EditState, coalesceKey?: string) => void
  undo: () => void
  redo: () => void
  resetAll: () => void
  copyLook: () => void
  pasteLook: () => void

  setSplit: (on: boolean) => void
  setSplitAt: (v: number) => void
  setZoom: (z: ZoomMode) => void
  togglePanel: (panel: PanelId, open?: boolean) => void
  focusPanel: (panel: PanelId) => void
  openTool: (tool: PanelId) => void
  closeTool: () => void
  applyTool: () => void
  discardTool: () => void
  setCropping: (on: boolean) => void
  setExportOpen: (open: boolean) => void
  setAboutOpen: (open: boolean) => void
  setSyncOpen: (open: boolean) => void
  setExifOpen: (open: boolean) => void
  setResetOpen: (open: boolean) => void
  setExportSettings: (patch: Partial<ExportSettings>) => void
  setHistogram: (data: HistogramData) => void
  setViewScale: (scale: number, fit: number) => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
}

export interface BatchState {
  running: boolean
  total: number
  saved: number
  failed: number
  /** Per-frame state, so each thumbnail can show where it is in the run. */
  statuses: Record<string, BatchStatus>
  /** What the current photo is doing, for the docked readout. */
  stage: string
}

const IDLE_BATCH: BatchState = {
  running: false,
  total: 0,
  saved: 0,
  failed: 0,
  statuses: {},
  stage: '',
}

let batchAbort: AbortController | null = null

/** Rebuilt never: the comparison target for "has this photo been touched?". */
const PRISTINE = defaultEdits()

/** What the loader says at each stage of a decode. */
const STAGE_LABELS: Record<DecodeStage, string> = {
  reading: 'Reading the file',
  developing: 'Developing the raw',
  // Only ever shown for a HEIC on a browser with no decoder of its own, where
  // the first one also waits on the WASM being fetched.
  decoding: 'Decoding the photo',
  preview: 'Building the preview',
}

const AUTOSAVE_DELAY = 600
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export const useEditor = create<EditorState>((set, get) => ({
  frames: [],
  activeFrameId: null,
  selection: [],
  selectionAnchor: null,
  photo: null,
  recents: [],

  edits: defaultEdits(),
  history: emptyHistory(),
  clipboard: null,
  presets: [],
  framePresets: [],

  loading: false,
  loadingLabel: '',
  loadingName: '',
  splitCompare: false,
  splitAt: 0.38,
  zoom: 'fit',
  openPanels: { light: true, crop: true, looks: true, curves: false, mixer: false, grade: false, lens: false, detail: false, grain: false, frame: false, masks: false, raw: false },
  focusedPanel: null,
  activeTool: null,
  toolSnapshot: null,
  cropping: false,
  activeMaskId: null,
  cropDragging: false,
  sheetDragging: false,
  maskOverlay: true,
  maskMapsAt: 0,
  detecting: false,
  exportOpen: false,
  aboutOpen: false,
  syncOpen: false,
  exifOpen: false,
  resetOpen: false,
  batch: { ...IDLE_BATCH },
  exportSettings: { ...DEFAULT_EXPORT },
  histogram: null,
  viewScale: 1,
  fitScale: 1,
  toasts: [],

  canUndo: () => get().history.past.length > 0,
  canRedo: () => get().history.future.length > 0,
  dirty: () => !editsEqual(get().edits, PRISTINE),
  toolChanged: () => {
    const snapshot = get().toolSnapshot
    return snapshot ? !editsEqual(get().edits, snapshot) : false
  },

  /* ─────────────────────────── library ─────────────────────────── */

  async openFiles(files, options) {
    if (!files.length) return

    // Opening a folder makes the strip that folder. The rail is labelled FOLDER
    // and reads as one place, so leaving the odd file someone opened earlier
    // sitting inside it describes something that is not on disk. Adding files
    // is still additive — that is the gesture asking for more, not for a
    // different folder.
    const existing = options?.replace ? [] : get().frames
    if (options?.replace) {
      for (const frame of get().frames) {
        if (!files.some((f) => db.fileKey(f.file) === frame.id)) openedFiles.delete(frame.id)
        if (frame.thumbUrl) URL.revokeObjectURL(frame.thumbUrl)
      }
    }
    const added: Frame[] = files.map((f) => ({
      id: db.fileKey(f.file),
      meta: {
        name: f.file.name,
        ext: extensionOf(f.file.name),
        isRaw: isRawFile(f.file.name),
        width: 0,
        height: 0,
        orientation: 1,
        bytes: f.file.size,
      },
    }))

    // Re-dropping a photo should select it, not duplicate the filmstrip entry.
    const merged = [...existing]
    for (const [i, frame] of added.entries()) {
      const at = merged.findIndex((f) => f.id === frame.id)
      if (at === -1) merged.push(frame)
      openedFiles.set(frame.id, files[i])
    }

    set({ frames: merged, selection: get().selection.filter((id) => merged.some((f) => f.id === id)) })
    await get().selectFrame(added[0].id)

    // Thumbnails for the rest of the strip, after the first photo is up.
    void hydrateThumbnails(added.map((f) => f.id), set, get)
  },

  async selectFrame(id) {
    const opened = openedFiles.get(id)
    if (!opened) return

    set({
      loading: true,
      loadingLabel: isRawFile(opened.file.name) ? STAGE_LABELS.reading : 'Opening',
      loadingName: opened.file.name,
      activeFrameId: id,
      selectionAnchor: id,
      cropping: false,
    })

    try {
      // Edits are read *before* the decode, not after: they carry the develop
      // settings, and those decide what the decoder is asked for in the first
      // place. Reading them afterwards would develop every raw on the defaults
      // and then quietly disagree with the panel.
      const key = db.fileKey(opened.file)
      const saved = await db.loadEdits(key)
      const edits = saved?.edits ? migrate(saved.edits) : defaultEdits()

      const developed = await developFor(opened.file, edits.raw, (stage) => {
        // Only relabel while this file is still the one being opened; a fast
        // click onto another frame must not be narrated by the old decode.
        if (get().activeFrameId === id) set({ loadingLabel: STAGE_LABELS[stage] })
      })
      // Clicking another photo mid-develop is now an ordinary thing to do, so
      // a result that is no longer the one being waited for is dropped rather
      // than allowed to land on top of whatever the user moved on to.
      if (get().activeFrameId !== id) {
        developed.source.close()
        if (developed.preview !== developed.source) developed.preview.close()
        return
      }

      const { meta, source, preview, sourceIsPreview } = developed

      const previous = get().photo
      if (previous && previous.frameId !== id) {
        previous.source.close()
        if (previous.preview !== previous.source) previous.preview.close()
      }

      set({
        photo: {
          frameId: id,
          key,
          meta,
          source,
          preview,
          sourceIsPreview,
          file: opened.file,
          handle: opened.handle,
        },
        edits,
        history: emptyHistory(),
        histogram: null,
        // The selection named a mask on the photo being left behind.
        activeMaskId: edits.masks[0]?.id ?? null,
        loading: false,
        loadingLabel: '',
        loadingName: '',
        frames: get().frames.map((f) =>
          f.id === id
            ? {
                ...f,
                meta,
                error: undefined,
                editCount: countEdits(edits),
                // A sidecar is a file on disk, and nothing here can see one, so
                // remembered edits count as unwritten until this session writes.
                unsaved: countEdits(edits) > 0,
              }
            : f,
        ),
      })

      if (opened.handle) void db.saveHandle(key, opened.handle)
      void cacheThumbnail(key, id, preview, meta.orientation, set, get)
      void get().refreshRecents()
      // Edits restored from a sidecar or arrived by sync can carry a subject
      // mask that has never been resolved on this photo. It covers nothing
      // until it has been, so resolve it — silently, and only if the model is
      // already loaded.
      void get().autoDetectSubjects()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open that file'
      set({
        loading: false,
        loadingLabel: '',
        loadingName: '',
        frames: get().frames.map((f) => (f.id === id ? { ...f, error: message } : f)),
      })
      get().toast(message, 'error')
    }
  },

  toggleFrameSelected(id) {
    const selection = get().selection
    set({
      selection: selection.includes(id)
        ? selection.filter((s) => s !== id)
        : [...selection, id],
      // Picking one out re-anchors, so a shift-click after it measures from
      // here rather than from wherever the last range happened to end.
      selectionAnchor: id,
    })
  },

  /**
   * Extend the selection to `id`, anchored on whatever was picked last — or on
   * the open photo when nothing is selected yet, which is what a bare
   * shift-click after opening a frame is asking for.
   */
  selectRangeTo(id, within) {
    const { frames, selection, selectionAnchor, activeFrameId } = get()
    const order = within ?? frames.map((f) => f.id)

    const to = order.indexOf(id)
    if (to === -1) return

    // Shift-clicking something already in the selection takes it out. Ranging
    // from the anchor instead would drop everything *except* it, which is the
    // opposite of what clicking a selected thing asks for.
    if (selection.includes(id)) {
      const next = selection.filter((s) => s !== id)
      set({
        selection: next,
        selectionAnchor: selectionAnchor === id ? (next.at(-1) ?? null) : selectionAnchor,
      })
      return
    }

    const anchorId = selectionAnchor ?? activeFrameId
    const from = anchorId ? order.indexOf(anchorId) : -1
    const start = from === -1 ? to : from

    const [lo, hi] = start <= to ? [start, to] : [to, start]
    set({ selection: order.slice(lo, hi + 1), selectionAnchor: anchorId ?? id })
  },

  setSelection(ids) {
    set({ selection: ids })
  },

  clearSelection() {
    set({ selection: [], selectionAnchor: null })
  },

  async syncToSelection(groups) {
    const { selection, frames, photo, edits } = get()
    if (!photo || !selection.length || !groups.length) return 0

    let applied = 0
    for (const id of selection) {
      const frame = frames.find((f) => f.id === id)
      if (!frame) continue

      // The open photo is handled through the edit stack so its history and
      // the viewport both follow; everything else is a stored record, which
      // needs no decode at all.
      if (id === photo.frameId) {
        get().replaceEdits(applySyncScope(edits, edits, groups), 'sync')
        applied++
        continue
      }

      const saved = await db.loadEdits(id)
      const base = saved?.edits ? migrate(saved.edits) : defaultEdits()
      const next = applySyncScope(base, edits, groups)
      const editCount = countEdits(next)

      await db.saveEdits({
        key: id,
        meta: frame.meta,
        edits: next,
        editCount,
        updatedAt: Date.now(),
      })
      set({
        frames: get().frames.map((f) =>
          f.id === id ? { ...f, editCount, unsaved: editCount > 0 } : f,
        ),
      })
      applied++
    }

    void get().refreshRecents()
    return applied
  },

  removeFrames(ids) {
    const drop = new Set(ids)
    if (!drop.size) return

    const { frames, activeFrameId, selection } = get()
    const removedAt = activeFrameId ? frames.findIndex((f) => f.id === activeFrameId) : -1

    for (const frame of frames) {
      if (!drop.has(frame.id)) continue
      // The coverage found for this photo describes a photo that is no longer
      // in the strip, and its id will never be asked for again.
      forgetSubjects(frame.id)
      // The strip is the only holder of these, so let them go with it. The
      // file on disk and anything saved about it in IndexedDB are untouched —
      // reopening the photo brings its edits back.
      if (frame.thumbUrl) URL.revokeObjectURL(frame.thumbUrl)
      openedFiles.delete(frame.id)
    }

    const remaining = frames.filter((f) => !drop.has(f.id))
    set({
      frames: remaining,
      selection: selection.filter((id) => !drop.has(id)),
    })

    if (!activeFrameId || !drop.has(activeFrameId)) return
    // Land on whatever took the removed photo's place, so the strip does not
    // jump to the top every time one is taken out.
    const next = remaining[Math.min(Math.max(removedAt, 0), remaining.length - 1)]
    if (next) void get().selectFrame(next.id)
    else get().closePhoto()
  },

  async exportSelection(ids) {
    const { selection, frames, batch } = get()
    const targets = ids ?? selection
    if (batch.running || !targets.length) return

    if (!canBatchExport()) {
      get().toast(
        'This browser cannot write a folder, so photos have to be exported one at a time',
        'error',
      )
      return
    }

    const directory = await pickExportDirectory()
    if (!directory) return

    // Snapshot the edits now. The run takes minutes on a folder of raws, and a
    // photo half-exported with settings from two different moments would be
    // worse than one exported with settings the user has since changed.
    const items = []
    for (const id of targets) {
      const frame = frames.find((f) => f.id === id)
      const file = openedFiles.get(id)
      if (!frame || !file) continue
      const saved = await db.loadEdits(id)
      items.push({
        frameId: id,
        file,
        meta: frame.meta,
        edits: saved?.edits ? migrate(saved.edits) : defaultEdits(),
      })
    }
    if (!items.length) return

    batchAbort = new AbortController()
    set({
      batch: {
        ...IDLE_BATCH,
        running: true,
        total: items.length,
        statuses: Object.fromEntries(items.map((i) => [i.frameId, 'pending' as BatchStatus])),
      },
    })

    const result = await runBatchExport({
      items,
      settings: get().exportSettings,
      directory,
      signal: batchAbort.signal,
      onProgress: (update) => {
        const current = get().batch
        set({
          batch: {
            ...current,
            stage: update.status === 'working' ? (update.stage ?? '') : current.stage,
            statuses: { ...current.statuses, [update.frameId]: update.status },
          },
        })
      },
    })

    batchAbort = null
    set({ batch: { ...get().batch, running: false, saved: result.saved, failed: result.failed } })

    if (result.cancelled) {
      get().toast(`Export stopped — ${result.saved} saved`)
    } else if (result.failed) {
      get().toast(`${result.saved} exported, ${result.failed} could not be`, 'warn')
    } else {
      get().toast(`${result.saved} photo${result.saved === 1 ? '' : 's'} exported`)
    }
  },

  cancelBatchExport() {
    batchAbort?.abort()
    set({ batch: { ...get().batch, stage: 'Stopping' } })
  },

  markSidecarSaved() {
    const id = get().activeFrameId
    if (!id) return
    set({ frames: get().frames.map((f) => (f.id === id ? { ...f, unsaved: false } : f)) })
  },

  closePhoto() {
    const photo = get().photo
    if (photo) {
      forgetSubjects(photo.frameId)
      photo.source.close()
      if (photo.preview !== photo.source) photo.preview.close()
    }
    set({
      photo: null,
      activeFrameId: null,
      edits: defaultEdits(),
      history: emptyHistory(),
      histogram: null,
      activeMaskId: null,
      exifOpen: false,
      resetOpen: false,
    })
  },

  async refreshRecents() {
    set({ recents: await db.recentEdits(8) })
  },

  async clearRecents() {
    await db.clearRecents()
    set({ recents: [] })
    get().toast('Recent edits cleared')
  },

  /* ─────────────────────────── imported presets ─────────────────────────── */

  async loadPresets() {
    publishPresets(await db.loadPresets(), set)
  },

  async loadFramePresets() {
    set({ framePresets: await db.loadFramePresets() })
  },

  async saveFramePreset(name) {
    const preset = {
      // Namespaced like a custom look, so the two id spaces can never meet.
      id: `frame:${crypto.randomUUID()}`,
      name,
      frame: { ...get().edits.frame },
      createdAt: Date.now(),
    }
    await db.saveFramePreset(preset)
    // Read back rather than prepended, so the order is whatever the store says
    // it is and a failed write does not leave a preset on screen that is not
    // saved anywhere.
    set({ framePresets: await db.loadFramePresets() })
    void ensureDurableStorage()
    get().toast(`Saved the frame “${name}”`)
  },

  async deleteFramePreset(id) {
    await db.deleteFramePreset(id)
    set({ framePresets: await db.loadFramePresets() })
  },

  async importPresets(files) {
    if (!files.length) return

    const outcomes = await importPresetFiles(files)
    const added = outcomes.map((o) => o.preset).filter((p): p is CustomPreset => Boolean(p))
    for (const preset of added) await db.savePreset(preset)
    if (added.length) {
      publishPresets([...added, ...get().presets], set)
      // The first import is the point at which this origin holds something the
      // user cannot re-create from a file they still have open.
      void ensureDurableStorage()
    }

    for (const { error } of outcomes) if (error) get().toast(error, 'error')

    if (added.length === 1) {
      const [preset] = added
      const lost = preset.dropped ?? []
      if (!lost.length) {
        get().toast(`Imported "${preset.name}"`)
      } else {
        // One toast, not two: the old pair said "Imported" and then "not
        // applied", which read as a contradiction. The preset always applies —
        // what varies is how much of it survived the trip.
        get().toast(
          `Imported "${preset.name}" · everything applied except ${listPhrase(lost)}`,
          toneForLost(lost.length),
        )
      }
    } else if (added.length > 1) {
      const partial = added.filter((p) => p.dropped?.length)
      if (!partial.length) {
        get().toast(`Imported ${added.length} presets`)
      } else {
        const worst = Math.max(...partial.map((p) => p.dropped?.length ?? 0))
        get().toast(
          `Imported ${added.length} presets · ${partial.length} of them use settings 35mm has no equivalent for`,
          toneForLost(worst),
        )
      }
    }
  },

  async deletePreset(id) {
    const preset = get().presets.find((p) => p.id === id)
    await db.deletePreset(id)
    forgetLut(id)
    publishPresets(get().presets.filter((p) => p.id !== id), set)

    // Nothing should still be pointing at a look that no longer exists.
    if (get().edits.look.id === id) {
      get().update({ look: { id: null, strength: 100 } }, 'look')
    }
    if (preset) get().toast(`Removed "${preset.name}"`)
  },

  async setPresetInputSpace(id, space) {
    const preset = get().presets.find((p) => p.id === id)
    if (!preset || preset.kind !== 'lut' || preset.inputSpace === space) return

    const next = { ...preset, inputSpace: space }
    await db.savePreset(next)
    forgetLut(id)
    publishPresets(get().presets.map((p) => (p.id === id ? next : p)), set)
  },

  /* ─────────────────────────── edits ─────────────────────────── */

  update(patch, coalesceKey) {
    const { edits, history } = get()
    const next = { ...edits, ...patch }
    if (editsEqual(next, edits)) return
    const beforeRaw = edits.raw

    const now = Date.now()
    const nextHistory = shouldPush(history, coalesceKey ?? null, now)
      ? pushHistory(history, cloneEdits(edits), coalesceKey ?? null, now)
      : touchHistory(history, coalesceKey ?? null, now)

    set({ edits: next, history: nextHistory })
    maybeRedevelop(beforeRaw, get, set)
    scheduleAutosave(get, set)
  },

  updateFrame(patch, coalesceKey) {
    get().update({ frame: { ...get().edits.frame, ...patch } }, coalesceKey)
  },

  updateCrop(patch, coalesceKey) {
    get().update({ crop: { ...get().edits.crop, ...patch } }, coalesceKey)
  },

  applyLook(id) {
    const look = getLook(id)
    if (!look) {
      get().update({ look: { id: null, strength: 100 }, grain: 0 }, 'look')
      return
    }

    const preset = look.custom
    if (preset?.kind === 'parametric') {
      // A Lightroom preset *is* slider values, so it lands on the edit stack
      // directly and stays editable. Like Lightroom, it only touches what it
      // actually contains; `look.id` is set purely to mark the grid, and
      // resolves to no LUT.
      get().update({ ...preset.edits, look: { id: look.id, strength: 100 } }, 'look')
      return
    }
    if (preset) {
      // An imported LUT carries no grain of its own; leave whatever is set.
      get().update({ look: { id: look.id, strength: look.defaultStrength } }, 'look')
      return
    }

    // A built-in look brings its own grain defaults into the edit state rather
    // than hiding them, so the Grain panel always shows what is applied.
    get().update(
      {
        look: { id: look.id, strength: look.defaultStrength },
        grain: look.grain.amount,
        grainSize: look.grain.size,
      },
      'look',
    )
  },

  /* ─────────────────────────── raw development ─────────────────────────── */

  updateRawDevelop(patch) {
    const { photo, edits } = get()
    const next = { ...edits.raw, ...patch }
    if (JSON.stringify(next) === JSON.stringify(edits.raw)) return

    // Onto the edit stack like anything else, so it round-trips through the
    // sidecar and undo reaches it. Unlike anything else, it then has to be
    // developed again — a develop setting is not a slider, it is a question put
    // to the decoder.
    void photo
    get().update({ raw: next }, 'raw-develop')
  },

  async ensureFullSource() {
    const photo = get().photo
    if (!photo) return null
    if (!photo.sourceIsPreview) return photo.source

    // The open came from the cache, which holds preview pixels only. Anything
    // being written out has to be developed from the file.
    set({ loading: true, loadingLabel: STAGE_LABELS.developing, loadingName: photo.meta.name })
    try {
      const source = await developFullSource(photo.file, get().edits.raw)
      const current = get().photo
      // Still the same photo? A slow develop must not land on a different one.
      if (!current || current.frameId !== photo.frameId) {
        source.close()
        return null
      }
      set({ photo: { ...current, source, sourceIsPreview: false } })
      return source
    } finally {
      set({ loading: false, loadingLabel: '', loadingName: '' })
    }
  },

  /* ─────────────────────────── masks ─────────────────────────── */

  addMask(kind) {
    const { edits, photo } = get()
    if (edits.masks.length >= MAX_MASKS) {
      get().toast(`A photo can carry ${MAX_MASKS} masks — remove one first`, 'error')
      return
    }

    // The frame's shape decides the starting geometry, so a radial arrives as
    // a circle rather than an ellipse stretched by whatever the aspect is.
    const aspect = photo ? photo.meta.width / photo.meta.height : 1
    const mask = createMask(kind, aspect, edits.masks)
    get().update({ masks: [...edits.masks, mask] }, `mask-add-${mask.id}`)
    set({ activeMaskId: mask.id })

    // A fresh subject mask covers nothing until the detector has run, so run
    // it — unless that would mean downloading the model, which the tool asks
    // about rather than assumes.
    if (mask.kind === 'subject' && modelIsWarm()) void get().detectSubjectMask(mask.id)
  },

  /**
   * Find the subject without being asked — but only once the model is already
   * here.
   *
   * The first detection of a session is an 8 MB download, and starting one on
   * somebody's behalf because they opened a photo, or because a mask arrived
   * on it from a sync, is not a decision to make for them. After that it is a
   * second of compute and asking again is just a click in the way.
   */
  async autoDetectSubjects() {
    if (!modelIsWarm()) return
    const pending = get().edits.masks.filter(
      (m) => m.kind === 'subject' && m.enabled && m.amount > 0,
    )
    for (const mask of pending) await get().detectSubjectMask(mask.id)
  },

  async detectSubjectMask(id) {
    const { edits, photo, activeFrameId } = get()
    const mask = edits.masks.find((m) => m.id === id)
    if (!mask || mask.kind !== 'subject' || !photo || !activeFrameId) return
    if (get().detecting) return

    set({ detecting: true })
    try {
      // The preview, not the full-resolution source. The detector sees a 320px
      // copy either way, and a photo restored from the develop cache has no
      // full-resolution pixels to offer without developing the raw again.
      const map = await subjectFor(activeFrameId, mask.model, photo.preview)
      // The photo may have been changed underneath a slow detection.
      if (get().activeFrameId !== activeFrameId) return
      rememberSubject(activeFrameId, mask.model, map)
      // Nothing in the edit stack changed, so nudge the frame counter instead:
      // the viewport redraws on it, and this must not land in undo.
      set({ maskMapsAt: Date.now() })
    } catch (err) {
      get().toast(err instanceof Error ? err.message : 'Could not find a subject', 'error')
    } finally {
      set({ detecting: false })
    }
  },

  /**
   * Crop to whatever the photograph is of.
   *
   * Reuses the detector the subject mask already carries — the coverage map is
   * in the same upright uv a crop rect is, so this is a bounding box and not a
   * second pipeline. The aspect lock wins if there is one: someone who has
   * asked for 4:5 wants 4:5 around the subject, not the subject's own shape.
   */
  async cropToSubject(options = {}) {
    const { margin = 0.06, offsetX = 0, offsetY = 0 } = options
    const { photo, activeFrameId, edits } = get()
    if (!photo || !activeFrameId || get().detecting) return

    set({ detecting: true })
    try {
      const map = await subjectFor(activeFrameId, DETECT_VERSION, photo.preview)
      const found = subjectBounds(map, { margin })
      if (!found) {
        get().toast('No subject to crop to in this photo', 'warn')
        return
      }
      if (get().activeFrameId !== activeFrameId) return

      const frame = displaySize(photo.meta.width, photo.meta.height, edits.crop.rotate90)
      const ratio = parseAspectRatio(edits.crop.aspect)
      // Offset before the ratio, so growing to the lock happens around where
      // the box has actually been placed rather than where it was found.
      const placed = offsetBounds(found, offsetX, offsetY)
      const box = ratio === null ? placed : fitAspect(placed, ratio / (frame.width / frame.height))

      get().updateCrop({ x: box.x, y: box.y, w: box.w, h: box.h }, 'crop-subject')
    } catch (err) {
      get().toast(err instanceof Error ? err.message : 'Could not find a subject', 'error')
    } finally {
      set({ detecting: false })
    }
  },

  removeMask(id) {
    const { edits, activeMaskId } = get()
    const index = edits.masks.findIndex((m) => m.id === id)
    if (index === -1) return

    const remaining = edits.masks.filter((m) => m.id !== id)
    get().update({ masks: remaining }, `mask-remove-${id}`)

    if (activeMaskId !== id) return
    // Land on the neighbour, so removing a mask does not close the panel.
    const next = remaining[Math.min(index, remaining.length - 1)]
    set({ activeMaskId: next?.id ?? null })
  },

  selectMask(id) {
    set({ activeMaskId: id })
  },

  updateMask(id, patch, coalesceKey) {
    get().update({ masks: replaceMask(get().edits.masks, id, patch) }, coalesceKey)
  },

  updateMaskAdjust(id, patch, coalesceKey) {
    get().update({ masks: replaceMaskAdjust(get().edits.masks, id, patch) }, coalesceKey)
  },

  setCropDragging(on) {
    if (get().cropDragging !== on) set({ cropDragging: on })
  },

  setSheetDragging(on) {
    if (get().sheetDragging !== on) set({ sheetDragging: on })
  },

  setMaskOverlay(on) {
    set({ maskOverlay: on })
  },

  replaceEdits(edits, coalesceKey) {
    const current = get().edits
    if (editsEqual(edits, current)) return
    const now = Date.now()
    set({
      edits: cloneEdits(edits),
      history: pushHistory(get().history, cloneEdits(current), coalesceKey ?? null, now),
    })
    maybeRedevelop(current.raw, get, set)
    scheduleAutosave(get, set)
  },

  undo() {
    const { history, edits } = get()
    const previous = history.past.at(-1)
    if (!previous) return
    const beforeRaw = edits.raw
    set({
      edits: previous,
      history: {
        past: history.past.slice(0, -1),
        future: [cloneEdits(edits), ...history.future],
        coalesceKey: null,
        coalesceAt: 0,
      },
    })
    maybeRedevelop(beforeRaw, get, set)
    scheduleAutosave(get, set)
  },

  redo() {
    const { history, edits } = get()
    const next = history.future[0]
    if (!next) return
    const beforeRaw = edits.raw
    set({
      edits: next,
      history: {
        past: [...history.past, cloneEdits(edits)],
        future: history.future.slice(1),
        coalesceKey: null,
        coalesceAt: 0,
      },
    })
    maybeRedevelop(beforeRaw, get, set)
    scheduleAutosave(get, set)
  },

  resetAll() {
    get().replaceEdits(defaultEdits(), 'reset')
    set({ resetOpen: false })
    get().toast('All edits reset')
  },

  copyLook() {
    set({ clipboard: cloneEdits(get().edits) })
    get().toast('Look copied — paste it onto another photo')
  },

  pasteLook() {
    const clipboard = get().clipboard
    if (!clipboard) {
      get().toast('Nothing copied yet', 'error')
      return
    }
    // Crop is about this frame, not the look, so it stays put.
    get().replaceEdits({ ...cloneEdits(clipboard), crop: get().edits.crop }, 'paste')
    get().toast('Look pasted')
  },

  /* ─────────────────────────── ui ─────────────────────────── */

  setSplit(on) { set({ splitCompare: on }) },
  setSplitAt(v) { set({ splitAt: Math.min(0.98, Math.max(0.02, v)) }) },
  setZoom(z) { set({ zoom: z }) },

  togglePanel(panel, open) {
    const panels = get().openPanels
    set({ openPanels: { ...panels, [panel]: open ?? !panels[panel] } })
  },

  focusPanel(panel) {
    // The rail is behind the open tool's panel now, so a chip aimed at a rail
    // control cannot just scroll to it. Apply rather than discard: what is on
    // screen is what the tool was asked for, and the chip was a move on to the
    // next adjustment, not a change of mind about this one.
    if (get().activeTool) get().applyTool()
    set({ openPanels: { ...get().openPanels, [panel]: true }, focusedPanel: panel })
    // Clear the highlight once the scroll-into-view has had time to land.
    setTimeout(() => {
      if (get().focusedPanel === panel) set({ focusedPanel: null })
    }, 1600)
  },

  openTool(tool) {
    const { activeTool, edits } = get()
    if (activeTool === tool) {
      get().closeTool()
      return
    }
    // Reopening a different tool keeps whatever the last one left behind: the
    // snapshot is only ever the starting point of the tool now being opened.
    set({
      activeTool: tool,
      toolSnapshot: cloneEdits(edits),
      cropping: tool === 'crop',
      splitCompare: tool === 'crop' ? false : get().splitCompare,
      // Opening the mask tool on a photo that already has masks should show one,
      // not an empty panel and a picture with nothing drawn on it.
      activeMaskId:
        tool === 'masks'
          ? (get().activeMaskId && edits.masks.some((m) => m.id === get().activeMaskId)
              ? get().activeMaskId
              : (edits.masks[0]?.id ?? null))
          : get().activeMaskId,
    })
  },

  closeTool() {
    set({ activeTool: null, toolSnapshot: null, cropping: false })
  },

  applyTool() {
    // The parameters are already live in the preview; applying just settles them.
    const tool = get().activeTool
    get().closeTool()
    if (tool) scheduleAutosave(get, set)
  },

  discardTool() {
    const snapshot = get().toolSnapshot
    if (snapshot) get().replaceEdits(snapshot, `tool-discard-${Date.now()}`)
    get().closeTool()
  },

  setCropping(on) { set({ cropping: on, splitCompare: on ? false : get().splitCompare }) },
  setAboutOpen(open) {
    set({ aboutOpen: open })
  },

  setSyncOpen(open) {
    set({ syncOpen: open })
  },

  setExifOpen(open) {
    set({ exifOpen: open })
  },

  setResetOpen(open) {
    set({ resetOpen: open })
  },

  setExportOpen(open) { set({ exportOpen: open }) },
  setExportSettings(patch) { set({ exportSettings: { ...get().exportSettings, ...patch } }) },
  setHistogram(data) { set({ histogram: data }) },
  setViewScale(scale, fit) {
    // Guard the write: the viewport recomputes this every frame.
    if (get().viewScale !== scale || get().fitScale !== fit) set({ viewScale: scale, fitScale: fit })
  },

  toast(message, tone = 'info') {
    const id = crypto.randomUUID()
    set({ toasts: [...get().toasts, { id, message, tone }] })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 3200)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

/* ─────────────────────────── module-local helpers ─────────────────────────── */

/**
 * Re-run the decoder for the open photo.
 *
 * Counted rather than cancelled: LibRaw has no way to abandon a decode in
 * flight, so a second change while the first is still running would otherwise
 * land whichever finished last. The generation check means only the newest one
 * is allowed to reach the screen.
 */
let developGeneration = 0

/**
 * Develop again when the develop settings moved, wherever they moved from.
 *
 * This sits on the edit stack's write paths rather than only on the panel's
 * action, because the panel is not the only thing that can change them: undo,
 * redo, "reset everything", pasting a look and a batch sync all write the whole
 * edit state. Any of those can change what the decoder was asked for, and a
 * panel that disagreed with the pixels on screen would be worse than no panel.
 */
function maybeRedevelop(before: EditState['raw'], get: Getter, set: Setter): void {
  if (!get().photo?.meta.isRaw) return
  if (JSON.stringify(before) === JSON.stringify(get().edits.raw)) return
  void redevelop(get, set)
}

async function redevelop(get: Getter, set: Setter): Promise<void> {
  const photo = get().photo
  if (!photo) return

  const generation = ++developGeneration
  const raw = get().edits.raw
  set({ loading: true, loadingLabel: STAGE_LABELS.developing, loadingName: photo.meta.name })

  try {
    const developed = await developFor(photo.file, raw, (stage) => {
      if (developGeneration === generation) set({ loadingLabel: STAGE_LABELS[stage] })
    })

    const current = get().photo
    if (developGeneration !== generation || !current || current.frameId !== photo.frameId) {
      developed.source.close()
      if (developed.preview !== developed.source) developed.preview.close()
      return
    }

    current.source.close()
    if (current.preview !== current.source) current.preview.close()

    set({
      photo: {
        ...current,
        meta: developed.meta,
        source: developed.source,
        preview: developed.preview,
        sourceIsPreview: developed.sourceIsPreview,
      },
      histogram: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not develop that file'
    get().toast(message, 'error')
  } finally {
    if (developGeneration === generation) {
      set({ loading: false, loadingLabel: '', loadingName: '' })
    }
  }
}

/**
 * Files are held outside the store: `File` and `FileSystemFileHandle` are not
 * plain data, and keeping them out of state keeps the store serialisable.
 */
const openedFiles = new Map<string, OpenedFile>()

export function getOpenedFile(id: string): OpenedFile | undefined {
  return openedFiles.get(id)
}

export function registerOpenedFile(id: string, file: OpenedFile) {
  openedFiles.set(id, file)
}

/** Asked once per session; the answer cannot change under us. */
let durableRequested = false
function ensureDurableStorage() {
  if (durableRequested) return
  durableRequested = true
  return db.requestPersistentStorage()
}

/**
 * One write for both readers: the store (for React) and the catalogue (for the
 * LUT cache and the renderer, which resolve look ids outside React).
 */
function publishPresets(presets: CustomPreset[], set: Setter) {
  const sorted = [...presets].sort((a, b) => b.createdAt - a.createdAt)
  setCustomPresets(sorted)
  set({ presets: sorted })
}

/**
 * A couple of missing settings is a footnote; a handful means the preset will
 * not look like itself, and saying so in the same colour as "saved" would be
 * misleading. Either way the rest of the preset is applied — the tone is about
 * how much to trust the result, not whether anything happened.
 */
const MAX_LOST_FOR_WARNING = 2

function toneForLost(count: number): Toast['tone'] {
  return count <= MAX_LOST_FOR_WARNING ? 'warn' : 'error'
}

function listPhrase(items: string[]): string {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

type Setter = (partial: Partial<EditorState>) => void
type Getter = () => EditorState

async function cacheThumbnail(
  key: string,
  frameId: string,
  bitmap: ImageBitmap,
  orientation: Orientation,
  set: Setter,
  get: Getter,
) {
  const blob = await makeThumbnail(bitmap, orientation)
  if (!blob) return
  void db.saveThumb(key, blob)

  const url = URL.createObjectURL(blob)
  set({
    frames: get().frames.map((f) => {
      if (f.id !== frameId) return f
      if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl)
      return { ...f, thumbUrl: url }
    }),
  })
}

/** Decode the rest of a dropped batch at thumbnail size only. */
async function hydrateThumbnails(ids: string[], set: Setter, get: Getter) {
  for (const id of ids) {
    // Wait for any open the user is actually watching before queueing the next
    // thumbnail. LibRaw runs one decode at a time, so without this a folder of
    // raws puts every remaining file ahead of the photo they just clicked —
    // minutes of apparent freeze. Yielding here bounds that to a single decode.
    while (get().loading) await new Promise((r) => setTimeout(r, 120))

    if (get().frames.find((f) => f.id === id)?.thumbUrl) continue
    const opened = openedFiles.get(id)
    if (!opened) continue

    try {
      const cached = await db.loadThumb(db.fileKey(opened.file))
      if (cached) {
        const url = URL.createObjectURL(cached)
        set({ frames: get().frames.map((f) => (f.id === id && !f.thumbUrl ? { ...f, thumbUrl: url } : f)) })
        continue
      }

      const decoded = await decodeFile(opened.file)
      await cacheThumbnail(
        db.fileKey(opened.file), id, decoded.bitmap, decoded.meta.orientation, set, get,
      )
      set({ frames: get().frames.map((f) => (f.id === id ? { ...f, meta: decoded.meta } : f)) })
      // The bitmap was only needed for the thumbnail — the active photo keeps
      // its own copy.
      if (get().photo?.frameId !== id) decoded.bitmap.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open that file'
      set({ frames: get().frames.map((f) => (f.id === id ? { ...f, error: message } : f)) })
    }
  }
}

function scheduleAutosave(get: Getter, set: Setter) {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    const { photo, edits } = get()
    if (!photo) return
    const editCount = countEdits(edits)
    void db.saveEdits({
      key: photo.key,
      meta: photo.meta,
      edits,
      editCount,
      updatedAt: Date.now(),
    })
    // Debounced with the save rather than run on every slider tick: the marker
    // is a state, not an animation, and re-rendering the strip per frame of a
    // drag would cost more than it tells anyone.
    set({
      frames: get().frames.map((f) =>
        f.id === photo.frameId ? { ...f, editCount, unsaved: editCount > 0 } : f,
      ),
    })
    void get().refreshRecents()
  }, AUTOSAVE_DELAY)
}

/** Fill in fields added after a sidecar or IndexedDB record was written. */
function migrate(edits: Partial<EditState>): EditState {
  const base = defaultEdits()
  return {
    ...base,
    ...edits,
    curves: { ...base.curves, ...(edits.curves ?? {}) },
    hsl: { ...base.hsl, ...(edits.hsl ?? {}) },
    perspective: { ...base.perspective, ...(edits.perspective ?? {}) },
    lens: { ...base.lens, ...(edits.lens ?? {}) },
    colorGrade: { ...base.colorGrade, ...(edits.colorGrade ?? {}) },
    // A subject mask names the detector that produced it, and a sidecar can
    // name one this build no longer has. Point it at what is actually here:
    // the alternative is a mask that never finds anything, because the cache
    // is keyed by a model nothing will ever derive.
    masks: (edits.masks ?? base.masks).map((mask) => {
      // An adjustment added after this record was written is absent rather than
      // zero, and absent is not a number: it would reach the uniform arrays as
      // NaN, and `hasMaskAdjust` would call an untouched mask adjusted.
      const filled = { ...mask, adjust: { ...neutralMaskAdjust(), ...mask.adjust } }
      return filled.kind === 'subject' && filled.model !== DETECT_VERSION
        ? { ...filled, model: DETECT_VERSION }
        : filled
    }),
    dynamicRange: edits.dynamicRange ?? base.dynamicRange,
    raw: { ...base.raw, ...(edits.raw ?? {}) },
    look: { ...base.look, ...(edits.look ?? {}) },
    crop: { ...base.crop, ...(edits.crop ?? {}) },
    // Its own line for the same reason every sub-object above has one: the
    // shallow spread that built `base` covers a frame that is missing entirely,
    // but not one written by a build that had fewer sides — and a side arriving
    // as undefined reaches the shader as NaN, which is a blank picture rather
    // than a visible mistake.
    frame: { ...base.frame, ...(edits.frame ?? {}) },
  }
}

export { MAX_PREVIEW_EDGE }
