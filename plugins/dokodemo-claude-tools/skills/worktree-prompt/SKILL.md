---
name: worktree-prompt
description: This skill should be used when the user asks to "broadcast a prompt to all worktrees", "全ワークツリーにプロンプト送信", "各ワークツリーに一斉送信", "ワークツリーにまとめて指示", "broadcast prompt", "worktree-prompt", or when Claude Code needs to send the same prompt to multiple git worktrees' AI queues at once through the dokodemo-claude backend.
---

# worktree-prompt

dokodemo-claude のバックエンド経由で、親リポジトリ配下の全（または指定）ワークツリーへ
同一プロンプトを一斉にキュー投入するスキル。各ワークツリーの AI（claude / codex）キューに追加される。

操作は **`dokodemo-claude-tools` プラグインの MCP サーバ `api` が提供するツール**で行う
（curl は使わない）。ツールのフル名は `mcp__plugin_dokodemo-claude-tools_api__<ツール名>`。

## Prerequisites

- dokodemo-claude のバックエンドが起動していること
- dokodemo-claude 上で管理されているリポジトリ内で作業していること

## ツール一覧

| 操作 | ツール | 主な引数 |
|------|--------|----------|
| rid 取得 | `repository_id` | `path` |
| 対象一覧 | `worktree_list` | `rid` |
| 一斉送信 | `prompt_broadcast` | `rid`, `provider`, `prompt`, `targets?`, `includeMain?`, `sendClearBefore?`, `isAutoCommit?`, `model?` |

## ワークフロー

### Step 1: rid を取得する

`repository_id` に現在の作業ディレクトリの絶対パスを渡し、レスポンスの `rid` を控える。
ワークツリー内で実行していても問題ない（サーバが親へ正規化する）。

### Step 2: 送信対象を確認する（任意）

`worktree_list` に `rid` を渡すと各 worktree の `rid`（wtid）が分かる。特定のワークツリーだけに
送りたい場合は `targets` で指定する。**`targets` に渡す値は、この一覧レスポンスの `rid` フィールドを
そのまま逐語コピーして使うこと。** `wt:...` のような形式を手で組み立てると、存在しない wtid となり
下記の `unmatchedTargets` に入って黙って送信対象から外れる。

### Step 3: 一斉送信する（`prompt_broadcast`）

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `rid` | 必須 | 親 or 任意 worktree の rid（親へ正規化される） |
| `provider` | 必須 | `claude` または `codex` |
| `prompt` | 必須 | 送信するプロンプト文字列 |
| `targets` | 任意 | 送信先 rid(wtid) の配列。省略時は全ワークツリー |
| `includeMain` | 任意 | 親リポジトリ本体にも送る場合 `true`（既定 `false`） |
| `sendClearBefore` | 任意 | 送信前に `/clear` を投入する場合 `true` |
| `isAutoCommit` | 任意 | 自動コミットを行う場合 `true` |
| `model` | 任意 | 使用モデルの指定 |

成功レスポンス:

```json
{
  "success": true,
  "sent": 2,
  "results": [
    { "path": "/.../wt-a", "rid": "...", "success": true, "itemId": "..." },
    { "path": "/.../wt-b", "rid": "...", "success": false, "message": "..." }
  ],
  "unmatchedTargets": [],
  "warning": "（送信先 0 件 や 未マッチ target がある場合のみ付与される）"
}
```

`results` に各ワークツリーへの投入結果が並ぶ（部分成功を許容）。投入されたプロンプトは
各ワークツリーのキュー処理で順次 AI へ送られ、Web UI のキュー表示にも自動反映される。

> **送信後は必ず `sent` / `unmatchedTargets` / `warning` を確認すること。**
> `unmatchedTargets` には、指定した `targets` のうちどのワークツリーにも一致しなかった値が入る
> （誤った wtid・取り違え）。`sent:0` や `unmatchedTargets` が非空なら投げっぱなしの事故なので、
> `worktree_list` で正しい `rid` を取り直して送信し直す。

## エラーハンドリング

ツールがエラー時は結果に `isError` が付き、メッセージに理由が入る。

| 状況 | 意味 |
|------|------|
| 必須欠落 | `rid` / `provider` / `prompt` のいずれかが欠けている |
| 見つからない | rid に対応するリポジトリが見つからない |
| 接続失敗 | dokodemo-claude-api が起動していない / MCP サーバへ接続できない |

## Tips

- このスキルは **キュー投入まで**。実際に AI へ送られるのは既存のキュー処理に委ねられる。
  各 claude が処理中か完了したかを取るツールは現状ない（必要ならターミナル出力等でポーリングする）。
- **`targets` は `worktree_list` の `rid` を逐語コピー。** 手で組んだ wtid は `unmatchedTargets` に入り黙って外れる。
- 一部のワークツリーで投入に失敗しても全体は成功扱いで返る。`sent` / `results` / `unmatchedTargets` / `warning` で
  成否と未マッチを必ず確認すること。`sent:0` でもエラーにはならない（送信先 0 件 or targets 不一致）。
- 引数の受け渡しなどの低レベルな扱いはすべて MCP サーバ側が処理する。
