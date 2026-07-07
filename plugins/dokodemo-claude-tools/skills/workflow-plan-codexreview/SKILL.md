---
name: workflow-plan-codexreview
description: >
  This skill should be used ONLY when the user explicitly invokes it by name
  ("workflow-plan-codexreview", "/workflow-plan-codexreview") or explicitly
  asks for a Codex review of the plan ("codexでプランをレビュー", "codex review plan").
  Do NOT trigger on generic review requests such as 「計画の妥当性をチェック」 —
  ignore those unless the skill name or Codex is explicitly named.
---

# Plan Codex Review - 実装計画のCodexレビュー

`.workflow-tools/plan.md` をOpenAI Codex CLIに渡し、実装計画の妥当性をフラットな視点で評価する。
細かい実装の正当性だけでなく、そもそもの方針・アプローチが適切かどうかも含めて検証する。

## ワークフロー

### Step 1: plan.md の読み込み

`.workflow-tools/plan.md` を読み込む。存在しない場合はユーザーに「先に計画フェーズを実行してください」と伝える。

### Step 2: プロジェクトコンテキストの収集

レビューの質を高めるため、以下を把握する:

- CLAUDE.md のアーキテクチャ概要
- research.md が存在すれば調査結果
- 関連するコードベースの現状

### Step 3: Codex でレビュー実行

1. **レビュープロンプト全文を `.workflow-tools/codex-prompt.md` に Write ツールで書き出す。** プロンプトをシェル引数に直接埋め込むと、plan 内の引用符・バッククォート・`$` でコマンドが壊れるため、必ずファイル経由で渡す。

2. 以下のコマンドで Codex を呼び出す（Bash ツールの timeout に 600000ms 程度を指定する）:

```bash
codex exec --sandbox read-only --cd <project_directory> "$(cat .workflow-tools/codex-prompt.md)"
```

`--full-auto` は使わない（書き込み許可を含意し、read-only サンドボックスの意図と矛盾するため）。

3. Codex が利用できない場合（コマンド不存在・タイムアウト・非ゼロ終了）は、リトライせずその旨をユーザーに報告して終了する。

**codex-prompt.md に書くレビュープロンプトの構成:**

```
あなたはシニアソフトウェアアーキテクトとして、以下の実装計画をレビューしてください。
Claudeが作成した計画に対する独立したセカンドオピニオンとして、忖度なくフラットな視点で評価してください。

重要: あなたはClaude（計画の作成者）とは異なるAIです。Claudeの判断が正しいとは限りません。
計画を鵜呑みにせず、ゼロベースで妥当性を検証してください。

## 実装計画
<plan_content>

## レビュー観点

### A. 方針・アプローチの妥当性（最重要）
- そもそもこのアプローチは正しいか？根本的に別の方法のほうが良くないか？
- 問題の捉え方自体が間違っていないか？
- 過剰設計や不足はないか？
- 既存のライブラリ・フレームワークの機能で代替できないか？

### B. 技術的な実現可能性
- 提案されたコードは実際に動作するか？
- 使用しているAPIやライブラリの使い方は正しいか？
- エッジケースや例外処理の漏れはないか？

### C. アーキテクチャとの整合性
- プロジェクトの既存パターンと矛盾していないか？
- 将来的な保守性に問題はないか？

### D. リスクと見落とし
- 計画に含まれていない重要な考慮事項はないか？
- パフォーマンス、セキュリティ上の懸念はないか？
- 既存コードへの影響範囲は正しく評価されているか？

確認や質問は不要です。具体的な評価・提案・代替案を自主的に出力してください。
特に「方針自体が間違っている」場合は遠慮なく指摘し、代替アプローチを具体的に提示してください。
```

**注意:** `<plan_content>` 部分には、読み込んだ plan.md の全内容を埋め込む。
research.md が存在する場合は、プロンプトに `## 調査結果（参考）` セクションを追加し内容を含める。

### Step 4: レビュー結果の保存

Codexからの回答を `.workflow-tools/plan-review.md` に以下の形式で保存する:

```markdown
# Plan Review (Codex)

レビュー日時: {YYYY-MM-DD HH:MM}

## 方針の評価
（アプローチ自体の妥当性について。問題なければ「妥当」、問題あれば具体的に指摘）

## 良い点
- ...

## 懸念点・リスク
- ...

## 方針レベルの代替案（あれば）
- ...

## 実装レベルの改善提案
- ...
```

既に `plan-review.md` が存在する場合は上書きする（最新のレビュー結果のみ保持）。
保存後、一時ファイルの `.workflow-tools/codex-prompt.md` は削除する。

ユーザーにレビュー結果のサマリーをチャットで伝える。

### Step 5: ユーザーへの提案

レビュー結果を踏まえて次を案内する。**このスキル内では plan.md を一切編集しない。** 修正の反映はすべて workflow-plan へのハンドオフで行う:

- **方針に問題がない場合**: 「計画は妥当です。/workflow-implement で実装フェーズに進められます。」
- **修正が必要な場合（軽微・方針レベルとも）**: 「/workflow-plan で『plan-review.md の指摘を反映して』と指示すると計画を更新できます。」

## 重要なルール

- **このフェーズではコードの変更を絶対に行わない。** plan.md の更新も行わない。修正が必要な場合は workflow-plan へ誘導する。
- レビュー結果は `.workflow-tools/plan-review.md` にのみ書き出す（一時ファイル `codex-prompt.md` は使用後に削除）
- Codexは read-only サンドボックスで実行されるため、コードの変更は行われない
- レビュー結果は参考意見。最終判断はユーザーに委ねる
- Codexが利用できない環境では、その旨をユーザーに伝える
