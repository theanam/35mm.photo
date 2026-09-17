import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import type { PanelId } from '../../editor/edit-stack/summary'
import { useEditor } from '../../editor/edit-stack/store'

interface PanelProps {
  id: PanelId
  title: string
  /** Small grey note beside the title. */
  note?: string
  /** Right-aligned control in the header. */
  action?: ReactNode
  /** Collapsible panels render as a single row until opened. */
  collapsible?: boolean
  /** Shown as a dot on the header when the panel holds non-default values. */
  active?: boolean
  children: ReactNode
}

export function Panel({ id, title, note, action, collapsible, active, children }: PanelProps) {
  const open = useEditor((s) => s.openPanels[id])
  const focused = useEditor((s) => s.focusedPanel === id)
  const togglePanel = useEditor((s) => s.togglePanel)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  if (collapsible && !open) {
    return (
      <section ref={ref} className="panel panel--collapsed" data-focused={focused || undefined}>
        <button className="panel__row" onClick={() => togglePanel(id, true)} aria-expanded={false}>
          <span className="panel__row-title">
            {title}
            {active && <span className="panel__dot" aria-label="has edits" />}
          </span>
          <span className="panel__chevron" aria-hidden>
            ＋
          </span>
        </button>
      </section>
    )
  }

  return (
    <section ref={ref} className="panel" data-focused={focused || undefined}>
      <header className="panel__header">
        <button
          className="panel__title-button"
          onClick={() => collapsible && togglePanel(id, false)}
          aria-expanded={collapsible ? true : undefined}
          disabled={!collapsible}
        >
          <span className="panel__title">{title}</span>
          {active && <span className="panel__dot" aria-label="has edits" />}
          {note && <span className="panel__note">{note}</span>}
        </button>
        {action}
        {collapsible && (
          <button
            className="panel__chevron panel__chevron--button"
            onClick={() => togglePanel(id, false)}
            aria-label={`Collapse ${title}`}
          >
            −
          </button>
        )}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  )
}
