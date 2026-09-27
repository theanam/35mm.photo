import { Panel } from './ui/Panel'
import { Histogram } from '../editor/tools/Histogram'
import { LooksTool } from '../editor/tools/LooksTool'
import { LightTool } from '../editor/tools/LightTool'
import { CurvesTool } from '../editor/tools/CurvesTool'
import { MixerTool } from '../editor/tools/MixerTool'
import { ColorGradeTool } from '../editor/tools/ColorGradeTool'
import { LensTool } from '../editor/tools/LensTool'
import { DetailTool } from '../editor/tools/DetailTool'
import { GrainTool } from '../editor/tools/GrainTool'
import { FrameTool } from '../editor/tools/FrameTool'
import { RawTool } from '../editor/tools/RawTool'
import { useEditor } from '../editor/edit-stack/store'
import { getTool } from '../editor/tools/registry'
import { rawSummary } from '../editor/edit-stack/summary'

/**
 * Colour and contrast live here, where they always have. Only the geometry
 * tools move to the top toolbar — those need the whole viewport and a
 * commit/cancel gesture; these are continuous adjustments you leave open.
 */
export function RightRail() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const isRaw = useEditor((s) => s.photo?.meta.isRaw ?? false)

  const dirty = (id: string) => getTool(id as never)?.isDirty(edits) ?? false

  /**
   * One button per section, in its header, that puts every control in it
   * back — the registry already knows what each tool's defaults are, for the
   * toolbar tools' own Reset. It is only there while there is something to
   * put back, so a row of untouched sections is not a row of buttons.
   */
  const reset = (id: string) => {
    const tool = getTool(id as never)
    if (!tool || !tool.isDirty(edits)) return undefined
    return (
      <button
        className="link-button panel__reset"
        onClick={() => update(tool.reset(edits), `reset-${tool.id}`)}
        title={`Reset ${tool.label.toLowerCase()} to defaults`}
      >
        Reset
      </button>
    )
  }

  return (
    <aside className="rail" aria-label="Adjustments">
      <Histogram />

      {isRaw && (
        <Panel id="raw" action={reset('raw')} title="RAW develop" note={rawSummary(edits)} collapsible active={dirty('raw')}>
          <RawTool />
        </Panel>
      )}

      {/* Collapsible like the rest. Both of these open by default — see
          openPanels in the store — so the rail still reads the same on arrival;
          the difference is that the two panels taking the most vertical space
          can now be folded away like every other one. */}
      <Panel
        id="looks" action={reset('looks')}
        title="Looks"
        note="previewed on your photo"
        collapsible
        active={dirty('looks')}
      >
        <LooksTool />
      </Panel>

      <Panel id="light" action={reset('light')} title="Light & colour" collapsible active={dirty('light')}>
        <LightTool />
      </Panel>

      <Panel id="curves" action={reset('curves')} title="Curves" collapsible active={dirty('curves')}>
        <CurvesTool />
      </Panel>

      <Panel id="mixer" action={reset('mixer')} title="Colour mixer" collapsible active={dirty('mixer')}>
        <MixerTool />
      </Panel>

      {/* After the mixer and before detail, matching the order the colour pass
          applies them in — the rail reads top to bottom as the pipeline runs. */}
      <Panel id="grade" action={reset('grade')} title="Colour grading" collapsible active={dirty('grade')}>
        <ColorGradeTool />
      </Panel>

      <Panel id="lens" action={reset('lens')} title="Optics & perspective" collapsible active={dirty('lens')}>
        <LensTool />
      </Panel>

      <Panel id="detail" action={reset('detail')} title="Detail & noise" collapsible active={dirty('detail')}>
        <DetailTool />
      </Panel>

      <Panel id="grain" action={reset('grain')} title="Grain & vignette" collapsible active={dirty('grain')}>
        <GrainTool />
      </Panel>

      {/* Last, because it is the last thing the render does: the mat goes on
          around everything above it. */}
      <Panel id="frame" action={reset('frame')} title="Frame" collapsible active={dirty('frame')}>
        <FrameTool />
      </Panel>
    </aside>
  )
}
