import { useEditor } from '../editor/edit-stack/store'

/**
 * The docked readout for a batch export.
 *
 * Deliberately not a modal: a folder of raws takes minutes, and locking the
 * whole app behind it would make a long export feel like a hang. Editing other
 * photos while it runs is safe — each one's settings were snapshotted when the
 * run started.
 */
export function BatchBar() {
  const batch = useEditor((s) => s.batch)
  const cancel = useEditor((s) => s.cancelBatchExport)

  if (!batch.running) return null

  const states = Object.values(batch.statuses)
  const finished = states.filter((s) => s === 'done' || s === 'failed').length
  const inFlight = states.some((s) => s === 'working') ? 1 : 0

  // The photo being worked on counts as the one you are on, not as one still to
  // come: "Exporting 1 of 3" while the first is rendering, not "0 of 3".
  const position = Math.min(finished + inFlight, batch.total)
  const pct = batch.total ? Math.round((finished / batch.total) * 100) : 0

  return (
    <div className="batchbar" role="status" aria-live="polite">
      <div className="batchbar__text">
        <span>
          Exporting <span className="mono">{position}</span> of{' '}
          <span className="mono">{batch.total}</span>
        </span>
        {batch.stage && <span className="batchbar__stage">{batch.stage}…</span>}
      </div>
      <div className="batchbar__track" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <button className="link-button" onClick={cancel}>
        Stop
      </button>
    </div>
  )
}
