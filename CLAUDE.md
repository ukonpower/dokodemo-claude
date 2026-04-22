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

## 開発コマンド

```bash
# 一括起動（.env の DC_WEB_PORT / DC_API_PORT を使用）
npm run dev

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

| アプリ | ポート |
|-------|--------|
| dokodemo-claude-web | .env の DC_WEB_PORT で設定 |
| dokodemo-claude-api | .env の DC_API_PORT で設定 |

## 起動手順

1. **一括起動（推奨）**

   ```bash
   npm run dev
   ```

2. **個別起動**

   ```bash
   # バックエンド
   npx nx serve dokodemo-claude-api

   # フロントエンド
   npx nx serve dokodemo-claude-web
   ```

3. **動作確認**
   - ブラウザで `https://localhost:<DC_WEB_PORT>` にアクセス（`.env.example` の既定は 8000）
   - 接続状態（緑丸）を確認

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
