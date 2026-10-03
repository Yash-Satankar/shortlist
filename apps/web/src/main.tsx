import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { queryClient } from './api/queryClient';
import { ToastProvider } from './components/ui';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Service worker for installability + offline app shell (auto-updates on deploy).
if (import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
