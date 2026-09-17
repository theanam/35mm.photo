import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { filesFromDataTransfer } from '../io/file-system'
import { isSupportedFile } from '../io/formats'
import { isPresetFile } from '../editor/presets/import'

/**
 * Window-level drag and drop. Counting enter/leave events is the only reliable
 * way to know when the pointer has really left — child elements fire their own.
 */
export function useDropTarget() {
  const openFiles = useEditor((s) => s.openFiles)
  const importPresets = useEditor((s) => s.importPresets)
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

      // One drop can carry both: a preset pack and the photo to try it on.
      const dropped = await filesFromDataTransfer(event.dataTransfer)
      const photos = dropped.filter((f) => isSupportedFile(f.file.name))
      const presets = dropped.filter((f) => isPresetFile(f.file.name)).map((f) => f.file)

      if (!photos.length && !presets.length) {
        toast('Nothing 35mm can read in what you dropped', 'error')
        return
      }
      if (presets.length) await importPresets(presets)
      if (photos.length) await openFiles(photos)
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
  }, [openFiles, importPresets, toast])

  return dragging
}
