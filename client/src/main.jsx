import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './globals.css';
import { APP_BASENAME } from '@/lib/runtimeConfig';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={APP_BASENAME}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
