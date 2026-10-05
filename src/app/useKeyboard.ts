import { useEffect } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { LOOKS } from '../editor/presets/looks'
import { pickFiles } from '../io/file-system'
import { stepBrush } from '../retouch/brush'
import { displaySize } from '../editor/gpu/transform'
import { nudgeCrop, swapOrientation, toggleAspectLock } from '../editor/edit-stack/crop-drag'
import { nextGuide } from '../editor/edit-stack/crop-guides'

/** Keyboard shortcuts, aimed at the habits a Lightroom user already has. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Checked rather than cast: a keydown can be dispatched at the window or
      // the document, which have no closest(), and the throw would take every
      // shortcut down with it.
      const target = event.target instanceof Element ? event.target : null
      // Never steal a key from a field the user is typing in.
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        if (!(event.key === 'Escape')) return
      }

      const s = useEditor.getState()
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void pickFiles().then(s.openFiles)
        return
      }
      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        if (s.photo) s.setExportOpen(true)
        return
      }
      if (mod && event.key.toLowerCase() === 'c' && s.dirty()) {
        event.preventDefault()
        s.copyLook()
        return
      }
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        s.pasteLook()
        return
      }
      if (mod) return

      // The retouch brush borrows the bracket keys for its size, as every
      // brush does, and Delete for the spot it has selected.
      if (s.activeTool === 'retouch') {
        if (event.key === '[' || event.key === ']') {
          event.preventDefault()
          s.setRetouchBrush({ size: stepBrush(s.retouchBrush.size, event.key === ']' ? 1 : -1) })
          return
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && s.activeRetouchId) {
          event.preventDefault()
          s.removeRetouchStroke(s.activeRetouchId)
          return
        }
      }

      // Lightroom's crop keys, while the crop is open: O and ⇧O for the guide,
      // X turns the box on its side, A is the padlock, and the arrows nudge
      // by a pixel of the picture (ten with ⇧) — so while cropping they do
      // not step the filmstrip, which would apply the crop and leave.
      if (s.activeTool === 'crop' && s.photo) {
        const frame = displaySize(s.photo.meta.width, s.photo.meta.height, s.edits.crop.rotate90)
        const step = event.shiftKey ? 10 : 1
        switch (event.key) {
          case 'o':
            event.preventDefault()
            s.setCropGuide(nextGuide(s.cropGuide))
            return
          case 'O':
            event.preventDefault()
            s.setCropGuide(s.cropGuide, s.cropGuideTurn + 1)
            return
          case 'x':
          case 'X':
            event.preventDefault()
            s.updateCrop(swapOrientation(s.edits.crop, frame), 'crop-aspect')
            return
          case 'a':
          case 'A':
            event.preventDefault()
            s.updateCrop(toggleAspectLock(s.edits.crop, frame), 'crop-aspect')
            return
          case 'ArrowLeft':
          case 'ArrowRight':
          case 'ArrowUp':
          case 'ArrowDown': {
            event.preventDefault()
            const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
            const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
            s.updateCrop(nudgeCrop(s.edits.crop, dx / frame.width, dy / frame.height), 'crop-nudge')
            return
          }
          default:
            break
        }
      }

      switch (event.key) {
        case '\\':
          event.preventDefault()
          s.setSplit(!s.splitCompare)
          break
        case 'c':
        case 'C':
          event.preventDefault()
          s.openTool('crop')
          break
        case 'm':
        case 'M':
          event.preventDefault()
          s.openTool('masks')
          break
        case 'q':
        case 'Q':
          // Lightroom's key for spot removal.
          event.preventDefault()
          if (s.photo) s.openTool('retouch')
          break
        case 'Escape':
          // The open tool owns Escape while it is open.
          if (s.exportOpen) s.setExportOpen(false)
          break
        case 'f':
        case 'F':
          s.setZoom('fit')
          break
        case '1':
          if (event.shiftKey) break
          s.setZoom(1)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Step through the filmstrip.
          const index = s.frames.findIndex((f) => f.id === s.activeFrameId)
          if (index === -1) break
          const next = index + (event.key === 'ArrowRight' ? 1 : -1)
          if (next >= 0 && next < s.frames.length) {
            event.preventDefault()
            void s.selectFrame(s.frames[next].id)
          }
          break
        }
        case '[':
        case ']': {
          // Cycle looks.
          const ids = [null, ...LOOKS.map((l) => l.id)]
          const at = ids.indexOf(s.edits.look.id)
          const next = (at + (event.key === ']' ? 1 : -1) + ids.length) % ids.length
          s.applyLook(ids[next])
          break
        }
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
