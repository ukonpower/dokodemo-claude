import { useCallback, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MoreVertical,
  Home,
  Plus,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Trash2,
  ArrowLeft,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useOutsideClose } from '@/shared/hooks/useOutsideClose';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { GitWorktree, GitWorktreePrInfo } from '@/types';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useWorktreeContext } from '@/features/worktree/providers/WorktreeProvider';
import { setLastWorktreeForParent } from '@/shared/utils/last-tab-storage';
import WorktreeCreateModal from './WorktreeCreateModal';
import s from './WorktreeTabs.module.scss';

// ドラッグ移動を横軸のみに制限する modifier
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

interface PrStateVisual {
  label: string;
  Icon: LucideIcon;
  colorClass: string;
}

/**
 * PR の状態から表示ラベル・アイコン・色クラスを決める。
 * Draft は state が OPEN のまま isDraft で区別されるため、OPEN より先に判定する
 */
function getPrStateVisual(pr: GitWorktreePrInfo): PrStateVisual {
  if (pr.state === 'OPEN' && pr.isDraft) {
    return { label: 'Draft', Icon: GitPullRequestDraft, colorClass: s.prDraft };
  }
  if (pr.state === 'OPEN') {
    return { label: 'Open', Icon: GitPullRequest, colorClass: s.prOpen };
  }
  if (pr.state === 'MERGED') {
    return { label: 'Merged', Icon: GitMerge, colorClass: s.prMerged };
  }
  return { label: 'Closed', Icon: GitPullRequestClosed, colorClass: s.prClosed };
}

interface PrStateIconProps {
  pr: GitWorktreePrInfo;
  compact: boolean;
}

/**
 * PR の状態を色付きアイコンだけで示すリンク。クリックで PR を新規タブで開く。
 * 番号は横幅を取るので出さず、ツールチップと ⋮ メニューの「PR を開く」で補う
 */
function PrStateIcon({ pr, compact }: PrStateIconProps) {
  const visual = getPrStateVisual(pr);
  const Icon = visual.Icon;
  const tooltip = `#${pr.number} ${visual.label}\n${pr.title}`;

  let iconSize = 14;
  let sizeClass = s.normal;
  if (compact) {
    iconSize = 12;
    sizeClass = s.compact;
  }

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      title={tooltip}
      aria-label={`PR #${pr.number} ${visual.label}`}
      onClick={(e) => {
        // 親タブのリンクへ伝播するとワークツリー切り替えが走るため止める
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        // dnd-kit のドラッグセンサー発火を抑止
        e.stopPropagation();
      }}
      className={`${s.prStateIcon} ${sizeClass} ${visual.colorClass}`}
    >
      <Icon size={iconSize} />
    </a>
  );
}

interface OpenPrMenuItemProps {
  pr: GitWorktreePrInfo;
  onOpen: () => void;
}

/**
 * ⋮ メニューの「PR を開く」行。タブ上のアイコンは小さくスマホで押しにくいので、その代わりの入口
 */
function OpenPrMenuItem({ pr, onOpen }: OpenPrMenuItemProps) {
  const visual = getPrStateVisual(pr);
  const Icon = visual.Icon;

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={pr.title}
      onClick={onOpen}
      className={`${s.menuItem} ${s.openPrItem}`}
    >
      <Icon className={`${s.menuItemIcon} ${visual.colorClass}`} />
      PR を開く
      <span className={s.menuItemPrNumber}>#{pr.number}</span>
    </a>
  );
}

interface SortableWorktreeTabProps {
  wt: GitWorktree;
  isActive: boolean;
  isMenuOpen: boolean;
  isDeleting: boolean;
  compact: boolean;
  isConnected: boolean;
  onSwitch: (path: string) => void;
  onMenuClick: (
    e: React.MouseEvent<HTMLButtonElement>,
    wt: GitWorktree
  ) => void;
}

/**
 * ドラッグ&ドロップで並び替え可能なブランチワークツリータブ。
 * 削除実行中はトーンダウン表示にし、クリック・メニュー・ドラッグを受け付けない。
 */
function SortableWorktreeTab({
  wt,
  isActive,
  isMenuOpen,
  isDeleting,
  compact,
  isConnected,
  onSwitch,
  onMenuClick,
}: SortableWorktreeTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: wt.path, disabled: isDeleting });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`${s.tabWrapper} ${compact ? s.compactStyle : s.normalStyle} ${isActive ? s.active : ''} ${isDeleting ? s.deleting : ''}`}
    >
      <a
        href={`?repo=${encodeURIComponent(wt.path)}`}
        draggable={false}
        title={
          isDeleting
            ? `${wt.branch}（削除中...）`
            : wt.memo
              ? `${wt.branch}\n${wt.memo}`
              : wt.branch
        }
        onClick={(e) => {
          if (isDeleting) {
            e.preventDefault();
            return;
          }
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
            return;
          }
          e.preventDefault();
          if (isActive) return;
          onSwitch(wt.path);
        }}
        className={`${s.tabButton} ${compact ? s.compact : s.normal} ${isActive ? s.active : ''}`}
      >
        <span className={s.tabTexts}>
          <span className={s.tabTopRow}>
            {wt.prInfo && <PrStateIcon pr={wt.prInfo} compact={compact} />}
            <span
              className={`${s.tabBranchName} ${compact ? s.compact : s.normal}`}
            >
              {wt.branch}
            </span>
          </span>
          {wt.memoSummary && (
            <span className={`${s.tabSummary} ${isActive ? s.active : ''}`}>
              {wt.memoSummary}
            </span>
          )}
        </span>
      </a>

      {isDeleting ? (
        // 削除中スピナー（メニューボタンと同寸で置き換え、レイアウトを崩さない）
        <span
          className={`${s.menuButton} ${compact ? s.compact : s.normal}`}
          aria-label="削除中"
        >
          <Loader2 size={compact ? 12 : 16} className={s.deletingSpinner} />
        </span>
      ) : (
        // 3点リーダーメニュー
        <button
          onClick={(e) => onMenuClick(e, wt)}
          disabled={!isConnected}
          className={`${s.menuButton} ${compact ? s.compact : s.normal} ${isMenuOpen ? s.open : ''}`}
          title="ワークツリー操作"
        >
          <MoreVertical size={compact ? 12 : 16} />
        </button>
      )}
    </div>
  );
}

interface WorktreeTabsProps {
  compact?: boolean;
}

function WorktreeTabs({ compact = false }: WorktreeTabsProps) {
  // 接続状態
  const { isConnected } = useSocketContext();

  // 現在開いているワークツリーのパス
  const { repository, switchRepositoryFromList: onSwitchRepository } =
    useRepositoryContext();
  const { currentRepo: currentWorktreePath } = repository;

  // ブランチ・ワークツリー関連
  const {
    worktrees,
    parentRepoPath,
    reorderWorktrees: onReorderWorktrees,
    deleteWorktree: onDeleteWorktree,
    mergeWorktree: onMergeWorktree,
    deletingWorktreePaths,
    worktreeCreateSuccessNonce,
    clearWorktreeCreateError: onClearWorktreeCreateError,
  } = useWorktreeContext();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  // メニューの表示段階。削除はモーダルを開かず、同じメニュー内で確認段階へ切り替える
  const [menuStep, setMenuStep] = useState<'actions' | 'deleteConfirm'>(
    'actions'
  );
  // 削除確認段階のオプション。既定はワークツリーのみ削除（ブランチは残す）
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [targetWorktree, setTargetWorktree] = useState<GitWorktree | null>(
    null
  );
  const [isMerging, setIsMerging] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 直後に合成される click を1回だけ握り潰すためのクリーンアップ参照
  const suppressClickCleanupRef = useRef<(() => void) | null>(null);

  // ドラッグ完了直後に呼ぶ: 次の click を window capture で1回だけ無効化
  const suppressNextClick = () => {
    suppressClickCleanupRef.current?.(); // 多重armを防ぐ
    const onClickCapture = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      remove();
    };
    const remove = () => {
      window.removeEventListener('click', onClickCapture, true);
      suppressClickCleanupRef.current = null;
    };
    window.addEventListener('click', onClickCapture, true);
    // click が発火しなかった場合に備え、次マクロタスクで確実に解除
    window.setTimeout(remove, 0);
    suppressClickCleanupRef.current = remove;
  };

  // アンマウント時にリスナーが残らないよう保険で解除
  useEffect(() => () => suppressClickCleanupRef.current?.(), []);

  // ドラッグ&ドロップ用センサー（8px動かすまではクリック扱い）
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // メニュー外クリック / Escape で閉じる
  const closeTabMenu = useCallback(() => {
    setMenuOpenPath(null);
    setMenuPosition(null);
    setMenuStep('actions');
  }, []);
  useOutsideClose(!!menuOpenPath, closeTabMenu, {
    ignore: [menuRef],
  });

  // ワークツリー作成が成功したら作成モーダルを閉じる
  const lastCreateSuccessNonceRef = useRef(worktreeCreateSuccessNonce);
  useEffect(() => {
    if (worktreeCreateSuccessNonce !== lastCreateSuccessNonceRef.current) {
      lastCreateSuccessNonceRef.current = worktreeCreateSuccessNonce;
      setShowCreateModal(false);
    }
  }, [worktreeCreateSuccessNonce]);

  const handleMenuClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    wt: GitWorktree
  ) => {
    e.stopPropagation();
    if (menuOpenPath === wt.path) {
      closeTabMenu();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
      setMenuOpenPath(wt.path);
      setMenuStep('actions');
    }
  };

  const handleMergeClick = (wt: GitWorktree) => {
    setTargetWorktree(wt);
    setShowMergeConfirm(true);
    closeTabMenu();
  };

  const handleConfirmDelete = (wt: GitWorktree, deleteBranch: boolean) => {
    onDeleteWorktree(wt.path, deleteBranch);
    // 親リポジトリへの切り替えはworktree-deletedイベント受信時に行う
    // 削除中状態はuseWorktrees側で管理（deletingWorktreePaths）
    closeTabMenu();
  };

  const handleConfirmMerge = () => {
    if (targetWorktree) {
      setIsMerging(true);
      onMergeWorktree(targetWorktree.path);
      // マージ結果はworktree-mergedイベントで処理される
      setShowMergeConfirm(false);
      setTargetWorktree(null);
      setIsMerging(false);
    }
  };

  // ワークツリーが1つ以下（メインのみ）の場合は表示しない
  if (worktrees.length <= 1 && !showCreateModal) {
    return (
      <div className={`${s.singleRoot} ${compact ? s.compact : s.normal}`}>
        <div className={`${s.singleInner} ${compact ? '' : s.normal}`}>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!isConnected}
            className={`${s.createButton} ${compact ? s.compact : s.normal}`}
            title="新しいワークツリーを作成"
          >
            <Plus
              size={compact ? 12 : 16}
              className={`${s.createIcon} ${compact ? s.compact : s.normal}`}
            />
            {!compact && 'ワークツリーを作成'}
          </button>
        </div>

        {showCreateModal && (
          <WorktreeCreateModal
            onClose={() => {
              setShowCreateModal(false);
              onClearWorktreeCreateError();
            }}
          />
        )}
      </div>
    );
  }

  // パスを正規化してアクティブ判定
  const normalizedCurrentPath = currentWorktreePath.replace(/\/+$/, '');
  const isWorktreeActive = (wt: GitWorktree) =>
    wt.path.replace(/\/+$/, '') === normalizedCurrentPath;

  // メインワークツリーとブランチワークツリーを分離
  const mainWorktree = worktrees.find((wt) => wt.isMain);
  const branchWorktrees = worktrees.filter((wt) => !wt.isMain);

  // 明示的なクリックを「次回ホームから親リポを開く時の遷移先」として記憶する
  const handleSwitchAndRemember = (path: string) => {
    setLastWorktreeForParent(parentRepoPath, path);
    onSwitchRepository(path);
  };

  // ドラッグ終了時に並び替えを反映
  const handleDragEnd = (event: DragEndEvent) => {
    suppressNextClick(); // ドラッグ後に合成される click を1回だけ握り潰す
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const paths = branchWorktrees.map((wt) => wt.path);
    const oldIndex = paths.indexOf(active.id as string);
    const newIndex = paths.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorderWorktrees(arrayMove(paths, oldIndex, newIndex));
  };

  // 要約付きのタブは 2 行になる。親のブランチバーはこの目印を見て帯の部品をすべて同じ高さに伸ばす
  const hasSummary = branchWorktrees.some((wt) => Boolean(wt.memoSummary));

  return (
    <div
      className={`${s.root} ${compact ? s.compact : s.normal}`}
      data-has-summary={hasSummary || undefined}
    >
      <div className={s.tabsContainer}>
        {/* メインワークツリー（左固定） */}
        {mainWorktree && (
          <div className={s.mainSection}>
            <div
              className={`${s.mainTab} ${compact ? s.compactStyle : s.normalStyle} ${isWorktreeActive(mainWorktree) ? s.active : ''}`}
            >
              <a
                href={`?repo=${encodeURIComponent(mainWorktree.path)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
                    return;
                  }
                  e.preventDefault();
                  if (isWorktreeActive(mainWorktree)) return;
                  handleSwitchAndRemember(mainWorktree.path);
                }}
                className={`${s.tabButton} ${compact ? s.compact : s.normal} ${isWorktreeActive(mainWorktree) ? s.active : ''}`}
              >
                <Home
                  size={compact ? 12 : 16}
                  className={`${s.mainIcon} ${compact ? s.compact : s.normal}`}
                />
                {mainWorktree.prInfo && (
                  <PrStateIcon pr={mainWorktree.prInfo} compact={compact} />
                )}
                <span className={`${s.tabBranchName} ${compact ? s.compact : s.normal}`}>
                  {mainWorktree.branch}
                </span>
              </a>
            </div>
            <div className={s.divider}></div>
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
          onDragCancel={suppressNextClick}
        >
          <SortableContext
            items={branchWorktrees.map((wt) => wt.path)}
            strategy={horizontalListSortingStrategy}
          >
            <div className={s.tabsScroll}>
              {/* ブランチワークツリータブ */}
              {branchWorktrees.map((wt) => (
                <SortableWorktreeTab
                  key={wt.path}
                  wt={wt}
                  isActive={isWorktreeActive(wt)}
                  isMenuOpen={menuOpenPath === wt.path}
                  isDeleting={deletingWorktreePaths.includes(wt.path)}
                  compact={compact}
                  isConnected={isConnected}
                  onSwitch={handleSwitchAndRemember}
                  onMenuClick={handleMenuClick}
                />
              ))}

              {/* 新規作成ボタン */}
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={!isConnected}
                className={`${s.newButton} ${compact ? s.compact : s.normal}`}
                title="新しいワークツリーを作成"
              >
                <Plus
                  size={compact ? 12 : 16}
                  className={`${s.newIcon} ${compact ? s.compact : s.normal}`}
                />
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* ワークツリー操作メニュー（Portalでbodyに描画） */}
      {menuOpenPath && menuPosition && createPortal(
        <div
          ref={menuRef}
          className={`${s.portalMenu} ${menuStep === 'deleteConfirm' ? s.confirmMenu : ''}`}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
          }}
        >
          {(() => {
            const wt = worktrees.find((w) => w.path === menuOpenPath);
            if (!wt) return null;
            const isDeleting = deletingWorktreePaths.includes(wt.path);

            // 2段目: 削除の確認（メニューを閉じずに同じ位置で中身だけ差し替える）。
            // 「どこまで消すか」は2択を並べず、既定＝ワークツリーのみ + 追加分をチェックで足す形にする
            if (menuStep === 'deleteConfirm') {
              return (
                <div className={s.confirmPanel}>
                  <div className={s.confirmHeader}>
                    <span className={s.confirmBranch} title={wt.branch}>
                      {wt.branch}
                    </span>
                    <span className={s.confirmNote}>
                      セッション・ターミナル・キューも終了します
                    </span>
                  </div>
                  <label className={s.branchOption}>
                    <input
                      type="checkbox"
                      checked={deleteBranch}
                      onChange={(e) => setDeleteBranch(e.target.checked)}
                      disabled={isDeleting}
                      className={s.branchCheckbox}
                    />
                    ブランチも削除する
                  </label>
                  <button
                    onClick={() => handleConfirmDelete(wt, deleteBranch)}
                    disabled={isDeleting}
                    className={s.dangerRow}
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setMenuStep('actions')}
                    className={s.backRow}
                  >
                    <ArrowLeft className={s.backIcon} />
                    戻る
                  </button>
                </div>
              );
            }

            return (
              <>
                {wt.prInfo && <OpenPrMenuItem pr={wt.prInfo} onOpen={closeTabMenu} />}
                <button
                  onClick={() => handleMergeClick(wt)}
                  className={`${s.menuItem} ${s.mergeItem}`}
                >
                  <GitMerge className={s.menuItemIcon} />
                  マージ
                </button>
                <button
                  onClick={() => {
                    setDeleteBranch(false);
                    setMenuStep('deleteConfirm');
                  }}
                  disabled={isDeleting}
                  className={`${s.menuItem} ${s.deleteItem}`}
                >
                  <Trash2 className={s.menuItemIcon} />
                  削除
                </button>
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {/* 作成モーダル */}
      {showCreateModal && (
        <WorktreeCreateModal
          onClose={() => {
            setShowCreateModal(false);
            onClearWorktreeCreateError();
          }}
        />
      )}

      {/* マージ確認モーダル */}
      {showMergeConfirm && targetWorktree && (
        <div className={s.modalOverlay}>
          <div className={s.modalContent}>
            <div className={s.modalHeader}>
              <div className={`${s.modalIconWrapper} ${s.info}`}>
                <GitMerge className={`${s.modalIcon} ${s.info}`} />
              </div>
              <h3 className={s.modalTitle}>
                ブランチをマージ
              </h3>
            </div>

            <p className={s.modalDescription}>
              このワークツリーのブランチを親リポジトリにマージしますか？
            </p>

            <div className={`${s.warningBox} ${s.blue}`}>
              <ul className={`${s.warningList} ${s.blue}`}>
                <li>
                  • ブランチ:{' '}
                  <span className={s.modalBranchNameBlue}>
                    {targetWorktree.branch}
                  </span>
                </li>
                <li>• マージ先: 親リポジトリの現在のブランチ</li>
                <li>• コンフリクトが発生した場合、マージは中止されます</li>
                <li>• ワークツリーは削除されません</li>
              </ul>
            </div>

            <div className={s.modalFooter}>
              <button
                onClick={() => {
                  setShowMergeConfirm(false);
                  setTargetWorktree(null);
                }}
                className={s.cancelButton}
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmMerge}
                disabled={isMerging}
                className={`${s.confirmButton} ${s.info}`}
              >
                {isMerging ? 'マージ中...' : 'マージ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorktreeTabs;
