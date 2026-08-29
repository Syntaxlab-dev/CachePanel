import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyAccent, applyTheme, getPreferredTheme, getStoredAccent } from '@/lib/theme'

applyTheme(getPreferredTheme())
applyAccent(getStoredAccent())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registered after the initial render, not blocking it -- installability
// only needs the SW registered at some point during the page's lifetime.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Best-effort: an older browser or a restrictive context (e.g. plain
      // HTTP without localhost) just means no install prompt, not a broken app.
    })
  })
}
