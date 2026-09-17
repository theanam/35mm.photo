import { useEditor } from '../editor/edit-stack/store'

export function Toasts() {
  const toasts = useEditor((s) => s.toasts)
  const dismiss = useEditor((s) => s.dismissToast)

  if (!toasts.length) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className="toast"
          data-tone={toast.tone}
          onClick={() => dismiss(toast.id)}
        >
          {toast.message}
        </button>
      ))}
    </div>
  )
}
