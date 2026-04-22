import { createRoot } from 'react-dom/client';
import '@fontsource/share-tech-mono';
import './index.scss';
import App from './App.tsx';

// Service Worker登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => {
        // Service Worker registered successfully
      })
      .catch(() => {
        // Service Worker registration failed
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
