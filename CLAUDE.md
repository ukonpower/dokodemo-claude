# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際にClaude Code (claude.ai/code) への指針を提供します。

## 言語設定

このプロジェクトでは日本語でのやり取りを基本とします。コメント、ドキュメント、コミットメッセージなどは日本語で記述してください。

## プロジェクト概要

「dokodemo-claude」は、Claude Code CLIをWebブラウザから操作するための最小限のインターフェースです。
個人利用を前提とした、シンプルで実用的なツールです。

## 必要最低限の機能

### Gitリポジトリクローン
- リポジトリURLを入力してローカルにクローン
- クローン先ディレクトリの指定
- クローン完了の確認表示

### Claude Code CLI表示
- Webブラウザ上でClaude Code CLIの出力を表示
- リアルタイムでCLIの内容が見える
- 従来のターミナルと同じ情報を表示

### テキスト入力・送信
- Webブラウザ上のテキストエリアで指示を入力
- 入力したテキストをClaude Code CLIに送信
- 送信ボタンまたはキーボードショートカットで実行

### ターミナル機能
- 選択されたプロジェクトディレクトリで起動するインタラクティブターミナル
- Claude Code CLIとは独立した自由なコマンド実行環境
- リアルタイムでの標準入力・出力・エラー表示
- プロセスの中断（Ctrl+C）、再開などの制御
- 複数ターミナルタブでの同時操作
- 開発サーバー起動、テスト実行、git操作など何でも実行可能

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **バックエンド**: Node.js + Express + TypeScript
- **コード品質**: ESLint + Prettier + TypeScript
- **CLI統合**: child_process でClaude Code CLI実行
- **ターミナル機能**: node-pty でインタラクティブターミナル（PTY）操作
- **通信**: WebSocket（Socket.IO）

## 基本アーキテクチャ

```
Webブラウザ ←→ Node.jsサーバー ←→ Claude Code CLI
                      ↓
                 ターミナル管理（PTY）
                 ├─ ターミナル1 (選択されたプロジェクトディレクトリ)
                 ├─ ターミナル2 (選択されたプロジェクトディレクトリ)
                 └─ ターミナルN (選択されたプロジェクトディレクトリ)
```

## 画面構成

メイン画面のみの単一画面構成：

```
┌─────────────────────────────────────────┐
│ Claude Code Web Interface               │
├─────────────────────────────────────────┤
│ リポジトリURL: [                    ] [Clone] │
│ 現在のプロジェクト: [プロジェクト選択▼]    │
├─────────────────────────────────────────┤
│ Claude Code CLI 出力表示エリア           │
│ ┌─────────────────────────────────────┐ │
│ │ claude> 待機中...                   │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ ターミナル                              │
│ ┌─ Terminal 1 ─┬─ Terminal 2 ─┬─ + ─┐ │
│ │ user@host:~/project$ npm run dev     │ │
│ │ > vite dev                          │ │
│ │ Local: http://localhost:5173/       │ │
│ │ $ _                                 │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Claude コマンド入力:                      │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                              [送信]    │
└─────────────────────────────────────────┘
```

## 動作フロー

### 初回セットアップ
1. Webブラウザでアプリケーションにアクセス
2. GitリポジトリURLを入力
3. [Clone]ボタンクリック
4. クローン完了を待機
5. Claude Code CLI自動起動
6. 使用開始

### 複数リポジトリの管理
1. 新しいリポジトリを追加する場合
   - 別のGitリポジトリURLを入力
   - [Clone]ボタンクリック
   - 新しいディレクトリにクローン
2. 既存リポジトリ間の切り替え
   - リポジトリ選択ドロップダウンから選択
   - Claude Code CLIが選択したプロジェクトディレクトリに移動
   - 作業ディレクトリが自動切り替え

### 日常利用
1. Webブラウザでアプリケーションにアクセス
2. 作業したいリポジトリを選択（複数ある場合）
3. ターミナルでの直接操作
   - 新しいターミナルタブを開く（[+]ボタン）
   - 選択されたプロジェクトディレクトリで自動的に起動
   - 開発サーバー起動、テスト実行、git操作など自由に実行
   - リアルタイムでのコマンド結果確認
4. Claude Code CLIでのAI支援
   - Claude用テキストエリアに指示を入力
   - [送信]ボタンクリックまたはCtrl+Enter
   - AIによるコード生成・修正・説明
5. 作業終了時はターミナルを適切に終了

### ターミナル管理フロー
1. **ターミナル作成**
   - [+]ボタンクリックで新しいターミナルタブを作成
   - node-ptyでPTY（疑似端末）を起動
   - 選択中のプロジェクトディレクトリで自動的にcd実行
   - WebSocketでリアルタイム通信を確立

2. **自由なコマンド実行**
   - ターミナル内でのテキスト入力
   - Enterキーで入力内容をPTYに送信
   - 標準出力・エラー出力をリアルタイム表示
   - ANSI colorコードに対応した色付き表示
   - 開発サーバー、テスト、git、npm、任意のコマンド実行

3. **プロセス制御**
   - Ctrl+C（SIGINT）でプロセス中断
   - Ctrl+Z（SIGTSTP）でプロセス一時停止
   - 長時間実行プロセスの継続実行
   - タブ切り替えで複数ターミナルの並行操作

4. **ターミナル終了**
   - タブの×ボタンでターミナル終了
   - PTYプロセスの適切な終了処理
   - 実行中プロセスがある場合の警告表示

## 実装要件

### 必要な環境
- Node.js（v18以上）
- Claude Code CLI（インストール済み）
- Git（インストール済み）
- Webブラウザ（Chrome, Firefox, Safari, Edge）
- node-pty（ターミナル機能用、build-essential必要）

### 制約事項
- ローカル環境でのみ動作
- 複数リポジトリ対応（同時に複数のプロジェクトを管理）
- 同時に1人のユーザーのみ利用可能

### セキュリティ
- ローカルホスト（127.0.0.1）のみでの動作
- 外部からのアクセス不可

## プロジェクト構造

```
dokodemo-claude/
├── frontend/          # React + TypeScript + Vite フロントエンド
│   ├── src/
│   │   ├── components/   # Reactコンポーネント
│   │   ├── types/       # TypeScript型定義
│   │   ├── App.tsx      # メインアプリケーション
│   │   └── main.tsx     # エントリーポイント
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── eslint.config.js
│   └── .prettierrc
├── backend/           # Node.js + Express + TypeScript バックエンド
│   ├── src/
│   │   ├── types/       # TypeScript型定義
│   │   ├── server.ts    # Expressサーバー
│   │   ├── claude.ts    # Claude Code CLI統合
│   │   └── terminal.ts  # ターミナル（PTY）管理
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.js
│   └── .prettierrc
└── CLAUDE.md
```

## 開発コマンド

```bash
# 推奨: ルートディレクトリから直接起動
npm run dev           # フロントエンド（Vite）サーバー起動（ポート5173）
cd backend && npm run dev  # バックエンド（Express）サーバー起動（ポート0001）

# 代替方法: 各ディレクトリでの個別起動
cd frontend && npm run dev    # フロントエンド開発サーバー
cd backend && npm run dev     # バックエンド開発サーバー

# 同時起動（将来実装予定）
npm run dev:all        # フロントエンド・バックエンド同時起動

# コード品質チェック
npm run lint           # ESLintでコード品質チェック
npm run lint:fix       # ESLintで自動修正可能なエラーを修正
npm run type-check     # TypeScript型チェック
npm run format         # Prettierでコードフォーマット
npm run format:check   # Prettierフォーマットチェック

# 全チェック実行
npm run check-all      # lint + type-check + format:check を一括実行
```

## 起動手順

1. **バックエンドサーバー起動**
   ```bash
   cd backend
   npm run dev
   ```
   - ポート0001で起動
   - Claude Code CLIとの統合機能を提供
   - Gitリポジトリ管理機能を提供

2. **フロントエンドサーバー起動**
   ```bash
   # ルートディレクトリから
   npm run dev
   ```
   - ポート5173（または5174）で起動
   - Webブラウザでアクセス: http://localhost:5173
   - バックエンドサーバー（ポート0001）と自動接続

3. **動作確認**
   - ブラウザで http://localhost:5173 にアクセス
   - 接続状態（緑丸）を確認
   - リポジトリクローン機能をテスト
   - Claude CLIコマンド入力をテスト

## コード品質設定

### ESLint設定例
```javascript
// eslint.config.js
export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      'react': require('eslint-plugin-react'),
      'react-hooks': require('eslint-plugin-react-hooks'),
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
];
```

### Prettier設定例
```json
// .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false
}
```

## 共通型定義

フロントエンドとバックエンドで共有する主要な型：

```typescript
// Claude Code CLI関連
interface ClaudeMessage {
  id: string;
  type: 'user' | 'claude' | 'system';
  content: string;
  timestamp: number;
}

// Git操作関連  
interface GitRepository {
  url: string;
  path: string;
  status: 'cloning' | 'ready' | 'error';
}

// ターミナル関連
interface Terminal {
  id: string;
  name: string;
  cwd: string;
  status: 'active' | 'running' | 'exited';
  pid?: number;
}

interface TerminalMessage {
  terminalId: string;
  type: 'stdout' | 'stderr' | 'input';
  data: string;
  timestamp: number;
}


// Socket.IO通信関連
interface SocketEvents {
  'clone-repo': (data: { url: string; path: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'send-command': (data: { command: string }) => void;
  'claude-output': (data: ClaudeMessage) => void;
  
  // ターミナル関連イベント
  'create-terminal': (data: { cwd: string; name?: string }) => void;
  'terminal-created': (data: Terminal) => void;
  'terminal-input': (data: { terminalId: string; input: string }) => void;
  'terminal-output': (data: TerminalMessage) => void;
  'list-terminals': () => void;
  'terminals-list': (data: { terminals: Terminal[] }) => void;
  'close-terminal': (data: { terminalId: string }) => void;
  'terminal-closed': (data: { terminalId: string }) => void;
}
```

この設計は、Claude Code CLIの基本的なWeb化と自由なターミナル操作環境の提供を目的としています。
選択されたプロジェクトディレクトリで直接操作できるターミナルにより、開発者は慣れ親しんだコマンドライン環境をWebブラウザ上で利用できます。

## ビルドチェックフロー

### 基本チェックコマンド

各プロジェクトで利用可能な品質チェックコマンド：

```bash
# 型チェック（TypeScript）
npm run type-check       # TypeScript型エラーのチェック

# コード品質チェック（ESLint）
npm run lint             # ESLintルール違反のチェック
npm run lint:fix         # 自動修正可能なESLintエラーを修正

# ビルドチェック
npm run build            # 本番環境用ビルドが成功するかチェック

# 総合チェック
npm run check-all        # type-check + lint + build を一括実行
```

### 必須チェックフロー

**コード変更後は必ず以下の順序でチェックを実行**：

1. **型チェック**: `npm run type-check`
   - TypeScript型エラーがないことを確認
   - 型エラーがある場合は修正してから次へ

2. **リントチェック**: `npm run lint`
   - ESLintルール違反がないことを確認
   - 自動修正可能な場合は `npm run lint:fix` を実行

3. **ビルドチェック**: `npm run build`
   - 本番環境用ビルドが成功することを確認
   - ビルドエラーがあれば修正

4. **総合チェック**: `npm run check-all`
   - 全チェックを一括実行して最終確認

### Claude Code使用時の推奨フロー

Claude Codeでコード変更を行った際の推奨手順：

```bash
# 1. コード変更完了後、即座にチェック実行
npm run check-all

# 2. エラーがあれば修正して再チェック
npm run check-all

# 3. 全チェック通過後にコミット
git add .
git commit -m "機能追加: 〇〇の実装"
```

### エラー対応ガイド

#### TypeScript型エラー (`npm run type-check`)
- 未定義の変数・プロパティへのアクセス
- 型の不一致（string vs number等）
- 未インポートの型・インターフェース
- 必須プロパティの不足

#### ESLintエラー (`npm run lint`)
- 未使用変数・インポート
- インデント・改行の不統一
- React Hooks使用規則違反
- 推奨コーディングスタイル違反

#### ビルドエラー (`npm run build`)
- モジュール解決エラー
- 循環参照
- 最適化時のコード問題
- 型チェック後の残存エラー

### 自動化の検討

将来的に以下の自動化を検討：

```bash
# Git pre-commitフックでの自動チェック
# .git/hooks/pre-commit
#!/bin/sh
npm run check-all
if [ $? -ne 0 ]; then
  echo "ビルドチェックに失敗しました。コミットを中止します。"
  exit 1
fi
```

## 開発・運用ガイドライン

### 重要な制約事項

**IMPORTANT: このプロジェクト配下のファイルのみ編集可能**

このClaude Codeセッションでは、以下のディレクトリ配下のファイル**のみ**編集が許可されています：

```
/Users/ukonpower/Documents/work-space/dokodemo-claude/backend/repositories/dokodemo-claude/
```

#### 技術的な制限

- `.claude/hooks/tool-use` フックにより、上記ディレクトリ外のファイル編集は**技術的に拒否**されます
- Edit、Write、NotebookEditなどのファイル編集ツールは、このディレクトリ配下でのみ動作します
- 外側のdokodemo-claudeシステムファイルの誤編集を防止するための安全機構です

#### 編集禁止の対象

以下のファイル・ディレクトリは編集**できません**：
- `/Users/ukonpower/Documents/work-space/dokodemo-claude/backend/` 配下のファイル
  - `src/server.ts`
  - `src/process-manager.ts`
  - その他のバックエンドシステムファイル
- `/Users/ukonpower/Documents/work-space/dokodemo-claude/frontend/` 配下のファイル
- `/Users/ukonpower/Documents/work-space/dokodemo-claude/` 直下の設定ファイル

#### 編集可能な対象

- `backend/` - このプロジェクトのバックエンドコード
- `frontend/` - このプロジェクトのフロントエンドコード
- `.env`、`.env.example` - 環境変数設定
- `CLAUDE.md` - プロジェクト指針
- その他、このプロジェクト内の全てのファイル

この制約により、dokodemo-claude本体のメインシステムファイルの誤編集を確実に防止します。

### Git運用方針

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