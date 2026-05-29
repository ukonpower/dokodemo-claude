---
name: worktree-prompt
description: This skill should be used when the user asks to "broadcast a prompt to all worktrees", "全ワークツリーにプロンプト送信", "各ワークツリーに一斉送信", "ワークツリーにまとめて指示", "broadcast prompt", "worktree-prompt", or when Claude Code needs to send the same prompt to multiple git worktrees' AI queues at once through the dokodemo-claude backend API.
---

# worktree-prompt

dokodemo-claude のバックエンド API 経由で、親リポジトリ配下の全（または指定）ワークツリーへ
同一プロンプトを一斉にキュー投入するスキル。各ワークツリーの AI（claude / codex）キューに追加される。

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
| 対象一覧 | `GET /api/worktrees/:rid` | — |
| 一斉送信 | `POST /api/prompt/broadcast` | `{rid, provider, prompt, targets?, includeMain?, sendClearBefore?, isAutoCommit?, model?}` |

> `:rid` はURLパスに埋め込むため `@uri` で必ずエンコードする（`rid` は `wt:proj/feature/foo` のように `:` や `/` を含む）。
> 一方 `/api/prompt/broadcast` は `rid` を JSON body で渡すのでエンコード不要。

## クイック実行

```bash
API="${DOKODEMO_API_BASE_URL:?dokodemo-claude から起動されていないため未設定。ユーザーに API のURLを確認してください}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')

# 全ワークツリーへ一斉送信（claude provider）
curl -sk -X POST "${API}/api/prompt/broadcast" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg rid "$RID" --arg prompt "テストを実行して" \
        '{rid:$rid, provider:"claude", prompt:$prompt}')" | jq
```

## ワークフロー

### Step 1: API ベースURLと rid を取得する

```bash
API="${DOKODEMO_API_BASE_URL}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
```

dokodemo-claude から起動された Claude/ターミナルでは `DOKODEMO_API_BASE_URL` が自動で設定される。
未設定の場合は dokodemo-claude 本体の `.env` から `DC_API_PORT`（既定 `8001`）と `DC_USE_HTTPS` を読んで組み立てる。

ワークツリー内で実行していても問題ない（サーバが親へ正規化する）。

### Step 2: 送信対象を確認する（任意）

```bash
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')
curl -sk "${API}/api/worktrees/${RID_ENC}" | jq '.worktrees'
```

各 worktree の `rid`（wtid）が分かる。特定のワークツリーだけに送りたい場合は `targets` で指定する。
※`rid` はパスに `/` を含むため、URLに埋め込むときは `@uri` で encode する。

### Step 3: 一斉送信する

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

```bash
# 全ワークツリー（main を除く）へ送信
curl -sk -X POST "${API}/api/prompt/broadcast" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg rid "$RID" --arg prompt "npm run lint を通して" \
        '{rid:$rid, provider:"claude", prompt:$prompt}')" | jq

# 対象を絞って送信（main も含める）
curl -sk -X POST "${API}/api/prompt/broadcast" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg rid "$RID" --arg prompt "..." --argjson targets '["wtid1","wtid2"]' \
        '{rid:$rid, provider:"claude", prompt:$prompt, targets:$targets, includeMain:true}')" | jq
```

成功時 (HTTP 200):

```json
{
  "success": true,
  "sent": 2,
  "results": [
    { "path": "/.../wt-a", "rid": "...", "success": true, "itemId": "..." },
    { "path": "/.../wt-b", "rid": "...", "success": false, "message": "..." }
  ]
}
```

`results` に各ワークツリーへの投入結果が並ぶ（部分成功を許容）。投入されたプロンプトは
各ワークツリーのキュー処理で順次 AI へ送られ、Web UI のキュー表示にも自動反映される。

## エラーハンドリング

| HTTP ステータス | 意味 |
|----------------|------|
| 200 | 送信処理完了（`results` で個別結果を確認） |
| 400 | `rid` / `provider` / `prompt` のいずれか欠落 |
| 404 | rid に対応するリポジトリが見つからない |
| 500 | サーバーエラー |

## Tips

- このスキルは **キュー投入まで**。実際に AI へ送られるのは既存のキュー処理に委ねられる。
- 一部のワークツリーで投入に失敗しても全体は 200 で返る。`results` の各要素で成否を確認すること。
- 日本語プロンプトを `-d` でインライン指定するときは JSON 文字列のエスケープに注意。`jq -n --arg` で組み立てるとエスケープ事故が起きにくい。
- 自己署名証明書のため curl では `-k` を必ず付ける。
- `:rid` をパスに埋め込む API（`/api/worktrees/:rid` 等）では `jq -rn --arg r "$RID" '$r|@uri'` で URL エンコードする。`/api/prompt/broadcast` は body 渡しなので不要。
