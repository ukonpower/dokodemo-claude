---
name: dokodemo-md
description: This skill should be used when the user asks to "dokodemo-md", "send markdown to dokodemo-claude", "dokodemo-claudeにmdで送る", "dokodemoclaudeにmarkdownで出力", "mdで返して", "markdownで送って", "mdとして送信", "markdownで結果を共有", or when Claude Code needs to share a long-form text result (summary, plan, log, table, code snippets) to the user as rendered Markdown in the dokodemo-claude web interface instead of leaving it in the noisy xterm output.
---

# dokodemo-md

dokodemo-claude のファイル領域へ Markdown 本文を送る。
送信即 Web UI の受信タブに `.md` カードが現れ、クリックで整形済み Markdown ビューアが開き、
「本文をコピー」ボタンでクリップボードに丸ごとコピーできる。

通常のターミナル出力では改行・コードブロック・テーブルが崩れて読みにくいときに使う。
ファイルの送信に似た UX だが、ローカルファイルを用意する必要はなく **本文文字列を直接渡す**。

操作は **`dokodemo-claude-tools` プラグインの MCP サーバ `api` が提供するツール** で行う
（curl は使わない）。ツールのフル名は `mcp__plugin_dokodemo-claude-tools_api__<ツール名>`。

## 前提

- dokodemo-claude-api が起動していること
- 対象リポジトリの `rid`（Repository ID）が取得できること
- 最大サイズ: 1MB（utf-8）

## ツール一覧

| 操作 | ツール | 主な引数 |
|------|--------|----------|
| rid 取得 | `repository_id` | `path` |
| Markdown 送信 | `markdown_send` | `rid`, `content`, `title?`, `description?`, `filename?` |

## 1. rid を取得

`repository_id` に現在の作業ディレクトリの絶対パスを渡し、レスポンスの `rid` を控える。
すでに `$DOKODEMO_RID` 等で rid が分かっていればそれを使ってよい。

## 2. Markdown を送信（`markdown_send`）

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `rid` | 必須 | 送信先リポジトリの rid |
| `content` | 必須 | Markdown 本文。コードブロック・テーブル・見出しがそのまま整形表示される |
| `title` | 任意 | UI 表示タイトル（受信タブのカード上部・ビューア見出し） |
| `description` | 任意 | 補足説明（ビューア内のタイトル下に表示） |
| `filename` | 任意 | UI に表示する元ファイル名。省略時は title から生成。拡張子無しなら `.md` が補完 |
| `source` | 任意 | `claude`（既定）または `user` |

`content` は **文字列をそのまま** 渡す。URL エンコードや JSON エスケープは不要
（MCP プロトコル側で処理される）。

## 3. 応答

```json
{
  "success": true,
  "message": "ファイルをアップロードしました",
  "file": {
    "id": "1706520000000_abc12345",
    "filename": "1706520000000_abc12345.md",
    "rid": "<rid>",
    "size": 12345,
    "mimeType": "text/markdown",
    "source": "claude",
    "type": "markdown",
    "title": "実装サマリ",
    "description": "Phase 1 完了報告"
  }
}
```

送信完了とともに Socket.IO の `file-uploaded` がブロードキャストされ、Web UI の受信タブが自動更新される。

## よくある用途

- **長い実装サマリ・調査結果**: ターミナルに垂れ流す代わりに `markdown_send` で送り、ユーザは整形済みで読める
- **PR 説明文の下書き**: `title:"PR draft"` で送って、ユーザがビューアからコピーしてそのまま使う
- **コマンド出力の整形版**: 表や差分を見出し付きで送る（`title:"npm test result"` 等）
- **手順書 / チェックリスト**: 番号付きリストや checkbox を維持したまま共有

## 注意

- 受信タブは Claude 由来（`source:'claude'`）のファイルが集約されるので、既定の `claude` のままでよい
- 同じ `title` で複数回送ると別カードとして並ぶ（上書きはされない）。最新版を残したいときは、不要になった古いものは UI から削除してもらう
- markdown 本文に含めるリンクは Web UI から別タブで開ける（react-markdown + remark-gfm）

## エラーハンドリング

ツールがエラー時は結果に `isError` が付き、メッセージに理由が入る。

| 状況 | 意味 |
|------|------|
| `content（markdown 本文）は必須です` | content が空 / 文字列でない |
| `markdown が大きすぎます` | 1MB を超えた。分割して複数回送る |
| `rid が必要です` / `リポジトリが見つかりません` | rid 取得をやり直す |
| 接続失敗 | dokodemo-claude-api が起動していない / MCP サーバへ接続できない |
