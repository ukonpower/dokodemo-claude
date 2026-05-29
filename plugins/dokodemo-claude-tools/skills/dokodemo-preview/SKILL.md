---
name: dokodemo-preview
description: This skill should be used when the user asks to "dokodemo-preview", "preview with dokodemo", "dokodemo-claudeでプレビュー", "dokodemoclaudeでプレビュー", "upload image to dokodemo-claude", "register screenshot", "send image to web interface", "dokodemo-previewでプレビュー", "プレビューしたい", "画像をdokodemo-claudeに登録", "スクリーンショットをアップロード", "画像を送信", or when Claude Code needs to share generated images (test screenshots, diagrams, etc.) with the user through the dokodemo-claude web interface.
---

# dokodemo-preview

dokodemo-claude のプレビュー領域に画像 / 動画 / その他ファイルをアップロードする。
アップロードした瞬間に Web UI のアコーディオン（ファイルタブ）へリアルタイム反映される。

操作は **`dokodemo-claude-tools` プラグインの MCP サーバ `api` が提供するツール**で行う
（curl は使わない）。ツールのフル名は `mcp__plugin_dokodemo-claude-tools_api__<ツール名>`。

## 前提

- dokodemo-claude-api が起動していること
- 対象リポジトリの `rid`（Repository ID）が取得できること
- 最大サイズ: 50MB

## ツール一覧

| 操作 | ツール | 主な引数 |
|------|--------|----------|
| rid 取得 | `repository_id` | `path` |
| アップロード | `preview_upload` | `rid`, `filePath`, `filename?`, `contentType?`, `source?`, `title?`, `description?` |

## 1. rid を取得

`repository_id` に現在の作業ディレクトリの絶対パスを渡し、レスポンスの `rid` を控える。
すでに `$DOKODEMO_RID` 等で rid が分かっていればそれを使ってよい。
取得に失敗する場合はユーザーに UI 上の現在のリポジトリ ID を確認する。

## 2. ファイルをアップロード（`preview_upload`）

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `rid` | 必須 | アップロード先リポジトリの rid |
| `filePath` | 必須 | アップロードするファイルの**絶対パス**（サーバがその場で読み込んで送信する） |
| `filename` | 任意 | UI 表示用の元ファイル名（省略時は `filePath` のファイル名） |
| `contentType` | 任意 | MIME タイプ。省略時は拡張子から自動推定（例 `.png` → `image/png`） |
| `source` | 任意 | `claude`（既定）または `user` |
| `title` | 任意 | UI 表示タイトル |
| `description` | 任意 | 補足説明 |

タイトル・説明・日本語の扱いはツール側で処理されるので、URL エンコード等は不要。

## 3. 応答

```json
{
  "success": true,
  "message": "ファイルをアップロードしました",
  "file": {
    "id": "1706520000000_abc12345",
    "filename": "1706520000000_abc12345.png",
    "rid": "<rid>",
    "size": 12345,
    "mimeType": "image/png",
    "source": "claude",
    "type": "image",
    "title": "E2E結果",
    "description": "npm test 実行後のスクリーンショット"
  }
}
```

アップロード完了とともに Socket.IO の `file-uploaded` イベントがブロードキャストされ、
Web UI のファイルタブが自動更新される。

## よくある用途

- **テスト後のスクリーンショット**: `preview_upload`（`filePath` にスクショの絶対パス、`title:"Cypressテスト結果"` 等）
- **iOS シミュレータ**: まず `xcrun simctl io booted screenshot /tmp/sim.png` で保存 → `preview_upload`（`filePath:"/tmp/sim.png"`）
- **生成した図**: `preview_upload`（`filePath` に図の絶対パス、`title:"アーキテクチャ図"`）

## エラーハンドリング

ツールがエラー時は結果に `isError` が付き、メッセージに理由が入る。

| 状況 | 意味 |
|------|------|
| 400 | 不正リクエスト（body 無し、rid 無し等） |
| 接続失敗 | dokodemo-claude-api が起動していない / ベース URL が不正 |

## メモ

- `source:"claude"` を付けると Claude 由来のファイルとして metadata に保存される（既定）。
- 対応 MIME 例: `image/png` `image/jpeg` `image/gif` `image/webp` `video/mp4` `video/webm` `application/pdf` 等。
- ファイルはローカルの**絶対パス**で渡すこと（MCP サーバがそのパスを読み込んで raw binary として送信する）。
