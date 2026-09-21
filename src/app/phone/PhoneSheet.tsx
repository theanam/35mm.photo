import { useRef } from 'react'
import { useEditor } from '../../editor/edit-stack/store'
import { getTool } from '../../editor/tools/registry'
import { IconCheck, IconCross } from '../ui/icons'
import { useSheetDrag } from './useSheetDrag'
import { useIsLandscape } from './useLayoutMode'

/**
 * The open tool's controls, under the picture.
 *
 * A flex sibling of the stage rather than something floating over it. The
 * viewport derives fit, pan limits and the crop box's centring from a
 * ResizeObserver on its own box, so a sheet that covered part of the picture
 * without shortening the stage would leave all three aiming at a region behind
 * it — the photo would centre under the sheet and pinch would anchor to points
 * nobody can see. Taking real height costs the picture some room and gets all
 * of that right for nothing.
 */
export function PhoneSheet() {
  const activeTool = useEditor((s) => s.activeTool)
  const applyTool = useEditor((s) => s.applyTool)
  const discardTool = useEditor((s) => s.discardTool)
  const update = useEditor((s) => s.update)
  const edits = useEditor((s) => s.edits)
  const changed = useEditor((s) => s.toolChanged())

  const ref = useRef<HTMLElement>(null)
  const { detent, handlers } = useSheetDrag(ref)
  /*
   * No detents on a phone held sideways. The sheet becomes a column beside the
   * picture there, so resizing it would be a horizontal drag — the same axis
   * every slider inside it is dragged on. In portrait the two axes are at right
   * angles, and that is the whole reason dragging the header is safe.
   */
  const landscape = useIsLandscape()

  const tool = getTool(activeTool)
  if (!tool) return null

  return (
    <section
      ref={ref}
      className="phone-sheet"
      data-detent={landscape ? 'fixed' : detent}
      aria-label={`${tool.label} controls`}
    >
      {/*
        The whole header is the drag target, not just the grabber: a 4-point bar
        is a signpost, not a handful. The buttons inside it stop the gesture
        themselves, so a tap on apply is a tap and not a one-pixel drag.
      */}
      <header className="phone-sheet__head" {...(landscape ? {} : handlers)}>
        <span className="phone-sheet__grab" aria-hidden />

        <div className="phone-sheet__row">
          <h2 className="phone-sheet__title">{tool.label}</h2>

          {/* Only the controls opt out of the drag — the grabber, the title and
              the space around them are all handle, because a 4-point bar is
              too small a thing to have to hit. */}
          <div className="phone-sheet__actions" onPointerDown={(e) => e.stopPropagation()}>
            <button
              className="link-button"
              disabled={!tool.isDirty(edits)}
              onClick={() => update(tool.reset(edits), `reset-${tool.id}`)}
            >
              Reset
            </button>

            <button
              className="icon-button icon-button--discard"
              onClick={discardTool}
              title={changed ? 'Discard these changes' : 'Close'}
              aria-label={changed ? 'Discard changes' : 'Close'}
            >
              <IconCross />
            </button>
            <button
              className="icon-button icon-button--apply"
              onClick={applyTool}
              title="Apply and close"
              aria-label="Apply and close"
            >
              <IconCheck />
            </button>
          </div>
        </div>
      </header>

      <div className="phone-sheet__body">
        <tool.Content />
      </div>
    </section>
  )
}
