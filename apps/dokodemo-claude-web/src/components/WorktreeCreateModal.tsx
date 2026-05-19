import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GitBranch,
  WorktreeSyncEntry,
  WorktreeSyncMode,
} from '../types';
import type { WorktreeSyncConfigState } from '../hooks/useBranchWorktree';
import s from './WorktreeCreateModal.module.scss';

interface WorktreeCreateModalProps {
  parentRepoPath: string;
  branches: GitBranch[];
  syncConfig: WorktreeSyncConfigState | null;
  onRequestSyncConfig: () => void;
  onSaveSyncConfig: (entries: WorktreeSyncEntry[]) => void;
  onClose: () => void;
  onCreate: (
    branchName: string,
    baseBranch: string | undefined,
    useExisting: boolean,
    syncEntries: WorktreeSyncEntry[]
  ) => void;
}

// 「skip（含めない）」を含むローカル状態
type SyncRowMode = WorktreeSyncMode | 'skip';

interface SyncRow {
  path: string;
  mode: SyncRowMode;
  fromSuggestion: boolean;
}

function buildRows(
  suggestions: string[],
  savedEntries: WorktreeSyncEntry[]
): SyncRow[] {
  const rows: SyncRow[] = [];
  const seen = new Set<string>();

  for (const entry of savedEntries) {
    rows.push({
      path: entry.path,
      mode: entry.mode,
      fromSuggestion: suggestions.includes(entry.path),
    });
    seen.add(entry.path);
  }

  for (const suggestion of suggestions) {
    if (seen.has(suggestion)) continue;
    rows.push({ path: suggestion, mode: 'skip', fromSuggestion: true });
    seen.add(suggestion);
  }

  return rows;
}

function rowsToEntries(rows: SyncRow[]): WorktreeSyncEntry[] {
  return rows
    .filter((r) => r.mode !== 'skip')
    .map((r) => ({ path: r.path, mode: r.mode as WorktreeSyncMode }));
}

function WorktreeCreateModal({
  parentRepoPath,
  branches,
  syncConfig,
  onRequestSyncConfig,
  onSaveSyncConfig,
  onClose,
  onCreate,
}: WorktreeCreateModalProps) {
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [useExistingBranch, setUseExistingBranch] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [rows, setRows] = useState<SyncRow[]>([]);
  const [hasInitializedRows, setHasInitializedRows] = useState(false);
  const [savingSince, setSavingSince] = useState<number | null>(null);
  const lastSeenSavedAt = useRef<number | undefined>(syncConfig?.lastSavedAt);

  // モーダル表示直後に設定の取得をリクエスト
  useEffect(() => {
    onRequestSyncConfig();
  }, [onRequestSyncConfig]);

  // 設定が（このリポジトリ向けに）届いたら一度だけ初期化
  useEffect(() => {
    if (!syncConfig) return;
    if (syncConfig.parentRepoPath !== parentRepoPath) return;
    if (hasInitializedRows) return;
    setRows(buildRows(syncConfig.suggestions, syncConfig.entries));
    setHasInitializedRows(true);
  }, [syncConfig, parentRepoPath, hasInitializedRows]);

  // 保存完了の検知
  useEffect(() => {
    if (!syncConfig?.lastSavedAt) return;
    if (syncConfig.lastSavedAt === lastSeenSavedAt.current) return;
    lastSeenSavedAt.current = syncConfig.lastSavedAt;
    setSavingSince(null);
  }, [syncConfig?.lastSavedAt]);

  const isSaving = savingSince !== null;
  const justSaved =
    !isSaving &&
    syncConfig?.lastSavedAt !== undefined &&
    Date.now() - syncConfig.lastSavedAt < 2000;

  const handleCreate = () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    onCreate(
      branchName.trim(),
      baseBranch.trim() || undefined,
      useExistingBranch,
      rowsToEntries(rows)
    );
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.dataset?.role === 'sync-add') return;
    if (target.tagName === 'TEXTAREA') return;
    if (branchName.trim() && !isCreating) {
      handleCreate();
    }
  };

  const handleExistingBranchSelect = (selectedBranch: string) => {
    setBranchName(selectedBranch);
  };

  const updateRowMode = (path: string, mode: SyncRowMode) => {
    setRows((prev) => prev.map((r) => (r.path === path ? { ...r, mode } : r)));
  };

  const removeRow = (path: string) => {
    setRows((prev) => prev.filter((r) => r.path !== path));
  };

  const addManualPath = () => {
    const trimmed = newPath.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!trimmed) return;
    if (trimmed.includes('..')) return;
    if (rows.some((r) => r.path === trimmed)) {
      setNewPath('');
      return;
    }
    setRows((prev) => [
      ...prev,
      { path: trimmed, mode: 'copy', fromSuggestion: false },
    ]);
    setNewPath('');
  };

  const handleSaveAsDefault = () => {
    setSavingSince(Date.now());
    onSaveSyncConfig(rowsToEntries(rows));
  };

  const summary = useMemo(() => {
    const copy = rows.filter((r) => r.mode === 'copy').length;
    const link = rows.filter((r) => r.mode === 'link').length;
    return { copy, link };
  }, [rows]);

  const loaded =
    hasInitializedRows ||
    (syncConfig?.parentRepoPath === parentRepoPath && rows.length === 0);

  return (
    <div className={s.modalOverlay}>
      <div className={s.modalContent} onKeyDown={handleKeyDown}>
        <div className={s.modalHeader}>
          <h3 className={s.modalTitle}>ワークツリーを作成</h3>
          <button onClick={onClose} className={s.closeButton}>
            <svg
              className={s.closeIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className={s.formFields}>
          <div className={s.checkboxRow}>
            <input
              type="checkbox"
              id="useExisting"
              checked={useExistingBranch}
              onChange={(e) => {
                setUseExistingBranch(e.target.checked);
                setBranchName('');
              }}
              className={s.checkbox}
            />
            <label htmlFor="useExisting" className={s.checkboxLabel}>
              既存のブランチを使用
            </label>
          </div>

          <div className={s.fieldGroup}>
            <label className={s.fieldLabel}>
              ブランチ名 <span className={s.requiredMark}>*</span>
            </label>
            {useExistingBranch ? (
              <select
                value={branchName}
                onChange={(e) => handleExistingBranchSelect(e.target.value)}
                className={s.selectInput}
              >
                <option value="">ブランチを選択...</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.current ? ' (現在)' : ''}
                    {branch.remote ? ` (${branch.remote})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="feature/new-feature"
                autoFocus
                className={s.textInput}
              />
            )}
            <p className={s.fieldHint}>
              ワークツリーのディレクトリ名としても使用されます
            </p>
          </div>

          {!useExistingBranch && (
            <div className={s.fieldGroup}>
              <label className={s.fieldLabel}>元になるブランチ</label>
              <select
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className={s.selectInput}
              >
                <option value="">HEAD（現在のコミット）</option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.current ? ' (現在)' : ''}
                    {branch.remote ? ` (${branch.remote})` : ''}
                  </option>
                ))}
              </select>
              <p className={s.fieldHint}>
                省略した場合は現在のHEADから新しいブランチを作成します
              </p>
            </div>
          )}

          <div className={s.syncSection}>
            <div className={s.syncHeader}>
              <span className={s.syncTitle}>
                ファイル同期
                {loaded && (
                  <>
                    {' '}
                    <span className={s.syncPathMuted}>
                      (コピー: {summary.copy} / リンク: {summary.link})
                    </span>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={handleSaveAsDefault}
                disabled={!loaded || isSaving}
                className={`${s.syncSaveButton} ${
                  justSaved ? s.syncSaveButtonSaved : ''
                }`}
                title="現在の選択をこのリポジトリのデフォルトとして保存"
              >
                {isSaving
                  ? '保存中…'
                  : justSaved
                    ? '保存しました'
                    : 'デフォルトとして保存'}
              </button>
            </div>
            <p className={s.syncHint}>
              .gitignore から抽出した候補と手動追加のパスを
              「コピー / リンク / 含めない」から選択。作成直後に worktree
              へ反映されます。
            </p>

            {!loaded && <p className={s.syncEmpty}>読み込み中…</p>}
            {loaded && rows.length === 0 && (
              <p className={s.syncEmpty}>
                候補なし。下の入力欄から追加できます。
              </p>
            )}

            <div className={s.syncList}>
              {rows.map((row) => (
                <div key={row.path} className={s.syncRow}>
                  <span
                    className={`${s.syncPath} ${row.mode === 'skip' ? s.syncPathMuted : ''}`}
                    title={row.path}
                  >
                    {row.path}
                  </span>
                  <select
                    value={row.mode}
                    onChange={(e) =>
                      updateRowMode(row.path, e.target.value as SyncRowMode)
                    }
                    className={s.syncSelect}
                  >
                    <option value="skip">含めない</option>
                    <option value="copy">コピー</option>
                    <option value="link">リンク</option>
                  </select>
                  {!row.fromSuggestion && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.path)}
                      className={s.syncRemoveButton}
                      title="この行を削除"
                    >
                      <svg
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className={s.syncAddRow}>
              <input
                data-role="sync-add"
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addManualPath();
                  }
                }}
                placeholder=".env, .vscode など（相対パス）"
                className={s.syncAddInput}
              />
              <button
                type="button"
                onClick={addManualPath}
                disabled={!newPath.trim()}
                className={s.syncAddButton}
              >
                追加
              </button>
            </div>
          </div>
        </div>

        <div className={s.modalFooter}>
          <button onClick={onClose} className={s.cancelButton}>
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            disabled={!branchName.trim() || isCreating}
            className={s.createButton}
          >
            {isCreating ? '作成中...' : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorktreeCreateModal;
