/** The right rail before a photo is open — the design's greyed-out placeholder. */
export function IdleRail() {
  return (
    <aside className="rail rail--idle" aria-hidden>
      <div className="idle-group">
        <span className="idle-group__title">Looks</span>
        <div className="idle-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="idle-swatch" data-faint={i > 2 || undefined} />
          ))}
        </div>
      </div>

      <div className="idle-group">
        <span className="idle-group__title">Light & colour</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="idle-track" data-faint={i > 1 || undefined} />
        ))}
      </div>

      <div className="idle-card">
        <strong>Coming from Lightroom?</strong>
        <p>
          35mm reads your files straight off the disk. Sliders sit where you expect them, and
          every edit stays undoable.
        </p>
        <span className="idle-card__hint mono">
          ⌘Z undo · \ before/after · C crop · [ ] cycle looks
        </span>
      </div>
    </aside>
  )
}
