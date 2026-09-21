import { PhoneBar } from './PhoneBar'
import { PhoneSheet } from './PhoneSheet'
import { PhoneTabs } from './PhoneTabs'
import { Viewport } from '../Viewport'
import { LoadingOverlay } from '../LoadingOverlay'
import { EmptyState } from '../EmptyState'
import { ExportDialog } from '../ExportDialog'
import { AboutDialog } from '../AboutDialog'
import { SyncDialog } from '../SyncDialog'
import { ExifDialog } from '../ExifDialog'
import { ResetDialog } from '../ResetDialog'
import { BatchBar } from '../BatchBar'
import { Toasts } from '../Toasts'
import { useEditor } from '../../editor/edit-stack/store'

/**
 * The whole app on a phone.
 *
 * Not a restyling of the desktop tree but a replacement for it, chosen at
 * runtime — see useIsPhone for why the two must never be mounted together.
 * Everything below the chrome is the same code the desktop runs: the viewport
 * and its overlays, the dialogs, the batch bar, the toasts. Only the four bars
 * are re-authored, because a filmstrip column, a right rail and a toolbar of
 * chips have nowhere to go on a 390-point screen.
 *
 * The stage is a flex child with a real height rather than a backdrop the rest
 * floats over. The viewport measures itself with a ResizeObserver and derives
 * fit, pan limits and the crop box's centring from that one number, so a
 * control that covers part of the picture without shortening the stage would
 * leave all three quietly aiming at a region behind it.
 */
export function PhoneShell() {
  const photo = useEditor((s) => s.photo)

  return (
    <div className="phone">
      <PhoneBar />

      <main className={photo ? 'app__center phone__stage' : 'app__center app__center--empty phone__stage'}>
        {photo ? <Viewport /> : <EmptyState dragging={false} />}
        <LoadingOverlay />
      </main>

      {photo && (
        <>
          <PhoneSheet />
          <PhoneTabs />
        </>
      )}

      <ExportDialog />
      <AboutDialog />
      <SyncDialog />
      <ExifDialog />
      <ResetDialog />
      <BatchBar />
      <Toasts />
    </div>
  )
}
