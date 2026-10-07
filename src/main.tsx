import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { InAppBrowserDialog, Unsupported } from './app/SupportGate'
import { missingEssentials, polyfill } from './app/support'
import { registerServiceWorker } from './pwa/register'
import './styles/tokens.css'
import './styles/app.css'
import './styles/phone.css'

declare global {
  interface Window {
    /** The startup watchdog in index.html, told when the app is up. */
    __35mm?: { ready: () => void }
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('35mm could not find its mount point')
const reactRoot = createRoot(root)

function start() {
  reactRoot.render(
    <StrictMode>
      <App />
      <InAppBrowserDialog />
    </StrictMode>,
  )
  registerServiceWorker()
  window.__35mm?.ready()
}

polyfill()

/*
 * Getting this far means the browser runs modern modules, which is most of
 * the question. What remains is whether it has the few things the editor
 * cannot do without; if not, say so instead of showing a viewport that cannot
 * draw — and still leave the door open, because the check is a guess about a
 * browser nobody has seen and the viewport's own error is the better judge.
 */
const missing = missingEssentials()
if (missing.length) {
  reactRoot.render(<Unsupported missing={missing} onContinue={start} />)
  window.__35mm?.ready()
} else {
  start()
}
