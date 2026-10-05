import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './globals.css';
import { APP_BASENAME } from '@/lib/runtimeConfig';
import { APP_MODE_CONFIG } from '@/lib/appMode';
import { AppProviders } from '@/AppProviders.jsx';
import { AppErrorBoundary } from '@/components/AppErrorBoundary.jsx';
import { initializeMsal, isMsalAuthEnabled } from '@/auth/msalClient';
import { config } from '@/config';

// Keep the event page independent of training, faculty, PDFs, and admin bundles.
const App = React.lazy(() => import.meta.env.VITE_APP_MODE === 'mc'
  ? import('./pages/McSessionPage.jsx')
  : import('./App.jsx'));

// Chrome may restore an already-rendered document from its back/forward cache
// without asking CloudFront for the now-current SPA shell. Reload only that
// restored snapshot; ordinary first loads and refreshes are untouched.
export function reloadRestoredDocument(event) {
  if (event?.persisted) window.location.reload();
}

window.addEventListener('pageshow', reloadRestoredDocument);

// Any build can opt into the shared Microsoft gate. Public builds still render
// without an auth context, MSAL bootstrap, or asynchronous startup delay.
async function bootstrap() {
  let msalInstance = null;
  let bootstrapError = null;

  if (config.authEnabled && isMsalAuthEnabled()) {
    try {
      msalInstance = await initializeMsal();
    } catch (error) {
      bootstrapError = error;
    }
  }

  const app = <React.Suspense fallback={<div role="status" className="p-8 text-slate-600">Loading…</div>}><App /></React.Suspense>;

  // Outside the router and the providers, so a crash in either is caught too —
  // and because anything React throws while rendering unmounts the whole tree.
  // Without this the user gets a white page and no clue, which is how the same
  // failure reached students twice; see AppErrorBoundary for both.
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <BrowserRouter basename={APP_BASENAME}>
          {config.authEnabled ? (
            <AppProviders bootstrapError={bootstrapError} msalInstance={msalInstance}>
              {app}
            </AppProviders>
          ) : (
            app
          )}
        </BrowserRouter>
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

void bootstrap();
