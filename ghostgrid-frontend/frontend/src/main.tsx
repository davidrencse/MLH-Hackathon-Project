import { createRoot } from 'react-dom/client'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import './index.css'
import { startLiveBridge } from './store/live'
import App from './App.tsx'

// Streams real backend events into the city. No-op when the backend is unreachable.
void startLiveBridge()

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <App />
    <Toaster position="bottom-right" />
  </TooltipProvider>,
)
