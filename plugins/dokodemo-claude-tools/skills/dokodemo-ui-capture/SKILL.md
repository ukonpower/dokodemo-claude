---
name: dokodemo-ui-capture
description: This skill should be used when the user asks to "dokodemo-ui-capture", "実装した画面のスクショを送って", "実装内容をスクショで確認させて", "UIをスクショでdokodemo-claudeに送って", "画面を撮ってプレビューに登録して", "スクショで動作確認させて", "capture implemented UI screenshots", "send UI screenshots to dokodemo-claude", or when Claude Code finishes implementing UI changes in a worktree and should provide visual evidence without the user running the dev server — by starting the dev server, capturing the changed screens with agent-browser, uploading them via preview_upload, and stopping the server. Do NOT use when the image file already exists (use dokodemo-preview instead).
---

# dokodemo-ui-capture

ワークツリーで実装した UI を、ユーザーが自分で `npm run dev` しなくても確認できるようにする。
「dev サーバ起動 → agent-browser で実装箇所を撮影 → `preview_upload` で Web UI へ送信 → サーバ停止」までを一気通貫で行う。

既存画像を送るだけなら `dokodemo-preview` スキルを使うこと。このスキルは「起動して撮る」ところからやる場合専用。

## Critical

- **後始末必須**: このスキルが起動した dev サーバとブラウザセッションは、撮影の成否に関わらず必ず停止・クローズする。逆に、**元から動いていたサーバは再利用し、絶対に止めない**。
- **ポートは明示指定**: 他ワークツリーの dev サーバと衝突しうる。起動前に `lsof -i :ポート` で空きを確認し、env やフラグでポートを明示して起動する。
- **撮るのは「今回の実装で変わった画面・状態」**: トップページ 1 枚で済ませない。モーダルを開く・タブを切り替える等、変更が写る状態まで操作してから撮る。
- **送る前に画像を確認**: 撮影した画像を Read で開き、真っ白・エラー画面・変更箇所が写っていない画像をそのまま送らない。

## Instructions

### Step 1: 撮影計画を立てる

今回の変更で見た目が変わる画面・状態を列挙する：

- URL（パス）と、その状態に至る操作手順（クリック・入力など）
- viewport: 基本はモバイル `390x844` とデスクトップ `1280x800` の 2 種。片方にしか影響しない変更ならその 1 種でよい

### Step 2: dev サーバを準備する

1. **既存サーバの確認**: 対象ワークツリーで既に dev サーバが動いていれば（`lsof -nP -iTCP -sTCP:LISTEN | grep node` 等で確認）それを再利用し、Step 3 へ
2. **依存の確認**: ワークツリーは node_modules 未インストールのことがある。起動対象アプリの `node_modules` が無ければ先に install する
3. **空きポートの選定**: 候補ポートを `lsof -i :ポート` で確認し、空いているものを選ぶ
4. **バックグラウンド起動**: プロジェクトの起動コマンド（`package.json` の dev スクリプト等）を、ポートを明示して Bash の `run_in_background` で起動
5. **起動待ち**: `curl -sk -o /dev/null -w '%{http_code}' http://localhost:ポート/` を数秒間隔でポーリングし、応答が返るまで待つ（目安 60 秒でタイムアウト。失敗したらバックグラウンド出力でエラーを確認）

### Step 3: agent-browser で撮影する

agent-browser スキルを使い、計画した画面・状態を撮影する：

1. viewport を設定して対象 URL を開く（HTTPS 自己署名証明書の場合は証明書エラー無視の設定を使う）
2. 計画した操作を実行して状態を再現する（アニメーションがある場合は少し wait を挟む）
3. スクリーンショットを scratchpad ディレクトリに絶対パスで保存する
4. 保存した画像を Read で開き、変更箇所が写っていることを確認する。写っていなければ操作をやり直す

### Step 4: preview_upload で送信する

`mcp__plugin_dokodemo-claude-tools_api__repository_id` に**ワークツリーの絶対パス**を渡して `rid` を取得し、
各画像を `mcp__plugin_dokodemo-claude-tools_api__preview_upload` でアップロードする：

- `title`: 何の実装か（例: 「設定モーダルのダークモード対応」）
- `description`: どの画面・どの状態・どの viewport か（例: 「設定モーダルを開いた状態 / モバイル 390x844」）

引数の詳細やエラー時の対応は `dokodemo-preview` スキルを参照。

### Step 5: 後始末する

1. **自分が起動した** dev サーバのプロセスを kill する（既存サーバを再利用した場合は何もしない）
2. `lsof -i :ポート` でポートが解放されたことを確認する
3. agent-browser のセッションを閉じる

### Step 6: 報告する

送った画像の一覧（title）と見どころ、確認できたこと・できなかったことを簡潔に報告する。

## Examples

### Example 1: 実装完了後にユーザーが依頼

User says: 「実装した画面のスクショをdokodemoに送って」

Actions:
1. 直前の実装で変わった画面（例: 設定モーダル）と状態を列挙
2. 空きポートで dev サーバをバックグラウンド起動し、応答をポーリングで待つ
3. agent-browser でモーダルを開いた状態をモバイル・デスクトップ両 viewport で撮影
4. `repository_id` → `preview_upload` で title/description 付きで送信
5. dev サーバを停止し、ポート解放を確認して報告

Result: ユーザーは Web UI のファイルタブで実装結果を画像で確認できる

### Example 2: 委譲プロンプトに組み込まれている

委譲プロンプト内に「完了時に dokodemo-ui-capture でスクショを送ること」とある場合、
実装・check-all 完了後にこのスキルの Step 1〜6 を実行してから完了報告する。

## Troubleshooting

### 画面が真っ白 / エラー画面になる

**Cause:** dev サーバのコンパイルエラー、または起動完了前にアクセスした
**Solution:** バックグラウンド出力（またはターミナル出力）でビルドエラーを確認。起動待ちポーリングが成功してから撮影する

### ポートが既に使用中

**Cause:** 他ワークツリーの dev サーバや前回の消し忘れプロセスが掴んでいる
**Solution:** 別の空きポートを明示して起動する。自分の消し忘れなら kill してから再起動する

### アップロードが失敗する

**Cause:** dokodemo-claude-api が起動していない、または rid が取れていない
**Solution:** `dokodemo-preview` スキルのエラーハンドリング手順に従う。rid はワークツリーの絶対パスで `repository_id` を呼んで取得する

### HTTPS の証明書エラーでページが開けない

**Cause:** dev サーバが自己署名証明書の HTTPS で起動している
**Solution:** agent-browser の証明書エラー無視設定を使う。それが使えない場合は http で起動できないか起動オプションを確認する
