# dokodemo-claude

Claude Code CLIをWebブラウザから操作するための最小限のインターフェース

## 概要

dokodemo-cloude は、Claude Code CLIをWebブラウザから操作するための個人利用向けのシンプルで実用的なツールです。Gitリポジトリの管理、Claude Code CLIとの対話、インタラクティブターミナル操作を統合したWeb UIを提供します。

## 主な機能

### Gitリポジトリクローン
- リポジトリURLを入力してローカルにクローン
- 複数リポジトリの管理と切り替え
- クローン先ディレクトリの指定

### Claude Code CLI表示
- Webブラウザ上でClaude Code CLIの出力をリアルタイム表示
- テキストエリアでの指示入力・送信
- 従来のターミナルと同じ情報を表示

### ターミナル機能
- 選択されたプロジェクトディレクトリでのインタラクティブターミナル
- 複数ターミナルタブでの同時操作
- 開発サーバー起動、テスト実行、git操作など自由なコマンド実行
- リアルタイムでの標準入力・出力・エラー表示
- ANSI colorコード対応の色付き表示

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite + Tailwind CSS
- **バックエンド**: Node.js + Express + TypeScript
- **CLI統合**: child_process でClaude Code CLI実行
- **ターミナル機能**: node-pty でインタラクティブターミナル（PTY）操作
- **通信**: WebSocket（Socket.IO）
- **コード品質**: ESLint + Prettier + TypeScript

## 必要な環境

- Node.js v18以上
- Claude Code CLI（インストール済み）
- Git（インストール済み）
- モダンなWebブラウザ（Chrome, Firefox, Safari, Edge）
- node-pty用のビルドツール（build-essential等）

## セットアップ・起動手順

1. **リポジトリのクローン**
```bash
git clone https://github.com/yourusername/dokodemo-claude.git
cd dokodemo-claude
```

2. **依存関係のインストール**
```bash
# フロントエンド
cd frontend && npm install && cd ..

# バックエンド
cd backend && npm install && cd ..
```

3. **開発サーバーの起動**

**推奨方法（ルートディレクトリから）**:
```bash
# フロントエンド（ポート5173）
npm run dev

# 別ターミナルで バックエンド（ポート0001）
cd backend && npm run dev
```

**代替方法（各ディレクトリで個別起動）**:
```bash
# ターミナル1: フロントエンド
cd frontend && npm run dev

# ターミナル2: バックエンド  
cd backend && npm run dev
```

4. **アクセス**
   - フロントエンド: http://localhost:5173
   - バックエンドAPI: http://localhost:0001

## 基本的な使い方

### 初回セットアップ
1. Webブラウザで http://localhost:5173 にアクセス
2. GitリポジトリURLを入力
3. [Clone]ボタンクリックでクローン実行
4. Claude Code CLI自動起動
5. 使用開始

### 日常的な利用
1. **リポジトリ切り替え**: 複数リポジトリがある場合、選択ドロップダウンから切り替え
2. **ターミナル操作**: 
   - [+]ボタンで新しいターミナルタブを作成
   - 選択されたプロジェクトディレクトリで自動起動
   - 開発サーバー起動、テスト実行、git操作など自由に実行
3. **Claude Code CLI**: テキストエリアに指示を入力して[送信]またはCtrl+Enter
4. **作業終了**: ターミナルを適切に終了

## コード品質チェック

開発時は以下のコマンドでコード品質をチェック：

```bash
# 型チェック
npm run type-check

# リントチェック
npm run lint
npm run lint:fix    # 自動修正

# ビルドチェック
npm run build

# 総合チェック（推奨）
npm run check-all
```

**重要**: コード変更後は必ず `npm run check-all` を実行してからコミット

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
├── repositories/      # クローンされたGitリポジトリ
└── CLAUDE.md          # Claude Code向けプロジェクト指針
```

## セキュリティ・制約事項

- **ローカル環境専用**: ローカルホスト（127.0.0.1）のみでの動作
- **単一ユーザー**: 同時に1人のユーザーのみ利用可能
- **外部アクセス不可**: セキュリティのため外部からのアクセスは不可
- **編集範囲制限**: `repositories`ディレクトリ内のプロジェクトのみ編集可能

## Claude Code 設定

### 自走モード（Hook モード）を使用する場合

自走モードの Hook モードを使用するには、Claude Code の設定ファイルに以下の hook 設定を追加する必要があります。

1. Claude Code の設定ファイルを開く（通常は `~/.claude/settings.json`）

2. 以下の hook 設定を追加：

```json
{
  "hooks": {
    "matchers": [
      {
        "pattern": ".*",
        "hooks": {
          "Stop": [
            {
              "command": "curl -X POST http://localhost:0001/hook/claude-event -H 'Content-Type: application/json' -d '{\"event\":\"Stop\",\"matchers\":{},\"metadata\":{\"cwd\":\"'$PWD'\"}}'",
              "shell": "sh"
            }
          ]
        }
      }
    ]
  }
}
```

3. Claude Code を再起動

### 自走モード注意事項

- Hook モードは Claude Code の処理完了時に自動的に次のプロンプトを実行します
- タイマーモードは指定された間隔で定期的にプロンプトを実行します
- 両モードともバックエンドで動作するため、ブラウザを閉じても継続実行されます
- dokodemo-claude のバックエンドサーバーがポート 0001 で動作している必要があります

## 開発・運用ガイドライン

### Git運用方針

- **タスク完了時の即時コミット**: 個別のタスクや機能の実装が完了したら、都度コミットを行う
- **コミットメッセージは日本語**: 本プロジェクトでは日本語でのコミットメッセージを使用
- **コミット前の品質チェック**: **必須** - `npm run check-all` を実行してからコミット

#### コミットメッセージ例
```bash
git commit -m "ターミナル機能: タブの閉じるボタン実装"
git commit -m "UI改善: レスポンシブデザイン対応"
git commit -m "バグ修正: Socket.IO接続エラーハンドリング"
```

## トラブルシューティング

### よくある問題

1. **バックエンドサーバーが起動しない**
   - ポート0001が既に使用されていないか確認
   - Claude Code CLIがインストールされているか確認

2. **ターミナルが動作しない**
   - node-ptyのビルドツール（build-essential等）がインストールされているか確認
   - Node.js v18以上がインストールされているか確認

3. **リポジトリクローンが失敗する**
   - Gitがインストールされているか確認
   - リポジトリURLが正しいか確認
   - ネットワーク接続を確認

### デバッグ情報

開発時は以下のログを確認：
- ブラウザの開発者ツールのコンソール
- バックエンドサーバーのコンソール出力
- Claude Code CLIの出力