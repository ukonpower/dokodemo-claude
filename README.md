<p align="center">
  <img src="./docs/icon.png" alt="dokodemo-claude icon" width="128" height="128">
</p>

# dokodemo-claude

Claude Code / Codex を Web ブラウザから操作するツール。スマホからでも、どこからでも（dokodemo）、自宅 PC 上の AI CLI 作業を継続できます。

![dokodemo-claude screenshot](./docs/screenshot-terminal.png)

## 機能

- Claude Code / Codex CLI をブラウザから対話操作
- インタラクティブターミナル（複数タブ）
- Git worktree 管理・ブランチ切替・diff 表示・ファイル閲覧
- 起動済みiOSシミュレータの画面表示・タップ・スワイプ操作（macOS）
- プロンプトキュー（`/clear` `/commit` プレフィックス付与・自走キュー）
- PWA / Web Push 通知（iOS Safari 対応）

## 動作環境

| 依存 | 備考 |
|------|------|
| Node.js 22 以上 | `volta.node: 22.17.0` を参考 |
| [Claude Code CLI](https://docs.anthropic.com/claude-code) または [Codex CLI](https://github.com/openai/codex) | |
| Git | |
| ビルドツール | macOS: Xcode Command Line Tools / Linux: build-essential（node-pty 用） |
| `jq` | hook 連携用。`npm run setup` で自動インストール試行 |

## セットアップ

```bash
git clone <このリポジトリ>
cd dokodemo-claude
npm run setup   # 依存 install + .env 生成 + jq チェック
npm run start
```

ブラウザで https://localhost:8000 を開きます。ポートを変えるときは `.env` の `DC_PROD_PORT` を編集してください。

UI 右上の「更新」ボタンで `git pull` を実行すると、ソース変更は自動で反映されます（手動リロード不要、反映まで数十秒）。

## HTTPS

モバイルから PWA / Web Push を使うには HTTPS が必要です。[mkcert](https://github.com/FiloSottile/mkcert) で証明書を作成し、`.env` にパスを書きます。

```bash
mkcert -install
mkcert -cert-file /path/to/server.crt -key-file /path/to/server.key localhost
```

```env
DC_HTTPS_CERT_PATH=/path/to/server.crt
DC_HTTPS_KEY_PATH=/path/to/server.key
```

HTTPS が不要なら `DC_USE_HTTPS=false` で HTTP 起動できます。

## Hook 連携

プロンプトキューの自走機能を使うには AI CLI 側に hook を登録します。**設定モーダルの「hooks を追加」ボタンから自動登録できます**（手動編集不要）。

登録される hook:

| 項目 | 内容 |
|------|------|
| エンドポイント | `POST /hook/claude-event`（Codex は `/hook/codex-event`） |
| イベント | `Stop`, `UserPromptSubmit`, `PermissionRequest` |

## Web Push 通知

AI セッションの完了や権限要求などをプッシュ通知します。設定モーダルから購読・テスト送信できます。

- HTTPS 起動が必要
- VAPID 鍵は初回起動時に自動生成（`processes/web-push-vapid.json`）
- iOS Safari は「ホーム画面に追加」して PWA として起動した場合のみ通知が届きます

## iOSシミュレータ

画面右下の「iOS Simulator」パネルから、ホストMac上ですでに起動しているiOSシミュレータを表示できます。パネルを開いている間だけ画面を取得し、閉じるとポーリングを停止します。パネルからシミュレータを新規bootすることはありません。

タップ・スワイプ操作には [idb](https://fbidb.io/) が必要です。

```bash
brew install idb-companion
pipx install fb-idb
```

`idb` が見つからない場合も画面表示と手動更新は利用できます。通信量はパネル内の `fps`、`size`、`quality` で調整してください。`live` を切ると自動更新を止め、更新ボタンで1枚だけ取得できます。

## `.env` リファレンス

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DC_PROD_PORT` | `8000` | Web UI + API の公開ポート |
| `DC_HOST` | `0.0.0.0` | バインドホスト（`127.0.0.1` でローカル限定） |
| `DC_USE_HTTPS` | `true` | `false` で HTTP 起動 |
| `DC_HTTPS_CERT_PATH` | — | TLS 証明書ファイルの絶対パス |
| `DC_HTTPS_KEY_PATH` | — | TLS 秘密鍵ファイルの絶対パス |
| `DC_HTTPS_ROOT_CA_PATH` | — | ルート CA（任意。`/api/cert` で配信） |
| `DC_REPOSITORIES_DIR` | `repositories` | リポジトリ保存先（相対: backend ディレクトリ基準） |
| `DC_VAPID_CONTACT` | — | Web Push 用連絡先メール（Safari 対応時に設定） |

## 注意事項

- **認証機構はありません**。公開ネットワークに直接公開しないでください。信頼できる LAN 内か、`DC_HOST=127.0.0.1` でローカル限定運用してください。
- 接続したクライアントは PTY 経由で任意のシェルコマンドを実行できます。**外部公開厳禁**。
- 本プロジェクトは Anthropic / OpenAI の公式ツールではありません。

## 開発者向け

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| モノレポ | [Nx](https://nx.dev) 22.3.3 |
| フロントエンド | React 19 + Vite + SCSS |
| バックエンド | Node.js + Express + TypeScript |
| 通信 | WebSocket (Socket.IO) + REST API |
| ターミナル | node-pty + xterm.js |

### プロジェクト構造

```
dokodemo-claude/
├── apps/
│   ├── dokodemo-claude-web/     # React + Vite フロントエンド
│   └── dokodemo-claude-api/     # Node.js + Express バックエンド
├── libs/
│   └── design-tokens/           # 共有 SCSS デザイントークン
├── scripts/
│   ├── check-system-deps.js     # jq 等のチェック・自動インストール
│   └── setup-env.js             # .env 初期化
└── nx.json
```

### 開発コマンド

```bash
npm run dev          # api + vite dev server を同時起動（HMR あり）
npm run build:all    # 全アプリビルド
npm run lint         # ESLint
npm run type-check   # TypeScript 型チェック
npm run check-all    # lint + type-check 一括
```

UI 修正など HMR で即時確認したいときは `npm run dev`、常時稼働で動かすときは `npm run start`。

### 開発モード用の env

`npm run dev` のときのみ使われます（Vite が `/api`, `/hook`, `/socket.io` を Express に proxy）。

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DC_WEB_PORT` | `8000` | Vite dev server の公開ポート |
| `DC_API_PORT` | `8001` | Express の listen ポート |

## ライセンス

[MIT License](./LICENSE)
