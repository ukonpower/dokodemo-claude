---
name: terminal-control
description: This skill should be used when the user asks to "create a terminal", "run a command in a terminal", "ターミナルを作成", "ターミナルでコマンド実行", "ターミナルの出力を取得", "全ワークツリーで〜を実行して", "全てのワークツリーで npm run dev して", "各ワークツリーでコマンドを実行", "terminal-control", or when Claude Code needs to create, send input to, read output from, or close interactive terminals (PTY) through the dokodemo-claude backend API — including running the same command across every worktree's terminal.
---

# terminal-control

dokodemo-claude のバックエンド API 経由で、インタラクティブターミナル（PTY）を
作成・コマンド送信・出力取得・一覧・終了するスキル。作成したターミナルは Web UI のタブにも自動反映される。

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

| 操作 | メソッド/パス | body / param |
|------|---------------|--------------|
| 一覧 | `GET /api/terminals/:rid` | — |
| 作成 | `POST /api/terminals/:rid` | `{name?, cols?, rows?}` |
| 入力送信 | `POST /api/terminals/:terminalId/input` | `{input, enter?}` |
| シグナル送信 | `POST /api/terminals/:terminalId/signal` | `{signal}` |
| リサイズ | `POST /api/terminals/:terminalId/resize` | `{cols, rows}` |
| 終了 | `POST /api/terminals/:terminalId/close` | — |
| 出力取得 | `GET /api/terminals/:terminalId/output` | `?strip=true`（ANSI 除去） |

> 作成・一覧は **rid** をキーにする。**rid には main リポジトリの prid だけでなく、ワークツリーの wtid も使える**（wtid を渡すとそのワークツリーのディレクトリでターミナルが開く）。入力・出力・終了・シグナル・リサイズは **terminalId** をキーにする。
> `rid`/`wtid` は `wt:proj/feature/foo` のように `:` や `/` を含むため、URL パスに埋め込む前に `@uri` で必ずエンコードする。

## クイック実行

```bash
API="${DOKODEMO_API_BASE_URL:?dokodemo-claude から起動されていないため未設定。ユーザーに API のURLを確認してください}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')

# 作成
TID=$(curl -sk -X POST "${API}/api/terminals/${RID_ENC}" \
  -H "Content-Type: application/json" -d '{"name":"build"}' | jq -r '.terminal.id')

# コマンド送信（enter:true で実行）
curl -sk -X POST "${API}/api/terminals/${TID}/input" \
  -H "Content-Type: application/json" -d '{"input":"npm run build","enter":true}'

# 出力が揃うまで少し待つ
sleep 3

# 出力取得（ANSI 除去）
curl -sk "${API}/api/terminals/${TID}/output?strip=true" | jq -r '.output'
```

## ワークフロー

### Step 1: API ベースURLと rid を取得する

```bash
API="${DOKODEMO_API_BASE_URL}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')
```

`API` が未設定の場合は dokodemo-claude 本体の `.env` から `DC_API_PORT`（既定 `8001`）と `DC_USE_HTTPS` を読んで `https://localhost:${DC_API_PORT}` を組み立てる。**作業ディレクトリの `.env` は別プロジェクトの設定なので参照しない。**

### Step 2: ターミナルを作成する

```bash
TID=$(curl -sk -X POST "${API}/api/terminals/${RID_ENC}" \
  -H "Content-Type: application/json" -d '{"name":"build"}' | jq -r '.terminal.id')
```

作成と同時に Web UI にタブが追加される。`RID_ENC` にワークツリーの wtid を使えば、そのワークツリー内でターミナルが開く。

### Step 3: コマンドを送信する

`enter:true` を付けると入力末尾に改行（`\r`）が付与され、コマンドが実行される。

```bash
curl -sk -X POST "${API}/api/terminals/${TID}/input" \
  -H "Content-Type: application/json" -d '{"input":"npm run build","enter":true}'
```

### Step 4: 出力を取得する（結果確認）

PTY 出力は非同期。**送信 → 数秒待つ → `/output` 取得** の順で結果を確認する。
長時間かかるコマンドは待ち時間を延ばすか、間隔を空けて複数回 `/output` を取得する。

```bash
sleep 3
curl -sk "${API}/api/terminals/${TID}/output?strip=true" | jq -r '.output'
```

`?strip=true` で ANSI エスケープを除去した読みやすい文字列が得られる。省略すると生の出力（ANSI 含む）。

### その他の操作

```bash
# 一覧
curl -sk "${API}/api/terminals/${RID_ENC}" | jq '.terminals'

# シグナル送信（例: Ctrl-C 相当の中断）
curl -sk -X POST "${API}/api/terminals/${TID}/signal" \
  -H "Content-Type: application/json" -d '{"signal":"SIGINT"}'

# リサイズ
curl -sk -X POST "${API}/api/terminals/${TID}/resize" \
  -H "Content-Type: application/json" -d '{"cols":120,"rows":40}'

# 終了
curl -sk -X POST "${API}/api/terminals/${TID}/close"
```

## 全ワークツリーで同じコマンドを実行する

「全てのワークツリーで `npm run dev` して」のような依頼では、worktree 一覧から各 **wtid** を取り、
ワークツリーごとにターミナルを作成してコマンドを送信する（`npm run dev` のような常駐プロセスでも、
PTY なので各タブで動き続ける）。

```bash
API="${DOKODEMO_API_BASE_URL}"
RID=$(curl -sk "${API}/api/repository-id?path=$(pwd)" | jq -r '.rid')
RID_ENC=$(jq -rn --arg r "$RID" '$r|@uri')
CMD="npm run dev"

# worktree 一覧から wtid を取得（main を除外。main も含めたいなら select を外す）
WTIDS=$(curl -sk "${API}/api/worktrees/${RID_ENC}" \
  | jq -r '.worktrees[] | select(.isMain | not) | .wtid')

for WT in $WTIDS; do
  WT_ENC=$(jq -rn --arg r "$WT" '$r|@uri')
  TID=$(curl -sk -X POST "${API}/api/terminals/${WT_ENC}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg name "dev" '{name:$name}')" | jq -r '.terminal.id')
  curl -sk -X POST "${API}/api/terminals/${TID}/input" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg cmd "$CMD" '{input:$cmd, enter:true}')" >/dev/null
  echo "sent to ${WT} (terminal ${TID})"
done
```

> 各要素は `isMain`（main worktree か）と `wtid` を持つ。上記は main を除いた全ワークツリーへ送る例。
> `npm run dev` のような常駐コマンドの出力確認は「数秒待ってから `/output`」で起動ログを取得する（プロセスは終了しない）。

## エラーハンドリング

| HTTP ステータス | 意味 |
|----------------|------|
| 200 / 201 | 成功 |
| 400 | 必須パラメータ欠落（`input` / `signal` / `cols,rows`） |
| 404 | rid またはterminalId が見つからない／既に終了している |
| 500 | サーバーエラー |

## Tips

- 作成・出力ストリーム・終了は Web UI のタブに自動反映される。
- コマンド実行は `input` + `enter:true`。`enter` を省くと改行なしで文字だけ送られる。
- 出力取得は「送信 → 待つ → 取得」。完了検知は API では行わないため、必要に応じて間隔をおいて複数回取得する。
- **ワークツリーで実行したいときは、作成 API の rid にそのワークツリーの wtid を渡す**（cwd がワークツリーになる）。「全ワークツリーで〜」は wtid をループ。
- `rid`/`wtid` は必ず `@uri` で URL エンコードしてからパスに埋め込む（`:` や `/` を含むため）。
- 自己署名証明書のため curl では `-k` を必ず付ける。HTTP ではなく **HTTPS**。
