---
name: worktree-manage
description: This skill should be used when the user asks to "create/list/delete a worktree", "ワークツリーを作成/一覧/削除", "ワークツリー作って", "ワークツリー一覧", "ワークツリー消して", "ワークツリーに説明/メモを付けて/書いて", "これらのタスクをそれぞれワークツリーを立てて実装して", "タスクごとにワークツリーを作って実装", "複数の作業をワークツリーに分けて", "ワークツリーを切ってタスクを委譲して実行させて", "各タスクを別ワークツリーで自走させて", "この作業をワークツリーで進めて", "worktree-manage", or when Claude Code needs to create, list, delete, or annotate (add a description / メモ to) git worktrees through the dokodemo-claude backend — including the full orchestration of taking one or more tasks, creating a worktree per task, and handing each off to that worktree's AI (via prompt_broadcast) or terminal (via terminal-control) so it runs autonomously (this skill is responsible for creating those worktrees, not raw `git worktree`).
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
> **重要 2: ワークツリーを作るときは原則必ず `description`（説明）を付けること。**
> `worktree_create` の `description` 引数に「このワークツリーで何をするか」を書けば、作成と同時に
> メモが設定され Web UI のタブに表示される。後から `worktree_set_memo` を別途呼ぶ必要はない
> （説明を変更・削除したいときだけ `worktree_set_memo` を使う）。
>
> **重要 3: ワークツリーの「説明」は git の `branch.description`（`git config`）ではなく、必ず
> `worktree_create` の `description` または `worktree_set_memo` に入れること。**
> `git config branch.<name>.description` に書いても dokodemo-claude のレスポンスにも Web UI の
> タブにも一切反映されない。Web UI のタブに表示される「説明 = メモ」はこれらのツール経由のものだけ。
>
> **重要 4: 「ワークツリーを切って対応して／実装して」と指示された場合、作成側の Claude が
> そのまま実装してはいけない。** ワークツリーを作ったら、そのタスクは `prompt_broadcast` で
> 対象ワークツリーの AI（claude / codex）キューへ送信し、**ワークツリー側の AI に実装させる**。
> 作成側 Claude の役割は「ワークツリーを作る」→「作業内容をプロンプトとして対象ワークツリーに
> 投げる」までで、コード変更そのものは行わない。詳しい送信手順は `worktree-prompt` スキルおよび
> 下記「作成したワークツリーへ作業を委譲する」を参照。
>
> **重要 5: このスキルは dokodemo-claude の入力欄（CommandInput）の「Worktree」ボタンからも
> 直接起動される。** ボタンは入力中のプロンプト先頭に `/dokodemo-claude-tools:worktree-manage` を
> 付けて AI キューへ送る。つまりこのスキルは **「タスク本文＋このスキル」という形で呼ばれる**のが
> 標準的な入口。この経路で呼ばれたら、**付随するプロンプト本文＝オーケストレーション対象のタスク**
> として受け取り、確認を挟まず即座に「タスク分解 → ワークツリー作成 → 委譲」を実行する
> （下記「Worktree ボタン経由で呼ばれたときの動作」を参照）。

## 使いどころ

- **dokodemo-claude の「Worktree」ボタン経由で呼ばれたとき**（プロンプト先頭に
  `/dokodemo-claude-tools:worktree-manage` が付いて届く）。本文をタスクとして受け取り、
  下記「Worktree ボタン経由で呼ばれたときの動作」に従って一気通貫でオーケストレーションする。

- 「ワークツリーを作って／一覧／削除して」などの直接的な依頼。
- **「これらのタスクをそれぞれワークツリーを立てて実装して」「ワークツリーを切って対応して」** のように
  分離環境で作業を進める依頼。この場合は **タスクごとに `worktree_create` でワークツリーを 1 つずつ作る**
  （生 `git worktree` は使わない）。ブランチ名は **そのリポジトリの既存規約に合わせる**
  （「ブランチ命名はリポジトリの規約に合わせる」を参照）。**`description` に
  そのタスクの内容（何をするか）を Markdown で必ず書く**。issue/PR の URL が渡されていればリンクとして含める。
  **作成後は自分で実装せず、`prompt_broadcast` でそのタスクを対象ワークツリーの AI キューへ送って委譲する**
  （重要 4／「作成したワークツリーへ作業を委譲する」を参照）。
  タスクが複数あれば **1 タスク = 1 ワークツリー**で、それぞれ別ブランチ・別 description で作り、
  対応するプロンプトを個別に委譲する（1 つに詰め込まない）。
- 作った全ワークツリーで同じコマンド（例: `npm run dev`）をターミナル実行したい場合は、
  `worktree_list` で wtid を集めてから **`terminal-control` スキル**でワークツリーごとに送信する。
  AI（claude/codex）キューへ一斉にプロンプト投入したい場合は **`worktree-prompt` スキル**。

## Worktree ボタン経由で呼ばれたときの動作

dokodemo-claude の「Worktree」ボタンから起動されると、プロンプトは
`/dokodemo-claude-tools:worktree-manage <タスク本文>` の形で届く。この場合は次を**確認を挟まず
一気通貫で**実行する（このスキルの標準的な使い方）。

1. **タスク本文を読み、独立して進められる単位に分解する。** 明確に複数タスク（「A と B をやって」）なら
   **1 タスク = 1 ワークツリー**。単一タスクなら 1 つ。分解に迷う程度の小さな差なら 1 つにまとめてよい。
2. **リポジトリの命名規約に沿ってブランチ名を決める**（下記「ブランチ命名はリポジトリの規約に
   合わせる」）。タスク内容から type と kebab-case の slug を組む。
3. **各タスクを `worktree_create` でワークツリー化**（`description` にタスク内容を Markdown で必ず記載。
   レスポンスの `worktree.wtid` を控える）。
4. **タスクを委譲する**。実装・修正・調査は `prompt_broadcast` で対象 wtid の AI キューへ
   （`includeMain: false`）。`npm run dev` 等の明示コマンドは `terminal-control` でそのワークツリーの
   terminal へ（下記「AI 委譲か terminal 実行かの振り分け」）。**作成側はコードを書かない。**
5. 作成したワークツリー（ブランチ / wtid / 委譲内容）を簡潔に報告して終わる。

> タスク本文が曖昧で分解できない、あるいは委譲先の AI に丸投げできない情報不足がある場合のみ、
> 作成前に不足点を 1 度だけ確認する。それ以外は上記をそのまま進める（`worktree-manage` は
> 「段取りを組んで委譲する」ことがゴールで、作成側が実装まで抱えないのが原則）。

## Prerequisites

- dokodemo-claude のバックエンドが起動していること（MCP サーバがそこへ接続する）
- dokodemo-claude 上で管理されているリポジトリ内で作業していること

## ツール一覧

| 操作 | ツール | 主な引数 |
|------|--------|----------|
| rid 取得 | `repository_id` | `path`（対象リポジトリ内の絶対パス） |
| 一覧 | `worktree_list` | `rid` |
| 作成 | `worktree_create` | `rid`, `branchName`, `description`, `baseBranch?`, `useExistingBranch?`, `syncEntries?` |
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
| `description` | 原則必須 | ワークツリーの説明（= Web UI のタブに表示されるメモ）。**Markdown 表記**で、後からそのワークツリーが何だったかをすぐ思い出せる情報を書く（下記参照）。作成と同時に保存され、別途 `worktree_set_memo` を呼ぶ必要はない |

##### description の書き方（重要）

`description` は **Markdown として表示される**（本文中の URL も自動リンク化）。
タブを見ただけで「このワークツリーが何のためのものか」をすぐ思い出せる内容にすること。

- **そのワークツリーで何をするか**を一行で要約する（例: 見出しや太字で簡潔に）。
- **関連 issue / PR / チケットが渡されている場合は、その URL を必ず含める**
  （`#123` のような番号だけでなく、開けるリンクにする）。
- 仕様・要求のリンク、参照ドキュメントの URL があれば併せて載せる。
- 箇条書きで「やること」を数点書いておくと後から状況を思い出しやすい。

例:

```markdown
**ログイン画面のバリデーション修正**

- Issue: https://github.com/owner/repo/issues/123
- メール形式チェックとエラーメッセージ表示を追加する
- 関連 PR: https://github.com/owner/repo/pull/120
```

issue 等が渡されていない場合でも、最低限「何をするワークツリーか」の要約は必ず書く。

##### ブランチ命名はリポジトリの規約に合わせる（重要）

`branchName` はハードコードせず、**そのリポジトリの既存ブランチの命名パターンを踏襲する**。
`git log --oneline --merges` や `git branch -a` で既存ブランチの prefix を確認してから決める。

- **dokodemo-claude の規約**: `<type>/<kebab-case-slug>` 形式。
  - `feature/…` 新機能 / `fix/…` バグ修正 / `refactor/…` リファクタ / `improve/…` 既存挙動の改善 / `release/…` リリース準備（通常このスキルでは作らない）
  - 例: `feature/project-switcher-fuzzy-search`, `fix/tabbed-panel-xterm-height`
- **他リポジトリ**: そのリポジトリの既存ブランチに倣う（`type/slug` でない流儀のプロジェクトもある）。
  規約が読み取れないときのみ、内容から素直な `feature/…` などを付ける。

タスク内容から type を選び、内容を表す kebab-case の slug を付ける。

| `baseBranch` | 任意 | 新規ブランチの分岐元（省略時は現在の HEAD） |
| `useExistingBranch` | 任意 | 既存ブランチをチェックアウトする場合 `true` |
| `syncEntries` | 任意 | 親から取り込むファイル。例 `[{"path":".env","mode":"copy"}]`（`mode` は `copy` or `link`）。**未指定時は GUI で保存した既定設定が自動適用される**。明示的に「同期なし」にしたい場合は `[]` を渡す |

成功レスポンス（抜粋）:

```json
{
  "success": true,
  "message": "ワークツリー「feature/foo」を作成しました",
  "worktree": { "path": "/.../.dokodemo-worktrees/proj/feature/foo", "branch": "feature/foo", "wtid": "...", "memo": "..." }
}
```

> **説明（用途・目的）は作成時に `description` で渡すのが基本。** これで作成と同時にメモが設定され、
> レスポンスの `worktree.memo` にも反映される。後から説明を変更・削除したいときだけ `worktree_set_memo`
> を使う。git の `branch.description` には絶対に書かない（Web UI に反映されない）。

#### 作成したワークツリーへ作業を委譲する（実装は委譲。自分で実装しない）

「ワークツリーを切って対応して／実装して」と指示された場合、作成側 Claude は **コードを自分で
変更してはいけない**。ワークツリーを作ったら、タスク内容をプロンプトとして対象ワークツリーの
AI キューへ送り、ワークツリー側の AI に実装させる。

1. `worktree_create` のレスポンスから `worktree.wtid` を控える。
2. `prompt_broadcast` を呼び、`targets` に **その wtid だけ**を入れて送信する
   （`rid` は作成時と同じ親 rid、`includeMain: false`）。プロンプトには「何を実装するか」を
   具体的に書く。複数タスクを複数ワークツリーへ分配する場合は、各ワークツリーに対応する
   プロンプトをそれぞれ送る（同一プロンプトを全ワークツリーへ一斉送信したいときは
   `worktree-prompt` スキルを使う）。

```jsonc
// 例: 作成した 1 ワークツリーへタスクを委譲
prompt_broadcast({
  "rid": "<親 rid>",
  "provider": "claude",
  "targets": ["<作成レスポンスの worktree.wtid を逐語コピー>"],
  "includeMain": false,
  "prompt": "ログイン画面にメール形式チェックとエラーメッセージ表示を実装して。完了したらコミットまで。"
})
```

> `prompt_broadcast` の詳細パラメータ（`sendClearBefore` / `isAutoCommit` / `model` 等）と
> `targets` の扱いは **`worktree-prompt` スキル**を参照。`targets` は必ず作成/一覧レスポンスの
> rid(wtid) を逐語コピーすること（手で組むと `unmatchedTargets` に入り黙って送信対象から外れる）。

##### AI 委譲か terminal 実行かの振り分け（重要）

委譲先には 2 系統ある。**取り違えないこと**。

- **実装・修正・調査など「AI に判断・編集させたい作業」** → ワークツリー側の **AI キュー**
  （上記 `prompt_broadcast`）。「実装して、ついでに `npm run check-all` まで通して」のように
  AI が内部でコマンドを回すケースもここ。
- **`npm run dev` / `npm run build` / テスト起動など、ユーザーが明らかにターミナルでの
  コマンド実行を指示したもの** → AI キューではなく **`terminal-control` スキル**で
  **そのワークツリーの terminal** へ送る。`terminal_create` の `rid` に**そのワークツリーの wtid**
  を渡すと cwd がそのワークツリーになる（`terminal_create` → `terminal_input` で `input` に
  コマンド、`enter:true`）。「全ワークツリーで `npm run dev`」は各 wtid についてこれを繰り返す。

| 依頼の中身 | 送り先 | 使うスキル |
|------------|--------|-----------|
| 機能実装 / バグ修正 / リファクタ / コード調査 | ワークツリー側の **AI キュー** | `worktree-prompt`（`prompt_broadcast`） |
| `npm run dev` / dev サーバ起動・ビルド・テストを**そのまま走らせたい** | ワークツリーの **terminal** | `terminal-control` |
| 「実装して、そのついでにチェックまで通して」 | **AI キュー**（AI が内部でコマンド実行） | `worktree-prompt` |

> 基準はシンプル: **「AI に判断・編集させたい」= AI キュー**、
> **「決まったコマンド文字列（`npm run dev` 等）をそのまま実行したい」= terminal**。

#### メモ（説明）

ワークツリーの「説明」は **メモ**として管理され、Web UI のタブに表示される。
**新規作成時は `worktree_create` の `description` で設定するのが基本**。作成後に説明を取得・変更・削除
したい場合のみ `worktree_get_memo` / `worktree_set_memo` に対象 worktree の **wtid**（作成 or 一覧から取得）を渡す。

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

ツールがエラー時は結果に `isError` が付き、メッセージにサーバ側の理由が入る。

| 状況 | 意味 |
|------|------|
| 必須欠落 / git 失敗 / main 削除不可 | 必須引数が欠けている（メモは `memo` が文字列でない） / git 操作が失敗した（理由つき） / main は削除できない |
| 見つからない | rid/wtid に対応するリポジトリ・ワークツリーが見つからない。よくある原因: 手で組み立てた（または取り違えた）存在しない wtid を渡している（→ 作成/一覧レスポンスの値を逐語コピーする） |
| 接続失敗 | dokodemo-claude-api が起動していない / MCP サーバへ接続できない |

## Tips

- **ID は手で組まず、作成・一覧レスポンスの値を逐語コピーして使い回す。** 特に作成直後は
  `worktree.wtid` をその場で控え、続くメモ・削除・プロンプト送信に流用する。これだけで wtid の
  取り違え事故（存在しない wtid を作って 404／別の worktree を操作）はほぼ全て防げる。
- 作成・削除・メモ更新は Web UI のタブに自動反映される（手動リロード不要）。
- **作成時は `description` を必ず付ける。** 作成と同時にメモが設定され、二度手間（作成→`worktree_set_memo`）が不要になる。
- **「説明」は git ではなくメモツールに入れる。** `git config branch.<name>.description` は dokodemo-claude には一切反映されない。
- 既存ブランチをワークツリー化する場合は `useExistingBranch:true` を指定する。指定なしで既存ブランチ名を渡すと git が失敗する。
- 引数の受け渡しなどの低レベルな扱いはすべて MCP サーバ側が処理する。
