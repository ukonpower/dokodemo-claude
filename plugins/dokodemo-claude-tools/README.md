# dokodemo-claude-tools

dokodemo-claude に同梱された Claude Code プラグイン。dokodemo-claude の設定画面からインストール／アンインストールできる。

## 含まれるスキル / コマンド

### dokodemo-claude 連携スキル

- `dokodemo-preview` — 画像を dokodemo-claude Web UI にアップロードしてプレビュー表示


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
