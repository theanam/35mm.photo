import { useEditor } from '../editor/edit-stack/store'

/** The right rail before a photo is open — the design's greyed-out placeholder. */
export function IdleRail() {
  const presets = useEditor((s) => s.presets)

  return (
    <aside className="rail rail--idle">
      <div className="idle-group">
        <span className="idle-group__title" aria-hidden>Looks</span>
        <div className="idle-grid" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="idle-swatch" data-faint={i > 2 || undefined} />
          ))}
        </div>
        {/* Without this the rail is all placeholder, and a refresh with no photo
            open reads as "my imported presets are gone" when they are not. */}
        {presets.length > 0 && (
          <p className="idle-group__note">
            {presets.length} imported preset{presets.length === 1 ? '' : 's'} kept in this
            browser. Open a photo to use {presets.length === 1 ? 'it' : 'them'}.
          </p>
        )}
      </div>

      <div className="idle-group" aria-hidden>
        <span className="idle-group__title">Light & colour</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="idle-track" data-faint={i > 1 || undefined} />
        ))}
      </div>

      <div className="idle-card" aria-hidden>
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
