import { useMemo } from 'react'
import { readShotInfo } from '../../io/exif-tags'
import { create } from 'zustand'
import { cloneEdits, defaultEdits, editsEqual } from './defaults'
import { emptyHistory, pushHistory, shouldPush, touchHistory, type History } from './history'
import { countEdits, revealTouched, withHidden, type PanelId } from './summary'
import { createMask, neutralMaskAdjust, replaceMask, replaceMaskAdjust } from './masks'
import { SUBJECT_EDGE_DEFAULTS } from '../../subject/refine'
import { rememberKey, resolveLens, shotOf, type ResolvedLens } from '../../lens/resolve'
import { loadRemembered, rememberLens } from '../../lens/remember'
import { openingLift } from '../tools/auto'
import {
  DETECT_VERSION,
  forgetSubjects,
  isModelCached,
  modelIsWarm,
  onSubjectMapsChanged,
  primeSubjects,
  refineFor,
  restoreSubjects,
  subjectFor,
} from '../../subject/detect'
import { fitAspect, offsetBounds, subjectBounds } from '../../subject/bounds'
import { displaySize } from '../gpu/transform'
import { parseAspectRatio } from './aspect'
import { applySyncScope, type SyncGroup } from './sync'
import {
  MAX_MASKS,
  type EditState,
  type Frame,
  type ImageMeta,
  type Mask,
  type MaskAdjust,
  type MaskKind,
  type RetouchStroke,
} from './types'
import { planStroke, prepareFillModel } from '../../retouch/retouch'
import { loadFillReady, loadSmartFill, saveSmartFill } from '../../retouch/preference'
import { DEFAULT_BRUSH_SIZE } from '../../retouch/brush'
import { MAX_PREVIEW_EDGE, decodeFile, makeThumbnail, previewBitmap } from '../../io/decode'
import { developFor, developFullSource } from '../../io/develop'
import { prepareUpscale, upscaleSignature, type UpscaledView } from '../../upscale/inline'
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
import { guideTurns, loadCropGuide, saveCropGuide, type CropGuide } from './crop-guides'
import * as db from '../../storage/indexeddb'

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'warn' | 'error'
}

export type ZoomMode = 'fit' | number
/** The crop gesture in progress: see `cropDragging`. */
export type CropDrag = false | 'move' | 'resize' | 'rotate'

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
  /**
   * The crop's region of the picture, upscaled — see `upscale/inline.ts`.
   * Drawn in place of the picture by everything but the crop and retouch
   * tools, which show the picture as shot. Null until built, or when the
   * upscale is off.
   */
  upscaled?: UpscaledView | null
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
  /**
   * Chips in the applied-edits strip whose eye is shut. The edit stays in the
   * stack with its values intact; the renderer is handed its off state instead
   * (`withHidden`). Session state for the open photo: it says what you are
   * looking at right now, not what the photo is, so it goes in no sidecar.
   */
  hidden: readonly string[]

  /** LUTs and presets the user has imported (spec §4.3.1). */
  presets: CustomPreset[]
  /** Frames the user has saved, newest first. Kept in this browser only. */
  framePresets: StoredFramePreset[]

  /**
   * What the lens database knows about the open photo, resolved once per photo
   * and again when the user picks a lens. Not edit state: the edit state holds
   * the intent, and this is the answer for this file.
   */
  lensProfile: ResolvedLens | null
  /** True while a profile is being looked up, so the panel can say so. */
  lensResolving: boolean

  /* UI */
  loading: boolean
  loadingLabel: string
  /** 0..1 while a stage can count its work — only the upscaler can — else null. */
  loadingProgress: number | null
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
   * Which crop gesture is under the pointer, or false. The viewport scales
   * itself to the crop box, and rescaling mid-drag would slide the picture out
   * from under the finger doing the dragging — so the zoom settles on release.
   * Which gesture matters too: a move holds the box still on screen and slides
   * the picture, a resize holds the picture still and lets the box grow.
   */
  cropDragging: CropDrag
  /** The guide drawn inside the crop box, and which way round it is turned. */
  cropGuide: CropGuide
  cropGuideTurn: number
  /** The crop overlay is taking a drawn line as the horizon, not a box drag. */
  drawingHorizon: boolean
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
  /** The retouch stroke the tool is editing. UI state, like `activeMaskId`. */
  activeRetouchId: string | null
  /**
   * The brush the next stroke is drawn with. Size is a share of the picture's
   * shorter edge, as a stroke stores it, so the brush covers the same part of
   * any photograph whatever its resolution.
   */
  retouchBrush: { size: number; feather: number }
  /**
   * Whether a stroke a heal cannot hold may be handed to the fill model. A
   * preference, kept in this browser, and only in force once `fillReady`.
   */
  smartFill: boolean
  /** The fill model has been loaded in this browser, and is kept. */
  fillReady: boolean
  /** True while a new stroke's source is being searched for. */
  retouchPlanning: boolean
  /** True while the fill model is downloading, after smart fill was switched on. */
  fillLoading: boolean
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
  /**
   * Whether a raw that opens with no edits of its own gets its exposure set
   * from its histogram. An honest develop is darker than the camera's JPEG,
   * because the JPEG has been lifted and this has not; this makes the lift,
   * as an ordinary Exposure edit that can be undone, reset or switched off.
   * A preference, not an edit, so it is kept in this browser rather than in
   * any photo's sidecar.
   */
  autoExpose: boolean
  /**
   * The frame waiting for its first histogram so the lift above can be made.
   * Set on open, cleared on the first histogram, on the next open, and by any
   * edit the user makes first.
   */
  pendingAutoExpose: string | null
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
  /** Shut or open the eye on one chip of the applied-edits strip. */
  toggleHidden: (chipId: string) => void
  /** Look the open photo's lens up again, from its metadata and the user's choice. */
  resolveLensProfile: () => Promise<void>
  /** Choose a lens by hand, and optionally for every photo that names it the same way. */
  pickLens: (lensId: string | null, remember: boolean) => void
  updateCrop: (patch: Partial<EditState['crop']>, coalesceKey?: string) => void
  updateFrame: (patch: Partial<EditState['frame']>, coalesceKey?: string) => void
  applyLook: (id: string | null) => void
  /** Change a develop setting and run the decoder again. */
  updateRawDevelop: (patch: Partial<EditState['raw']>) => void
  /** Full-resolution pixels, developing them first if this open came from cache. */
  ensureFullSource: () => Promise<ImageBitmap | null>
  /**
   * Build the upscaled view for the edits as they stand, or drop it when the
   * upscale is off. Returns the view, which is at full resolution, or null
   * when there is none or the photo changed underneath.
   */
  refreshUpscale: () => Promise<UpscaledView | null>
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
  setCropDragging: (on: CropDrag) => void
  setCropGuide: (guide: CropGuide, turn?: number) => void
  setDrawingHorizon: (on: boolean) => void
  setSheetDragging: (on: boolean) => void
  setMaskOverlay: (on: boolean) => void
  /** Commit a drawn stroke: find where it heals from, and whether it should fill. */
  addRetouchStroke: (stroke: Pick<RetouchStroke, 'points' | 'size' | 'feather'>) => Promise<void>
  updateRetouchStroke: (id: string, patch: Partial<RetouchStroke>, coalesceKey?: string) => void
  removeRetouchStroke: (id: string) => void
  selectRetouchStroke: (id: string | null) => void
  setRetouchBrush: (patch: Partial<EditorState['retouchBrush']>) => void
  setSmartFill: (on: boolean) => void
  /** Download the fill model, once; after that it is kept. */
  loadFillModel: () => Promise<void>
  /** Record that the model turned up by another route — an installed app's prefetch. */
  setFillReady: () => void
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
  setAutoExpose: (on: boolean) => void
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

const savedGuide = loadCropGuide()

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
  hidden: [],
  lensProfile: null,
  lensResolving: false,
  presets: [],
  framePresets: [],

  loading: false,
  loadingLabel: '',
  loadingProgress: null,
  loadingName: '',
  splitCompare: false,
  splitAt: 0.38,
  zoom: 'fit',
  openPanels: { light: true, crop: true, looks: true, curves: false, mixer: false, grade: false, lens: false, detail: false, grain: false, frame: false, upscale: false, masks: false, retouch: false, raw: false },
  focusedPanel: null,
  activeTool: null,
  toolSnapshot: null,
  cropping: false,
  activeMaskId: null,
  cropDragging: false,
  cropGuide: savedGuide.guide,
  cropGuideTurn: savedGuide.turn,
  drawingHorizon: false,
  sheetDragging: false,
  maskOverlay: true,
  activeRetouchId: null,
  retouchBrush: { size: DEFAULT_BRUSH_SIZE, feather: 50 },
  smartFill: loadSmartFill(),
  retouchPlanning: false,
  fillLoading: false,
  fillReady: loadFillReady(),
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
  autoExpose: loadAutoExpose(),
  pendingAutoExpose: null,
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
      modifiedAt: f.file.lastModified,
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
    queueThumbnails(added.map((f) => f.id), set, get)
  },

  async selectFrame(id) {
    const opened = openedFiles.get(id)
    if (!opened) return

    /*
     * Crop and masks draw over the photo and hold a snapshot of its edits for
     * Discard; carried onto another photo they would frame and restore the
     * wrong one. They close as the photo changes, kept as Apply would keep
     * them, since what was on screen is what was asked for. Other tools keep
     * their panel open and take a fresh snapshot once the new photo is in.
     */
    const tool = get().activeTool
    if (tool === 'crop' || tool === 'masks' || tool === 'retouch') get().applyTool()
    flushAutosave(get, set)

    set({
      loading: true,
      loadingLabel: isRawFile(opened.file.name) ? STAGE_LABELS.reading : 'Opening',
      loadingName: opened.file.name,
      activeFrameId: id,
      selectionAnchor: id,
      cropping: false,
      drawingHorizon: false,
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
        dropUpscaled(previous)
      }

      set({
        photo: {
          frameId: id,
          key,
          meta,
          source,
          preview,
          sourceIsPreview,
          upscaled: null,
          file: opened.file,
          handle: opened.handle,
        },
        edits,
        history: emptyHistory(),
        hidden: [],
        histogram: null,
        zoom: zoomByFrame.get(id) ?? 'fit',
        // Only a raw, and only one arriving with no edits of its own: a
        // photo somebody has already worked on has an exposure they chose.
        pendingAutoExpose:
          get().autoExpose && meta.isRaw && !saved?.edits ? id : null,
        // The selection named a mask on the photo being left behind.
        activeMaskId: edits.masks[0]?.id ?? null,
        activeRetouchId: null,
        // Discard in a still-open tool returns to this photo's edits, not the last one's.
        toolSnapshot: get().activeTool ? cloneEdits(edits) : null,
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
      void cacheThumbnail(key, id, preview, meta, set, get)
      void get().refreshRecents()
      // A subject mask covers nothing until its map is in hand. Bring back
      // whatever was found before; find the rest, if that costs no download.
      void get().autoDetectSubjects()
      void get().resolveLensProfile()
      // A photo saved with an upscale opens upscaled, with the bar to show for it.
      if (edits.upscale > 1) void get().refreshUpscale()
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
      zoomByFrame.delete(frame.id)
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
      dropUpscaled(photo)
    }
    set({
      photo: null,
      activeFrameId: null,
      edits: defaultEdits(),
      history: emptyHistory(),
      hidden: [],
      histogram: null,
      pendingAutoExpose: null,
      lensProfile: null,
      activeMaskId: null,
      activeRetouchId: null,
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
    const before = edits

    const now = Date.now()
    const nextHistory = shouldPush(history, coalesceKey ?? null, now)
      ? pushHistory(history, cloneEdits(edits), coalesceKey ?? null, now)
      : touchHistory(history, coalesceKey ?? null, now)

    set({
      edits: next,
      history: nextHistory,
      hidden: hiddenAfter(get, edits, next),
      // An edit made before the first histogram landed is the user's own
      // decision about this photo, and the lift must not land on top of it.
      pendingAutoExpose: coalesceKey === 'auto-expose' ? get().pendingAutoExpose : null,
    })
    maybeRedevelop(before, get, set)
    maybeReresolveLens(edits, get)
    maybeReupscale(get)
    scheduleAutosave(get, set)
  },

  toggleHidden(chipId) {
    const { hidden } = get()
    set({
      hidden: hidden.includes(chipId) ? hidden.filter((id) => id !== chipId) : [...hidden, chipId],
    })
  },

  async resolveLensProfile() {
    const { photo, activeFrameId, edits } = get()
    if (!photo || !activeFrameId) {
      set({ lensProfile: null })
      return
    }
    set({ lensResolving: true })
    try {
      const profile = await resolveLens(shotOf(photo.meta), edits.lens.correction.lensId, loadRemembered())
      // The photo may have changed under a slow fetch.
      if (get().activeFrameId !== activeFrameId) return
      set({ lensProfile: profile })
    } finally {
      if (get().activeFrameId === activeFrameId) set({ lensResolving: false })
    }
  },

  pickLens(lensId, remember) {
    const { photo, edits } = get()
    if (photo && remember) rememberLens(rememberKey(shotOf(photo.meta)), lensId)
    get().update({ lens: { ...edits.lens, correction: { ...edits.lens.correction, lensId } } }, 'lens-pick')
    // A remembered choice can change the answer without the id changing.
    if (photo && remember && !lensId) void get().resolveLensProfile()
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
      set({ loading: false, loadingLabel: '', loadingProgress: null, loadingName: '' })
    }
  },

  async refreshUpscale() {
    const photo = get().photo
    if (!photo) return null
    const edits = get().edits
    if (edits.upscale === 1) {
      if (photo.upscaled) {
        dropUpscaled(photo)
        set({ photo: { ...photo, upscaled: null }, histogram: null })
      }
      return null
    }
    const sig = upscaleSignature(edits)
    if (photo.upscaled?.sig === sig) return photo.upscaled

    const generation = ++upscaleGeneration
    // Always from the full-resolution pixels: a photo restored from the
    // develop cache holds a preview, and a model run on that would invent
    // detail for a picture that was never there.
    const native = await get().ensureFullSource()
    if (!native || upscaleGeneration !== generation || get().photo?.frameId !== photo.frameId) return null

    set({ loading: true, loadingLabel: 'Upscaling', loadingProgress: 0, loadingName: photo.meta.name })
    try {
      const prepared = await prepareUpscale(native, photo.meta, get().edits, photo.frameId, (fraction) => {
        if (upscaleGeneration === generation) set({ loadingProgress: fraction })
      })
      const current = get().photo
      if (upscaleGeneration !== generation || !current || current.frameId !== photo.frameId) {
        prepared.source.close()
        return null
      }
      const preview = await previewBitmap(prepared.source)
      const view: UpscaledView = {
        source: prepared.source,
        preview,
        region: prepared.region,
        factor: prepared.factor,
        sig,
        from: { width: native.width, height: native.height },
      }
      if (current.upscaled) dropUpscaled(current)
      set({ photo: { ...current, upscaled: view }, histogram: null })
      return view
    } catch (err) {
      get().toast(err instanceof Error ? `Could not upscale — ${err.message}` : 'Could not upscale', 'error')
      return null
    } finally {
      if (upscaleGeneration === generation) {
        set({ loading: false, loadingLabel: '', loadingProgress: null, loadingName: '' })
      }
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
   * Give every subject mask on the open photo its map, without being asked.
   *
   * First from disk: a map found on an earlier visit comes back in a few
   * milliseconds and draws on the next frame, which is what makes closing a
   * photo and reopening it bring the whole edit back rather than all of it
   * but the subject. Then, for anything still uncovered, the detector — but
   * only when the model is already on this machine. The first detection ever
   * is an 8 MB download, and starting one on somebody's behalf because they
   * opened a photo, or because a mask arrived on it from a sync, is not a
   * decision to make for them. Once it is here it is a second of compute, and
   * asking again is just a click in the way.
   */
  async autoDetectSubjects() {
    const { edits, activeFrameId } = get()
    const subjects = edits.masks.filter((m) => m.kind === 'subject')
    if (!subjects.length || !activeFrameId) return

    const { restored, missing } = await restoreSubjects(subjects, activeFrameId)
    if (get().activeFrameId !== activeFrameId) return
    // What came back is the model's coarse answer; the mask draws once it has
    // been re-cut along the picture, and the listener below redraws for that.
    if (restored) {
      const photo = get().photo
      if (photo) primeSubjects(subjects, activeFrameId, photo.preview)
    }

    const pending = missing.filter((m) => m.enabled && m.amount > 0)
    if (!pending.length) return
    if (!modelIsWarm() && !(await isModelCached())) return
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
      // Found, remembered — in memory and on disk — and refined with the
      // mask's own edge settings.
      await refineFor(mask, activeFrameId, photo.preview)
      // The photo may have been changed underneath a slow detection.
      if (get().activeFrameId !== activeFrameId) return
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

  setCropGuide(guide, turn = 0) {
    const turns = guideTurns(guide)
    const wrapped = ((turn % turns) + turns) % turns
    saveCropGuide(guide, wrapped)
    set({ cropGuide: guide, cropGuideTurn: wrapped })
  },
  setCropDragging(on) {
    if (get().cropDragging !== on) set({ cropDragging: on })
  },

  setDrawingHorizon(on) {
    if (get().drawingHorizon !== on) set({ drawingHorizon: on })
  },

  setSheetDragging(on) {
    if (get().sheetDragging !== on) set({ sheetDragging: on })
  },

  async addRetouchStroke(stroke) {
    const { photo, activeFrameId, smartFill, fillReady } = get()
    if (!photo || !activeFrameId || stroke.points.length < 2) return

    set({ retouchPlanning: true })
    try {
      const planned = await planStroke(
        photo.preview,
        photo.meta.orientation,
        get().edits.retouch.filter((s) => s.enabled),
        stroke,
        activeFrameId,
        smartFill && fillReady,
      )
      // The photo can change while the search runs; the stroke belongs to the
      // one it was drawn on, and nowhere else.
      if (get().activeFrameId !== activeFrameId) return
      const added: RetouchStroke = {
        id: crypto.randomUUID(),
        enabled: true,
        points: stroke.points.map(round6),
        size: round6(stroke.size),
        feather: stroke.feather,
        ...planned,
        dx: round6(planned.dx),
        dy: round6(planned.dy),
      }
      // Not selected: a selected spot is drawn on the picture, and a spot you
      // have just taken out should leave nothing behind to look at.
      get().update({ retouch: [...get().edits.retouch, added] }, `retouch-add-${added.id}`)
    } catch (err) {
      get().toast(err instanceof Error ? `Could not heal there — ${err.message}` : 'Could not heal there', 'error')
    } finally {
      set({ retouchPlanning: false })
    }
  },

  updateRetouchStroke(id, patch, coalesceKey) {
    const retouch = get().edits.retouch.map((s) => (s.id === id ? { ...s, ...patch } : s))
    get().update({ retouch }, coalesceKey)
  },

  removeRetouchStroke(id) {
    const { edits, activeRetouchId } = get()
    const index = edits.retouch.findIndex((s) => s.id === id)
    if (index === -1) return
    const remaining = edits.retouch.filter((s) => s.id !== id)
    get().update({ retouch: remaining }, `retouch-remove-${id}`)
    if (activeRetouchId === id) set({ activeRetouchId: remaining[Math.min(index, remaining.length - 1)]?.id ?? null })
  },

  selectRetouchStroke(id) {
    set({ activeRetouchId: id })
  },

  setRetouchBrush(patch) {
    set({ retouchBrush: { ...get().retouchBrush, ...patch } })
  },

  setSmartFill(on) {
    set({ smartFill: on })
    saveSmartFill(on)
  },

  async loadFillModel() {
    if (get().fillLoading) return
    set({ fillLoading: true })
    try {
      await prepareFillModel()
      set({ fillReady: true, smartFill: true })
      saveSmartFill(true)
    } catch {
      get().toast('Could not load the fill model — check the connection and try again', 'error')
    } finally {
      set({ fillLoading: false })
    }
  },

  setFillReady() {
    if (!get().fillReady) set({ fillReady: true })
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
      hidden: hiddenAfter(get, current, edits),
    })
    maybeRedevelop(current, get, set)
    maybeReresolveLens(current, get)
    maybeReupscale(get)
    scheduleAutosave(get, set)
  },

  undo() {
    const { history, edits } = get()
    const previous = history.past.at(-1)
    if (!previous) return
    const before = edits
    set({
      edits: previous,
      history: {
        past: history.past.slice(0, -1),
        future: [cloneEdits(edits), ...history.future],
        coalesceKey: null,
        coalesceAt: 0,
      },
      hidden: hiddenAfter(get, edits, previous),
    })
    maybeRedevelop(before, get, set)
    maybeReresolveLens(edits, get)
    scheduleAutosave(get, set)
  },

  redo() {
    const { history, edits } = get()
    const next = history.future[0]
    if (!next) return
    const before = edits
    set({
      edits: next,
      history: {
        past: [...history.past, cloneEdits(edits)],
        future: history.future.slice(1),
        coalesceKey: null,
        coalesceAt: 0,
      },
      hidden: hiddenAfter(get, edits, next),
    })
    maybeRedevelop(before, get, set)
    maybeReresolveLens(edits, get)
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
    // Crop is about this frame, not the look, so it stays put — and so do the
    // retouch strokes, which are spots on one particular photograph.
    get().replaceEdits(
      { ...cloneEdits(clipboard), crop: get().edits.crop, retouch: get().edits.retouch },
      'paste',
    )
    get().toast('Look pasted')
  },

  /* ─────────────────────────── ui ─────────────────────────── */

  setSplit(on) { set({ splitCompare: on }) },
  setSplitAt(v) { set({ splitAt: Math.min(0.98, Math.max(0.02, v)) }) },
  setZoom(z) {
    // Keyed by the photo on screen, not the active frame: while the next one
    // is still developing, the zoom being changed is the old photo's.
    const id = get().photo?.frameId
    if (id) {
      if (z === 'fit') zoomByFrame.delete(id)
      else zoomByFrame.set(id, z)
    }
    set({ zoom: z })
  },

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
    set({ activeTool: null, toolSnapshot: null, cropping: false, drawingHorizon: false })
    // The crop and retouch tools showed the picture as shot; the view they
    // may have changed is built again now that they are closed.
    maybeReupscale(get)
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

  setCropping(on) {
    set({ cropping: on, splitCompare: on ? false : get().splitCompare, drawingHorizon: on && get().drawingHorizon })
  },
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
  setHistogram(data) {
    const { pendingAutoExpose, activeFrameId, edits } = get()
    set({ histogram: data })
    if (!pendingAutoExpose || pendingAutoExpose !== activeFrameId) return
    set({ pendingAutoExpose: null })
    // Measured before the user has touched anything; if they have, theirs wins.
    if (edits.exposure !== 0 || edits.highlights !== 0) return
    const lift = openingLift(data)
    if (Object.keys(lift).length) get().update(lift, 'auto-expose')
  },
  setAutoExpose(on) {
    set({ autoExpose: on })
    saveAutoExpose(on)
  },
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

// A refined map landing is not an edit, so it cannot reach the viewport through
// the edit stack. It nudges the same counter a finished detection does.
onSubjectMapsChanged(() => useEditor.setState({ maskMapsAt: Date.now() }))

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
/*
 * The one preference this app keeps. localStorage rather than IndexedDB: a
 * boolean read once at startup does not need a transaction, and it must be
 * there synchronously for the initial state. Wrapped, because storage can be
 * absent or refuse in a private window, and that costs the default, not a
 * broken app.
 */
const AUTO_EXPOSE_KEY = '35mm.autoExpose'

function loadAutoExpose(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_EXPOSE_KEY)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

function saveAutoExpose(on: boolean): void {
  try {
    localStorage.setItem(AUTO_EXPOSE_KEY, on ? '1' : '0')
  } catch {
    // Nothing to do: the choice holds for this session.
  }
}

/** Six places is a tenth of a pixel on a 100-megapixel frame, and keeps sidecars short. */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

/** A different lens picked — by an edit, an undo, a paste — is a different profile. */
function maybeReresolveLens(before: EditState, get: Getter): void {
  if (get().edits.lens.correction.lensId !== before.lens.correction.lensId) void get().resolveLensProfile()
}

/** The hidden set once `before` has become `after` — see `revealTouched`. */
function hiddenAfter(get: Getter, before: EditState, after: EditState): readonly string[] {
  const { hidden, photo } = get()
  return revealTouched(hidden, before, after, photo?.meta ?? null)
}

/**
 * The edits to draw, export and measure: the stack with every shut eye taken
 * out. Everything that puts pixels on screen or in a file reads this; the
 * panels and their sliders keep reading `edits`, because the value under a
 * shut eye is still the user's value.
 */
export function useRenderEdits(): EditState {
  const edits = useEditor((s) => s.edits)
  const hidden = useEditor((s) => s.hidden)
  const meta = useEditor((s) => s.photo?.meta ?? null)
  return useMemo(() => withHidden(edits, hidden, meta), [edits, hidden, meta])
}

let upscaleGeneration = 0
let upscaleTimer: ReturnType<typeof setTimeout> | null = null

/** Let the view's bitmaps go. The record is left to the caller to replace. */
function dropUpscaled(photo: OpenPhoto): void {
  const view = photo.upscaled
  if (!view) return
  view.source.close()
  if (view.preview !== view.source) view.preview.close()
}

/**
 * The upscaled view is built for a particular geometry; when that moves, or
 * the factor does, it is built again — a moment after the last change, so a
 * slider does not run the model on every notch. Not while the crop or
 * retouch tool is open: those show the picture as shot, and `closeTool`
 * comes back here when they are done.
 */
function maybeReupscale(get: Getter): void {
  const { photo, edits, activeTool, cropping } = get()
  if (!photo) return
  const wanted = edits.upscale > 1
  if (!wanted && !photo.upscaled) return
  if (wanted && photo.upscaled?.sig === upscaleSignature(edits)) return
  if (cropping || activeTool === 'crop' || activeTool === 'retouch') return
  if (upscaleTimer) clearTimeout(upscaleTimer)
  upscaleTimer = setTimeout(
    () => {
      upscaleTimer = null
      void get().refreshUpscale()
    },
    wanted && !photo.upscaled ? 0 : 250,
  )
}

/** The raw settings changed, so the pixels everything else works on have to be made again. */
function maybeRedevelop(before: EditState, get: Getter, set: Setter): void {
  if (!get().photo?.meta.isRaw) return
  if (JSON.stringify(before.raw) === JSON.stringify(get().edits.raw)) return
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
    // Built from the pixels that were just replaced.
    dropUpscaled(current)

    set({
      photo: {
        ...current,
        meta: developed.meta,
        source: developed.source,
        preview: developed.preview,
        sourceIsPreview: developed.sourceIsPreview,
        upscaled: null,
      },
      histogram: null,
    })
    maybeReupscale(get)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not develop that file'
    get().toast(message, 'error')
  } finally {
    if (developGeneration === generation) {
      set({ loading: false, loadingLabel: '', loadingProgress: null, loadingName: '' })
    }
  }
}

/**
 * Files are held outside the store: `File` and `FileSystemFileHandle` are not
 * plain data, and keeping them out of state keeps the store serialisable.
 */
const openedFiles = new Map<string, OpenedFile>()

/**
 * The zoom each photo was left at, by frame id. A view setting rather than an
 * edit, so it lives for the session and never reaches a sidecar — but it is the
 * photo's own: zooming into one frame to check focus must not drag every other
 * frame in the strip in with it.
 */
const zoomByFrame = new Map<string, ZoomMode>()

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
  meta: ImageMeta,
  set: Setter,
  get: Getter,
) {
  const blob = await makeThumbnail(bitmap, meta.orientation)
  if (!blob) return
  // Filed with the shot facts, so a strip grouped by lens does not have to
  // decode every photo it has ever shown a thumbnail of.
  void db.saveThumb(key, blob, db.shotFacts(meta))

  const url = URL.createObjectURL(blob)
  set({
    frames: get().frames.map((f) => {
      if (f.id !== frameId) return f
      if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl)
      return { ...f, thumbUrl: url }
    }),
  })
}

/** An `ImageMeta` with nothing in it, to type the facts an EXIF read gives. */
const blankMeta: ImageMeta = { name: '', ext: '', isRaw: false, width: 0, height: 0, orientation: 1, bytes: 0 }

/**
 * Thumbnails still to make, and the order to make them in.
 *
 * One queue for the whole strip rather than one loop per drop, so photos added
 * while a folder is still filling in join the same line instead of racing it
 * for LibRaw, which decodes one file at a time either way.
 */
const thumbQueue = new Set<string>()
/** Most recent first: the photo just clicked is the one being looked at. */
let thumbUrgent: string[] = []
/** Where each photo sits in the strip as drawn, top first. */
let thumbRank = new Map<string, number>()
let thumbWorker: Promise<void> | null = null

/**
 * Tell the queue the order the strip is drawn in, so the thumbnails fill in
 * from the top down rather than in the order the files were dropped — which,
 * once the strip is sorted by date or grouped by lens, is no order at all.
 */
export function setThumbnailOrder(ids: string[]) {
  thumbRank = new Map(ids.map((id, i) => [id, i]))
}

/** Put a photo still waiting for its thumbnail at the front of the line. */
export function prioritizeThumbnail(id: string) {
  if (!thumbQueue.has(id)) return
  thumbUrgent = [id, ...thumbUrgent.filter((u) => u !== id)]
}

function nextThumbnail(get: Getter): string | undefined {
  while (thumbUrgent.length) {
    const id = thumbUrgent.shift()!
    if (thumbQueue.has(id)) return id
  }
  // Anything the strip has not ranked — a phone, where the library draws the
  // frames as they are — falls back to its place in the list, after the rest.
  const frameIndex = new Map(get().frames.map((f, i) => [f.id, i]))
  const rank = (id: string) => thumbRank.get(id) ?? thumbRank.size + (frameIndex.get(id) ?? Infinity)
  let best: string | undefined
  for (const id of thumbQueue) if (best === undefined || rank(id) < rank(best)) best = id
  return best
}

/** Decode the rest of a dropped batch at thumbnail size only. */
function queueThumbnails(ids: string[], set: Setter, get: Getter) {
  for (const id of ids) thumbQueue.add(id)
  thumbWorker ??= drainThumbnails(set, get).finally(() => {
    thumbWorker = null
  })
}

async function drainThumbnails(set: Setter, get: Getter) {
  for (;;) {
    // Wait for any open the user is actually watching before starting the next
    // thumbnail. LibRaw runs one decode at a time, so without this a folder of
    // raws puts every remaining file ahead of the photo they just clicked —
    // minutes of apparent freeze. Yielding here bounds that to a single decode.
    while (get().loading) await new Promise((r) => setTimeout(r, 120))

    // Picked only now, after the wait, so a click made during it counts.
    const id = nextThumbnail(get)
    if (id === undefined) return
    thumbQueue.delete(id)

    // The open photo makes its own thumbnail from the develop it just did.
    if (get().photo?.frameId === id) continue
    if (get().frames.find((f) => f.id === id)?.thumbUrl) continue
    const opened = openedFiles.get(id)
    if (!opened) continue

    try {
      const cached = await db.loadThumb(db.fileKey(opened.file))
      if (cached) {
        // A thumbnail filed before the strip could sort by camera has no facts
        // beside it. Reading the EXIF block is a few kilobytes, not a decode,
        // so the record is brought up to date on the spot.
        let shot = cached.shot
        if (!shot) {
          const facts = db.shotFacts({ ...blankMeta, ...(await readShotInfo(opened.file)) })
          if (Object.keys(facts).length) {
            shot = facts
            void db.saveThumb(db.fileKey(opened.file), cached.blob, facts)
          }
        }
        const url = URL.createObjectURL(cached.blob)
        set({
          frames: get().frames.map((f) =>
            f.id === id && !f.thumbUrl ? { ...f, thumbUrl: url, meta: { ...f.meta, ...(shot ?? {}) } } : f,
          ),
        })
        continue
      }

      const decoded = await decodeFile(opened.file)
      await cacheThumbnail(db.fileKey(opened.file), id, decoded.bitmap, decoded.meta, set, get)
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
  autosaveTimer = setTimeout(() => saveNow(get, set), AUTOSAVE_DELAY)
}

/**
 * Write a pending autosave immediately. Called on the way to another photo:
 * the save reads whichever photo is open when it fires, and a JPEG can open
 * inside the debounce, so the last edits to the photo being left would be
 * filed against the one arriving — and lost from their own.
 */
function flushAutosave(get: Getter, set: Setter) {
  if (!autosaveTimer) return
  clearTimeout(autosaveTimer)
  saveNow(get, set)
}

function saveNow(get: Getter, set: Setter) {
  autosaveTimer = null
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
    lens: {
      ...base.lens,
      ...(edits.lens ?? {}),
      // The profile settings arrived after the sliders; an older record has none.
      correction: { ...base.lens.correction, ...(edits.lens?.correction ?? {}) },
    },
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
      if (filled.kind !== 'subject') return filled
      // The edge controls arrived after the first subject masks were written.
      return {
        ...filled,
        model: DETECT_VERSION,
        detail: Number.isFinite(filled.detail) ? filled.detail : SUBJECT_EDGE_DEFAULTS.detail,
        shift: Number.isFinite(filled.shift) ? filled.shift : SUBJECT_EDGE_DEFAULTS.shift,
      }
    }),
    dynamicRange: edits.dynamicRange ?? base.dynamicRange,
    raw: { ...base.raw, ...(edits.raw ?? {}) },
    // Anything malformed is dropped rather than repaired: a stroke with no
    // points has nowhere to heal, and a missing number reaches the heal as NaN.
    retouch: (Array.isArray(edits.retouch) ? edits.retouch : base.retouch).filter(
      (s) =>
        s &&
        Array.isArray(s.points) &&
        s.points.length >= 2 &&
        s.points.every(Number.isFinite) &&
        [s.size, s.feather, s.dx, s.dy].every(Number.isFinite) &&
        (s.mode === 'heal' || s.mode === 'fill'),
    ).map((s) => ({ ...s, enabled: s.enabled !== false })),
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
