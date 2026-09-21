import { useEffect } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { getTool } from '../editor/tools/registry'
import { IconCheck, IconCross } from './ui/icons'

/**
 * The open tool's controls, shown in the right rail in place of the
 * adjustments. Discard puts the edit state back to the snapshot taken when the
 * tool was opened; Apply keeps what is on screen. Both close the panel, so the
 * pair reads as a proper cancellable edit without anything ever being baked
 * into pixels.
 */
export function ToolPanel() {
  const activeTool = useEditor((s) => s.activeTool)
  const applyTool = useEditor((s) => s.applyTool)
  const discardTool = useEditor((s) => s.discardTool)
  const update = useEditor((s) => s.update)
  const edits = useEditor((s) => s.edits)
  const changed = useEditor((s) => s.toolChanged())

  const tool = getTool(activeTool)

  // Escape discards, matching the dialog convention everywhere else in the app.
  useEffect(() => {
    if (!tool) return

    const onKey = (event: KeyboardEvent) => {
      // The export dialog is modal over the panel and owns the keys while open.
      if (useEditor.getState().exportOpen) return

      if (event.key === 'Escape') {
        event.preventDefault()
        discardTool()
        return
      }
      if (event.key !== 'Enter') return

      // Only text entry should swallow Enter. A slider has focus for most of a
      // tool's life, and Enter has no meaning there — it must still apply.
      const target = event.target
      const typing =
        target instanceof Element &&
        target.matches(
          'textarea, [contenteditable="true"], input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"])',
        )
      if (typing) return

      event.preventDefault()
      applyTool()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool, applyTool, discardTool])

  if (!tool) return null

  const resettable = tool.isDirty(edits)

  return (
    // Keyed so that going straight from one tool to another replays the swap:
    // the rail changing under you is the whole signal that the click landed.
    <section key={tool.id} className="tool-panel" aria-label={`${tool.label} controls`}>
      <header className="tool-panel__head">
        {/* The rail is a third of the drawer's old width, so the header that
            used to be one line is two: what this is, then what it does and how
            to undo it. */}
        <div className="tool-panel__row">
          <span className="tool-panel__icon" aria-hidden>
            <tool.Icon size={17} />
          </span>
          <h2 className="tool-panel__title">{tool.label}</h2>

          <div className="tool-panel__buttons">
            <button
              className="icon-button icon-button--discard"
              onClick={discardTool}
              title={changed ? 'Discard these changes (Esc)' : 'Close (Esc)'}
              aria-label={changed ? 'Discard changes' : 'Close'}
            >
              <IconCross />
            </button>
            <button
              className="icon-button icon-button--apply"
              onClick={applyTool}
              title="Apply and close (Enter)"
              aria-label="Apply and close"
            >
              <IconCheck />
            </button>
          </div>
        </div>

        <div className="tool-panel__row tool-panel__row--sub">
          <span className="tool-panel__hint">{tool.hint}</span>
          <button
            className="link-button"
            disabled={!resettable}
            onClick={() => update(tool.reset(edits), `reset-${tool.id}`)}
          >
            Reset {tool.label.toLowerCase()}
          </button>
        </div>
      </header>

      <div className="tool-panel__body">
        <tool.Content />
      </div>
    </section>
  )
}
