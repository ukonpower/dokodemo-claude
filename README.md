# dokodemo-claude

どこでもClaude - Claude Code CLIをWebブラウザから操作するための最小限のインターフェース

## 概要

dokodemo-claude は、[Claude Code CLI](https://github.com/anthropic/claude-code) をWebブラウザから操作するためのツールです。Gitリポジトリのクローン、Claude Code CLIとの対話、そして通常のターミナル操作を統合したシンプルなWeb UIを提供します。

## 主な機能

- 📁 **Gitリポジトリ管理** - URLを入力してリポジトリを簡単にクローン
- 🤖 **Claude Code CLI統合** - ブラウザ上でClaude Code CLIの出力をリアルタイム表示
- 💻 **インタラクティブターミナル** - 複数のターミナルタブで自由なコマンド実行
- 🔄 **リアルタイム通信** - WebSocketによる双方向通信

## 必要な環境

- Node.js v18以上
- Claude Code CLI（インストール済み）
- Git
- モダンなWebブラウザ（Chrome, Firefox, Safari, Edge）

## インストール

1. リポジトリをクローン
```bash
git clone https://github.com/yourusername/dokodemo-claude.git
cd dokodemo-claude
```

2. 依存関係をインストール
```bash
npm run install:all
```

## 起動方法

```bash
npm run dev:all
```

ブラウザで http://<ホストのIPアドレス>:8000、にアクセス

## 外部ホストからの接続設定

### 1. 環境変数の設定

**フロントエンド設定**
```bash
# frontend/.env
VITE_BACKEND_URL=http://your-server-ip:8001
```

**バックエンド設定**
```bash
# backend/.env
PORT=8001
CORS_ORIGIN=http://your-frontend-domain:8000
HOST=0.0.0.0
```

### 2. 設定例

**ローカル開発**
- フロントエンド: `http://localhost:8000`
- バックエンド: `http://localhost:8001`

**本番/外部アクセス**
- フロントエンド: `http://192.168.1.100:8000`
- バックエンド: `http://192.168.1.100:8001`

### 3. 外部接続の確認

1. ブラウザで `http://your-server-ip:8000` にアクセス
2. 接続状態（緑丸）を確認
3. リポジトリクローン機能をテスト

## 使い方

### 初回セットアップ

1. Webブラウザでアプリケーションにアクセス
2. GitリポジトリURLを入力して[Clone]ボタンをクリック
3. クローン完了後、Claude Code CLIが自動起動
4. 使用開始

### 基本的な使い方

1. **リポジトリ操作**
   - 新しいリポジトリをクローン: URL入力後[Clone]をクリック
   - リポジトリ切り替え: ドロップダウンから選択

2. **Claude Code CLI操作**
   - 下部のテキストエリアに指示を入力
   - [送信]ボタンまたはCtrl+Enterで送信
   - 出力エリアでAIの応答を確認

3. **ターミナル操作**
   - [+]ボタンで新しいターミナルタブを作成
   - 通常のターミナルと同様にコマンドを実行
   - Ctrl+Cでプロセス中断、タブの×ボタンで終了

詳細な技術仕様とClaude Code向けの設定は[CLAUDE.md](./CLAUDE.md)を参照してください。