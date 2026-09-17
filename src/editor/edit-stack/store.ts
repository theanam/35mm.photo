import { create } from 'zustand'
import { cloneEdits, defaultEdits, editsEqual } from './defaults'
import { emptyHistory, pushHistory, shouldPush, touchHistory, type History } from './history'
import { countEdits, type PanelId } from './summary'
import type { EditState, Frame, ImageMeta } from './types'
import type { Orientation } from '../../io/exif'
import { MAX_PREVIEW_EDGE, decodeFile, makeThumbnail, previewBitmap } from '../../io/decode'
import type { OpenedFile } from '../../io/file-system'
import { DEFAULT_EXPORT, type ExportSettings } from '../../io/export'
import { getLook } from '../presets/looks'
import type { HistogramData } from '../histogram'
import * as db from '../../storage/indexeddb'

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'error'
}

export type ZoomMode = 'fit' | number

export interface OpenPhoto {
  frameId: string
  key: string
  meta: ImageMeta
  /** Full-resolution decode, kept for export. */
  source: ImageBitmap
  /** Possibly downscaled copy the viewport renders (spec §5). */
  preview: ImageBitmap
  handle?: FileSystemFileHandle
}

interface EditorState {
  /* Library */
  frames: Frame[]
  activeFrameId: string | null
  photo: OpenPhoto | null
  recents: db.StoredEdit[]

  /* Edits */
  edits: EditState
  history: History
  clipboard: EditState | null

  /* UI */
  loading: boolean
  loadingLabel: string
  splitCompare: boolean
  splitAt: number
  zoom: ZoomMode
  /** Collapsed/expanded state of the right rail's panels. */
  openPanels: Record<PanelId, boolean>
  focusedPanel: PanelId | null
  /** The toolbar tool whose drawer is open, or null when the toolbar is idle. */
  activeTool: PanelId | null
  /**
   * Edit state as it was when the current tool was opened. Discard restores it,
   * which is what makes the per-tool Apply/Discard pair mean anything while the
   * pipeline stays purely parametric.
   */
  toolSnapshot: EditState | null
  cropping: boolean
  exportOpen: boolean
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
  openFiles: (files: OpenedFile[]) => Promise<void>
  selectFrame: (id: string) => Promise<void>
  closePhoto: () => void
  refreshRecents: () => Promise<void>
  clearRecents: () => Promise<void>

  update: (patch: Partial<EditState>, coalesceKey?: string) => void
  updateCrop: (patch: Partial<EditState['crop']>, coalesceKey?: string) => void
  applyLook: (id: string | null) => void
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
  setExportSettings: (patch: Partial<ExportSettings>) => void
  setHistogram: (data: HistogramData) => void
  setViewScale: (scale: number, fit: number) => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
}

/** Rebuilt never: the comparison target for "has this photo been touched?". */
const PRISTINE = defaultEdits()

const AUTOSAVE_DELAY = 600
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export const useEditor = create<EditorState>((set, get) => ({
  frames: [],
  activeFrameId: null,
  photo: null,
  recents: [],

  edits: defaultEdits(),
  history: emptyHistory(),
  clipboard: null,

  loading: false,
  loadingLabel: '',
  splitCompare: false,
  splitAt: 0.38,
  zoom: 'fit',
  openPanels: { light: true, crop: true, looks: true, curves: false, mixer: false, detail: false, grain: false, raw: false },
  focusedPanel: null,
  activeTool: null,
  toolSnapshot: null,
  cropping: false,
  exportOpen: false,
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

  async openFiles(files) {
    if (!files.length) return

    const existing = get().frames
    const added: Frame[] = files.map((f) => ({
      id: db.fileKey(f.file),
      meta: {
        name: f.file.name,
        ext: f.file.name.split('.').pop()?.toLowerCase() ?? '',
        isRaw: false,
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

    set({ frames: merged })
    await get().selectFrame(added[0].id)

    // Thumbnails for the rest of the strip, after the first photo is up.
    void hydrateThumbnails(added.map((f) => f.id), set, get)
  },

  async selectFrame(id) {
    const opened = openedFiles.get(id)
    if (!opened) return

    set({ loading: true, loadingLabel: 'Opening', activeFrameId: id, cropping: false })

    try {
      const decoded = await decodeFile(opened.file)
      const preview = await previewBitmap(decoded.bitmap)

      const key = db.fileKey(opened.file)
      const saved = await db.loadEdits(key)
      const edits = saved?.edits ? migrate(saved.edits) : defaultEdits()

      const previous = get().photo
      if (previous && previous.frameId !== id) {
        previous.source.close()
        if (previous.preview !== previous.source) previous.preview.close()
      }

      set({
        photo: { frameId: id, key, meta: decoded.meta, source: decoded.bitmap, preview, handle: opened.handle },
        edits,
        history: emptyHistory(),
        histogram: null,
        loading: false,
        loadingLabel: '',
        frames: get().frames.map((f) =>
          f.id === id ? { ...f, meta: decoded.meta, error: undefined } : f,
        ),
      })

      if (opened.handle) void db.saveHandle(key, opened.handle)
      void cacheThumbnail(key, id, decoded.bitmap, decoded.meta.orientation, set, get)
      void get().refreshRecents()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open that file'
      set({
        loading: false,
        loadingLabel: '',
        frames: get().frames.map((f) => (f.id === id ? { ...f, error: message } : f)),
      })
      get().toast(message, 'error')
    }
  },

  closePhoto() {
    const photo = get().photo
    if (photo) {
      photo.source.close()
      if (photo.preview !== photo.source) photo.preview.close()
    }
    set({ photo: null, activeFrameId: null, edits: defaultEdits(), history: emptyHistory(), histogram: null })
  },

  async refreshRecents() {
    set({ recents: await db.recentEdits(8) })
  },

  async clearRecents() {
    await db.clearRecents()
    set({ recents: [] })
    get().toast('Recent edits cleared')
  },

  /* ─────────────────────────── edits ─────────────────────────── */

  update(patch, coalesceKey) {
    const { edits, history } = get()
    const next = { ...edits, ...patch }
    if (editsEqual(next, edits)) return

    const now = Date.now()
    const nextHistory = shouldPush(history, coalesceKey ?? null, now)
      ? pushHistory(history, cloneEdits(edits), coalesceKey ?? null, now)
      : touchHistory(history, coalesceKey ?? null, now)

    set({ edits: next, history: nextHistory })
    scheduleAutosave(get)
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
    // A look brings its own grain defaults into the edit state rather than
    // hiding them, so the Grain panel always shows what is actually applied.
    get().update(
      {
        look: { id: look.id, strength: look.defaultStrength },
        grain: look.grain.amount,
        grainSize: look.grain.size,
      },
      'look',
    )
  },

  replaceEdits(edits, coalesceKey) {
    const current = get().edits
    if (editsEqual(edits, current)) return
    const now = Date.now()
    set({
      edits: cloneEdits(edits),
      history: pushHistory(get().history, cloneEdits(current), coalesceKey ?? null, now),
    })
    scheduleAutosave(get)
  },

  undo() {
    const { history, edits } = get()
    const previous = history.past.at(-1)
    if (!previous) return
    set({
      edits: previous,
      history: {
        past: history.past.slice(0, -1),
        future: [cloneEdits(edits), ...history.future],
        coalesceKey: null,
        coalesceAt: 0,
      },
    })
    scheduleAutosave(get)
  },

  redo() {
    const { history, edits } = get()
    const next = history.future[0]
    if (!next) return
    set({
      edits: next,
      history: {
        past: [...history.past, cloneEdits(edits)],
        future: history.future.slice(1),
        coalesceKey: null,
        coalesceAt: 0,
      },
    })
    scheduleAutosave(get)
  },

  resetAll() {
    get().replaceEdits(defaultEdits(), 'reset')
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
    })
  },

  closeTool() {
    set({ activeTool: null, toolSnapshot: null, cropping: false })
  },

  applyTool() {
    // The parameters are already live in the preview; applying just settles them.
    const tool = get().activeTool
    get().closeTool()
    if (tool) scheduleAutosave(get)
  },

  discardTool() {
    const snapshot = get().toolSnapshot
    if (snapshot) get().replaceEdits(snapshot, `tool-discard-${Date.now()}`)
    get().closeTool()
  },

  setCropping(on) { set({ cropping: on, splitCompare: on ? false : get().splitCompare }) },
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

function scheduleAutosave(get: Getter) {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    const { photo, edits } = get()
    if (!photo) return
    void db.saveEdits({
      key: photo.key,
      meta: photo.meta,
      edits,
      editCount: countEdits(edits),
      updatedAt: Date.now(),
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
    look: { ...base.look, ...(edits.look ?? {}) },
    crop: { ...base.crop, ...(edits.crop ?? {}) },
  }
}

export { MAX_PREVIEW_EDGE }
