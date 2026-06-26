# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際に Claude Code (claude.ai/code) への指針を提供します。

## 実装方針の決定

- **選択肢が一つの場合**: ユーザーに確認を求めず、そのまま実装を進める
- **選択肢が複数ある場合**: AskUserQuestion ツールを使ってユーザーに選択を問う
- 計画を提示して「これでよいですか？」と確認するのは不要。実装するか、選択肢を問うかの二択
- **後方互換性は考慮しない**: 極力シンプルでフラットな実装を優先する。後方互換が必要な場合はユーザーが明示的に指示する

## 言語設定

このプロジェクトでは日本語でのやり取りを基本とします。コメント、ドキュメント、コミットメッセージなどは日本語で記述してください。

## プロジェクト概要

「dokodemo-workspace」は Nx モノレポで管理される dokodemo-claude の開発リポジトリです。

### dokodemo-claude
Claude Code CLI を Web ブラウザから操作するための最小限のインターフェースです。個人利用を前提とした、シンプルで実用的なツールです。

## 技術スタック

- **モノレポ管理**: Nx 22.3.3
- **フロントエンド**: React + TypeScript + Vite + SCSS
- **バックエンド**: Node.js + Express + TypeScript
- **コード品質**: ESLint + Prettier + TypeScript
- **CLI 統合**: child_process で Claude Code CLI 実行
- **ターミナル機能**: node-pty でインタラクティブターミナル（PTY）操作
- **通信**: WebSocket（Socket.IO）

## プロジェクト構造

```
dokodemo-workspace/
├── apps/
│   ├── dokodemo-claude-web/   # フロントエンド (React + Vite)
│   └── dokodemo-claude-api/   # バックエンド (Node.js + Express)
│
├── libs/
│   └── design-tokens/         # 共有デザイントークン（SCSS）
│
├── nx.json                    # Nx 設定
├── tsconfig.base.json         # ベース TypeScript 設定
├── tsconfig.json              # ルート TypeScript 設定
├── package.json               # ルート（Nx スクリプト）
└── CLAUDE.md                  # 開発ガイドライン
```

### 主要エントリポイント

調査時に毎回探さず、まずここを見る。

**backend (`apps/dokodemo-claude-api/src/`)**
- `server.ts` — Express + Socket.IO のエントリ。`/api`, `/hook`, `/socket.io` を束ねる
- `code-server.ts` — code-server 連携
- `utils/clean-env.ts` — env まわりの司令塔。`getApiListenPort()` / `getDokodemoApiBaseUrl()` / `getDokodemoMcpUrl()` / `cleanChildEnv()`（子プロセスへ `DC_*` を引き継がない）
- `managers/` — `terminal-manager` (node-pty), `ai-session-manager` (Claude CLI セッション)
- `handlers/` — REST/Socket イベント実装（`repository-handlers`, `diff-handlers`, `misc-handlers` 等）
- `services/` — `plugin-manager-service`, `claude-hooks-service`

**frontend (`apps/dokodemo-claude-web/src/`)**
- `utils/backend-url.ts` — `BACKEND_URL` 定義（dev/prod とも `window.location.origin`、frontend にポートをハードコードしない）
- `vite-env.d.ts` — Vite import.meta.env の型定義（`DC_API_URL` 等）
- `hooks/`, `components/` — React UI

**ルート**
- `apps/dokodemo-claude-web/vite.config.ts` — dev サーバ proxy（`/api`, `/hook`, `/socket.io` → `DC_API_PORT`）
- `scripts/setup-env.js` — `.env.example` → `.env` をコピーするだけのスクリプト

## env 関連ファイルマップ

env 周りを触る依頼で「どのファイルを見るか」迷ったら、ここを起点にする：

| 役割 | ファイル |
|------|----------|
| 全 env 変数の定義・既定値・コメント | `.env.example`（ルート） |
| `.env` 生成 | `scripts/setup-env.js`（`.env.example` をコピー） |
| backend 側の env 解決（port/URL/MCP/子プロセス） | `apps/dokodemo-claude-api/src/utils/clean-env.ts` |
| frontend 側の API URL | `apps/dokodemo-claude-web/src/utils/backend-url.ts` |
| frontend 側 env の TS 型 | `apps/dokodemo-claude-web/src/vite-env.d.ts` |
| dev proxy（`/api` 等 → Express） | `apps/dokodemo-claude-web/vite.config.ts` |
| ポート規約 / `DC_*` 一覧 | このファイル下記「ポート割り当て」セクション |

原則：
- フロントは `window.location.origin` 経由でしか backend を叩かない（ポートは hardcode 禁止）
- backend → 子プロセスへは `cleanChildEnv()` で `DC_*` を除外する
- 新規 env を増やすときは `.env.example`・`clean-env.ts`（必要なら）・`vite-env.d.ts`（frontend で使うなら）の 3 点を揃える

## 開発コマンド

```bash
# 開発モード一括起動（Vite=DC_WEB_PORT + Express=DC_API_PORT を concurrently で立てる）
# Vite が /api,/hook,/socket.io を Express に proxy するため、ブラウザは DC_WEB_PORT を開く
npm run dev

# 本番モード起動（DC_MODE=prod で Express を DC_PROD_PORT に単体起動、Web も統合配信）
npm run start

# 個別起動（Nx経由）
npx nx serve dokodemo-claude-web    # フロントエンド開発サーバー
npx nx serve dokodemo-claude-api    # バックエンド開発サーバー

# ビルド
npx nx build dokodemo-claude-web    # フロントエンドビルド
npx nx build dokodemo-claude-api    # バックエンドビルド
npm run build:all                   # 全アプリビルド

# コード品質チェック
npm run lint                        # 全アプリ lint
npm run type-check                  # 全アプリ型チェック
npm run check-all                   # lint + type-check 一括実行

# 個別チェック（Nx経由）
npx nx lint dokodemo-claude-web
npx nx type-check dokodemo-claude-web
npx nx lint dokodemo-claude-api
npx nx type-check dokodemo-claude-api
```

## ポート割り当て

ポート env は dev / prod で役割が分かれています：

| 変数 | 用途 | 説明 |
|------|------|------|
| `DC_WEB_PORT` | dev | `npm run dev` で Vite が listen する公開ポート（既定 8000） |
| `DC_API_PORT` | dev | `npm run dev` で Express が listen するポート（既定 8001、Vite から proxy される） |
| `DC_PROD_PORT` | prod | `npm run start` で Express が Web+API を統合配信する公開ポート（既定 8000） |

フロントは `window.location.origin` で API / Socket.IO に接続するため、dev でも prod でも単一オリジンで完結します（ポートはフロントコードにハードコードしない）。

## 起動手順

1. **開発モード**

   ```bash
   npm run dev
   ```
   - ブラウザで `https://localhost:<DC_WEB_PORT>` にアクセス（既定 8000）
   - Vite が `/api`, `/hook`, `/socket.io` を Express（`DC_API_PORT`）に proxy

2. **本番モード**

   ```bash
   npm run start
   ```
   - ブラウザで `https://localhost:<DC_PROD_PORT>` にアクセス（既定 8000）
   - Express が Web (dist) + API を 1 ポートで配信

## ビルドチェックフロー

### 必須チェックフロー

**コード変更後は必ず以下の順序でチェックを実行**：

1. **型チェック**: `npm run type-check`
2. **リントチェック**: `npm run lint`
3. **総合チェック**: `npm run check-all`（一括実行）

### Claude Code 使用時の推奨フロー

```bash
# 1. コード変更完了後、即座にチェック実行
npm run check-all

# 2. エラーがあれば修正して再チェック
npm run check-all

# 3. 全チェック通過後にコミット
git add .
git commit -m "機能追加: 〇〇の実装"
```

## 開発・運用ガイドライン

### Git 運用方針

- **タスク完了時の即時コミット**: 個別のタスクや機能の実装が完了したら、都度コミットを行う
- **コミットメッセージは日本語**: 本プロジェクトでは日本語でのコミットメッセージを使用
- **コミット前の品質チェック**: **必須** - `npm run check-all` を実行してからコミット
- **機能単位でのコミット**: 大きな変更は適切な単位に分割してコミット

#### コミットメッセージ例

```bash
git commit -m "ターミナル機能: タブの閉じるボタン実装"
git commit -m "UI改善: レスポンシブデザイン対応"
git commit -m "バグ修正: Socket.IO接続エラーハンドリング"
git commit -m "リファクタリング: 型定義の整理と統合"
```
