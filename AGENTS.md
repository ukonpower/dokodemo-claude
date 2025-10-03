# Repository Guidelines

## プロジェクト構成・モジュール配置
- `frontend/` React + TypeScript（Vite, Tailwind）。主要: `src/components/*`, `src/types/*`, `src/App.tsx`, `src/main.tsx`。
- `backend/` Node + Express + TypeScript。主要: `src/server.ts`, `src/process-manager.ts`, `src/types/*`, `repositories/`（管理対象のクローン先）。
- ルートの `package.json` が前後両方のスクリプトを統括。ESLint/Prettier/TS 設定は各パッケージ配下。

## ビルド・テスト・開発コマンド
- 依存関係: `npm run install`（FE/BE 両方をインストール）。
- 開発同時起動: `npm run dev`（フロント/バックを並行起動）。
- 個別起動: `npm run dev:frontend` / `npm run dev:backend`。
- ビルド: `npm run build` もしくは `build:frontend` / `build:backend`。
- Lint: `npm run lint`（両方）。自動修正は各パッケージの `lint:fix`。
- 型チェック: `npm run type-check`。
- フォーマット: `npm run format` / `npm run format:check`。
- フロント確認: `npm run preview`。アクセス: FE `http://localhost:5173` / BE ポート `0001`。

## コーディングスタイル・命名
- Prettier: セミコロンあり・シングルクォート・幅 80・インデント 2 スペース。
- ESLint: 厳格 TS。FE は React Hooks ルール、BE は `no-unused-vars` を error、`any` と戻り値型省略は warn。
- 命名: コンポーネントは PascalCase（例: `AutoModeSettings.tsx`）、関数/変数は camelCase、ディレクトリは kebab-case。型は `src/types` へ。

## テスト方針
- 公式テスト基盤は未導入。追加する場合:
  - TypeScript テスト（`*.test.ts[x]`）。
  - 近接配置または `frontend/src/__tests__` / `backend/src/__tests__`。
  - 重要経路（プロセスマネージャ、Socket 経路、UI 状態）を優先。

## コミット・PR ガイド
- 形式は Conventional Commits を推奨（履歴例: `feat: ...`, `fix: ...`）。コミットメッセージと議論は日本語で統一。
- プッシュ前に `npm run check-all` を必ず通過。
- PR: 概要/背景、関連 Issue、確認手順、UI 変更はスクリーンショット/GIF、影響する環境変数を明記。

## セキュリティ・設定
- 各パッケージで `.env.example` を `.env` にコピー。秘密情報はコミット禁止。
- ローカル利用前提。バックエンドを外部公開しない。
- ユーザーデータ書き込みは `backend/repositories/` 配下に限定。

## エージェント向けメモ
- 変更は最小限・局所的に。無関係なリファクタは避ける。
- UI は `frontend/src/components/`、BE 追加は `backend/src/` に置き、必要に応じて `src/server.ts` に配線。
- 既存スクリプト/設定を尊重し、PR 前に Lint/Format/型チェックを整える。

## コミュニケーション方針
- 本リポジトリでのやり取り（Issue、PR、レビュー、コミットメッセージ）は日本語で行います。
