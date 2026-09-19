import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Provider } from 'react-redux'
import { store } from '@/app/store'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import ThemeSync from '@/components/common/ThemeSync'
import DeferredToaster from '@/components/common/DeferredToaster'
import { registerChunkReloadHandler } from '@/lib/chunkReload'
import { registerRumMetrics } from '@/services/rum'

registerChunkReloadHandler()
registerRumMetrics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeSync />
        <App />
        <DeferredToaster />
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
)
