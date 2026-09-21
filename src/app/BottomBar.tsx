import { useEditor } from '../editor/edit-stack/store'
import { exportLayout } from '../editor/gpu/transform'
import { IconCamera, IconLens, IconMinus, IconPlus, IconSplit } from './ui/icons'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.66, 1, 1.5, 2, 3, 4]

/** Viewport controls only: zoom, and the before/after split. */
export function BottomBar({ scale, fitScale }: { scale: number; fitScale: number }) {
  const zoom = useEditor((s) => s.zoom)
  const setZoom = useEditor((s) => s.setZoom)
  const splitCompare = useEditor((s) => s.splitCompare)
  const setSplit = useEditor((s) => s.setSplit)
  const cropping = useEditor((s) => s.cropping)
  const photo = useEditor((s) => s.photo)
  const edits = useEditor((s) => s.edits)
  const setExifOpen = useEditor((s) => s.setExifOpen)
  const meta = photo?.meta

  /**
   * What this photo currently *is*, in pixels.
   *
   * The whole file, at full resolution and with the mat counted — the same
   * arithmetic the export runs, so the number here and the number in the export
   * dialog come from one place and cannot drift. The dialog then applies any
   * long-edge limit on top; this is the size before anyone asks for a smaller
   * one. Every other reading in the app is about a part of it: the crop tool
   * reports the crop, the frame panel reports the frame.
   */
  const size = meta ? exportLayout(meta.width, meta.height, edits.crop, edits.frame, null) : null

  const step = (direction: 1 | -1) => {
    const current = zoom === 'fit' ? fitScale : zoom
    const next =
      direction === 1
        ? ZOOM_STEPS.find((z) => z > current + 0.001)
        : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001)
    if (next) setZoom(next)
    else if (direction === -1) setZoom('fit')
  }

  return (
    <footer className="bottombar">
      <button
        className="button button--toggle"
        data-on={splitCompare || undefined}
        aria-pressed={splitCompare}
        disabled={!photo || cropping}
        onClick={() => setSplit(!splitCompare)}
        title={cropping ? 'Not available while cropping' : 'Before / after split (\\)'}
      >
        <IconSplit />
        <span>Split view</span>
      </button>

      {/* What the photo was shot with, beside the photo rather than a dialog
          away. The whole thing is the handle for the rest of the metadata. */}
      {(meta?.camera || meta?.lens) && (
        <button
          className="bottombar__shot"
          onClick={() => setExifOpen(true)}
          title="All metadata for this photo"
        >
          {meta.camera && (
            <span className="bottombar__shot-part">
              <IconCamera size={14} />
              {meta.camera}
            </span>
          )}
          {meta.lens && (
            <span className="bottombar__shot-part">
              <IconLens size={14} />
              {meta.lens}
            </span>
          )}
        </button>
      )}

      <div className="bottombar__spacer" />

      {size && (
        <span
          className="bottombar__size"
          title={
            size.framed
              ? `${size.width} × ${size.height} px, including the frame — ` +
                `the picture inside it is ${size.photo.width} × ${size.photo.height}`
              : `${size.width} × ${size.height} px`
          }
        >
          <span className="mono">
            {size.width} × {size.height}
          </span>
          {/* Said out loud, because the number jumped when the frame went on and
              a reader is owed the reason. */}
          {size.framed && <span className="bottombar__size-note">with frame</span>}
        </span>
      )}

      <div className="zoom">
        <button
          className="icon-button"
          onClick={() => step(-1)}
          aria-label="Zoom out"
          disabled={!photo}
        >
          <IconMinus />
        </button>
        <span className="mono zoom__value">
          {zoom === 'fit' ? 'fit · ' : ''}
          {Math.round(scale * 100)}%
        </span>
        <button
          className="icon-button"
          onClick={() => step(1)}
          aria-label="Zoom in"
          disabled={!photo}
        >
          <IconPlus />
        </button>
        <button
          className="button button--toggle button--sm"
          data-on={zoom !== 'fit' || undefined}
          aria-pressed={zoom !== 'fit'}
          onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
          disabled={!photo}
        >
          {zoom === 'fit' ? '100%' : 'Fit'}
        </button>
      </div>
    </footer>
  )
}
