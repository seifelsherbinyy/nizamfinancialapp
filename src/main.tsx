/**
 * NIZAM · App entry — mount React root, providers
 * Implemented by: KIRO Contract 1 / Phase 1.3
 * Depends on: App.tsx, app/providers.tsx
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '@/app/providers';
import App from '@/App';
import '@/styles/globals.css';
import '@/styles/analytics.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('NIZAM: #root element not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
