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
