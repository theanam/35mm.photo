import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { filesFromDataTransfer, type OpenedFile } from '../io/file-system'
import { isSupportedFile } from '../io/formats'
import { couldBeLutImage, isAmbiguousImage, isPresetFile } from '../editor/presets/import'
import { readImageSize } from '../io/image-size'

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
      const { photos, presets } = await sortDrop(dropped)

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

/**
 * Decide what each dropped file is. Most answer for themselves — a .cube is
 * never a photo, a .raf is never a LUT — but .png, .jpg and .webp match both
 * lists, and taking them for both is how dropping a photo used to report that
 * it was not a LUT image.
 *
 * Dimensions settle it. A LUT image is a cube flattened to a grid, so its size
 * is one of a few exact shapes; a photo satisfying one by accident would have
 * to be 512x512 or 4096x64. Reading the header costs a few bytes rather than a
 * decode, which matters when the drop is a folder of them. An unreadable header
 * counts as a photo, since that is what a dropped image usually is.
 */
async function sortDrop(dropped: OpenedFile[]) {
  const photos: OpenedFile[] = []
  const presets: File[] = []

  for (const entry of dropped) {
    const name = entry.file.name

    if (isAmbiguousImage(name)) {
      const size = await readImageSize(entry.file)
      if (size && couldBeLutImage(size.width, size.height)) presets.push(entry.file)
      else if (isSupportedFile(name)) photos.push(entry)
      continue
    }

    if (isSupportedFile(name)) photos.push(entry)
    else if (isPresetFile(name)) presets.push(entry.file)
  }

  return { photos, presets }
}
