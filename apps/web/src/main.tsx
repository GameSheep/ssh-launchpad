import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LaunchpadApp } from './app.js'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><LaunchpadApp /></StrictMode>)
