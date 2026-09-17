import { useEditor } from '../editor/edit-stack/store'
import { IconMinus, IconPlus, IconSplit } from './ui/icons'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.66, 1, 1.5, 2, 3, 4]

/** Viewport controls only: zoom, and the before/after split. */
export function BottomBar({ scale, fitScale }: { scale: number; fitScale: number }) {
  const zoom = useEditor((s) => s.zoom)
  const setZoom = useEditor((s) => s.setZoom)
  const splitCompare = useEditor((s) => s.splitCompare)
  const setSplit = useEditor((s) => s.setSplit)
  const cropping = useEditor((s) => s.cropping)
  const photo = useEditor((s) => s.photo)

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

      <div className="bottombar__spacer" />

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
