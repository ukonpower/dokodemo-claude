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
| プロトコル | **HTTPS**（自己署名証明書を使用） |
| ホスト | `localhost` |
| ポート | `.env` の `DC_API_PORT`（既定 `8101`） |
| 認証 | なし（ローカル専用） |

> HTTPS の自己署名証明書を使うため、curl では `-k`（`--insecure`）が必要。

| 操作 | メソッド/パス | body |
|------|---------------|------|
| 一覧 | `GET /api/worktrees/:rid` | — |
| 作成 | `POST /api/worktree/:rid` | `{branchName, baseBranch?, useExistingBranch?, syncEntries?}` |
| 削除 | `DELETE /api/worktree/:rid` | `{deleteBranch?}`（:rid は対象 worktree の wtid） |

> 作成・一覧の `:rid` は親でも worktree でも可（サーバが親リポジトリへ正規化する）。
> 削除の `:rid` は **削除対象 worktree の wtid**。親 rid を渡すと 400 になる。

## クイック実行

```bash
API_PORT=$(grep '^DC_API_PORT=' .env | cut -d= -f2)
RID=$(curl -sk "https://localhost:${API_PORT}/api/repository-id?path=$(pwd)" | jq -r '.rid')

# 一覧
curl -sk "https://localhost:${API_PORT}/api/worktrees/${RID}" | jq

# 作成
curl -sk -X POST "https://localhost:${API_PORT}/api/worktree/${RID}" \
  -H "Content-Type: application/json" \
  -d '{"branchName":"feature/foo","baseBranch":"main"}' | jq

# 削除（WTID は一覧 or 作成レスポンスの wtid）
curl -sk -X DELETE "https://localhost:${API_PORT}/api/worktree/${WTID}" \
  -H "Content-Type: application/json" \
  -d '{"deleteBranch":false}' | jq
```

## ワークフロー

### Step 1: API のポートを取得する

```bash
API_PORT=$(grep '^DC_API_PORT=' .env | cut -d= -f2)
```

ユーザーから直接ポートを聞いてもよい（既定 8101）。

### Step 2: Repository ID を取得する

```bash
RID=$(curl -sk "https://localhost:${API_PORT}/api/repository-id?path=$(pwd)" | jq -r '.rid')
```

ワークツリー内で実行していても問題ない。サーバ側で親リポジトリへ正規化される。

### Step 3: 操作を実行する

#### 作成

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `branchName` | 必須 | 作成するブランチ名（= ワークツリー名） |
| `baseBranch` | 任意 | 新規ブランチの分岐元（省略時は現在の HEAD） |
| `useExistingBranch` | 任意 | 既存ブランチをチェックアウトする場合 `true` |
| `syncEntries` | 任意 | 親から取り込むファイル。例 `[{"path":".env","mode":"copy"}]`（`mode` は `copy` or `link`） |

```bash
curl -sk -X POST "https://localhost:${API_PORT}/api/worktree/${RID}" \
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
curl -sk "https://localhost:${API_PORT}/api/worktrees/${RID}" | jq
```

main リポジトリと各 worktree が `rid` 付きで返る（main は prid、worktree は wtid）。

#### 削除

削除には対象 worktree の **wtid** を使う（一覧 or 作成レスポンスから取得）。

```bash
curl -sk -X DELETE "https://localhost:${API_PORT}/api/worktree/${WTID}" \
  -H "Content-Type: application/json" \
  -d '{"deleteBranch":true}' | jq
```

`deleteBranch:true` でワークツリーに紐づくブランチも削除する（既定 `false`）。

## エラーハンドリング

| HTTP ステータス | 意味 |
|----------------|------|
| 200 / 201 | 成功 |
| 400 | 必須欠落 / git 失敗（`message` に git stderr 等の理由） / main 削除不可 |
| 404 | rid に対応するリポジトリが見つからない |
| 500 | サーバーエラー |

## Tips

- 作成・削除は Web UI のタブに自動反映される（手動リロード不要）。
- 既存ブランチをワークツリー化する場合は `useExistingBranch:true` を指定する。指定なしで既存ブランチ名を渡すと git が失敗し 400（`message` に理由）。
- 自己署名証明書のため curl では `-k` を必ず付ける。HTTP ではなく **HTTPS**。
