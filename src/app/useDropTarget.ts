import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { filesFromDataTransfer } from '../io/file-system'

/**
 * Window-level drag and drop. Counting enter/leave events is the only reliable
 * way to know when the pointer has really left — child elements fire their own.
 */
export function useDropTarget() {
  const openFiles = useEditor((s) => s.openFiles)
  const toast = useEditor((s) => s.toast)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth++
      setDragging(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = async (event: DragEvent) => {
      if (!event.dataTransfer) return
      event.preventDefault()
      depth = 0
      setDragging(false)

      const files = await filesFromDataTransfer(event.dataTransfer)
      if (!files.length) {
        toast('No photos 35mm can read in what you dropped', 'error')
        return
      }
      await openFiles(files)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFiles, toast])

  return dragging
}
