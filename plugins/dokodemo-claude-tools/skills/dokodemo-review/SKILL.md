---
name: dokodemo-review
description: This skill should be used when the user asks to "dokodemo-review", "評価リクエストを出して", "評価リクエストを発行", "レビューリクエストを送って", "受信箱にレビューを出して", "ユーザーに評価を依頼して", "request a user review", "send a review request", or when Claude Code finishes implementing a change that affects UI/UX (見た目・触り心地) and should ask the user to judge the result asynchronously through the dokodemo-claude review inbox instead of blocking on a question.
---

# dokodemo-review

実装結果に対するユーザーの評価を依頼する**評価リクエスト**を発行する。
発行すると dokodemo-claude Web UI の**受信箱**に届き、ユーザーが空き時間に
選択肢・コメントで応答すると、その内容が発行元リポジトリの AI キューへ
プロンプトとして自動注入される（応答を待ってブロックしない非同期の仕組み）。

操作は **`dokodemo-claude-tools` プラグインの MCP サーバ `api` が提供するツール**で行う。
ツールのフル名は `mcp__plugin_dokodemo-claude-tools_api__review_request`。

## いつ使うか

- 見た目・触り心地（UI/UX）に影響する変更を実装したサイクルの終わり
- 複数案を作って、どれを採用するかユーザーに選んでほしいとき
- 方向性が合っているか、先に進む前に確認を挟みたいとき（ただし発行後は評価を待たずに次の作業へ進んでよい）

内部ロジックのみの変更では発行しない。

## 発行の作法（重要）

- **「どう思う？」の丸投げは禁止**。ユーザーが3秒で返せるよう、選択肢で答えられる問いまで整形する
- `aim`（狙い）は 1〜2 行。このサイクルで何を改善しようとしたかを書く
- 画像で判断できるものは**必ずスクリーンショットを添付**する（複数案は各案に `label` を付ける）
- 動きの確認が必要なら、触って確認できる URL を `urls` に入れる

## ツール: `review_request`

| パラメータ | 必須 | 説明 |
|-----------|------|------|
| `rid` | 必須 | 発行元リポジトリの rid（`repository_id` ツールで取得。worktree の wtid でもよい） |
| `aim` | 必須 | 狙い: このサイクルで何を改善しようとしたか（1〜2行） |
| `question` | 必須 | 問い: ユーザーに何を判断してほしいか |
| `choices` | 推奨 | 応答の選択肢（例 `["A案", "B案", "どちらも不採用"]`） |
| `images` | 任意 | `[{path, label?}]`。ローカル画像の絶対パス。恒久領域へコピーされる |
| `urls` | 任意 | `[{url, label?}]`。実機 URL 等 |
| `provider` | 任意 | 応答プロンプトの注入先キュー（既定 `claude`） |

## 発行例

```json
{
  "rid": "myapp",
  "aim": "設定画面のヘッダーを1行に圧縮し、余白を詰めて密度を上げた",
  "question": "圧縮後のレイアウトで進めてよいか",
  "choices": ["これで進める", "元のままがよい", "微調整して再提示"],
  "images": [
    { "path": "/tmp/settings-before.png", "label": "変更前" },
    { "path": "/tmp/settings-after.png", "label": "変更後" }
  ]
}
```

## 発行後の動き

1. Web UI の受信箱にカードが追加され、プッシュ通知が飛ぶ
2. ユーザーが選択肢 / コメント / 「そもそも」（方向性の相談）で応答する
3. 応答内容が発行元リポジトリの AI キューに `[評価リクエスト #N「...」への応答]` プロンプトとして積まれる
4. そのプロンプトを受けたターンが、評価の記録と必要な修正タスク化を行う

発行した AI は応答を**待たずに**次の作業へ進んでよい。ただし、評価待ちの画面に
依存する後続タスクがあれば着手を保留する。

## エラーハンドリング

| 状況 | 意味 |
|------|------|
| 画像を保存できませんでした | `images[].path` が存在しないか画像拡張子でない |
| リポジトリが見つかりません | rid が不正（`repository_id` で取り直す） |
| 接続失敗 | dokodemo-claude-api が起動していない |
