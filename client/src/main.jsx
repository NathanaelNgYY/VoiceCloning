import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './globals.css';
import { APP_BASENAME } from '@/lib/runtimeConfig';
import { APP_MODE_CONFIG } from '@/lib/appMode';
import { AppProviders } from '@/AppProviders.jsx';
import { initializeMsal, isMsalAuthEnabled } from '@/auth/msalClient';

// Only the gi build carries the lesson/auth surface. Every other mode renders
// exactly as before — no auth context, no MSAL bootstrap, no async gate.
async function bootstrap() {
  let msalInstance = null;
  let bootstrapError = null;

  if (APP_MODE_CONFIG.gi && isMsalAuthEnabled()) {
    try {
      msalInstance = await initializeMsal();
    } catch (error) {
      bootstrapError = error;
    }
  }

  const app = <App />;

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter basename={APP_BASENAME}>
        {APP_MODE_CONFIG.gi ? (
          <AppProviders bootstrapError={bootstrapError} msalInstance={msalInstance}>
            {app}
          </AppProviders>
        ) : (
          app
        )}
      </BrowserRouter>
    </React.StrictMode>
  );
}

void bootstrap();
