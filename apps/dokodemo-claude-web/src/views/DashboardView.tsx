import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Socket } from 'socket.io-client';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Eraser,
  GitCommit,
  LayoutGrid,
  Minus,
  RefreshCw,
  Send,
  Settings,
  Square,
} from 'lucide-react';
import type {
  AiProvider,
  GitRepository,
  GitWorktree,
  RepoProcessStatus,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import { useWorktreeDashboard } from '../hooks/useWorktreeDashboard';
import WorktreeDashboardCard from '../components/WorktreeDashboardCard';
import SettingsModal, { AppSettings } from '../components/SettingsModal';
import s from './DashboardView.module.scss';

interface DashboardViewProps {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  isConnected: boolean;
  worktrees: GitWorktree[];
  parentRepoPath: string;
  currentRepo: string;
  repositories: GitRepository[];
  repoProcessStatuses: RepoProcessStatus[];
  appSettings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onSwitchToProjectView: () => void;
  onOpenWorktree: (path: string) => void;
}

type BroadcastPrefix = 'none' | 'clear' | 'commit';

const COLUMN_OPTIONS: Array<'auto' | 1 | 2 | 3 | 4> = ['auto', 1, 2, 3, 4];

function getColumnsStorageKey(repo: string): string {
  return `dokodemo-dashboard-columns-${repo}`;
}

function getSelectionStorageKey(repo: string): string {
  return `dokodemo-dashboard-selection-${repo}`;
}

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

/**
 * 全 worktree の AI 出力をグリッドで一覧する。各カードから個別に prompt 送信、
 * 上部の入力欄からは選択中の WT へ一斉に送信できる。
 */
export function DashboardView({
  socket,
  isConnected,
  worktrees,
  parentRepoPath,
  currentRepo,
  repositories,
  repoProcessStatuses,
  appSettings,
  onSettingsChange,
  onSwitchToProjectView,
  onOpenWorktree,
}: DashboardViewProps) {
  // 列数（auto / 1-4 列）
  const [columns, setColumns] = useState<'auto' | 1 | 2 | 3 | 4>(() =>
    readColumnsSetting(parentRepoPath || currentRepo)
  );

  // 選択中の rid
  const [selectedRids, setSelectedRids] = useState<Set<string>>(() =>
    readSelection(parentRepoPath || currentRepo)
  );

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

  // rid -> RepoProcessStatus のマップ
  const statusByRid = useMemo(() => {
    const map = new Map<string, RepoProcessStatus>();
    for (const status of repoProcessStatuses) {
      map.set(status.rid, status);
    }
    return map;
  }, [repoProcessStatuses]);

  const dashboard = useWorktreeDashboard(socket, worktrees, repoProvidersByRid);

  // 選択クリーンアップ: 存在しない rid を除去
  useEffect(() => {
    setSelectedRids((prev) => {
      const validRids = new Set(worktreesWithRid.map((x) => x.rid));
      const next = new Set(Array.from(prev).filter((rid) => validRids.has(rid)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [worktreesWithRid]);

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

  const handleBroadcastKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleBroadcast();
      }
    },
    [handleBroadcast]
  );

  const handleColumnsChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === 'auto') setColumns('auto');
    else if (v === '1' || v === '2' || v === '3' || v === '4') {
      setColumns(Number(v) as 1 | 2 | 3 | 4);
    }
  }, []);

  // リポジトリ表示名
  const repoDisplayName = useMemo(() => {
    const info = repositories.find((r) => r.path === currentRepo);
    if (info?.isWorktree && info.parentRepoName) {
      return info.parentRepoName;
    }
    if (info?.name) return info.name;
    return (parentRepoPath || currentRepo).split('/').pop() || 'リポジトリ';
  }, [repositories, currentRepo, parentRepoPath]);

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
  const selectedCount = selectedRids.size;

  return (
    <div className={s.root}>
      <header className={s.header}>
        <div className={s.headerLeft}>
          <a
            href={window.location.pathname}
            className={s.homeLink}
            title="ホームに戻る"
          >
            <LayoutGrid size={16} />
          </a>
          <div className={s.headerTitleGroup}>
            <h1 className={s.repoTitle}>{repoDisplayName}</h1>
            <span className={s.viewLabel}>ダッシュボード</span>
          </div>
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
        </div>
        <div className={s.headerRight}>
          <label className={s.columnsControl} title="列数">
            <span className={s.columnsLabel}>列</span>
            <select
              value={String(columns)}
              onChange={handleColumnsChange}
              className={s.columnsSelect}
            >
              {COLUMN_OPTIONS.map((c) => (
                <option key={String(c)} value={String(c)}>
                  {c === 'auto' ? '自動' : `${c} 列`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => dashboard.refresh()}
            disabled={!isConnected}
            className={s.iconButton}
            title="再読み込み"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className={s.iconButton}
            title="設定"
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={onSwitchToProjectView}
            className={s.modeSwitchButton}
            title="通常表示へ切替"
          >
            <span>通常表示</span>
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      </header>

      <section className={s.broadcastBar}>
        <div className={s.broadcastInner}>
          <div className={s.broadcastInputRow}>
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
                    <span>/clear</span>
                  </>
                ) : broadcastPrefix === 'commit' ? (
                  <>
                    <GitCommit size={14} aria-hidden />
                    <span>/commit</span>
                  </>
                ) : (
                  <>
                    <Minus size={14} aria-hidden />
                    <span>プレフィックス</span>
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
            <textarea
              value={broadcastDraft}
              onChange={(e) => setBroadcastDraft(e.target.value)}
              onKeyDown={handleBroadcastKeyDown}
              placeholder={
                selectedCount === 0
                  ? '一斉送信したい WT を上のチェックボックスで選択してください'
                  : `${selectedCount} 件の worktree に一斉送信 (Ctrl+Enter)`
              }
              rows={2}
              className={s.broadcastTextarea}
            />
            <button
              type="button"
              onClick={handleBroadcast}
              disabled={
                !isConnected ||
                selectedCount === 0 ||
                !broadcastDraft.trim()
              }
              className={s.broadcastSubmit}
              title="一斉送信"
            >
              <Send size={14} />
              <span className={s.broadcastSubmitText}>一斉送信</span>
            </button>
          </div>
        </div>
      </section>

      <main className={s.main}>
        {totalCount === 0 ? (
          <div className={s.empty}>
            <p>worktree がまだありません。通常表示から作成してください。</p>
          </div>
        ) : (
          <div className={s.grid} style={gridStyle}>
            {worktreesWithRid.map(({ wt, rid }) => {
              const status = statusByRid.get(rid);
              const hasPrimary = dashboard.primaryInstances.has(rid);
              const provider =
                dashboard.primaryInstances.get(rid)?.provider ??
                repoProvidersByRid.get(rid);
              return (
                <WorktreeDashboardCard
                  key={wt.path}
                  worktree={wt}
                  rid={rid}
                  isCurrent={wt.path === currentRepo}
                  selected={selectedRids.has(rid)}
                  primaryProvider={provider}
                  aiDisplayStatus={status?.displayAiStatus}
                  hasPrimaryInstance={hasPrimary}
                  queuePending={status?.promptQueuePending ?? 0}
                  diffSummary={dashboard.diffByRid.get(rid)}
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

      {toast && (
        <div className={s.toast} role="status">
          {toast}
        </div>
      )}

      <SettingsModal
        isOpen={showSettings}
        settings={appSettings}
        onClose={() => setShowSettings(false)}
        onSettingsChange={onSettingsChange}
        socket={socket}
        currentRepo={currentRepo}
      />
    </div>
  );
}

export default DashboardView;
