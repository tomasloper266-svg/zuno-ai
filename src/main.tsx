import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/home.css'
import './styles/chat.css'

const rootElement = document.getElementById('root')
if (rootElement !== null) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// PWA: register the service worker in production builds only. The URL is
// relative, so registration lands in the current directory — correct under the
// GitHub Pages subpath (/zuno-ai/) without hardcoding the base. Registration
// failure must never break the app itself; it is surfaced, not swallowed.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err: unknown) => {
      console.warn('[zuno] service worker registration failed:', err)
    })
  })
}
