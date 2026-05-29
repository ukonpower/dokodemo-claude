---
name: worktree-manage
description: This skill should be used when the user asks to "create/list/delete a worktree", "ワークツリーを作成/一覧/削除", "ワークツリー作って", "ワークツリー一覧", "ワークツリー消して", "worktree-manage", or when Claude Code needs to create, list, or delete git worktrees through the dokodemo-claude backend API.
---

# worktree-manage

dokodemo-claude のバックエンド API 経由で git ワークツリーを作成・一覧・削除するスキル。
作成/削除すると Web UI のタブにも自動反映される。

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

> 作成・一覧の `:rid` は親でも worktree でも可（サーバが親リポジトリへ正規化する）。
> 削除の `:rid` は **削除対象 worktree の wtid**。親 rid を渡すと 400 になる。
>
> **`rid` は `wt:reponame/feature/foo` のように `:` や `/` を含む**。URLパスに埋め込む前に必ずエンコードすること（下記参照）。

## クイック実行

```bash
API="${DOKODEMO_API_BASE_URL:?dokodemo-claude から起動されていないため未設定。ユーザーに API のURLを確認してください}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')

# 一覧
curl -sk "${API}/api/worktrees/${RID_ENC}" | jq

# 作成
curl -sk -X POST "${API}/api/worktree/${RID_ENC}" \
  -H "Content-Type: application/json" \
  -d '{"branchName":"feature/foo","baseBranch":"main"}' | jq

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
| `syncEntries` | 任意 | 親から取り込むファイル。例 `[{"path":".env","mode":"copy"}]`（`mode` は `copy` or `link`） |

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
| 400 | 必須欠落 / git 失敗（`message` に git stderr 等の理由） / main 削除不可 |
| 404 | rid に対応するリポジトリが見つからない（多くは rid を encode せず `/` で path が割れているケース） |
| 500 | サーバーエラー |

## Tips

- 作成・削除は Web UI のタブに自動反映される（手動リロード不要）。
- 既存ブランチをワークツリー化する場合は `useExistingBranch:true` を指定する。指定なしで既存ブランチ名を渡すと git が失敗し 400（`message` に理由）。
- 自己署名証明書のため curl では `-k` を必ず付ける。HTTP ではなく **HTTPS**。
- `rid`/`wtid` は必ず `@uri` で URL エンコードしてからパスに埋め込むこと。`jq parse error` や 404 が返ったらこれを疑う。
