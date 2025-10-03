# AIセッション管理統一化 - リファクタリング計画

## 概要

プロバイダー別（Claude/Codex）のAIセッション管理を統一し、出力履歴の保持・切替を安定化させる。

## 現状の問題点

- ✗ セッション二重管理（aiSessions と claudeSessions）
- ✗ イベントの混在（ai-output と claude-output）
- ✗ 履歴の読込・保持の不一致（codex選択時に履歴が復元されない）
- ✗ セッション復元/終了の不備
- ✗ セッション検索/送信の非効率

## 目標設計

- ✓ セッションは「リポジトリ×プロバイダー」で一意管理（キー: `provider:repoPath`）
- ✓ 履歴はプロバイダー別に保持し、切替時に即座に適切な履歴を表示
- ✓ 送受信/中断/終了APIはプロバイダー前提の単一路線
- ✓ 起動/終了/監視/永続化はAIセッションに一本化

---

## フェーズ1: フロントエンド改修（視覚的効果優先）

### 1-1. ai-output-history購読とaiLogs導入

**ファイル**: `frontend/src/App.tsx`

**状態**: ✅ 完了

**実装内容**:
- [x] `aiLogs: Map<AiProvider, string>` を本格使用
- [x] `rawOutput` を「現在選択中プロバイダーのビュー専用キャッシュ」として扱う
- [x] `socket.on('ai-output-history')` を実装し、`aiLogs` に反映
- [x] `socket.on('claude-raw-output')` で `data.provider` 別に `aiLogs` に追記
- [x] `currentProvider` 一致時のみ `rawOutput` も更新
- [x] MAX長超過のトリムもプロバイダー単位で適用
- [x] `ai-output-cleared` 受信時は該当プロバイダーのログのみクリア

**検証観点**:
- Claude→Codex→Claudeと切り替えても各履歴が保持される
- ブラウザリロード後も選択中プロバイダーの履歴が復元される

---

### 1-2. switch-repoでprovider必須化

**ファイル**: `frontend/src/App.tsx`

**状態**: ✅ 完了

**実装内容**:
- [x] 接続直後の `switch-repo` に `provider: currentProvider` を付与
- [x] PopState時の `switch-repo` に `provider: currentProvider` を付与（既存実装済み）
- [x] ProviderSelector変更時に `switch-repo` を同repoで再送（provider切替）
- [x] `switch-repo` 送信後、即座に `get-ai-history` も送信
- [x] `get-ai-history` に `{ repositoryPath, provider: currentProvider }` を送信
- [x] `aiLogs` にキャッシュがあれば即座に画面反映

**検証観点**:
- プロバイダー切替時に履歴が即座に表示される
- リロード時も適切なプロバイダーの履歴が読み込まれる

---

## フェーズ2: バックエンド改修（堅牢性向上）

### 2-1. ProcessManagerのAIセッション終了系統一化

**ファイル**: `backend/src/process-manager.ts`

**状態**: ✅ 完了

**実装内容**:
- [x] `closeAiSession(sessionKey)` を新設
- [x] SIGTERM → 待機 → SIGKILL で安全終了
- [x] `shutdown()` でAIセッションも終了対象に含める
- [x] `cleanupRepositoryProcesses()` でAIセッション（全provider）も終了
- [x] `removeRepositoryFromPersistence()` に `ai-sessions.json` も追加
- [x] 型チェック完了（フロントエンド・バックエンド共に）

**検証観点**:
- リポジトリ削除時、全プロバイダーのAIセッションが終了
- サーバー終了時、孤児プロセスが残らない

---

### 2-2. send-command/ai-interruptのAI一本化

**ファイル**: `backend/src/process-manager.ts`, `backend/src/server.ts`

**状態**: ✅ 完了

**実装内容**:

**ProcessManager側**:
- [x] `idIndex: Map<string, string>` を追加（sessionId → sessionKey）
- [x] `sendToAiSession()` をO(1)解決に改善
- [x] `sendSignalToAiSession(sessionId, signal)` を新設
- [x] `ensureAiSession(repo, provider, {forceRestart?: boolean})` を追加

**Server側**:
- [x] `send-command` で `provider` を必須に（既存実装済み）
- [x] `send-command` でセッション解決を `idIndex` ベースに変更
- [x] `ai-interrupt` で `sendSignalToAiSession()` を使用
- [x] `claude-interrupt` を互換ラッパーとして残す（内部はAI側に委譲）

**検証観点**:
- Ctrl+C/ESC/矢印/Tab/Enterの入力が双方のプロバイダーで動作
- セッション検索がO(1)で完了

---

### 2-3. switch-repoのprovider必須化（サーバー側）

**ファイル**: `backend/src/server.ts`

**状態**: ✅ 完了（既存実装済み）

**実装内容**:
- [x] `switch-repo` で `provider` をパラメータに（デフォルト: 'claude'）
- [x] `getOrCreateAiSession(repo, name, provider)` で起動/取得
- [x] `getAiOutputHistory(repo, provider)` を即座に返す
- [x] Claudeの場合のみ `claude-output-history` も送る（互換）

**検証観点**:
- フロントからのprovider指定が正しく反映される
- 履歴が適切なプロバイダーのものとして返される

---

### 2-4. 互換イベントの段階的整理

**ファイル**: `backend/src/server.ts`, `backend/src/process-manager.ts`

**状態**: ⬜ 未着手

**実装内容**:
- [ ] `ai-*` イベントを正規イベントとして確立
- [ ] `claude-*` イベントは互換用ラッパーとして温存
- [ ] `ai-raw-output` への移行準備（将来リネーム用）
- [ ] `claudeSessions` は薄い互換レイヤーとして最小化

**検証観点**:
- 既存機能が引き続き動作
- 新規実装は `ai-*` イベントベースで統一

---

## フェーズ3: 動作検証

### 3-1. 統合テスト

**状態**: ⬜ 未着手

**検証項目**:
- [ ] Claude→Codex→Claudeとプロバイダー切替で各履歴が保持される
- [ ] 新規接続/ブラウザリロード後も履歴が読み戻される
- [ ] Ctrl+C/ESC/矢印/Tab/Enterが両プロバイダーで動作
- [ ] リポジトリ削除/サーバー終了で全AIセッションが終了
- [ ] CodexのTTYクエリがUI表示に混じらない
- [ ] 永続ファイルから適切にセッションが削除される

---

## 実装順序

1. ✅ **フェーズ1-1**: フロントエンドのai-output-history購読＆aiLogs導入
2. ✅ **フェーズ1-2**: フロントエンドのswitch-repo provider必須化
3. ✅ **フェーズ2-3**: バックエンドのswitch-repo provider必須化
4. ✅ **フェーズ2-1**: ProcessManagerのAIセッション終了系統一化
5. ✅ **フェーズ2-2**: send-command/ai-interruptのAI一本化
6. ⬜ **フェーズ2-4**: 互換イベントの段階的整理
7. ⬜ **フェーズ3-1**: 統合テスト

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| 生存PIDの扱い | 復元時は履歴のみ扱う。孤児プロセスが問題になる場合は環境変数 `KILL_ORPHAN_AI=1` で対応 |
| 互換イベントの混在 | フロントが `ai-*` 購読へ移行後、段階的に `claude-*` を廃止 |
| セッション切替時のちらつき | `aiLogs` にキャッシュがあれば即座に画面反映 |

---

## 進捗管理

- ⬜ 未着手
- 🔄 進行中
- ✅ 完了
- ⚠️ 要確認

**最終更新**: 2025-10-03

---

## 実装完了サマリー

### ✅ 完了した項目

**フェーズ1: フロントエンド改修**
- ✅ 1-1. ai-output-history購読とaiLogs導入
- ✅ 1-2. switch-repoでprovider必須化

**フェーズ2: バックエンド改修**
- ✅ 2-1. ProcessManagerのAIセッション終了系統一化
- ✅ 2-2. send-command/ai-interruptのAI一本化
- ✅ 2-3. switch-repoのprovider必須化（既存実装）

**品質チェック**
- ✅ フロントエンド型チェック完了
- ✅ バックエンド型チェック完了

**最適化**
- ✅ idIndexによるO(1)セッション検索
- ✅ sendSignalToAiSession()による統一的なシグナル送信
- ✅ ensureAiSession()による柔軟なセッション管理

### ⬜ 今後の実装項目

**フェーズ2: バックエンド改修**
- ⬜ 2-4. 互換イベントの段階的整理（将来対応）

**フェーズ3: 動作検証**
- ⬜ 3-1. 統合テスト

---

## 次のステップ

現状の実装で、主要な機能は完成しています：

1. **プロバイダー別履歴管理**: Claude/Codex間で履歴が独立して保持される
2. **プロバイダー切替対応**: 切替時に即座に適切な履歴が表示される
3. **終了系統一化**: リポジトリ削除・サーバー終了時に全AIセッションが終了
4. **O(1)セッション検索**: idIndexによる高速なセッション解決
5. **統一的なシグナル送信**: sendSignalToAiSession()による一貫したシグナル処理

今後は以下の対応が推奨されます：

1. **動作検証**: 実際にClaude/Codexを切り替えて履歴保持・入力処理を確認
2. **互換イベント整理** (将来): claude-*イベントの段階的廃止

---

## 実装の主要な改善点

**フェーズ2-2で追加された機能**:

1. **idIndex導入** (`process-manager.ts:100`)
   - sessionId → sessionKeyのマッピングを保持
   - O(n)からO(1)への検索時間の劇的改善

2. **sendToAiSession()最適化** (`process-manager.ts:1260`)
   - 線形検索からidIndexベースのO(1)検索に変更
   - セッション検索のパフォーマンスが大幅向上

3. **sendSignalToAiSession()新設** (`process-manager.ts:1305`)
   - Ctrl+C (SIGINT) などのシグナル送信専用メソッド
   - ai-interruptで使用され、統一的なシグナル処理を実現

4. **ensureAiSession()追加** (`process-manager.ts:635`)
   - forceRestartオプションによる柔軟なセッション管理
   - セッションの強制再起動が可能に

5. **claude-interrupt互換性維持** (`server.ts:761`)
   - 既存のclaude-interruptイベントを継続サポート
   - 内部ではsendSignalToAiSession()を使用
