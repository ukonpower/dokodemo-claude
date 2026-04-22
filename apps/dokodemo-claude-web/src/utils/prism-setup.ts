import { Prism } from 'prism-react-renderer';

// prismjs/components/ は globalThis.Prism に言語を登録する仕組み
// このファイルを prism-languages.ts より先にインポートすることで
// ESM のホイスティング順序で確実に Prism がセットされる
(typeof globalThis !== 'undefined' ? globalThis : window).Prism = Prism;
