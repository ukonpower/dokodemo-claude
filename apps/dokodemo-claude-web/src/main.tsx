import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/share-tech-mono';
import './index.scss';
import App from './App.tsx';

// vite-plugin-pwa が生成した Service Worker を登録（新バージョンは autoUpdate）
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
