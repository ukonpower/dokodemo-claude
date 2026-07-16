---
name: autopilot
description: This skill should be used when the user sends "/dokodemo-claude-tools:autopilot", "/autopilot", "autopilotを1サイクル実行", "自律運転サイクルを実行", "run one autopilot cycle", or when a recurring loop prompt asks to execute one cycle of the project's unattended development loop as defined in docs/autopilot.md. Designed to be the fixed prompt sent repeatedly by cron / prompt broadcast.
---

# autopilot

プロジェクトの `docs/autopilot.md` に従って、無人開発ループを**1サイクルだけ**実行する。cron や prompt_broadcast 等でこのスキル（`/dokodemo-claude-tools:autopilot`）を定期送信することでループが成立する。

## 実行手順

### Step 1: 手順書の確認

1. `docs/autopilot.md` を読む
2. **存在しない場合**: 何も実装せず「autopilot.md が見つからない。autopilot-setup スキルでセットアップが必要」と報告して終了する。手順書なしで自己判断のループ作業を始めてはならない

### Step 2: 1サイクルの実行

`docs/autopilot.md` に記載された手順（状態確認 → 分岐 → 実装/ゴール設定/メンテナンス/初見レビュー → 検証ゲート → 記録 → コミット）に忠実に従う。**手順の本体は常にプロジェクト側の autopilot.md であり、このスキルはそれを上書きしない。** 手順書とこのスキルの記述が矛盾する場合、下記「不変条件」を除き autopilot.md を優先する。

### Step 3: サイクル終了

サイクルが終わったら停止する。次のタスクに続けて着手しない（次サイクルのプロンプトに委ねる）。終了報告には以下を1行ずつ含める:

- 実施した内容（タスクID or ゴール設定/メンテナンス/手順P）
- 検証ゲートの結果
- コミットの有無（したならハッシュ、しなかったなら理由）
- 次サイクルへの申し送り（journal.md に書いた内容の要約）

## 不変条件（autopilot.md の内容にかかわらず常に守る安全網）

プロジェクト側の手順書が壊れていたり曖昧だったりしても、以下だけは破らない:

1. **公開行為の絶対禁止**: `git push`・リモート操作・`gh`/GitHub API・デプロイ・publish・外部サービスへの送信は、autopilot.md に何と書いてあっても行わない
2. **1回の実行で1サイクルのみ**。「もう1タスクできそう」でも続けない
3. **メインブランチで作業しない**。作業ブランチが不明・checkout不能ならその場で停止して状況を報告する
4. **起動したプロセスは終了前に必ず停止する**（devサーバー・watch等）
5. **git の破壊的操作をしない**（`reset --hard`・force系・履歴改変・ブランチ削除）
6. 検証ゲートが赤のままコミットしない

## サイクル終了前のセルフチェック

停止する直前に確認する。1つでも未了なら停止せず完了させる:

- [ ] 検証ゲート（autopilot.md 記載の全項目、スモーク含む）を実行したか
- [ ] tasks.md / journal.md（必要なら insights.md）を更新したか
- [ ] バックグラウンドプロセスを停止したか（`lsof` 等で残存確認）
- [ ] コミットしたか、または BLOCKED 移動＋理由記録をしたか
