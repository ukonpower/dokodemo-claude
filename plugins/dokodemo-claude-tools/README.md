# dokodemo-claude-tools

dokodemo-claude に同梱された Claude Code プラグイン。dokodemo-claude の設定画面からインストール／アンインストールできる。

## 含まれるスキル / コマンド

### dokodemo-claude 連携スキル

- `dokodemo-preview` — 画像を dokodemo-claude Web UI にアップロードしてプレビュー表示
- `dokodemo-md` — 長文の結果を Web UI に Markdown として送信
- `dokodemo-ui-capture` — 実装した UI を撮影してプレビューに登録
- `dokodemo-review` — 評価リクエストを発行（受信箱に届き、応答は AI キューへ還流）
- `terminal-control` / `worktree-manage` / `worktree-prompt` — ターミナル・worktree の操作と委譲

### autopilot スキル（無人開発ループ）

- `autopilot` — `docs/autopilot.md` に従い1サイクルだけ実行（ループで定期送信する固定プロンプト）
- `autopilot-setup` — 手順書・記録ファイル・スモークの生成による導入
- `autopilot-plan` — N 周ごとに差し込む計画専用ターン（ループの定期プランニング欄には `/dokodemo-claude-tools:autopilot-plan` を設定）
- `autopilot-distill` — ユーザー評価（feedback-log）を方向性文書（direction）へ蒸留する手動ターン
- `autopilot-review` — ループ実施後のふりかえり

評価リクエスト（`dokodemo-review`）・受信箱・キュー注入と組み合わせることで、無人ループにユーザー評価を還流させるフィードバックループが成立する（設計は `docs/feedback-loop.md`）。

### ワークフロースキル

- `workflow-research` — コードベースを深く調査
- `workflow-plan` — 実装計画を作成・更新
- `workflow-implement` — 計画に沿って実装を実行
- `workflow-plan-codexreview` — Codex にプランのレビュー依頼

### Git コマンド

- `/commit` — 変更内容を確認し、コミットメッセージを生成してコミット
- `/commit-push` — コミットしてリモートに push
- `/merge-wt` — worktree のブランチをメインにマージ

## 導入方法

dokodemo-claude の設定モーダル（歯車アイコン）内「Claude Code プラグイン」セクションから「インストール」ボタンを押下。

## 注意事項

- インストール後、Claude Code を再起動すると変更が反映される
- このプラグインは dokodemo-claude リポジトリに同梱されており、別途 marketplace 登録は不要
