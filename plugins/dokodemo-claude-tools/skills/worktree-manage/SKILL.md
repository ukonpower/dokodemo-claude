---
name: worktree-manage
description: This skill should be used when the user asks to "create/list/delete a worktree", "ワークツリーを作成/一覧/削除", "ワークツリー作って", "ワークツリー一覧", "ワークツリー消して", "ワークツリーに説明/メモを付けて/書いて", "これらのタスクをそれぞれワークツリーを立てて実装して", "タスクごとにワークツリーを作って実装", "複数の作業をワークツリーに分けて", "worktree-manage", or when Claude Code needs to create, list, delete, or annotate (add a description / メモ to) git worktrees through the dokodemo-claude backend — including when the user asks to implement multiple tasks each in its own worktree (this skill is responsible for creating those worktrees, not raw `git worktree`).
---

# worktree-manage

dokodemo-claude のバックエンド経由で git ワークツリーを作成・一覧・削除・メモ更新するスキル。
作成/削除/メモ更新すると Web UI のタブにも自動反映される。

操作は **`dokodemo-claude-tools` プラグインの MCP サーバ `api` が提供するツール**で行う
（curl は使わない）。ツールのフル名は `mcp__plugin_dokodemo-claude-tools_api__<ツール名>`。
以下では短縮名（`worktree_create` など）で記す。

> **重要 1: rid / wtid は不透明なIDとして扱い、必ずツールのレスポンスから逐語コピーして使うこと。**
> 形式を手で組み立ててはいけない。`wt:reponame/feature/foo` のような表記は実装によって変わりうる
> サーバ生成値であり、推測で組むと存在しない wtid を渡して事故る。**作成時は必ずレスポンスの
> `worktree.wtid` をその場で控え、メモ・削除・プロンプト送信すべてその値を使い回す**。
> URL エンコードはサーバ側で行うので、こちらで `@uri` 等を気にする必要はない。
>
> **重要 2: ワークツリーの「説明」は git の `branch.description`（`git config`）ではなく、必ず
> `worktree_set_memo` ツールに入れること。** `git config branch.<name>.description` に書いても
> dokodemo-claude のレスポンスにも Web UI のタブにも一切反映されない。Web UI のタブに表示される
> 「説明 = メモ」はこのメモツール経由のものだけ。

## 使いどころ

- 「ワークツリーを作って／一覧／削除して」などの直接的な依頼。
- **「これらのタスクをそれぞれワークツリーを立てて実装して」** のように複数タスクを分離環境で進める依頼。
  この場合は **タスクごとに `worktree_create` でワークツリーを 1 つずつ作る**（生 `git worktree` は使わない）。
  ブランチ名はタスク内容から `feature/xxx` 等を付け、必要なら作成後に `worktree_set_memo` で説明も設定する。
- 作った全ワークツリーで同じコマンド（例: `npm run dev`）をターミナル実行したい場合は、
  `worktree_list` で wtid を集めてから **`terminal-control` スキル**でワークツリーごとに送信する。
  AI（claude/codex）キューへ一斉にプロンプト投入したい場合は **`worktree-prompt` スキル**。

## Prerequisites

- dokodemo-claude のバックエンドが起動していること（MCP サーバがそこへ接続する）
- dokodemo-claude 上で管理されているリポジトリ内で作業していること

## ツール一覧

| 操作 | ツール | 主な引数 |
|------|--------|----------|
| rid 取得 | `repository_id` | `path`（対象リポジトリ内の絶対パス） |
| 一覧 | `worktree_list` | `rid` |
| 作成 | `worktree_create` | `rid`, `branchName`, `baseBranch?`, `useExistingBranch?`, `syncEntries?` |
| 削除 | `worktree_delete` | `wtid`, `deleteBranch?` |
| メモ取得 | `worktree_get_memo` | `wtid` |
| メモ更新 | `worktree_set_memo` | `wtid`, `memo` |

> 作成・一覧の `rid` は親でも worktree でも可（サーバが親リポジトリへ正規化する）。
> 削除・メモ取得/更新は **対象 worktree の wtid**。存在しない wtid を渡すと 404/400 になる。

## ワークフロー

### Step 1: rid を取得する

`repository_id` に現在の作業ディレクトリの絶対パスを渡し、レスポンスの `rid` を控える。
ワークツリー内で実行していても問題ない（サーバ側で親リポジトリへ正規化される）。
この `rid` を含め、ID はすべてレスポンスの値をそのまま使い、形式を手で組み立てない。

### Step 2: 操作を実行する

#### 作成（`worktree_create`）

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `rid` | 必須 | 親 or 任意 worktree の rid |
| `branchName` | 必須 | 作成するブランチ名（= ワークツリー名） |
| `baseBranch` | 任意 | 新規ブランチの分岐元（省略時は現在の HEAD） |
| `useExistingBranch` | 任意 | 既存ブランチをチェックアウトする場合 `true` |
| `syncEntries` | 任意 | 親から取り込むファイル。例 `[{"path":".env","mode":"copy"}]`（`mode` は `copy` or `link`）。**未指定時は GUI で保存した既定設定が自動適用される**。明示的に「同期なし」にしたい場合は `[]` を渡す |

成功レスポンス（抜粋）:

```json
{
  "success": true,
  "message": "ワークツリー「feature/foo」を作成しました",
  "worktree": { "path": "/.../.dokodemo-worktrees/proj/feature/foo", "branch": "feature/foo", "wtid": "..." }
}
```

> **作成時に説明（用途・目的など）を求められたら**、レスポンスの `worktree.wtid` を控え、続けて
> `worktree_set_memo` で説明を設定する。git の `branch.description` には絶対に書かない（Web UI に反映されない）。

#### メモ（説明）

ワークツリーの「説明」は **メモ**として管理され、Web UI のタブに表示される。
`worktree_get_memo` / `worktree_set_memo` に対象 worktree の **wtid**（作成 or 一覧から取得）を渡す。

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `wtid` | 必須 | 対象ワークツリーの wtid |
| `memo` | 必須 | 説明本文（自由記述の文字列）。本文中の URL は Web UI 表示時に自動リンク化される。**空文字を渡すとメモ削除**（残骸を残さない） |

#### 一覧（`worktree_list`）

main リポジトリと各 worktree が `rid` 付きで返る（main は prid、worktree は wtid）。各要素は `isMain` も持つ。

#### 削除（`worktree_delete`）

対象 worktree の **wtid** を渡す（一覧 or 作成レスポンスから取得）。`deleteBranch:true` で
ワークツリーに紐づくブランチも削除する（既定 `false`）。

## エラーハンドリング

ツールがエラー時は結果に `isError` が付き、メッセージに HTTP ステータスとサーバの理由が入る。

| 状況 | 意味 |
|------|------|
| 400 | 必須欠落（メモは `memo` が文字列でない） / git 失敗（理由つき） / main 削除不可 |
| 404 | rid/wtid に対応するリポジトリ・ワークツリーが見つからない。よくある原因: 手で組み立てた（または取り違えた）存在しない wtid を渡している（→ 作成/一覧レスポンスの値を逐語コピーする） |
| 接続失敗 | dokodemo-claude-api が起動していない / ベース URL が不正 |

## Tips

- **ID は手で組まず、作成・一覧レスポンスの値を逐語コピーして使い回す。** 特に作成直後は
  `worktree.wtid` をその場で控え、続くメモ・削除・プロンプト送信に流用する。これだけで wtid の
  取り違え事故（存在しない wtid を作って 404／別の worktree を操作）はほぼ全て防げる。
- 作成・削除・メモ更新は Web UI のタブに自動反映される（手動リロード不要）。
- **「説明」は git ではなくメモツールに入れる。** `git config branch.<name>.description` は dokodemo-claude には一切反映されない。
- 既存ブランチをワークツリー化する場合は `useExistingBranch:true` を指定する。指定なしで既存ブランチ名を渡すと git が失敗する。
- URL エンコードや `-k`/HTTPS などの低レベルな扱いはすべて MCP サーバ側が処理する。
