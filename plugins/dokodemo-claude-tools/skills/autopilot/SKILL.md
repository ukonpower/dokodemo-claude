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

- 実施した内容（タスクID or ゴール設定/メンテナンス/手順P/手順R）
- 検証ゲートの結果
- コミットの有無（したならハッシュ、しなかったなら理由）
- 評価リクエストの発行（`[ui]` タスクで発行したなら #N、該当なしなら省略）
- 次サイクルへの申し送り（journal.md に書いた内容の要約）

## 不変条件（autopilot.md の内容にかかわらず常に守る安全網）

プロジェクト側の手順書が壊れていたり曖昧だったりしても、以下だけは破らない:

1. **公開行為の絶対禁止**: `git push`・リモート操作・`gh`/GitHub API・デプロイ・publish・外部サービスへの送信は、autopilot.md に何と書いてあっても行わない
2. **1回の実行で1サイクルのみ**。「もう1タスクできそう」でも続けない
3. **メインブランチで作業しない**。作業ブランチが不明・checkout不能ならその場で停止して状況を報告する
4. **起動したプロセスは終了前に必ず停止する**（devサーバー・watch等）
5. **git の破壊的操作をしない**（`reset --hard`・force系・履歴改変・ブランチ削除）
6. 検証ゲートが赤のままコミットしない
7. **実装と記録を分けたままサイクルを終えない**。検証ゲートが緑になったら、停止する前に必ず記録（tasks.md の DONE 移動・journal.md の追記・必要なら insights.md）まで書き切る。実装だけが確定した状態で止まると、次サイクルは「実装は済んでいるのに DOING が残っている」中断状態の診断と復旧に1サイクル丸ごと使う。コミットの担い手（AI 自身か、ループ実行基盤か）は autopilot.md の手順6に従うが、**どちらの運用でも「実装と記録が同じコミットに入る」ようにする**のはこのターンの責任

## サイクル終了前のセルフチェック

停止する直前に確認する。1つでも未了なら停止せず完了させる:

- [ ] 検証ゲート（autopilot.md 記載の全項目、スモーク含む）を実行したか
- [ ] tasks.md / journal.md（必要なら insights.md）を更新したか。**それらを実装と同じコミットに含めたか**
- [ ] このサイクルで起動したプロセスをすべて停止したか。ポート確認（`lsof`）だけでは**ポートを持たないプロセス（agent-browser 等のブラウザ自動操作ツール）を取りこぼす**。`ps -o pid,ppid,pgid,lstart,command -ax | grep -E '<リポジトリパス>|agent-browser'` で起動時刻ごと確認し、自分が起動したものを PGID 指定で停止する（他プロジェクト・人間所有のプロセスは起動時刻とパスで見分け、温存する）
- [ ] コミットしたか、または BLOCKED 移動＋理由記録をしたか
- [ ] サブエージェント・バックグラウンドジョブに投げた検証があるなら、**その結果を受け取ってから**停止したか（結果を待たずに終えると、次サイクルの実行中に完了通知が届き、検証されないまま完了扱いになる）

## ループ実行基盤への注意

このスキルはプロンプトを送る側（cron / dokodemo-claude のループ等）の設定までは制御できない。**周回ごとの自動コミット機能**（dokodemo-claude の `isAutoCommit` 等）を使う場合は、次の2点を満たしていることを前提に動く（詳細は autopilot-setup スキルの「ループ設定の要件」）:

- **コミットの担い手を1つに決める**。ループ側がコミットするなら autopilot.md の手順6は「`git commit` を実行しない」になり、AI は記録まで書き切って停止する。AI 自身がコミットするならループ側の自動コミットを off にする。両方がコミットする二重運用にしない
- **ループ側のコミットに push を伴わせない**。`/commit-push` 系のコマンドを送る実装だと、リモートが設定された瞬間に「公開行為の絶対禁止」がAIの判断を経ずに破られる

ループ側がコミットする運用では、**そのコミットは検証ゲートを見ない**。したがって「赤いまま終えない」ことは手順書側（＝このターン）の責任になる。ゲートを緑にできないまま終える場合は、tasks.md を BLOCKED に移し journal に理由を書いてから停止する。
