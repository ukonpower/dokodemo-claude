# dokodemo-claude

Claude Code CLIをWebブラウザから操作するためのシンプルなインターフェース

## 概要

dokodemo-claude は、Claude Code CLIをWebブラウザから操作するツールです。Gitリポジトリのクローン、Claude Code CLIとの対話、ターミナル操作を統合したWeb UIを提供します。

## 必要な環境

- Node.js v18以上
- Claude Code CLI
- Git
- モダンなWebブラウザ

## 起動手順

1. リポジトリをクローン
```bash
git clone https://github.com/yourusername/dokodemo-claude.git
cd dokodemo-claude
```

2. 依存関係をインストール
```bash
npm run install
```

3. 開発サーバーを起動
```bash
npm run dev
```

4. ブラウザで http://localhost:8000 にアクセス

## 使い方

1. **リポジトリクローン**: URL入力後[Clone]ボタンをクリック
2. **Claude CLI操作**: 下部のテキストエリアに指示を入力して送信
3. **ターミナル操作**: [+]ボタンで新しいターミナルタブを作成し、通常のターミナルと同様に操作