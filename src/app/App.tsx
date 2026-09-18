import { useEffect } from 'react'
import { TopBar } from './TopBar'
import { Toolbar } from './Toolbar'
import { ToolDrawer } from './ToolDrawer'
import { Filmstrip } from './Filmstrip'
import { Viewport } from './Viewport'
import { BottomBar } from './BottomBar'
import { RightRail } from './RightRail'
import { IdleRail } from './IdleRail'
import { EmptyState } from './EmptyState'
import { LoadingOverlay } from './LoadingOverlay'
import { ExportDialog } from './ExportDialog'
import { AboutDialog } from './AboutDialog'
import { SyncDialog } from './SyncDialog'
import { ExifDialog } from './ExifDialog'
import { BatchBar } from './BatchBar'
import { Toasts } from './Toasts'
import { useKeyboard } from './useKeyboard'
import { useDropTarget } from './useDropTarget'
import { useEditor } from '../editor/edit-stack/store'
import { LOOKS } from '../editor/presets/looks'
import { warmLuts } from '../editor/presets/lutCache'

export function App() {
  const photo = useEditor((s) => s.photo)
  const viewScale = useEditor((s) => s.viewScale)
  const fitScale = useEditor((s) => s.fitScale)
  const dragging = useDropTarget()
  useKeyboard()

  // Build the LUTs up front; the first click on a look should not wait for one.
  // Imported presets come out of IndexedDB first, so their swatches fill in at
  // the same time as the built-ins rather than a beat later.
  useEffect(() => {
    warmLuts(LOOKS.map((l) => l.id))
    void useEditor.getState().loadPresets().then(() => {
      warmLuts(useEditor.getState().presets.map((p) => p.id))
    })
  }, [])

  // Nothing leaves the machine, but unsaved work is still worth a prompt.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useEditor.getState().dirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <div className="app" data-dragging={dragging || undefined}>
      <TopBar />

      {photo && (
        <>
          <Toolbar />
          <ToolDrawer />
        </>
      )}

      <div className="app__body">
        <Filmstrip />

        {photo ? (
          <>
            <main className="app__center">
              <Viewport />
              <BottomBar scale={viewScale} fitScale={fitScale} />
            </main>
            <RightRail />
          </>
        ) : (
          <>
            <main className="app__center app__center--empty">
              <EmptyState dragging={dragging} />
            </main>
            <IdleRail />
          </>
        )}
      </div>

      {dragging && (
        <div className="drop-veil" aria-hidden>
          <span>Drop to open</span>
        </div>
      )}

      <LoadingOverlay />
      <ExportDialog />
      <AboutDialog />
      <SyncDialog />
      <ExifDialog />
      <BatchBar />
      <Toasts />
    </div>
  )
}
