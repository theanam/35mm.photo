import { useEditor } from '../../editor/edit-stack/store'
import { pickFiles } from '../../io/file-system'
import { IconCross } from '../ui/icons'

/**
 * The other photos, as a strip that slides up over the picture.
 *
 * Deliberately only a photo switcher. The desktop filmstrip also carries
 * multi-select, batch export, sync and per-frame removal, and all of those are
 * reached by holding a modifier while clicking — a gesture a phone does not
 * have. Rather than invent one and ship it untested, the phone keeps the part
 * that matters on a small screen and leaves the rest where it works.
 *
 * A tap goes straight to `selectFrame`. The desktop route runs through the
 * selection and waits 320ms for it to settle before opening anything, which on
 * a phone would be 320ms of nothing followed by a raw decode.
 */
export function PhoneLibrary({ onClose }: { onClose: () => void }) {
  const frames = useEditor((s) => s.frames)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  const selectFrame = useEditor((s) => s.selectFrame)
  const openFiles = useEditor((s) => s.openFiles)

  return (
    <div className="phone-library" role="dialog" aria-modal="true" aria-label="Photos">
      <div className="phone-library__scrim" onClick={onClose} />

      <div className="phone-library__panel">
        <header className="phone-library__head">
          <h2 className="phone-library__title">
            Photos <span className="mono phone-library__count">{frames.length}</span>
          </h2>
          <button
            className="button button--toggle"
            onClick={() => void pickFiles().then(openFiles)}
          >
            Add…
          </button>
          <button className="icon-button icon-button--quiet" onClick={onClose} aria-label="Close">
            <IconCross />
          </button>
        </header>

        <ol className="phone-library__list">
          {frames.map((frame) => (
            <li key={frame.id}>
              <button
                className="thumb"
                data-active={frame.id === activeFrameId || undefined}
                data-error={Boolean(frame.error) || undefined}
                onClick={() => {
                  void selectFrame(frame.id)
                  onClose()
                }}
              >
                {frame.thumbUrl ? (
                  <img src={frame.thumbUrl} alt="" loading="lazy" />
                ) : (
                  <span className="thumb__placeholder" aria-hidden />
                )}
                {frame.error && <span className="thumb__badge">!</span>}
                <span className="visually-hidden">{frame.meta.name}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
