# 技術スタック

## フロントエンド
- **React** 19.1.0: UIフレームワーク
- **TypeScript** 5.8.3: 型安全性
- **Vite** 6.3.5: ビルドツール・開発サーバー
- **Tailwind CSS** 3.4.0: CSSフレームワーク
- **Socket.IO Client** 4.7.0: リアルタイム通信
- **xterm.js** 5.5.0: ターミナルUI
- **ansi-to-html** 0.7.2: ANSI色コード変換

## バックエンド
- **Node.js** 22.17.0 (Voltaで管理)
- **Express** 4.18.0: Webサーバーフレームワーク
- **TypeScript** 5.0.0: 型安全性
- **Socket.IO** 4.7.0: リアルタイム通信サーバー
- **node-pty** 1.0.0: 疑似端末（PTY）操作
- **tsx** 4.0.0: TypeScript実行環境

## 開発ツール
- **ESLint** 9.x: コード品質チェック
- **Prettier** 3.0.0: コードフォーマット
- **TypeScript ESLint** 8.x: TypeScript用ESLintルール
- **Concurrently** 9.1.2: 複数プロセス同時実行

## 特徴
- **ES Modules**: `"type": "module"` を使用
- **日本語対応**: コメント・ドキュメント・コミットメッセージは日本語
- **モノレポ構造**: frontend/backend分離
- **リアルタイム通信**: WebSocketによる双方向通信