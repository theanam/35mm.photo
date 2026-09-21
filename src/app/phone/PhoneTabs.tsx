import { useEffect, useMemo, useRef } from 'react'
import { useEditor } from '../../editor/edit-stack/store'
import { availableTools } from '../../editor/tools/registry'

/**
 * Every tool, in one scrolling strip.
 *
 * The desktop splits these in two — nine panels that sit open in the rail, and
 * two that take the rail over with an apply/discard pair. That split exists
 * because the rail is always on screen, and a phone has no such place. So all
 * of them become the same thing here: tap to open into the sheet, tap again to
 * close, commit or cancel explicitly. `openTool` already carries that
 * behaviour for any tool — the only tool-specific lines it has are turning the
 * crop box on and picking a mask.
 *
 * Eleven tools do not fit across 390 points and will not be made to. The strip
 * scrolls, and the active tool is scrolled to the middle so the ones on either
 * side of it stay in view.
 */
export function PhoneTabs() {
  const meta = useEditor((s) => s.photo?.meta ?? null)
  const edits = useEditor((s) => s.edits)
  const activeTool = useEditor((s) => s.activeTool)
  const openTool = useEditor((s) => s.openTool)

  const tools = useMemo(() => availableTools(meta), [meta])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeTool) return
    const el = ref.current?.querySelector(`[data-tool="${activeTool}"]`)
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeTool])

  return (
    <nav className="phone-tabs" ref={ref} aria-label="Tools">
      {tools.map((tool) => {
        const open = activeTool === tool.id
        return (
          <button
            key={tool.id}
            className="phone-tab"
            data-tool={tool.id}
            data-open={open || undefined}
            aria-pressed={open}
            onClick={() => openTool(tool.id)}
          >
            <tool.Icon size={19} />
            <span className="phone-tab__label">{tool.short ?? tool.label}</span>
            {tool.isDirty(edits) && <span className="phone-tab__dot" aria-label="has edits" />}
          </button>
        )
      })}
    </nav>
  )
}
