import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { registerServiceWorker } from './pwa/register'
import './styles/tokens.css'
import './styles/app.css'
import './styles/phone.css'

const root = document.getElementById('root')
if (!root) throw new Error('35mm could not find its mount point')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
