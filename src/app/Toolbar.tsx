import { useMemo } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { isToolbarTool, toolbarTools } from '../editor/tools/registry'
import { buildStack } from '../editor/edit-stack/summary'
import { IconCopy, IconEye, IconEyeOff, IconPaste, IconRedo, IconReset, IconUndo } from './ui/icons'

/**
 * Geometry tools live here. Picking one puts its controls in the right rail,
 * in place of the colour and contrast panels — which are still one click away,
 * and are not what anyone is reaching for while a crop box is up.
 */
export function Toolbar() {
  const edits = useEditor((s) => s.edits)
  const meta = useEditor((s) => s.photo?.meta ?? null)
  const activeTool = useEditor((s) => s.activeTool)
  const openTool = useEditor((s) => s.openTool)
  const focusPanel = useEditor((s) => s.focusPanel)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.canUndo())
  const canRedo = useEditor((s) => s.canRedo())
  const setResetOpen = useEditor((s) => s.setResetOpen)
  const copyLook = useEditor((s) => s.copyLook)
  const pasteLook = useEditor((s) => s.pasteLook)
  const hasClipboard = useEditor((s) => s.clipboard !== null)
  const dirty = useEditor((s) => s.dirty())
  const hidden = useEditor((s) => s.hidden)
  const toggleHidden = useEditor((s) => s.toggleHidden)

  const tools = useMemo(() => toolbarTools(meta), [meta])
  const stack = useMemo(() => buildStack(edits, meta), [edits, meta])

  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="toolbar__tools">
        {tools.map((tool) => {
          const isOpen = activeTool === tool.id
          return (
            <button
              key={tool.id}
              className="tool-button"
              data-open={isOpen || undefined}
              aria-pressed={isOpen}
              aria-expanded={isOpen}
              disabled={!meta}
              onClick={() => openTool(tool.id)}
              title={tool.hint}
            >
              <tool.Icon size={17} />
              <span className="tool-button__label">{tool.label}</span>
              {tool.isDirty(edits) && <span className="tool-button__dot" aria-label="has edits" />}
            </button>
          )
        })}
      </div>

      <span className="toolbar__divider" />

      <div className="toolbar__stack" aria-label="Applied edits">
        {stack.map((chip) => {
          const off = hidden.includes(chip.id)
          return (
            /*
             * Two buttons in one chip, not one button with a button inside it:
             * the eye must switch the edit off without also opening its panel,
             * and a control nested in a control cannot promise that.
             */
            <span
              key={chip.id}
              className="stack-chip"
              data-accent={chip.accent || undefined}
              data-hidden={off || undefined}
            >
              <button
                className="stack-chip__pick"
                // A chip jumps to wherever its control actually lives.
                onClick={() => (isToolbarTool(chip.panel) ? openTool(chip.panel) : focusPanel(chip.panel))}
                title={`${chip.label} — open this control`}
              >
                <span>{chip.label}</span>
                <span className="mono stack-chip__value">{chip.value}</span>
              </button>
              {chip.off && (
                <button
                  className="stack-chip__eye"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleHidden(chip.id)
                  }}
                  aria-pressed={off}
                  title={off ? `Show ${chip.label.toLowerCase()}` : `Hide ${chip.label.toLowerCase()}`}
                  aria-label={off ? `Show ${chip.label.toLowerCase()}` : `Hide ${chip.label.toLowerCase()}`}
                >
                  {off ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                </button>
              )}
            </span>
          )
        })}
      </div>

      <div className="toolbar__actions">
        <button className="icon-button" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
          <IconUndo />
        </button>
        <button className="icon-button" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)" aria-label="Redo">
          <IconRedo />
        </button>
        <span className="toolbar__divider" />
        <button className="icon-button" onClick={copyLook} disabled={!dirty} title="Copy look (⌘C)" aria-label="Copy look">
          <IconCopy />
        </button>
        <button className="icon-button" onClick={pasteLook} disabled={!hasClipboard} title="Paste look (⌘V)" aria-label="Paste look">
          <IconPaste />
        </button>
        <button
          className="icon-button"
          onClick={() => setResetOpen(true)}
          disabled={!dirty}
          title="Reset everything"
          aria-label="Reset all edits"
        >
          <IconReset />
        </button>
      </div>
    </div>
  )
}
