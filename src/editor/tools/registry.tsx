import type { ComponentType } from 'react'
import type { EditState, ImageMeta } from '../edit-stack/types'
import {
  NEUTRAL_TEMPERATURE,
  defaultRawDevelop,
  neutralColorGrade,
  neutralFrame,
  neutralLens,
  neutralPerspective,
} from '../edit-stack/defaults'
import {
  hasCropEdits,
  hasCurveEdits,
  hasDetailEdits,
  hasFinishEdits,
  hasGradeEdits,
  hasLensEdits,
  hasFrameEdits,
  hasMaskEdits,
  hasMixerEdits,
  hasRawEdits,
  hasToneEdits,
  type PanelId,
} from '../edit-stack/summary'
import {
  IconCrop, IconCurves, IconDetail, IconGrade, IconGrain, IconLens, IconLight, IconLooks,
  IconFrame, IconMask, IconMixer, IconRaw,
} from '../../app/ui/icons'
import { LooksTool } from './LooksTool'
import { LightTool } from './LightTool'
import { CurvesTool } from './CurvesTool'
import { MixerTool } from './MixerTool'
import { ColorGradeTool } from './ColorGradeTool'
import { LensTool } from './LensTool'
import { CropTool } from './CropTool'
import { MasksTool } from './MasksTool'
import { DetailTool } from './DetailTool'
import { GrainTool } from './GrainTool'
import { FrameTool } from './FrameTool'
import { RawTool } from './RawTool'

export type ToolId = PanelId

export interface ToolDef {
  id: ToolId
  label: string
  /** Sits under the title in the tool panel's header. */
  hint: string
  /**
   * Used where a tab is only as wide as its word — the phone's tool strip.
   * Only a tool whose full label is a phrase needs one.
   */
  short?: string
  Icon: ComponentType<{ size?: number }>
  Content: ComponentType
  /** True when this tool holds values away from their defaults. */
  isDirty: (edits: EditState) => boolean
  /** Restore only this tool's parameters to their defaults. */
  reset: (edits: EditState) => Partial<EditState>
  /** Tools that only apply to certain files. */
  available?: (meta: ImageMeta | null) => boolean
}

export const TOOLS: ToolDef[] = [
  {
    id: 'looks',
    label: 'Looks',
    hint: 'previewed on your photo',
    Icon: IconLooks,
    Content: LooksTool,
    isDirty: (e) => Boolean(e.look.id),
    reset: () => ({ look: { id: null, strength: 100 }, grain: 0 }),
  },
  {
    id: 'light',
    label: 'Light',
    hint: 'exposure, tone and colour',
    Icon: IconLight,
    Content: LightTool,
    isDirty: (e) =>
      e.exposure !== 0 ||
      hasToneEdits(e) ||
      e.temperature !== NEUTRAL_TEMPERATURE ||
      e.tint !== 0 ||
      e.vibrance !== 0 ||
      e.saturation !== 0,
    reset: () => ({
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      dynamicRange: 0,
      temperature: NEUTRAL_TEMPERATURE, tint: 0, vibrance: 0, saturation: 0,
    }),
  },
  {
    id: 'curves',
    label: 'Curves',
    hint: 'RGB and per-channel',
    Icon: IconCurves,
    Content: CurvesTool,
    isDirty: hasCurveEdits,
    reset: () => ({
      curves: {
        rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      },
    }),
  },
  {
    id: 'mixer',
    label: 'Colour',
    hint: 'eight bands, hue, saturation and luminance',
    Icon: IconMixer,
    Content: MixerTool,
    isDirty: hasMixerEdits,
    reset: (e) => ({
      hsl: Object.fromEntries(
        Object.keys(e.hsl).map((band) => [band, { hue: 0, sat: 0, lum: 0 }]),
      ) as EditState['hsl'],
    }),
  },
  {
    id: 'grade',
    label: 'Grading',
    hint: 'split toning across shadows, midtones and highlights',
    Icon: IconGrade,
    Content: ColorGradeTool,
    isDirty: hasGradeEdits,
    reset: () => ({ colorGrade: neutralColorGrade() }),
  },
  {
    id: 'masks',
    label: 'Masks',
    hint: 'local adjustments — radial, linear and range',
    Icon: IconMask,
    Content: MasksTool,
    isDirty: hasMaskEdits,
    reset: () => ({ masks: [] }),
  },
  {
    id: 'crop',
    label: 'Crop & transform',
    short: 'Crop',
    hint: 'aspect, straighten, rotate and flip',
    Icon: IconCrop,
    Content: CropTool,
    isDirty: hasCropEdits,
    reset: (e) => ({
      crop: {
        ...e.crop,
        x: 0, y: 0, w: 1, h: 1,
        angle: 0, rotate90: 0, flipH: false, flipV: false, aspect: 'original',
      },
    }),
  },
  {
    id: 'lens',
    label: 'Optics',
    hint: 'perspective, distortion and chromatic aberration',
    Icon: IconLens,
    Content: LensTool,
    isDirty: hasLensEdits,
    reset: () => ({ perspective: neutralPerspective(), lens: neutralLens() }),
  },
  {
    id: 'detail',
    label: 'Detail',
    hint: 'texture, clarity, dehaze, sharpening and noise',
    Icon: IconDetail,
    Content: DetailTool,
    isDirty: hasDetailEdits,
    reset: () => ({
      clarity: 0, texture: 0, dehaze: 0, sharpen: 0, denoiseLuma: 0, denoiseChroma: 0,
    }),
  },
  {
    id: 'grain',
    label: 'Grain',
    hint: 'halation, grain and vignette',
    Icon: IconGrain,
    Content: GrainTool,
    isDirty: hasFinishEdits,
    reset: () => ({ grain: 0, grainSize: 50, vignette: 0, halation: 0 }),
  },
  {
    id: 'frame',
    label: 'Frame',
    hint: 'a border around the picture',
    Icon: IconFrame,
    Content: FrameTool,
    isDirty: hasFrameEdits,
    // The colour goes back to white with the widths: a mat nobody can see has
    // no colour worth keeping.
    reset: () => ({ frame: neutralFrame() }),
  },
  {
    id: 'raw',
    label: 'RAW',
    hint: 'how the file is developed',
    Icon: IconRaw,
    Content: RawTool,
    isDirty: hasRawEdits,
    // Safe to reset through the ordinary edit path: the store watches the
    // develop block on every write and runs the decoder again when it moves.
    reset: () => ({ raw: defaultRawDevelop() }),
    available: (meta) => Boolean(meta?.isRaw),
  },
]

/**
 * Tools that live in the top toolbar, each taking over the right rail with its
 * own apply/discard. Geometry goes here because it needs the whole viewport and
 * a commit gesture; the continuous colour adjustments are what the rail holds
 * the rest of the time. Masks join them for the same reason: placing one is a
 * gesture on the picture, not a slider you leave open.
 *
 * Add an id here to promote a tool to the toolbar — nothing else needs to change.
 */
export const TOOLBAR_TOOL_IDS: ToolId[] = ['crop', 'masks']

export const TOOLS_BY_ID = new Map(TOOLS.map((t) => [t.id, t]))

export function getTool(id: ToolId | null): ToolDef | null {
  return id ? (TOOLS_BY_ID.get(id) ?? null) : null
}

export function availableTools(meta: ImageMeta | null): ToolDef[] {
  return TOOLS.filter((t) => !t.available || t.available(meta))
}

/** The toolbar's tools, in toolbar order, filtered to what this file supports. */
export function toolbarTools(meta: ImageMeta | null): ToolDef[] {
  return TOOLBAR_TOOL_IDS.map((id) => TOOLS_BY_ID.get(id)).filter(
    (t): t is ToolDef => Boolean(t) && (!t!.available || t!.available(meta)),
  )
}

/** True when a chip or shortcut should open the tool rather than a rail panel. */
export function isToolbarTool(id: ToolId): boolean {
  return TOOLBAR_TOOL_IDS.includes(id)
}
