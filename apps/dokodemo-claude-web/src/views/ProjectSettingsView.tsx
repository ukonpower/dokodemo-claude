import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Images,
  Keyboard,
  GitFork,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import Button from '@/shared/components/Button';
import IconButton from '@/shared/components/IconButton';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useSectionScrollSpy } from '@/shared/hooks/useSectionScrollSpy';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import type { FileSource, WorktreeSyncEntry, WorktreeSyncMode } from '@/types';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useFileManagerContext } from '@/features/files/providers/FilesProvider';
import { useAiContext } from '@/features/ai/providers/AiProvider';
import { useWorktreeContext } from '@/features/worktree/providers/WorktreeProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';
import l from './settings-layout.module.scss';
import s from './ProjectSettingsView.module.scss';

type SectionId = 'files' | 'buttons' | 'worktree' | 'danger';

const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'files', label: 'ファイル', icon: Images },
  { id: 'buttons', label: '送信ボタン', icon: Keyboard },
  { id: 'worktree', label: 'ワークツリー', icon: GitFork },
  { id: 'danger', label: '危険な操作', icon: AlertTriangle },
];

/** 一括削除の対象種別と表示ラベル */
const CLEAR_TARGETS: {
  source: FileSource | 'all';
  label: string;
  desc: string;
}[] = [
  {
    source: 'claude',
    label: 'AI が登録したプレビュー',
    desc: 'AI がスクリーンショット等をアップロードしたファイル',
  },
  {
    source: 'user',
    label: '自分がアップロードしたファイル',
    desc: '入力欄への貼り付け・ドロップで送ったファイル',
  },
  {
    source: 'all',
    label: 'すべてのファイル',
    desc: 'このプロジェクトのアップロードをすべて削除します',
  },
];

const SYNC_MODE_LABELS: Record<WorktreeSyncMode, string> = {
  copy: 'コピー',
  link: 'シンボリックリンク',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

interface DeleteRepositoryDialogProps {
  isOpen: boolean;
  projectName: string;
  repoPath: string;
  worktreeCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * リポジトリ削除の確認ダイアログ。
 * 誤操作を防ぐため、プロジェクト名を打ち込むまで実行ボタンを押せない。
 */
function DeleteRepositoryDialog({
  isOpen,
  projectName,
  repoPath,
  worktreeCount,
  onConfirm,
  onCancel,
}: DeleteRepositoryDialogProps) {
  const [typed, setTyped] = useState('');

  // 開き直すたびに入力をリセットする
  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="プロジェクトを削除しますか？"
      confirmLabel="削除する"
      confirmDisabled={typed.trim() !== projectName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className={s.dangerBox}>
        <span className={s.dangerTitle}>
          <AlertTriangle className={s.dangerIcon} aria-hidden />
          この操作は元に戻せません
        </span>
        <ul className={s.dangerList}>
          <li>ディレクトリを削除します</li>
          {worktreeCount > 0 && (
            <li>ワークツリー {worktreeCount} 件も削除されます</li>
          )}
          <li>AI セッション・ターミナルは終了します</li>
          <li>アップロードやメモなどの保存データも消えます</li>
        </ul>
        <p className={s.dangerPath}>{repoPath}</p>
      </div>
      <div className={s.confirmField}>
        <label className={s.confirmLabel} htmlFor="delete-repo-confirm">
          確認のため <span className={s.confirmName}>{projectName}</span>{' '}
          と入力してください
        </label>
        <input
          id="delete-repo-confirm"
          type="text"
          className={s.textInput}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

/**
 * プロジェクト（リポジトリ）単位の設定画面。
 * アプリ全体の設定（SettingsView）とはスコープが違うため独立したビューに分け、
 * 破壊的操作（アップロードの一括削除・リポジトリ削除）もここに集約する。
 */
export function ProjectSettingsView() {
  const { repository } = useRepositoryContext();
  const { currentRepo, deleteRepository, deleteError, clearDeleteError } =
    repository;
  const {
    files,
    deleteAllFiles,
    clearFilesResult,
    dismissClearFilesResult,
    refreshFiles,
  } = useFileManagerContext();
  const { customAiButtons } = useAiContext();
  const {
    worktrees,
    parentRepoPath,
    worktreeSyncConfig,
    requestWorktreeSyncConfig,
    saveWorktreeSyncConfig,
  } = useWorktreeContext();
  const { closeProjectSettings: onBack } = useNavigationContext();

  const bodyRef = useRef<HTMLDivElement>(null);
  const { activeSection, scrollToSection } = useSectionScrollSpy<SectionId>(
    bodyRef,
    'project-settings-'
  );

  // ワークツリーは親リポジトリ側でしか削除できないため、rid の種別で判定する
  const isWorktree = Boolean(repositoryIdMap.getWorktreeId(currentRepo));
  const projectName = currentRepo.split('/').pop() ?? '';
  const worktreeCount = worktrees.filter((wt) => !wt.isMain).length;

  // 開いた時点の最新状態を取得しておく
  useEffect(() => {
    refreshFiles();
    requestWorktreeSyncConfig();
  }, [refreshFiles, requestWorktreeSyncConfig]);

  // --- ファイル ---

  const fileStats = useMemo(() => {
    const bySource = (source: FileSource) =>
      files.filter((f) => f.source === source);
    const sum = (list: typeof files) =>
      list.reduce((acc, f) => acc + f.size, 0);
    return {
      all: { count: files.length, bytes: sum(files) },
      claude: {
        count: bySource('claude').length,
        bytes: sum(bySource('claude')),
      },
      user: { count: bySource('user').length, bytes: sum(bySource('user')) },
    };
  }, [files]);

  const [clearTarget, setClearTarget] = useState<FileSource | 'all' | null>(
    null
  );
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const clearTargetStat =
    clearTarget === null ? null : fileStats[clearTarget === 'all' ? 'all' : clearTarget];

  const handleConfirmClear = () => {
    if (clearTarget === null) return;
    deleteAllFiles(clearTarget);
    setClearTarget(null);
  };

  // --- カスタム送信ボタン（このプロジェクト固有のもの） ---

  const repoButtons = useMemo(
    () =>
      customAiButtons.allButtons.filter(
        (btn) =>
          btn.scope === 'repository' && btn.repositoryPath === currentRepo
      ),
    [customAiButtons.allButtons, currentRepo]
  );

  // --- ワークツリー同期設定 ---

  const [syncRows, setSyncRows] = useState<WorktreeSyncEntry[]>([]);
  // 保存済みとして扱う内容（未保存判定の基準）
  const [syncSaved, setSyncSaved] = useState<WorktreeSyncEntry[]>([]);
  const [newSyncPath, setNewSyncPath] = useState('');
  const [newSyncMode, setNewSyncMode] = useState<WorktreeSyncMode>('copy');
  // 同期設定はワークツリーではなく親リポジトリ単位で持つ
  const syncTargetRepo = parentRepoPath || currentRepo;
  // 編集内容を取り込み済みのリポジトリ（切り替え時に読み直すための目印）
  const syncLoadedRepoRef = useRef<string | null>(null);
  // 保存要求中の内容（保存完了の通知を受けてから基準を更新する）
  const syncPendingRef = useRef<WorktreeSyncEntry[] | null>(null);
  const lastSavedAtRef = useRef<number | undefined>(undefined);

  // 保存済み設定が届いたら編集用の行に反映する（リポジトリごとに1回）
  useEffect(() => {
    if (!worktreeSyncConfig) return;
    if (worktreeSyncConfig.parentRepoPath !== syncTargetRepo) return;
    if (syncLoadedRepoRef.current === syncTargetRepo) return;
    syncLoadedRepoRef.current = syncTargetRepo;
    const entries = worktreeSyncConfig.entries.map((e) => ({ ...e }));
    setSyncRows(entries);
    setSyncSaved(entries);
  }, [worktreeSyncConfig, syncTargetRepo]);

  // 保存が成功したら未保存表示を解除する
  useEffect(() => {
    const savedAt = worktreeSyncConfig?.lastSavedAt;
    if (!savedAt || savedAt === lastSavedAtRef.current) return;
    lastSavedAtRef.current = savedAt;
    if (syncPendingRef.current) {
      setSyncSaved(syncPendingRef.current);
      syncPendingRef.current = null;
    }
  }, [worktreeSyncConfig?.lastSavedAt]);

  const syncDirty =
    JSON.stringify(syncRows) !== JSON.stringify(syncSaved);

  const handleSaveSync = () => {
    syncPendingRef.current = syncRows.map((r) => ({ ...r }));
    saveWorktreeSyncConfig(syncRows);
  };

  const handleAddSyncRow = () => {
    const path = newSyncPath.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (!path) return;
    if (syncRows.some((r) => r.path === path)) return;
    setSyncRows((prev) => [...prev, { path, mode: newSyncMode }]);
    setNewSyncPath('');
  };

  return (
    <div className={l.root}>
      <header className={l.header}>
        <h1 className={l.headerTitle}>プロジェクト設定</h1>
        <span className={l.headerSubject} title={currentRepo}>
          {projectName}
        </span>
        <IconButton label="閉じる" onClick={onBack} className={l.headerClose}>
          <X />
        </IconButton>
      </header>

      <div className={l.body} ref={bodyRef}>
        <div className={l.layout}>
          <nav className={l.nav} aria-label="プロジェクト設定カテゴリ">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                className={`${l.navItem} ${activeSection === id ? l.navItemActive : ''}`}
              >
                <Icon className={l.navIcon} />
                {label}
              </button>
            ))}
          </nav>

          <div>
            {/* ファイル */}
            <section
              id="project-settings-files"
              data-section-id="files"
              className={l.section}
            >
              <h2 className={l.sectionTitle}>ファイル</h2>
              <div className={l.card}>
                <div className={l.rowStack}>
                  <div className={l.rowInfo}>
                    <span className={l.rowLabel}>アップロード済みファイル</span>
                    <p className={l.rowDesc}>
                      プレビューや入力欄から送ったファイルの保存状況です。削除するとリンク済みのプレビューも表示できなくなります
                    </p>
                    {clearFilesResult && (
                      <p
                        className={
                          clearFilesResult.success
                            ? l.messageSuccess
                            : l.messageError
                        }
                      >
                        {clearFilesResult.message}
                        {clearFilesResult.deletedCount > 0 &&
                          `（${formatBytes(clearFilesResult.freedBytes)} 解放）`}
                      </p>
                    )}
                  </div>
                  <div className={s.fileStats}>
                    <div className={s.fileStat}>
                      <span className={s.fileStatValue}>
                        {fileStats.all.count}件 /{' '}
                        {formatBytes(fileStats.all.bytes)}
                      </span>
                      <span className={s.fileStatLabel}>合計</span>
                    </div>
                    <div className={s.fileStat}>
                      <span className={s.fileStatValue}>
                        {fileStats.claude.count}件 /{' '}
                        {formatBytes(fileStats.claude.bytes)}
                      </span>
                      <span className={s.fileStatLabel}>AI プレビュー</span>
                    </div>
                    <div className={s.fileStat}>
                      <span className={s.fileStatValue}>
                        {fileStats.user.count}件 /{' '}
                        {formatBytes(fileStats.user.bytes)}
                      </span>
                      <span className={s.fileStatLabel}>自分のアップロード</span>
                    </div>
                  </div>
                </div>

                {CLEAR_TARGETS.map(({ source, label, desc }) => {
                  const stat =
                    source === 'all' ? fileStats.all : fileStats[source];
                  return (
                    <div className={l.row} key={source}>
                      <div className={l.rowInfo}>
                        <span className={l.rowLabel}>{label}</span>
                        <p className={l.rowDesc}>{desc}</p>
                      </div>
                      <div className={l.rowControl}>
                        <span className={l.statusInactive}>{stat.count}件</span>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={stat.count === 0}
                          onClick={() => {
                            dismissClearFilesResult();
                            setClearTarget(source);
                          }}
                        >
                          一括削除
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 送信ボタン */}
            <section
              id="project-settings-buttons"
              data-section-id="buttons"
              className={l.section}
            >
              <h2 className={l.sectionTitle}>送信ボタン</h2>
              <div className={l.card}>
                <div className={l.rowStack}>
                  <div className={l.rowInfo}>
                    <span className={l.rowLabel}>
                      このプロジェクト固有のボタン
                    </span>
                    <p className={l.rowDesc}>
                      AI CLI の下に並ぶカスタム送信ボタンのうち、このプロジェクトでだけ表示されるものです。追加と編集は CLI 下のボタン列から行えます
                    </p>
                  </div>
                  {repoButtons.length === 0 ? (
                    <p className={s.emptyText}>
                      このプロジェクト固有のボタンはありません
                    </p>
                  ) : (
                    <div className={s.list}>
                      {repoButtons.map((btn) => (
                        <div className={s.listItem} key={btn.id}>
                          <div className={s.listItemMain}>
                            <span className={s.listItemTitle}>{btn.name}</span>
                            <span className={s.listItemSub} title={btn.command}>
                              {btn.command}
                            </span>
                          </div>
                          <div className={s.listItemActions}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                customAiButtons.updateButton(
                                  btn.id,
                                  btn.name,
                                  btn.command,
                                  'global'
                                )
                              }
                            >
                              共通にする
                            </Button>
                            <IconButton
                              size="xs"
                              label={`「${btn.name}」を削除`}
                              onClick={() =>
                                customAiButtons.deleteButton(btn.id)
                              }
                            >
                              <Trash2 />
                            </IconButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* ワークツリー */}
            <section
              id="project-settings-worktree"
              data-section-id="worktree"
              className={l.section}
            >
              <h2 className={l.sectionTitle}>ワークツリー</h2>
              <div className={l.card}>
                <div className={l.rowStack}>
                  <div className={l.rowInfo}>
                    <span className={l.rowLabel}>作成時に同期するファイル</span>
                    <p className={l.rowDesc}>
                      新しいワークツリーを作るときに、親リポジトリから引き継ぐファイル・ディレクトリです（.env や node_modules など）。パスはリポジトリルートからの相対パスで指定します
                    </p>
                    {worktreeSyncConfig?.lastSaveError && (
                      <p className={l.messageError}>
                        {worktreeSyncConfig.lastSaveError}
                      </p>
                    )}
                  </div>

                  {syncRows.length === 0 ? (
                    <p className={s.emptyText}>同期するファイルは未設定です</p>
                  ) : (
                    <div className={s.list}>
                      {syncRows.map((row) => (
                        <div className={s.listItem} key={row.path}>
                          <div className={s.listItemMain}>
                            <span className={s.listItemSub} title={row.path}>
                              {row.path}
                            </span>
                          </div>
                          <div className={s.listItemActions}>
                            <select
                              className={s.select}
                              value={row.mode}
                              aria-label={`${row.path} の同期方法`}
                              onChange={(e) =>
                                setSyncRows((prev) =>
                                  prev.map((r) =>
                                    r.path === row.path
                                      ? {
                                          ...r,
                                          mode: e.target
                                            .value as WorktreeSyncMode,
                                        }
                                      : r
                                  )
                                )
                              }
                            >
                              {(
                                Object.keys(SYNC_MODE_LABELS) as
                                  WorktreeSyncMode[]
                              ).map((mode) => (
                                <option key={mode} value={mode}>
                                  {SYNC_MODE_LABELS[mode]}
                                </option>
                              ))}
                            </select>
                            <IconButton
                              size="xs"
                              label={`${row.path} を同期対象から外す`}
                              onClick={() =>
                                setSyncRows((prev) =>
                                  prev.filter((r) => r.path !== row.path)
                                )
                              }
                            >
                              <Trash2 />
                            </IconButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className={s.inputRow}>
                    <input
                      type="text"
                      className={s.textInput}
                      value={newSyncPath}
                      placeholder=".env.local"
                      aria-label="同期するパス"
                      onChange={(e) => setNewSyncPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSyncRow();
                        }
                      }}
                    />
                    <select
                      className={s.select}
                      value={newSyncMode}
                      aria-label="追加するパスの同期方法"
                      onChange={(e) =>
                        setNewSyncMode(e.target.value as WorktreeSyncMode)
                      }
                    >
                      {(
                        Object.keys(SYNC_MODE_LABELS) as WorktreeSyncMode[]
                      ).map((mode) => (
                        <option key={mode} value={mode}>
                          {SYNC_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleAddSyncRow}
                      disabled={newSyncPath.trim().length === 0}
                    >
                      追加
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleSaveSync}
                      disabled={!syncDirty}
                    >
                      {syncDirty ? '保存' : '保存済み'}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            {/* 危険な操作 */}
            <section
              id="project-settings-danger"
              data-section-id="danger"
              className={l.section}
            >
              <h2 className={l.sectionTitle}>危険な操作</h2>
              <div className={`${l.card} ${l.cardDanger}`}>
                <div className={l.rowStack}>
                  <div className={l.rowInfo}>
                    <span className={l.rowLabel}>このプロジェクトを削除</span>
                    <p className={l.rowDesc}>
                      {isWorktree
                        ? '表示中はワークツリーです。ワークツリーの削除はワークツリータブのメニューから行ってください（git の登録も併せて解除されます）'
                        : 'ディスク上のリポジトリディレクトリごと削除します。元に戻せません'}
                    </p>
                    {deleteError && (
                      <p className={l.messageError}>{deleteError}</p>
                    )}
                  </div>
                  {!isWorktree && (
                    <div className={s.dangerBox}>
                      <span className={s.dangerTitle}>
                        <AlertTriangle className={s.dangerIcon} aria-hidden />
                        削除されるもの
                      </span>
                      <ul className={s.dangerList}>
                        <li>リポジトリディレクトリ全体</li>
                        {worktreeCount > 0 && (
                          <li>このリポジトリのワークツリー {worktreeCount}件</li>
                        )}
                        <li>AI セッション・ターミナル・プロンプトキュー</li>
                        <li>
                          アップロードファイル・ワークツリーのメモ・同期設定・このプロジェクト固有の送信ボタン
                        </li>
                      </ul>
                      <p className={s.dangerPath}>{currentRepo}</p>
                    </div>
                  )}
                  {!isWorktree && (
                    <div className={l.rowControl}>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          clearDeleteError();
                          setShowDeleteDialog(true);
                        }}
                      >
                        このプロジェクトを削除...
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* アップロード一括削除の確認 */}
      <ConfirmDialog
        isOpen={clearTarget !== null}
        title="ファイルを一括削除しますか？"
        confirmLabel="削除する"
        onConfirm={handleConfirmClear}
        onCancel={() => setClearTarget(null)}
      >
        <div className={s.dangerBox}>
          <span className={s.dangerTitle}>
            <AlertTriangle className={s.dangerIcon} aria-hidden />
            この操作は元に戻せません
          </span>
          <ul className={s.dangerList}>
            <li>
              {CLEAR_TARGETS.find((t) => t.source === clearTarget)?.label}:{' '}
              {clearTargetStat?.count ?? 0}件（
              {formatBytes(clearTargetStat?.bytes ?? 0)}）
            </li>
            <li>送信済みのプロンプトから参照しているファイルも消えます</li>
          </ul>
        </div>
      </ConfirmDialog>

      {/* リポジトリ削除の確認 */}
      <DeleteRepositoryDialog
        isOpen={showDeleteDialog}
        projectName={projectName}
        repoPath={currentRepo}
        worktreeCount={worktreeCount}
        onCancel={() => setShowDeleteDialog(false)}
        onConfirm={() => {
          setShowDeleteDialog(false);
          deleteRepository(currentRepo, projectName);
        }}
      />
    </div>
  );
}

export default ProjectSettingsView;
