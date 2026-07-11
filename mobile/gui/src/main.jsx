import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './utils/nativeBridge.js'
import './index.css'
import './mobile.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
