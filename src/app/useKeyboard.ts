import { useEffect } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { LOOKS } from '../editor/presets/looks'
import { pickFiles } from '../io/file-system'

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
        case 'Escape':
          // The drawer owns Escape while it is open.
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
