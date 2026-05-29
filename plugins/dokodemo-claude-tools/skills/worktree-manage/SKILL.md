---
name: worktree-manage
description: This skill should be used when the user asks to "create/list/delete a worktree", "ワークツリーを作成/一覧/削除", "ワークツリー作って", "ワークツリー一覧", "ワークツリー消して", "ワークツリーに説明/メモを付けて/書いて", "これらのタスクをそれぞれワークツリーを立てて実装して", "タスクごとにワークツリーを作って実装", "複数の作業をワークツリーに分けて", "worktree-manage", or when Claude Code needs to create, list, delete, or annotate (add a description / メモ to) git worktrees through the dokodemo-claude backend API — including when the user asks to implement multiple tasks each in its own worktree (this skill is responsible for creating those worktrees via the API, not raw `git worktree`).
---

# worktree-manage

dokodemo-claude のバックエンド API 経由で git ワークツリーを作成・一覧・削除・メモ更新するスキル。
作成/削除/メモ更新すると Web UI のタブにも自動反映される。

> **重要: ワークツリーの「説明」は git の `branch.description`（`git config`）ではなく、必ず本スキルの
> メモ API（`PUT /api/worktree/:rid/memo`）に入れること。** `git config branch.<name>.description` に
> 書いても dokodemo-claude の API レスポンスにも Web UI のタブにも一切反映されない。Web UI のタブに
> 表示される「説明 = メモ」はこのメモ API 経由のものだけ。

## 使いどころ

- 「ワークツリーを作って／一覧／削除して」などの直接的な依頼。
- **「これらのタスクをそれぞれワークツリーを立てて実装して」** のように複数タスクを分離環境で進める依頼。
  この場合は **タスクごとに本スキルの作成 API でワークツリーを 1 つずつ作る**（生 `git worktree` は使わない）。
  ブランチ名はタスク内容から `feature/xxx` 等を付け、必要なら作成後にメモ（説明）も設定する。
- 作った全ワークツリーで同じコマンド（例: `npm run dev`）をターミナル実行したい場合は、
  本スキルの一覧で wtid を集めてから **`terminal-control` スキル**でワークツリーごとに送信する。
  AI（claude/codex）キューへ一斉にプロンプト投入したい場合は **`worktree-prompt` スキル**。

## Prerequisites

- dokodemo-claude のバックエンドが起動していること
- dokodemo-claude 上で管理されているリポジトリ内で作業していること

## API の基本情報

| 項目 | 値 |
|------|-----|
| ベースURL | 環境変数 `DOKODEMO_API_BASE_URL`（dokodemo が Claude/ターミナル起動時に注入） |
| プロトコル | 通常は **HTTPS**（自己署名証明書） |
| 認証 | なし（ローカル専用） |

> HTTPS の自己署名証明書を使うため、curl では `-k`（`--insecure`）が必要。
>
> `DOKODEMO_API_BASE_URL` は dokodemo-claude から起動された Claude/ターミナルにのみ自動でセットされる。
> 未設定の場合は dokodemo-claude 本体の `.env`（既定パス `~/dokodemo-claude/.env` 等）の `DC_API_PORT` と `DC_USE_HTTPS` から組み立てるか、ユーザーに直接聞く。**作業ディレクトリの `.env` は別プロジェクトの設定なので参照しない。**

| 操作 | メソッド/パス | body |
|------|---------------|------|
| 一覧 | `GET /api/worktrees/:rid` | — |
| 作成 | `POST /api/worktree/:rid` | `{branchName, baseBranch?, useExistingBranch?, syncEntries?}` |
| 削除 | `DELETE /api/worktree/:rid` | `{deleteBranch?}`（:rid は対象 worktree の wtid） |
| メモ取得 | `GET /api/worktree/:rid/memo` | —（:rid は対象 worktree の wtid） |
| メモ更新 | `PUT /api/worktree/:rid/memo` | `{memo}`（:rid は対象 worktree の wtid） |

> 作成・一覧の `:rid` は親でも worktree でも可（サーバが親リポジトリへ正規化する）。
> 削除・メモ取得/更新の `:rid` は **対象 worktree の wtid**。親 rid を渡すと 404/400 になる。
>
> **`rid` は `wt:reponame/feature/foo` のように `:` や `/` を含む**。URLパスに埋め込む前に必ずエンコードすること（下記参照）。

## クイック実行

```bash
API="${DOKODEMO_API_BASE_URL:?dokodemo-claude から起動されていないため未設定。ユーザーに API のURLを確認してください}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')

# 一覧
curl -sk "${API}/api/worktrees/${RID_ENC}" | jq

# 作成（作成レスポンスの worktree.wtid を控える）
WTID=$(curl -sk -X POST "${API}/api/worktree/${RID_ENC}" \
  -H "Content-Type: application/json" \
  -d '{"branchName":"feature/foo","baseBranch":"main"}' | jq -r '.worktree.wtid')

# メモ（= Web UI に表示される説明）を設定。日本語は jq -n --arg で安全に組み立てる
WTID_ENC=$(jq -rn --arg r "$WTID" '$r|@uri')
curl -sk -X PUT "${API}/api/worktree/${WTID_ENC}/memo" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg memo "新機能 foo の実験用ワークツリー" '{memo:$memo}')" | jq

# 削除（WTID は一覧 or 作成レスポンスの wtid。これも encode する）
WTID_ENC=$(jq -rn --arg r "$WTID" '$r|@uri')
curl -sk -X DELETE "${API}/api/worktree/${WTID_ENC}" \
  -H "Content-Type: application/json" \
  -d '{"deleteBranch":false}' | jq
```

## ワークフロー

### Step 1: API ベースURLを取得する

```bash
API="${DOKODEMO_API_BASE_URL}"
```

dokodemo-claude から起動された Claude/ターミナルでは自動で設定される。
未設定の場合のフォールバック手順:

1. dokodemo-claude 本体の `.env`（例: `~/dokodemo-claude/.env`）から `DC_API_PORT` と `DC_USE_HTTPS` を読む
2. `DC_USE_HTTPS=false` でなければ HTTPS、それ以外は HTTP
3. URL は `https://localhost:${DC_API_PORT}`（既定 `8001`）
4. それでも分からなければユーザーに直接聞く

### Step 2: Repository ID を取得して URL エンコードする

```bash
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')
```

ワークツリー内で実行していても問題ない。サーバ側で親リポジトリへ正規化される。
`rid` は `wt:proj/feature/foo` のように `/` を含むため、`@uri` で encode してから URL パスに埋め込む。

### Step 3: 操作を実行する

#### 作成

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `branchName` | 必須 | 作成するブランチ名（= ワークツリー名） |
| `baseBranch` | 任意 | 新規ブランチの分岐元（省略時は現在の HEAD） |
| `useExistingBranch` | 任意 | 既存ブランチをチェックアウトする場合 `true` |
| `syncEntries` | 任意 | 親から取り込むファイル。例 `[{"path":".env","mode":"copy"}]`（`mode` は `copy` or `link`）。**未指定時は GUI で保存した既定設定が自動適用される**。明示的に「同期なし」にしたい場合は `[]` を渡す |

```bash
curl -sk -X POST "${API}/api/worktree/${RID_ENC}" \
  -H "Content-Type: application/json" \
  -d '{"branchName":"feature/foo","baseBranch":"main","syncEntries":[{"path":".env","mode":"copy"}]}' | jq
```

成功時 (HTTP 201):

```json
{
  "success": true,
  "message": "ワークツリー「feature/foo」を作成しました",
  "worktree": { "path": "/.../.dokodemo-worktrees/proj/feature/foo", "branch": "feature/foo", "wtid": "..." }
}
```

> **作成時に説明（用途・目的など）を求められたら**、レスポンスの `worktree.wtid` を控え、続けて
> 下記「メモ（説明）」の `PUT /api/worktree/:rid/memo` を実行して説明を設定する。git の
> `branch.description` には絶対に書かない（Web UI に反映されない）。

#### メモ（説明）

ワークツリーの「説明」は **メモ**として管理され、Web UI のタブに表示される。`:rid` は
対象 worktree の **wtid**（作成レスポンス or 一覧から取得）。wtid は `/` を含むので encode する。

```bash
WTID_ENC=$(jq -rn --arg r "$WTID" '$r|@uri')

# メモ取得
curl -sk "${API}/api/worktree/${WTID_ENC}/memo" | jq

# メモ更新（説明をセット）。日本語は jq -n --arg でエスケープ事故を防ぐ
curl -sk -X PUT "${API}/api/worktree/${WTID_ENC}/memo" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg memo "GLPower の実験用サンドボックス。master を汚さず補間関数等を試す隔離環境。" '{memo:$memo}')" | jq
```

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `memo` | 必須 | 説明本文（自由記述の文字列）。本文中の URL は Web UI 表示時に自動リンク化される。**空文字を渡すとメモ削除**（残骸を残さない）。保存時に前後の空白は trim される |

成功時 (HTTP 200): `{ "success": true, "rid": "...", "memo": "保存された本文" }`

#### 一覧

```bash
curl -sk "${API}/api/worktrees/${RID_ENC}" | jq
```

main リポジトリと各 worktree が `rid` 付きで返る（main は prid、worktree は wtid）。

#### 削除

削除には対象 worktree の **wtid** を使う（一覧 or 作成レスポンスから取得）。wtid も `/` を含むので encode する。

```bash
WTID_ENC=$(jq -rn --arg r "$WTID" '$r|@uri')
curl -sk -X DELETE "${API}/api/worktree/${WTID_ENC}" \
  -H "Content-Type: application/json" \
  -d '{"deleteBranch":true}' | jq
```

`deleteBranch:true` でワークツリーに紐づくブランチも削除する（既定 `false`）。

## エラーハンドリング

| HTTP ステータス | 意味 |
|----------------|------|
| 200 / 201 | 成功 |
| 400 | 必須欠落（メモは `memo` が文字列でない） / git 失敗（`message` に git stderr 等の理由） / main 削除不可 |
| 404 | rid に対応するリポジトリ・ワークツリーが見つからない（多くは rid を encode せず `/` で path が割れているケース） |
| 500 | サーバーエラー |

## Tips

- 作成・削除・メモ更新は Web UI のタブに自動反映される（手動リロード不要）。
- **「説明」は git ではなくメモ API に入れる。** `git config branch.<name>.description` は dokodemo-claude には一切反映されない。Web UI に出したい説明は必ず `PUT /api/worktree/:rid/memo`。
- 既存ブランチをワークツリー化する場合は `useExistingBranch:true` を指定する。指定なしで既存ブランチ名を渡すと git が失敗し 400（`message` に理由）。
- 自己署名証明書のため curl では `-k` を必ず付ける。HTTP ではなく **HTTPS**。
- `rid`/`wtid` は必ず `@uri` で URL エンコードしてからパスに埋め込むこと。`jq parse error` や 404 が返ったらこれを疑う。
- 日本語のメモを `-d` でインライン指定するときは `jq -n --arg memo "..." '{memo:$memo}'` で組み立てるとエスケープ事故が起きにくい。
