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

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **バックエンド**: Node.js + Express + TypeScript
- **コード品質**: ESLint + Prettier + TypeScript
- **CLI統合**: child_process でClaude Code CLI実行
- **通信**: WebSocket（Socket.IO）

## 基本アーキテクチャ

```
Webブラウザ ←→ Node.jsサーバー ←→ Claude Code CLI
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
│ │                                     │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ コマンド入力:                            │
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
3. Claude Code CLIの現在状態を確認
4. テキストエリアに指示を入力
5. [送信]ボタンクリックまたはCtrl+Enter
6. Claude Code CLIでコマンド実行
7. 結果を画面で確認

## 実装要件

### 必要な環境
- Node.js（v18以上）
- Claude Code CLI（インストール済み）
- Git（インストール済み）
- Webブラウザ（Chrome, Firefox, Safari, Edge）

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
│   │   └── claude.ts    # Claude Code CLI統合
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.js
│   └── .prettierrc
└── CLAUDE.md
```

## 開発コマンド

```bash
# フロントエンド開発サーバー起動
cd frontend
npm run dev    # Vite + TypeScript開発サーバー（ポート5173）

# バックエンドサーバー起動
cd backend
npm run dev    # Express + TypeScript開発サーバー（ポート3001）

# コード品質チェック
npm run lint           # ESLintでコード品質チェック
npm run lint:fix       # ESLintで自動修正可能なエラーを修正
npm run type-check     # TypeScript型チェック
npm run format         # Prettierでコードフォーマット
npm run format:check   # Prettierフォーマットチェック

# 全チェック実行
npm run check-all      # lint + type-check + format:check を一括実行

# 同時起動（推奨）
npm run dev:all        # フロントエンド・バックエンド同時起動
```

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

// Socket.IO通信関連
interface SocketEvents {
  'clone-repo': (data: { url: string; path: string }) => void;
  'switch-repo': (data: { path: string }) => void;
  'list-repos': () => void;
  'repos-list': (data: { repos: GitRepository[] }) => void;
  'send-command': (data: { command: string }) => void;
  'claude-output': (data: ClaudeMessage) => void;
}
```

この設計は、Claude Code CLIの基本的なWeb化に必要な最小限の機能のみを定義しています。
複雑な機能は一切含まず、シンプルで確実に動作するツールを目指します。