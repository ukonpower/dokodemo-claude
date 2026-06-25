import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { Socket } from 'socket.io-client';
import {
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  Eraser,
  Filter,
  GitCommit,
  Minus,
  PanelLeft,
  RefreshCw,
  Square,
} from 'lucide-react';
import type {
  AiInstance,
  AiProvider,
  EditorInfo,
  EditorType,
  GitRepository,
  GitWorktree,
  RepoProcessStatus,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import { useWorktreeDashboard } from '../hooks/useWorktreeDashboard';
import RepoHeader from '../components/RepoHeader';
import RepositorySwitcher from '../components/RepositorySwitcher';
import WorktreeDashboardCard from '../components/WorktreeDashboardCard';
import DashboardPromptInput from '../components/DashboardPromptInput';
import DashboardSidebar, {
  DashboardSidebarHandle,
} from '../components/DashboardSidebar';
import DashboardFilterModal from '../components/DashboardFilterModal';
import SettingsModal, { AppSettings } from '../components/SettingsModal';
import s from './DashboardView.module.scss';

interface DashboardViewProps {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  isConnected: boolean;
  isReconnecting: boolean;
  connectionAttempts: number;
  primaryInstance?: AiInstance;
  worktrees: GitWorktree[];
  parentRepoPath: string;
  currentRepo: string;
  repositories: GitRepository[];
  repoProcessStatuses: RepoProcessStatus[];
  lastAccessTimes: Record<string, number>;
  appSettings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onSwitchToProjectView: () => void;
  onOpenWorktree: (path: string) => void;
  onSwitchRepository: (path: string) => void;

  // RepoHeader 用
  onOpenFileViewer: () => void;
  onStartCodeServer: () => void;
  startingCodeServer: boolean;
  isLocalhost: boolean;
  availableEditors: EditorInfo[];
  showEditorMenu: boolean;
  setShowEditorMenu: (show: boolean) => void;
  editorMenuRef: RefObject<HTMLDivElement | null>;
  onOpenInEditor: (id: EditorType) => void;
  remoteUrl: string | null;
}

type BroadcastPrefix = 'none' | 'clear' | 'commit';

const COLUMN_OPTIONS: Array<'auto' | 1 | 2 | 3 | 4> = ['auto', 1, 2, 3, 4];

function getColumnsStorageKey(repo: string): string {
  return `dokodemo-dashboard-columns-${repo}`;
}

function getSelectionStorageKey(repo: string): string {
  return `dokodemo-dashboard-selection-${repo}`;
}

function getHiddenStorageKey(repo: string): string {
  // 「非表示」を保存することで、新規 worktree がデフォルトで表示される挙動になる
  return `dokodemo-dashboard-hidden-${repo}`;
}

const SIDEBAR_OPEN_STORAGE_KEY = 'dokodemo-dashboard-sidebar-open';

function readColumnsSetting(repo: string): 'auto' | 1 | 2 | 3 | 4 {
  try {
    const saved = localStorage.getItem(getColumnsStorageKey(repo));
    if (saved === 'auto') return 'auto';
    const n = Number(saved);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  } catch {
    /* noop */
  }
  return 'auto';
}

function readSelection(repo: string): Set<string> {
  try {
    const saved = localStorage.getItem(getSelectionStorageKey(repo));
    if (!saved) return new Set();
    const arr = JSON.parse(saved);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* noop */
  }
  return new Set();
}

function writeSelection(repo: string, sel: Set<string>): void {
  try {
    localStorage.setItem(
      getSelectionStorageKey(repo),
      JSON.stringify(Array.from(sel))
    );
  } catch {
    /* noop */
  }
}

function readHidden(repo: string): Set<string> {
  try {
    const saved = localStorage.getItem(getHiddenStorageKey(repo));
    if (!saved) return new Set();
    const arr = JSON.parse(saved);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* noop */
  }
  return new Set();
}

function writeHidden(repo: string, hidden: Set<string>): void {
  try {
    localStorage.setItem(
      getHiddenStorageKey(repo),
      JSON.stringify(Array.from(hidden))
    );
  } catch {
    /* noop */
  }
}

function readSidebarOpen(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    if (saved === 'false') return false;
  } catch {
    /* noop */
  }
  return true;
}

/**
 * 全 worktree の AI 出力をグリッドで一覧する。各カードから個別に prompt 送信、
 * 上部の入力欄からは選択中の WT へ一斉に送信できる。
 */
export function DashboardView({
  socket,
  isConnected,
  isReconnecting,
  connectionAttempts,
  primaryInstance,
  worktrees,
  parentRepoPath,
  currentRepo,
  repositories,
  repoProcessStatuses,
  lastAccessTimes,
  appSettings,
  onSettingsChange,
  onSwitchToProjectView,
  onOpenWorktree,
  onSwitchRepository,
  onOpenFileViewer,
  onStartCodeServer,
  startingCodeServer,
  isLocalhost,
  availableEditors,
  showEditorMenu,
  setShowEditorMenu,
  editorMenuRef,
  onOpenInEditor,
  remoteUrl,
}: DashboardViewProps) {
  // 列数（auto / 1-4 列）
  const [columns, setColumns] = useState<'auto' | 1 | 2 | 3 | 4>(() =>
    readColumnsSetting(parentRepoPath || currentRepo)
  );

  // 選択中の rid（一斉送信対象）
  const [selectedRids, setSelectedRids] = useState<Set<string>>(() =>
    readSelection(parentRepoPath || currentRepo)
  );

  // 非表示の rid（カードグリッドに出さない WT。"非表示" を保存することで
  // 新しく作られた WT がデフォルトで表示される）
  const [hiddenRids, setHiddenRids] = useState<Set<string>>(() =>
    readHidden(parentRepoPath || currentRepo)
  );

  // PC: サイドバー開閉。SP: 表示フィルタモーダル開閉
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    readSidebarOpen()
  );
  const [showFilterModal, setShowFilterModal] = useState(false);

  // 一斉送信入力
  const [broadcastDraft, setBroadcastDraft] = useState('');
  const [broadcastPrefix, setBroadcastPrefix] = useState<BroadcastPrefix>('none');
  const [showPrefixMenu, setShowPrefixMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 設定モーダル
  const [showSettings, setShowSettings] = useState(false);

  // 列数の永続化
  useEffect(() => {
    try {
      localStorage.setItem(
        getColumnsStorageKey(parentRepoPath || currentRepo),
        String(columns)
      );
    } catch {
      /* noop */
    }
  }, [columns, parentRepoPath, currentRepo]);

  // 選択状態の永続化
  useEffect(() => {
    writeSelection(parentRepoPath || currentRepo, selectedRids);
  }, [selectedRids, parentRepoPath, currentRepo]);

  // 非表示状態の永続化
  useEffect(() => {
    writeHidden(parentRepoPath || currentRepo, hiddenRids);
  }, [hiddenRids, parentRepoPath, currentRepo]);

  // サイドバー開閉の永続化
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen));
    } catch {
      /* noop */
    }
  }, [sidebarOpen]);

  // worktree の rid 集合
  const worktreesWithRid = useMemo(
    () =>
      worktrees
        .map((wt) => ({ wt, rid: repositoryIdMap.getRid(wt.path) }))
        .filter((x): x is { wt: GitWorktree; rid: string } => Boolean(x.rid)),
    [worktrees]
  );

  // rid -> primary provider のマップ
  const repoProvidersByRid = useMemo(() => {
    const map = new Map<string, AiProvider>();
    for (const status of repoProcessStatuses) {
      if (status.primaryProvider) {
        map.set(status.rid, status.primaryProvider);
      } else {
        // primary が無ければ displayProvider をフォールバックに使用
        map.set(status.rid, status.displayProvider);
      }
    }
    return map;
  }, [repoProcessStatuses]);

  const dashboard = useWorktreeDashboard(socket, worktrees, repoProvidersByRid);

  // 選択・非表示クリーンアップ: 存在しない rid を除去
  useEffect(() => {
    const validRids = new Set(worktreesWithRid.map((x) => x.rid));
    setSelectedRids((prev) => {
      const next = new Set(Array.from(prev).filter((rid) => validRids.has(rid)));
      return next.size === prev.size ? prev : next;
    });
    setHiddenRids((prev) => {
      const next = new Set(Array.from(prev).filter((rid) => validRids.has(rid)));
      return next.size === prev.size ? prev : next;
    });
  }, [worktreesWithRid]);

  // visible: hidden に入っていない rid
  const visibleRids = useMemo(() => {
    const set = new Set<string>();
    for (const { rid } of worktreesWithRid) {
      if (!hiddenRids.has(rid)) set.add(rid);
    }
    return set;
  }, [worktreesWithRid, hiddenRids]);

  // グリッドに描画する WT
  const visibleWorktreesWithRid = useMemo(
    () => worktreesWithRid.filter((x) => visibleRids.has(x.rid)),
    [worktreesWithRid, visibleRids]
  );

  // トースト自動消去
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleToggleSelected = useCallback((rid: string) => {
    setSelectedRids((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) {
        next.delete(rid);
      } else {
        next.add(rid);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedRids(new Set(worktreesWithRid.map((x) => x.rid)));
  }, [worktreesWithRid]);

  const handleClearSelection = useCallback(() => {
    setSelectedRids(new Set());
  }, []);

  // 表示 ON/OFF（hidden を反転）
  const handleToggleVisible = useCallback((rid: string) => {
    setHiddenRids((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  }, []);

  const handleSetAllVisible = useCallback(
    (visible: boolean) => {
      if (visible) {
        setHiddenRids(new Set());
      } else {
        setHiddenRids(new Set(worktreesWithRid.map((x) => x.rid)));
      }
    },
    [worktreesWithRid]
  );

  // 個別 WT へのプロンプト送信
  const handleSendPromptToWorktree = useCallback(
    (rid: string, prompt: string, options: { addToQueue: boolean }) => {
      if (options.addToQueue) {
        dashboard.broadcastPrompt([rid], prompt, {});
      } else {
        dashboard.sendCommand(rid, prompt, 'prompt');
      }
    },
    [dashboard]
  );

  // 各カードの xterm サイズに合わせて PTY をリサイズ
  const handleResizeInstance = useCallback(
    (rid: string, cols: number, rows: number) => {
      dashboard.resizeInstance(rid, cols, rows);
    },
    [dashboard]
  );

  // 一斉送信
  const handleBroadcast = useCallback(() => {
    const trimmed = broadcastDraft.trim();
    if (!trimmed) return;
    if (selectedRids.size === 0) {
      setToast('送信先 worktree を選択してください');
      return;
    }
    const rids = Array.from(selectedRids);
    dashboard.broadcastPrompt(rids, trimmed, {
      sendClearBefore: broadcastPrefix === 'clear',
      sendCommitAfter: broadcastPrefix === 'commit',
    });
    setBroadcastDraft('');
    setToast(`${rids.length} 件の worktree に送信しました`);
  }, [broadcastDraft, broadcastPrefix, dashboard, selectedRids]);

  const handleColumnsChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === 'auto') setColumns('auto');
    else if (v === '1' || v === '2' || v === '3' || v === '4') {
      setColumns(Number(v) as 1 | 2 | 3 | 4);
    }
  }, []);

  // グリッドの style（columns に応じて切替）
  const gridStyle = useMemo(() => {
    if (columns === 'auto') {
      return {
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      };
    }
    return {
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    };
  }, [columns]);

  const totalCount = worktreesWithRid.length;
  const visibleCount = visibleWorktreesWithRid.length;
  const selectedCount = selectedRids.size;

  return (
    <div className={s.root}>
      <RepoHeader
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        connectionAttempts={connectionAttempts}
        primaryInstance={primaryInstance}
        repositories={repositories}
        currentRepo={currentRepo}
        onOpenFileViewer={onOpenFileViewer}
        onOpenSettings={() => setShowSettings(true)}
        onStartCodeServer={onStartCodeServer}
        startingCodeServer={startingCodeServer}
        isLocalhost={isLocalhost}
        availableEditors={availableEditors}
        showEditorMenu={showEditorMenu}
        setShowEditorMenu={setShowEditorMenu}
        editorMenuRef={editorMenuRef}
        onOpenInEditor={onOpenInEditor}
        remoteUrl={remoteUrl}
      />

      <div className={s.toolbar}>
        <div className={s.toolbarLeft}>
          <button
            type="button"
            onClick={onSwitchToProjectView}
            className={s.modeSwitchButton}
            title="ダッシュボードを閉じる"
          >
            <ChevronLeft size={14} aria-hidden />
            <span>ダッシュボードを閉じる</span>
          </button>
          {/* PC: サイドバーが閉じているときに開くボタン */}
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className={`${s.modeSwitchButton} ${s.pcOnlyButton}`}
              title="サイドバーを開く"
            >
              <PanelLeft size={14} aria-hidden />
              <span>サイドバー</span>
            </button>
          )}
          {/* SP: 表示する worktree を絞り込むモーダルを開く */}
          <button
            type="button"
            onClick={() => setShowFilterModal(true)}
            className={`${s.modeSwitchButton} ${s.spOnlyButton}`}
            title="表示する worktree を選択"
          >
            <Filter size={14} aria-hidden />
            <span>
              表示 {visibleCount}/{totalCount}
            </span>
          </button>
          <button
            type="button"
            onClick={selectedCount === totalCount ? handleClearSelection : handleSelectAll}
            className={s.selectionChip}
            title={
              selectedCount === totalCount
                ? '選択をすべて解除'
                : 'すべて選択'
            }
          >
            {selectedCount === totalCount && totalCount > 0 ? (
              <CheckSquare size={14} aria-hidden />
            ) : (
              <Square size={14} aria-hidden />
            )}
            <span>
              {selectedCount}/{totalCount}
            </span>
          </button>
          <label className={s.columnsControl} title="列数">
            <select
              value={String(columns)}
              onChange={handleColumnsChange}
              className={s.columnsSelect}
            >
              {COLUMN_OPTIONS.map((c) => (
                <option key={String(c)} value={String(c)}>
                  {c === 'auto' ? '列数: 自動' : `列数: ${c}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={s.toolbarRight}>
          <button
            type="button"
            onClick={() => dashboard.refresh()}
            disabled={!isConnected}
            className="btn-icon"
            title="再読み込み"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className={s.contentRow}>
        {/* PC のみ: サイドバー本体（開）/ ハンドル（閉） */}
        <div className={s.sidebarSlot}>
          {sidebarOpen ? (
            <DashboardSidebar
              worktreesWithRid={worktreesWithRid}
              visibleRids={visibleRids}
              selectedRids={selectedRids}
              onToggleVisible={handleToggleVisible}
              onToggleSelected={handleToggleSelected}
              onSetAllVisible={handleSetAllVisible}
              onSelectAll={handleSelectAll}
              onClearSelection={handleClearSelection}
              onOpenWorktreeInNormalView={onOpenWorktree}
              onCollapse={() => setSidebarOpen(false)}
            />
          ) : (
            <DashboardSidebarHandle onExpand={() => setSidebarOpen(true)} />
          )}
        </div>

        <main className={s.main}>
          {totalCount === 0 ? (
            <div className={s.empty}>
              <p>worktree がまだありません。通常表示から作成してください。</p>
            </div>
          ) : visibleCount === 0 ? (
            <div className={s.empty}>
              <p>表示中の worktree がありません。サイドバー（PC）またはフィルタ（SP）から表示を有効にしてください。</p>
            </div>
          ) : (
            <div className={s.grid} style={gridStyle}>
              {visibleWorktreesWithRid.map(({ wt, rid }) => {
                const hasPrimary = dashboard.primaryInstances.has(rid);
                return (
                  <WorktreeDashboardCard
                    key={wt.path}
                    worktree={wt}
                    rid={rid}
                    selected={selectedRids.has(rid)}
                    hasPrimaryInstance={hasPrimary}
                    messages={dashboard.outputByRid.get(rid) ?? []}
                    canSend={isConnected && hasPrimary}
                    onToggleSelected={handleToggleSelected}
                    onOpenInNormalView={onOpenWorktree}
                    onSendPrompt={handleSendPromptToWorktree}
                    onResizeInstance={handleResizeInstance}
                  />
                );
              })}
            </div>
          )}
        </main>
      </div>

      {selectedCount > 0 && (
        <section className={s.broadcastBar}>
        <div className={s.broadcastInner}>
          <DashboardPromptInput
            value={broadcastDraft}
            onChange={setBroadcastDraft}
            onSubmit={handleBroadcast}
            disabled={!isConnected}
            placeholder={`${selectedCount} 件の worktree に一斉送信 (Ctrl+Enter)`}
            submitLabel="一斉送信"
            submitTitle={`${selectedCount} 件に一斉送信`}
            size="md"
            leadingExtras={
              <div className={s.prefixWrapper}>
                <button
                  type="button"
                  onClick={() => setShowPrefixMenu((v) => !v)}
                  className={`${s.prefixButton} ${broadcastPrefix !== 'none' ? s.prefixActive : ''}`}
                  title="プレフィックス"
                >
                  {broadcastPrefix === 'clear' ? (
                    <>
                      <Eraser size={14} aria-hidden />
                      <span className={s.prefixLabel}>/clear</span>
                    </>
                  ) : broadcastPrefix === 'commit' ? (
                    <>
                      <GitCommit size={14} aria-hidden />
                      <span className={s.prefixLabel}>/commit</span>
                    </>
                  ) : (
                    <>
                      <Minus size={14} aria-hidden />
                      <span className={s.prefixLabel}>プレフィックス</span>
                    </>
                  )}
                  <ChevronDown size={14} aria-hidden />
                </button>
                {showPrefixMenu && (
                  <div className={s.prefixMenu}>
                    {(
                      [
                        { v: 'none', label: 'なし', icon: Minus },
                        { v: 'clear', label: '/clear（送信前）', icon: Eraser },
                        { v: 'commit', label: '/commit（送信後）', icon: GitCommit },
                      ] as Array<{
                        v: BroadcastPrefix;
                        label: string;
                        icon: typeof Minus;
                      }>
                    ).map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          type="button"
                          key={opt.v}
                          onClick={() => {
                            setBroadcastPrefix(opt.v);
                            setShowPrefixMenu(false);
                          }}
                          className={`${s.prefixMenuItem} ${broadcastPrefix === opt.v ? s.prefixMenuItemActive : ''}`}
                        >
                          <Icon size={14} aria-hidden />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            }
          />
        </div>
        </section>
      )}

      {toast && (
        <div className={s.toast} role="status">
          {toast}
        </div>
      )}

      <DashboardFilterModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        worktreesWithRid={worktreesWithRid}
        visibleRids={visibleRids}
        onToggleVisible={handleToggleVisible}
        onSetAllVisible={handleSetAllVisible}
      />

      <SettingsModal
        isOpen={showSettings}
        settings={appSettings}
        onClose={() => setShowSettings(false)}
        onSettingsChange={onSettingsChange}
        socket={socket}
        currentRepo={currentRepo}
      />

      <RepositorySwitcher
        repositories={repositories}
        currentRepo={currentRepo}
        lastAccessTimes={lastAccessTimes}
        repoProcessStatuses={repoProcessStatuses}
        onSwitchRepository={onSwitchRepository}
      />
    </div>
  );
}

export default DashboardView;
