---
name: terminal-control
description: This skill should be used when the user asks to "create a terminal", "run a command in a terminal", "ターミナルを作成", "ターミナルでコマンド実行", "ターミナルの出力を取得", "全ワークツリーで〜を実行して", "全てのワークツリーで npm run dev して", "各ワークツリーでコマンドを実行", "terminal-control", or when Claude Code needs to create, send input to, read output from, or close interactive terminals (PTY) through the dokodemo-claude backend — including running the same command across every worktree's terminal.
---

# terminal-control

dokodemo-claude のバックエンド経由で、インタラクティブターミナル（PTY）を
作成・コマンド送信・出力取得・一覧・終了するスキル。作成したターミナルは Web UI のタブにも自動反映される。

操作は **`dokodemo-claude-tools` プラグインの MCP サーバ `api` が提供するツール**で行う
（curl は使わない）。ツールのフル名は `mcp__plugin_dokodemo-claude-tools_api__<ツール名>`。

## Prerequisites

- dokodemo-claude のバックエンドが起動していること
- dokodemo-claude 上で管理されているリポジトリ内で作業していること

## ツール一覧

| 操作 | ツール | 主な引数 |
|------|--------|----------|
| rid 取得 | `repository_id` | `path` |
| 一覧 | `terminal_list` | `rid` |
| 作成 | `terminal_create` | `rid`, `name?`, `cols?`, `rows?` |
| 入力送信 | `terminal_input` | `terminalId`, `input`, `enter?` |
| 出力取得 | `terminal_output` | `terminalId`, `strip?`（既定 true） |
| シグナル送信 | `terminal_signal` | `terminalId`, `signal` |
| リサイズ | `terminal_resize` | `terminalId`, `cols`, `rows` |
| 終了 | `terminal_close` | `terminalId` |

> 作成・一覧は **rid** をキーにする。**rid には main リポジトリの prid だけでなく、ワークツリーの wtid も使える**
> （wtid を渡すとそのワークツリーのディレクトリでターミナルが開く）。入力・出力・終了・シグナル・リサイズは
> 作成レスポンスの `terminal.id`（= terminalId）をキーにする。ID の URL エンコードはサーバ側で処理する。

## ワークフロー

### Step 1: rid を取得する

`repository_id` に現在の作業ディレクトリの絶対パスを渡し、`rid` を控える。
ワークツリー内で実行していても問題ない（サーバが親へ正規化する）。

### Step 2: ターミナルを作成する（`terminal_create`）

`rid` を渡して作成し、レスポンスの `terminal.id` を控える。作成と同時に Web UI にタブが追加される。
`rid` にワークツリーの wtid を使えば、そのワークツリー内でターミナルが開く。

### Step 3: コマンドを送信する（`terminal_input`）

`enter:true` を付けると入力末尾に改行が付与され、コマンドが実行される（省略すると改行なしで文字だけ送る）。

### Step 4: 出力を取得する（`terminal_output`）

PTY 出力は非同期。**送信 → 数秒待つ → `terminal_output`** の順で結果を確認する。
長時間かかるコマンドは待ち時間を延ばすか、間隔を空けて複数回 `terminal_output` を取得する。
`strip`（既定 `true`）で ANSI エスケープを除去した読みやすい出力が得られる。`false` で生出力。

### その他の操作

- 一覧: `terminal_list`（`rid`）
- シグナル送信: `terminal_signal`（例 `signal:"SIGINT"` で Ctrl-C 相当の中断）
- リサイズ: `terminal_resize`（`cols`, `rows`）
- 終了: `terminal_close`

## 全ワークツリーで同じコマンドを実行する

「全てのワークツリーで `npm run dev` して」のような依頼では、`worktree_list`（**`worktree-manage` スキル / 同じ MCP サーバ**）
で各 **wtid** を取り、ワークツリーごとに `terminal_create` → `terminal_input` する
（`npm run dev` のような常駐プロセスでも、PTY なので各タブで動き続ける）。

手順:

1. `repository_id` で `rid` を取得
2. `worktree_list` で各要素を取得し、`isMain` が false の `wtid` を集める（main も含めたいなら除外しない）
3. 各 wtid について `terminal_create`（`rid` に wtid を渡す）→ 返った `terminal.id` に対し `terminal_input`（`input` にコマンド、`enter:true`）
4. 起動ログを見たい場合は数秒待ってから `terminal_output`

## エラーハンドリング

ツールがエラー時は結果に `isError` が付き、メッセージに理由が入る。

| 状況 | 意味 |
|------|------|
| 400 | 必須パラメータ欠落（`input` / `signal` / `cols,rows`） |
| 404 | rid または terminalId が見つからない／既に終了している |
| 接続失敗 | dokodemo-claude-api が起動していない / ベース URL が不正 |

## Tips

- 作成・出力ストリーム・終了は Web UI のタブに自動反映される。
- コマンド実行は `input` + `enter:true`。`enter` を省くと改行なしで文字だけ送られる。
- 出力取得は「送信 → 待つ → 取得」。完了検知は行わないため、必要に応じて間隔をおいて複数回取得する。
- **ワークツリーで実行したいときは、`terminal_create` の `rid` にそのワークツリーの wtid を渡す**（cwd がワークツリーになる）。「全ワークツリーで〜」は wtid をループ。
- URL エンコードや `-k`/HTTPS などの低レベルな扱いはすべて MCP サーバ側が処理する。
