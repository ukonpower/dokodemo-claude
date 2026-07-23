import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  GitBranch,
  WorktreeSyncEntry,
  WorktreeSyncMode,
} from '@/types';
import type {
  WorktreeSyncConfigState,
  WorktreeSyncCandidatesState,
} from '@/features/worktree/hooks/useBranchWorktree';
import { useOverlayClose } from '@/shared/hooks/useOverlayClose';
import s from './WorktreeCreateModal.module.scss';

interface WorktreeCreateModalProps {
  parentRepoPath: string;
  branches: GitBranch[];
  onRefreshBranches: () => void;
  syncConfig: WorktreeSyncConfigState | null;
  onRequestSyncConfig: () => void;
  onSaveSyncConfig: (entries: WorktreeSyncEntry[]) => void;
  syncCandidates: WorktreeSyncCandidatesState | null;
  onRequestSyncCandidates: (dirPath: string) => void;
  worktreeCreateError: { message: string } | null;
  onClose: () => void;
  onCreate: (
    branchName: string,
    baseBranch: string | undefined,
    useExisting: boolean,
    syncEntries: WorktreeSyncEntry[]
  ) => void;
}

// 入力中のパスを「ディレクトリ部分」と「フィルタ部分」に分割
function splitPath(input: string): { dirPath: string; filter: string } {
  const trimmed = input.replace(/^\/+/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash === -1) return { dirPath: '', filter: trimmed };
  return {
    dirPath: trimmed.slice(0, lastSlash),
    filter: trimmed.slice(lastSlash + 1),
  };
}

function WorktreeCreateModal({
  parentRepoPath,
  branches,
  onRefreshBranches,
  syncConfig,
  onRequestSyncConfig,
  onSaveSyncConfig,
  syncCandidates,
  onRequestSyncCandidates,
  worktreeCreateError,
  onClose,
  onCreate,
}: WorktreeCreateModalProps) {
  const [branchName, setBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [useExistingBranch, setUseExistingBranch] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [rows, setRows] = useState<WorktreeSyncEntry[]>([]);
  const [hasInitializedRows, setHasInitializedRows] = useState(false);
  const [savingSince, setSavingSince] = useState<number | null>(null);
  const lastSeenSavedAt = useRef<number | undefined>(syncConfig?.lastSavedAt);

  // ブランチ再取得の状態
  const [isRefreshingBranches, setIsRefreshingBranches] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialBranchesRef = useRef(branches);
  const isAwaitingRefreshRef = useRef(false);

  const startRefresh = useCallback(() => {
    isAwaitingRefreshRef.current = true;
    setIsRefreshingBranches(true);
    onRefreshBranches();
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    // 一定時間内に応答がなくてもスピナーは解除（UI を固めない）
    refreshTimerRef.current = setTimeout(() => {
      isAwaitingRefreshRef.current = false;
      setIsRefreshingBranches(false);
    }, 3000);
  }, [onRefreshBranches]);

  // モーダル表示直後に必ず一度ブランチを再取得
  // worktree 切り替え直後など branches がクリアされた状態で開かれても
  // ドロップダウンが空にならないようにする
  useEffect(() => {
    startRefresh();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [startRefresh]);

  // ブランチ配列の参照が変わったら（= 新しい一覧が届いたら）スピナー解除
  useEffect(() => {
    if (!isAwaitingRefreshRef.current) return;
    if (branches === initialBranchesRef.current) return;
    isAwaitingRefreshRef.current = false;
    setIsRefreshingBranches(false);
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, [branches]);

  // 候補ドロップダウンの状態
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const lastRequestedDirRef = useRef<string | null>(null);

  // ドロップダウンの位置（portal で body に描画するため fixed 座標を持つ）
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // 入力中のパスを分割
  const { dirPath: currentDirPath, filter: currentFilter } = useMemo(
    () => splitPath(newPath),
    [newPath]
  );

  // モーダル表示直後にルート候補を取得
  useEffect(() => {
    onRequestSyncCandidates('');
    lastRequestedDirRef.current = '';
  }, [onRequestSyncCandidates]);

  // ディレクトリ部分が変わったら候補を再取得
  useEffect(() => {
    if (lastRequestedDirRef.current === currentDirPath) return;
    lastRequestedDirRef.current = currentDirPath;
    onRequestSyncCandidates(currentDirPath);
  }, [currentDirPath, onRequestSyncCandidates]);

  // 入力が変わったらハイライト位置をリセット
  useEffect(() => {
    setHighlightedIndex(0);
  }, [newPath]);

  // 候補のフィルタリング（現在ディレクトリの候補のみ使用）
  const filteredCandidates = useMemo(() => {
    if (
      !syncCandidates ||
      syncCandidates.parentRepoPath !== parentRepoPath ||
      syncCandidates.dirPath !== currentDirPath
    ) {
      return [];
    }
    const lower = currentFilter.toLowerCase();
    const existingPaths = new Set(rows.map((r) => r.path));
    return syncCandidates.entries
      .filter((e) => e.name.toLowerCase().includes(lower))
      .map((e) => {
        const fullPath = currentDirPath
          ? `${currentDirPath}/${e.name}`
          : e.name;
        return {
          name: e.name,
          type: e.type,
          fullPath,
          alreadyAdded: existingPaths.has(fullPath),
        };
      });
  }, [
    syncCandidates,
    parentRepoPath,
    currentDirPath,
    currentFilter,
    rows,
  ]);

  // ドロップダウン表示位置を入力欄の rect から計算する
  const updateDropdownPosition = useCallback(() => {
    const el = inputWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    // 下に十分なスペースがない場合は上に開く
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      120,
      Math.min(240, openUpward ? spaceAbove : spaceBelow)
    );
    setDropdownPos({
      top: openUpward ? rect.top - gap - maxHeight : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  // 候補ドロップダウンを開いている間、スクロール/リサイズで位置を追従
  const shouldShowDropdown = isSuggestOpen && filteredCandidates.length > 0;
  useLayoutEffect(() => {
    if (!shouldShowDropdown) {
      setDropdownPos(null);
      return;
    }
    updateDropdownPosition();
    const handler = () => updateDropdownPosition();
    // capture: true でモーダル内スクロールも拾う
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [shouldShowDropdown, updateDropdownPosition]);

  // モーダル表示直後に設定の取得をリクエスト
  useEffect(() => {
    onRequestSyncConfig();
  }, [onRequestSyncConfig]);

  // 設定が（このリポジトリ向けに）届いたら一度だけ初期化
  useEffect(() => {
    if (!syncConfig) return;
    if (syncConfig.parentRepoPath !== parentRepoPath) return;
    if (hasInitializedRows) return;
    setRows(syncConfig.entries.map((e) => ({ ...e })));
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
      rows
    );
  };

  // バックエンドからエラーが返ってきたら作成中ローディングを解除
  useEffect(() => {
    if (worktreeCreateError) {
      setIsCreating(false);
    }
  }, [worktreeCreateError]);

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

  const updateRowMode = (path: string, mode: WorktreeSyncMode) => {
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
    setRows((prev) => [...prev, { path: trimmed, mode: 'copy' }]);
    setNewPath('');
  };

  // 候補を選択
  // ファイル: そのまま追加して入力欄をクリア
  // ディレクトリ: パスを補完して `/` を末尾に追加（さらに掘り下げ可能）
  const selectCandidate = (candidate: {
    fullPath: string;
    type: 'file' | 'directory';
    alreadyAdded: boolean;
  }) => {
    if (candidate.type === 'directory') {
      setNewPath(`${candidate.fullPath}/`);
      return;
    }
    if (candidate.alreadyAdded) return;
    setRows((prev) => [...prev, { path: candidate.fullPath, mode: 'copy' }]);
    setNewPath('');
  };

  const handleSaveAsDefault = () => {
    setSavingSince(Date.now());
    onSaveSyncConfig(rows);
  };

  const summary = useMemo(() => {
    const copy = rows.filter((r) => r.mode === 'copy').length;
    const link = rows.filter((r) => r.mode === 'link').length;
    return { copy, link };
  }, [rows]);

  const loaded =
    hasInitializedRows || syncConfig?.parentRepoPath === parentRepoPath;

  const overlayProps = useOverlayClose(onClose);

  return (
    <div className={s.modalOverlay} {...overlayProps}>
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
            <div className={s.fieldLabelRow}>
              <label className={s.fieldLabel}>
                ブランチ名 <span className={s.requiredMark}>*</span>
              </label>
              {useExistingBranch && (
                <button
                  type="button"
                  onClick={startRefresh}
                  disabled={isRefreshingBranches}
                  className={s.refreshButton}
                  title="ブランチ一覧を再読み込み"
                >
                  <svg
                    className={`${s.refreshIcon} ${isRefreshingBranches ? s.spinning : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {isRefreshingBranches ? '更新中…' : '再読み込み'}
                </button>
              )}
            </div>
            {useExistingBranch ? (
              <select
                value={branchName}
                onChange={(e) => handleExistingBranchSelect(e.target.value)}
                className={s.selectInput}
              >
                <option value="">
                  {branches.length === 0 && isRefreshingBranches
                    ? '読み込み中…'
                    : 'ブランチを選択...'}
                </option>
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
              <div className={s.fieldLabelRow}>
                <label className={s.fieldLabel}>元になるブランチ</label>
                <button
                  type="button"
                  onClick={startRefresh}
                  disabled={isRefreshingBranches}
                  className={s.refreshButton}
                  title="ブランチ一覧を再読み込み"
                >
                  <svg
                    className={`${s.refreshIcon} ${isRefreshingBranches ? s.spinning : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  {isRefreshingBranches ? '更新中…' : '再読み込み'}
                </button>
              </div>
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
                {branches.length === 0 && isRefreshingBranches
                  ? 'ブランチ一覧を読み込み中…'
                  : branches.length === 0
                    ? 'ブランチ一覧が取得できませんでした。再読み込みボタンを押してください'
                    : '省略した場合は現在のHEADから新しいブランチを作成します'}
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
              worktree 作成時に親リポジトリからコピー / リンクするパスを
              指定します。下の入力欄から追加できます。
            </p>

            {!loaded && <p className={s.syncEmpty}>読み込み中…</p>}
            {loaded && rows.length === 0 && (
              <p className={s.syncEmpty}>
                同期対象なし。下の入力欄から追加できます。
              </p>
            )}

            <div className={s.syncList}>
              {rows.map((row) => (
                <div key={row.path} className={s.syncRow}>
                  <span className={s.syncPath} title={row.path}>
                    {row.path}
                  </span>
                  <select
                    value={row.mode}
                    onChange={(e) =>
                      updateRowMode(
                        row.path,
                        e.target.value as WorktreeSyncMode
                      )
                    }
                    className={s.syncSelect}
                  >
                    <option value="copy">コピー</option>
                    <option value="link">リンク</option>
                  </select>
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
                </div>
              ))}
            </div>

            <div className={s.syncAddRow}>
              <div className={s.syncAddInputWrap} ref={inputWrapRef}>
                <input
                  data-role="sync-add"
                  type="text"
                  value={newPath}
                  onChange={(e) => {
                    setNewPath(e.target.value);
                    setIsSuggestOpen(true);
                  }}
                  onFocus={() => setIsSuggestOpen(true)}
                  onBlur={() => {
                    // クリック判定のため少し遅延
                    setTimeout(() => setIsSuggestOpen(false), 150);
                  }}
                  onKeyDown={(e) => {
                    if (
                      isSuggestOpen &&
                      filteredCandidates.length > 0 &&
                      (e.key === 'ArrowDown' || e.key === 'ArrowUp')
                    ) {
                      e.preventDefault();
                      const delta = e.key === 'ArrowDown' ? 1 : -1;
                      setHighlightedIndex(
                        (prev) =>
                          (prev + delta + filteredCandidates.length) %
                          filteredCandidates.length
                      );
                      return;
                    }
                    if (e.key === 'Escape' && isSuggestOpen) {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsSuggestOpen(false);
                      return;
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (isSuggestOpen && filteredCandidates.length > 0) {
                        const cand = filteredCandidates[highlightedIndex];
                        if (cand) {
                          selectCandidate(cand);
                          return;
                        }
                      }
                      addManualPath();
                    }
                  }}
                  placeholder=".env, .vscode など（相対パス）"
                  className={s.syncAddInput}
                  autoComplete="off"
                />
                {shouldShowDropdown &&
                  dropdownPos &&
                  createPortal(
                    <ul
                      className={s.suggestList}
                      role="listbox"
                      style={{
                        top: dropdownPos.top,
                        left: dropdownPos.left,
                        width: dropdownPos.width,
                        maxHeight: dropdownPos.maxHeight,
                      }}
                    >
                      {filteredCandidates.map((cand, idx) => (
                        <li
                          key={cand.fullPath}
                          role="option"
                          aria-selected={idx === highlightedIndex}
                          className={`${s.suggestItem} ${
                            idx === highlightedIndex
                              ? s.suggestItemActive
                              : ''
                          } ${cand.alreadyAdded ? s.suggestItemDisabled : ''}`}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          onMouseDown={(e) => {
                            // blur より先に処理する
                            e.preventDefault();
                            selectCandidate(cand);
                          }}
                          onTouchStart={(e) => {
                            // タッチ操作でも blur 前にハンドリング
                            e.preventDefault();
                            selectCandidate(cand);
                          }}
                        >
                          <span className={s.suggestIcon}>
                            {cand.type === 'directory' ? '📁' : '📄'}
                          </span>
                          <span className={s.suggestName}>
                            {cand.name}
                            {cand.type === 'directory' ? '/' : ''}
                          </span>
                          {cand.alreadyAdded && (
                            <span className={s.suggestBadge}>追加済み</span>
                          )}
                        </li>
                      ))}
                    </ul>,
                    document.body
                  )}
              </div>
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

        {worktreeCreateError && (
          <div className={s.createErrorBox} role="alert">
            <div className={s.createErrorTitle}>
              <svg
                className={s.createErrorIcon}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              ワークツリーの作成に失敗しました
            </div>
            <pre className={s.createErrorMessage}>
              {worktreeCreateError.message}
            </pre>
          </div>
        )}

        <div className={s.modalFooter}>
          <button onClick={onClose} className={s.cancelButton}>
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            disabled={!branchName.trim() || isCreating}
            className={s.createButton}
          >
            {isCreating
              ? '作成中...'
              : worktreeCreateError
                ? '再試行'
                : '作成'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorktreeCreateModal;
