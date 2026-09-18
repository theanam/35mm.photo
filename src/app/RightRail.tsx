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
  const isRaw = useEditor((s) => s.photo?.meta.isRaw ?? false)

  const dirty = (id: string) => getTool(id as never)?.isDirty(edits) ?? false

  return (
    <aside className="rail" aria-label="Adjustments">
      <Histogram />

      {isRaw && (
        <Panel id="raw" title="RAW develop" note={rawSummary(edits)} collapsible active={dirty('raw')}>
          <RawTool />
        </Panel>
      )}

      {/* Collapsible like the rest. Both of these open by default — see
          openPanels in the store — so the rail still reads the same on arrival;
          the difference is that the two panels taking the most vertical space
          can now be folded away like every other one. */}
      <Panel
        id="looks"
        title="Looks"
        note="previewed on your photo"
        collapsible
        active={dirty('looks')}
      >
        <LooksTool />
      </Panel>

      <Panel id="light" title="Light & colour" collapsible active={dirty('light')}>
        <LightTool />
      </Panel>

      <Panel id="curves" title="Curves" collapsible active={dirty('curves')}>
        <CurvesTool />
      </Panel>

      <Panel id="mixer" title="Colour mixer" collapsible active={dirty('mixer')}>
        <MixerTool />
      </Panel>

      {/* After the mixer and before detail, matching the order the colour pass
          applies them in — the rail reads top to bottom as the pipeline runs. */}
      <Panel id="grade" title="Colour grading" collapsible active={dirty('grade')}>
        <ColorGradeTool />
      </Panel>

      <Panel id="lens" title="Optics & perspective" collapsible active={dirty('lens')}>
        <LensTool />
      </Panel>

      <Panel id="detail" title="Detail & noise" collapsible active={dirty('detail')}>
        <DetailTool />
      </Panel>

      <Panel id="grain" title="Grain & vignette" collapsible active={dirty('grain')}>
        <GrainTool />
      </Panel>
    </aside>
  )
}
