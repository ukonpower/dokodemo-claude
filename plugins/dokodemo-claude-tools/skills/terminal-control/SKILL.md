---
name: terminal-control
description: This skill should be used when the user asks to "create a terminal", "run a command in a terminal", "ターミナルを作成", "ターミナルでコマンド実行", "ターミナルの出力を取得", "terminal-control", or when Claude Code needs to create, send input to, read output from, or close interactive terminals (PTY) through the dokodemo-claude backend API.
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
| プロトコル | **HTTPS**（自己署名証明書を使用） |
| ホスト | `localhost` |
| ポート | `.env` の `DC_API_PORT`（既定 `8101`） |
| 認証 | なし（ローカル専用） |

| 操作 | メソッド/パス | body / param |
|------|---------------|--------------|
| 一覧 | `GET /api/terminals/:rid` | — |
| 作成 | `POST /api/terminals/:rid` | `{name?, cols?, rows?}` |
| 入力送信 | `POST /api/terminals/:terminalId/input` | `{input, enter?}` |
| シグナル送信 | `POST /api/terminals/:terminalId/signal` | `{signal}` |
| リサイズ | `POST /api/terminals/:terminalId/resize` | `{cols, rows}` |
| 終了 | `POST /api/terminals/:terminalId/close` | — |
| 出力取得 | `GET /api/terminals/:terminalId/output` | `?strip=true`（ANSI 除去） |

> 作成・一覧は **rid**（リポジトリ）をキーにする。入力・出力・終了・シグナル・リサイズは **terminalId** をキーにする。
> HTTPS の自己署名証明書を使うため、curl では `-k`（`--insecure`）が必要。

## クイック実行

```bash
API_PORT=$(grep '^DC_API_PORT=' .env | cut -d= -f2)
RID=$(curl -sk "https://localhost:${API_PORT}/api/repository-id?path=$(pwd)" | jq -r '.rid')

# 作成
TID=$(curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${RID}" \
  -H "Content-Type: application/json" -d '{"name":"build"}' | jq -r '.terminal.id')

# コマンド送信（enter:true で実行）
curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${TID}/input" \
  -H "Content-Type: application/json" -d '{"input":"npm run build","enter":true}'

# 出力が揃うまで少し待つ
sleep 3

# 出力取得（ANSI 除去）
curl -sk "https://localhost:${API_PORT}/api/terminals/${TID}/output?strip=true" | jq -r '.output'
```

## ワークフロー

### Step 1: ポートと rid を取得する

```bash
API_PORT=$(grep '^DC_API_PORT=' .env | cut -d= -f2)
RID=$(curl -sk "https://localhost:${API_PORT}/api/repository-id?path=$(pwd)" | jq -r '.rid')
```

### Step 2: ターミナルを作成する

```bash
TID=$(curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${RID}" \
  -H "Content-Type: application/json" -d '{"name":"build"}' | jq -r '.terminal.id')
```

作成と同時に Web UI にタブが追加される。

### Step 3: コマンドを送信する

`enter:true` を付けると入力末尾に改行（`\r`）が付与され、コマンドが実行される。

```bash
curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${TID}/input" \
  -H "Content-Type: application/json" -d '{"input":"npm run build","enter":true}'
```

### Step 4: 出力を取得する（結果確認）

PTY 出力は非同期。**送信 → 数秒待つ → `/output` 取得** の順で結果を確認する。
長時間かかるコマンドは待ち時間を延ばすか、間隔を空けて複数回 `/output` を取得する。

```bash
sleep 3
curl -sk "https://localhost:${API_PORT}/api/terminals/${TID}/output?strip=true" | jq -r '.output'
```

`?strip=true` で ANSI エスケープを除去した読みやすい文字列が得られる。省略すると生の出力（ANSI 含む）。

### その他の操作

```bash
# 一覧
curl -sk "https://localhost:${API_PORT}/api/terminals/${RID}" | jq '.terminals'

# シグナル送信（例: Ctrl-C 相当の中断）
curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${TID}/signal" \
  -H "Content-Type: application/json" -d '{"signal":"SIGINT"}'

# リサイズ
curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${TID}/resize" \
  -H "Content-Type: application/json" -d '{"cols":120,"rows":40}'

# 終了
curl -sk -X POST "https://localhost:${API_PORT}/api/terminals/${TID}/close"
```

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
- 自己署名証明書のため curl では `-k` を必ず付ける。HTTP ではなく **HTTPS**。
