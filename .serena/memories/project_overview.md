# プロジェクト概要

## プロジェクト名
dokodemo-claude

## 目的
Claude Code CLIをWebブラウザから操作するための最小限のインターフェース。個人利用を前提とした、シンプルで実用的なツール。

## 主要機能
1. **Gitリポジトリクローン**: リポジトリURLを入力してローカルにクローン
2. **Claude Code CLI表示**: Webブラウザ上でClaude Code CLIの出力を表示
3. **テキスト入力・送信**: Webブラウザ上のテキストエリアで指示を入力
4. **ターミナル機能**: 選択されたプロジェクトディレクトリで起動するインタラクティブターミナル

## アーキテクチャ
- **フロントエンド**: Webブラウザ
- **バックエンド**: Node.jsサーバー 
- **CLI統合**: Claude Code CLI実行
- **ターミナル**: node-ptyでインタラクティブターミナル（PTY）操作
- **通信**: WebSocket（Socket.IO）

## プロジェクト構造
```
dokodemo-claude/
├── frontend/          # React + TypeScript + Vite フロントエンド
├── backend/           # Node.js + Express + TypeScript バックエンド
├── package.json       # ルートレベルのビルドスクリプト
└── CLAUDE.md         # プロジェクト指針
```