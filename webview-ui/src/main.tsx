import './index.css';
// Bundled by Vite into the SPA's own CSS — the standalone server must serve
// every asset itself (no CDN).
import '@xterm/xterm/css/xterm.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { AgexaHeader } from './components/AgexaHeader.tsx';
import { isBrowserRuntime } from './runtime';

async function main() {
  // browserMock is for Vite dev mode only (UI prototyping without a server).
  // In standalone server mode, assets are loaded server-side and sent over WebSocket.
  if (isBrowserRuntime && import.meta.env.DEV) {
    const { initBrowserMock } = await import('./browserMock.js');
    await initBrowserMock();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <div className="agexa-shell">
        <AgexaHeader />
        <main className="agexa-office" aria-label="Escritório virtual Agexa">
          <App />
        </main>
      </div>
    </StrictMode>,
  );
}

main().catch(console.error);
