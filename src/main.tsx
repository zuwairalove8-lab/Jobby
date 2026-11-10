import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker makes the web build installable as a PWA. Inside Capacitor
// the app is already bundled locally, so registration is skipped there.
const isNativeShell =
  window.location.protocol === 'capacitor:' ||
  window.location.hostname === 'localhost' && Boolean((window as { Capacitor?: unknown }).Capacitor);

if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeShell) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is optional — never block startup on it */
    });
  });
}
