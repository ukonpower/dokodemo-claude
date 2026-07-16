---
name: autopilot-plan
description: This skill should be used when the user sends "/dokodemo-claude-tools:autopilot-plan", "autopilotの計画ターンを実行", "計画ターンを実行", "ループの進め方を見直して再計画", "run one autopilot planning turn", or when a loop's periodic planning turn (e.g. dokodemo-claude のループ定期プランニングの planningPrompt) asks to review the autopilot loop's direction with a stronger model. Reviews recent cycles against the goal, re-plans docs/tasks.md, records the decision, and does NOT implement anything. Designed to be the fixed prompt sent every N cycles by the loop runner.
---

# autopilot-plan

autopilot（無人開発ループ）の**計画ターンを1回だけ**実行する。N周ごとに強いモデルでこのスキル（`/dokodemo-claude-tools:autopilot-plan`）を差し込むことで、ループが「タスクは消化しているのに向かう先がずれている」状態に陥るのを防ぐ。実装は一切行わない。

dokodemo-claude のループ定期プランニング機能を使う場合は、計画プロンプト欄に `/dokodemo-claude-tools:autopilot-plan` を設定する（モデルは opus 等の強いモデルを推奨）。

## Critical（このターンの不変条件）

1. **実装しない**。変更してよいのは記録ファイル（docs/tasks.md・docs/journal.md・docs/insights.md・docs/decisions.md）のみ。ソースコードには触れない
2. **1回の実行で計画ターン1回のみ**。計画後に「ついでに1タスク」と実装を始めない（次の作業ターンに委ねる）
3. **公開行為・git の破壊的操作をしない**（push・リモート操作・reset --hard 等。autopilot 本体と同じ禁止事項に従う）
4. **サーバー等のプロセスを起動しない**。実物の実地確認は手順P（初見レビュー）の役割であり、計画ターンはログと記録ファイルだけで判断する

## Instructions

### Step 1: 手順書の確認

1. `docs/autopilot.md` を読む
2. **存在しない場合**: 何もせず「autopilot.md が見つからない。autopilot-setup スキルでセットアップが必要」と報告して終了する
3. autopilot.md に**手順PL（計画ターン）のセクションがあればそれに従う**（プロジェクト側の手順が常に優先。ただし上記の不変条件は破らない）。無ければ以下の Step 2〜4 をデフォルト手順として実行する

### Step 2: 状態の収集

直近の作業ターンの文脈が同一セッションに残っていてもそれだけに頼らず、記録ファイルから読み直す（ループ側の /clear 設定によっては文脈が消えているため）:

- docs/autopilot.md の「到達ライン」「垂直スライス」「実装フェーズの参考順序」
- docs/tasks.md — TODO の並び・DOING・BLOCKED・直近の DONE
- docs/journal.md — 前回の計画ターン（または直近5〜10サイクル分）以降のエントリ
- docs/insights.md — ループ自身が自覚している問題
- `git log --oneline -15` — サイクルのペースと種別比率（feat/fix/chore の偏り）

### Step 3: 進め方の評価

以下の観点で「このまま TODO を上から消化してよいか」を判断する:

1. **到達ラインへの距離**: 直近サイクルの成果は到達ラインに近づいているか。垂直スライス未達のまま横展開タスクが積まれていないか
2. **停滞**: BLOCKED の長期滞留・同種の失敗の繰り返し・タスク分割の頻発がないか。あれば正面突破ではなく代替アプローチを計画する
3. **タスクの質**: TODO の粒度は1サイクルで終わるか。受け入れ条件は「実物で確認できる状態」になっているか。陳腐化したタスク（前提が変わった・既に不要）がないか
4. **順序**: 今の TODO の並びは最短経路か。依存関係・リスクの高いものから着手する並びになっているか

### Step 4: 再計画と記録

1. 評価に基づき docs/tasks.md の TODO を組み替える: 並び替え・書き直し・分割・統合・不要タスクの削除・不足タスクの追加。**変更しない判断も有効な結論**（その場合も理由を記録する）
2. 方針レベルの変更（ゴールの再解釈・アプローチの転換）があれば docs/decisions.md に「何を・なぜ」を追記する
3. docs/journal.md に計画ターンのエントリを1件追記する: 評価の要点（3行程度）と、tasks.md に加えた変更の要約
4. 変更を `chore({{スコープ}}): 計画ターン` 等としてコミットする（記録ファイルのみの変更であることを git status で確認してから）
5. 終了報告には以下を1行ずつ含めて停止する:
   - 到達ラインへの現在地の評価
   - tasks.md に加えた変更（なければ「変更なし」と理由）
   - 次の作業ターンが最初に着手すべきタスク

## Examples

### Example 1: dokodemo-claude のループ定期プランニングから起動

Loop planning turn prompt: "/dokodemo-claude-tools:autopilot-plan"

Actions:
1. docs/autopilot.md を読み、手順PL があるか確認
2. tasks.md / journal.md / insights.md / git log から直近サイクルを評価
3. BLOCKED に3サイクル滞留したタスクを発見 → 代替アプローチのタスクに再定義し TODO 先頭へ
4. journal.md に計画エントリを追記してコミット

Result: 「T-012 を状態注入方式に再定義。次の作業ターンは T-012 から。実装は行っていない」と報告して停止

### Example 2: ユーザーが手動で計画を見直したいとき

User says: "計画ターンを実行して"

Actions: 上記と同じ手順を1回実行し、報告して停止する

## Troubleshooting

### 計画のたびに TODO が全面組み替えされて落ち着かない

**Cause:** 毎回ゼロベースで並べ直している
**Solution:** 変更は「評価で問題が見つかった箇所」に限定する。問題がなければ「変更なし」で終えるのが正しい挙動

### 計画ターンの内容が次の作業ターンに反映されない

**Cause:** 計画をセッションの文脈（会話）にだけ残し、記録ファイルに書いていない。ループの /clear 設定で文脈が消えると計画も消える
**Solution:** 計画の結論は必ず tasks.md / journal.md に書いてコミットする。文脈は補助、ファイルが本体

### 計画ターンで実装まで進んでしまう

**Cause:** 「小さい修正だからついでに」と手を出した
**Solution:** 不変条件1・2に従い、実装したくなったタスクは TODO の先頭に置いて次の作業ターンに委ねる
