# Codex/Claude 切替時の CLI 出力リフレッシュ計画

## 背景と問題
- 症状: プロバイダー切替（Codex ⇄ Claude Code）直後に、CLI 出力画面が切替先の履歴に更新されず、前のプロバイダーの表示が残る。
- 技術的原因:
  - `AiOutput` が xterm インスタンスと内部バッファ（`lastOutputLength`）を保持し、プロバイダー切替時にバッファをクリア・再描画していない。
  - `rawOutput` の描画が「追記（差分）」前提のため、履歴の「入れ替え」時に再初期化が必要。
  - クリア操作が後方互換イベント（`clear-claude-output`）を常時発火しており、Codex 表示中でも Claude 側が消える可能性。

## 目標（受け入れ条件）
- 切替直後に、表示は「切替先プロバイダーの履歴のみ」になり、混在しない。
- クリア操作は「表示中プロバイダー」の履歴のみを対象にし、他方は保持される。
- ストリーミング中に切替しても、裏でキャッシュは更新され、戻ると最新で表示される。
- リポジトリ切替/復帰でも表示が正確（オプション拡張でよりスムーズに）。

## 対応方針（概要）
1) 最小修正（即効性）
- `AiOutput` に `key={`${currentRepo}:${currentProvider}`}` を付与し、切替時に強制再マウントして xterm を再生成。

2) 堅牢化（併用）
- `AiOutput` 内で `currentProvider` 変化時に `terminal.clear()` と `lastOutputLength=0` を実行し、必要に応じて `rawOutput` 全量を再描画。
- `rawOutput` が「追記でなく入れ替わった」と推測できる場合も `clear + 全量描画` へフォールバック。

3) クリア操作の修正
- `clear-claude-output` は Claude 表示中のみに限定。Codex 表示中は `clear-ai-output`（新形式）だけを送信。

## 実装詳細

### 変更ファイル
- `frontend/src/App.tsx`
- `frontend/src/components/AiOutput.tsx`
- （任意拡張）`App.tsx` の `aiLogs` 構造

### App.tsx の変更
- `AiOutput` に `key` を付与（最小修正で確実に再生成）

```tsx
<AiOutput
  key={`${currentRepo}:${currentProvider}`}
  rawOutput={rawOutput}
  currentProvider={currentProvider}
  isLoading={isLoadingRepoData}
  onClickFocus={handleAiOutputFocus}
  onClearOutput={handleClearClaudeOutput}
  onKeyInput={handleAiKeyInput}
  isFocused={claudeOutputFocused}
/>
```

- プロバイダー切替時の表示と取得
  - 既に `aiLogs` にキャッシュがある場合は即時描画（`setRawOutput(cachedLog)`）。
  - キャッシュが無い場合は `setRawOutput('')` として空表示にし、その後 `get-ai-history` で同期（必要なら `setIsLoadingRepoData(true)` を併用）。

- クリア操作の誤送信を修正（Claude 表示時のみ後方互換イベント送出）

```ts
const handleClearClaudeOutput = () => {
  setRawOutput('');
  if (socket && currentRepo) {
    socket.emit('clear-ai-output', { repositoryPath: currentRepo, provider: currentProvider });
    if (currentProvider === 'claude') {
      socket.emit('clear-claude-output', { repositoryPath: currentRepo });
    }
  }
};
```

### AiOutput.tsx の変更
- プロバイダー変更時にターミナルを初期化して正しい内容に更新

```ts
// プロバイダー変更時に初期化 + 全量描画または初期メッセージ
useEffect(() => {
  if (!terminal.current) return;

  terminal.current.clear();
  lastOutputLength.current = 0;

  if (rawOutput && rawOutput.length > 0) {
    terminal.current.write(rawOutput);
    lastOutputLength.current = rawOutput.length;
  } else {
    const info = getProviderInfo();
    terminal.current.writeln(info.initialMessage1);
    terminal.current.writeln(info.initialMessage2);
  }
}, [currentProvider]);
```

- `rawOutput` 変化時のフォールバック（入れ替え検知）

```ts
useEffect(() => {
  if (!terminal.current) return;
  if (!rawOutput) return;

  // 入れ替え（長さが減った等）を検知したら全量描画
  if (rawOutput.length < lastOutputLength.current) {
    terminal.current.clear();
    lastOutputLength.current = 0;
  }

  const newOutput = rawOutput.slice(lastOutputLength.current);
  if (newOutput) {
    if (lastOutputLength.current === 0) {
      terminal.current.clear();
    }
    terminal.current.write(newOutput);
    terminal.current.scrollToBottom();
    lastOutputLength.current = rawOutput.length;
  }
}, [rawOutput]);
```

- 既存の初期マウント時の初期メッセージ表示ロジック（`getProviderInfo()`）は維持。

### 任意拡張（UX 向上）
- `aiLogs` を「リポジトリ別 × プロバイダー別」に拡張
  - 現状: `Map<AiProvider, string>`
  - 推奨: `Map<string /* repoPath */, Map<AiProvider, string>>`
  - メリット: リポジトリを行き来したときも即時復元できる。
  - 影響: 全参照箇所で `aiLogs.get(currentRepo)?.get(currentProvider)` へ変更。

## イベント/状態フロー
- プロバイダー切替
  - UI: `setCurrentProvider(provider)` → `key` による再マウント → `AiOutput` 内 `clear + 再描画`
  - サーバ: `switch-repo({ path, provider })` → `ai-output-history` 送出 → フロントで履歴キャッシュ更新

- 出力追記
  - サーバ: `claude-raw-output({ content, provider })` をストリーム送出
  - フロント: `aiLogs` の該当 provider に追記、表示中の provider なら `rawOutput` 更新

- クリア
  - フロント: `clear-ai-output({ provider })` を送信
  - サーバ: `ai-output-cleared` を返す
  - フロント: キャッシュと `rawOutput` を該当 provider のみ空に
  - Claude 表示中のみ `clear-claude-output` も送出（後方互換）

## 手動確認チェックリスト
- 切替（Codex → Claude → Codex）で、各時点の表示がその provider のみである。
- 片方でクリアしても、もう片方の履歴は残る。
- ストリーミング中に他方へ切替しても、戻ったときに最新状態で見える。
- リポジトリ切替直後、キャッシュの有無に応じて「即時表示 or ローディング」を経て最終的に正しい履歴が表示される。

## リスクと回避策
- xterm の残留: `key` による強制再マウントと、`clear + lastOutputLength=0 + 全量描画` の二重対策を実装。
- 互換イベントの副作用: `clear-claude-output` の発火条件を Claude 表示時のみに制限。
- 大きな履歴の全量描画: 切替時のみ全量描画。必要に応じて将来は遅延描画やチャンク化を検討。

## スケジュール目安
- 最小修正（key + 初期化 + クリア条件）: 0.5 日
- 拡張（リポジトリ別×プロバイダー別キャッシュ）: 0.5 日
- 動作確認・微調整: 0.5 日

## 将来改善
- 命名整理（`endLoadingOnClaudeOutput` → `endLoadingOnAiOutput`）
- `aiLogs` の構造拡張と永続化（必要なら localStorage）
- 大容量履歴時の描画最適化（仮想化/チャンク化）

