import React, { useMemo } from 'react';
import { FolderGit2 } from 'lucide-react';
import type { GitGraphData, GitGraphRef } from '@/types';
import { useLongPress, type LongPressPoint } from '@/shared/hooks/useLongPress';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import {
  computeGraphLayout,
  formatGraphDate,
  ROW_HEIGHT,
  LANE_WIDTH,
  type GraphInputCommit,
} from '@/features/git/utils/git-graph-layout';
import GitGraphSvg, { UNCOMMITTED_HASH } from './GitGraphSvg';
import s from './GitGraphTable.module.scss';

interface GitGraphTableProps {
  graph: GitGraphData;
  selectedHash: string | null;
  onSelectRow: (hash: string) => void;
  /** 検索でマッチした hash 集合（背景ハイライト用） */
  matchedHashes?: Set<string>;
  /** 現在ジャンプ中のマッチ hash */
  currentMatchHash?: string | null;
  /** ref chip の右クリック / 長押し（checkout / merge メニュー用） */
  onRefContextMenu?: (
    pos: { clientX: number; clientY: number },
    ref: GitGraphRef
  ) => void;
  /** ref chip のダブルクリック（checkout ショートカット用） */
  onRefDoubleClick?: (ref: GitGraphRef) => void;
  /** コミット行の右クリック / 長押し */
  onRowContextMenu?: (
    pos: { clientX: number; clientY: number },
    hash: string
  ) => void;
}

// グラフ列に描く最大レーン数（超過分はクリップ）
const MAX_VISIBLE_LANES = 8;

// 作者列を隠すブレークポイント（md 相当）
const MD_DOWN_MEDIA_QUERY = '(max-width: 680px)';
// 日付列も隠すブレークポイント（sm 相当）
const SM_DOWN_MEDIA_QUERY = '(max-width: 560px)';

/** ref ラベル chip */
function RefChip({
  r,
  onContextMenu,
  onDoubleClick,
  longPressHandlers,
  onLongPressStop,
}: {
  r: GitGraphRef;
  onContextMenu?: (e: React.MouseEvent, ref: GitGraphRef) => void;
  onDoubleClick?: (ref: GitGraphRef) => void;
  longPressHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
  onLongPressStop: () => void;
}): React.ReactElement {
  const cls =
    r.type === 'head'
      ? s.chipHead
      : r.type === 'tag'
        ? s.chipTag
        : r.type === 'remote'
          ? s.chipRemote
          : r.worktree
            ? s.chipWorktree
            : s.chipBranch;
  return (
    <span
      className={`${s.chip} ${cls}`}
      title={r.worktree ? `${r.name}（別のワークツリーで使用中）` : undefined}
      onPointerDown={(e) => {
        // 行側の長押しと二重発火しないよう伝播を止める
        e.stopPropagation();
        longPressHandlers.onPointerDown(e);
      }}
      onPointerMove={longPressHandlers.onPointerMove}
      onPointerUp={longPressHandlers.onPointerUp}
      onPointerCancel={longPressHandlers.onPointerCancel}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onLongPressStop();
              onContextMenu(e, r);
            }
          : undefined
      }
      onDoubleClick={
        onDoubleClick
          ? (e) => {
              e.stopPropagation();
              onDoubleClick(r);
            }
          : undefined
      }
    >
      {r.worktree && (
        <FolderGit2 size={12} className={s.chipIcon} aria-hidden="true" />
      )}
      {r.name}
    </span>
  );
}

/**
 * コミットグラフのテーブル（左端に SVG グラフを絶対配置で重ねる）
 */
const GitGraphTable: React.FC<GitGraphTableProps> = ({
  graph,
  selectedHash,
  onSelectRow,
  matchedHashes,
  currentMatchHash,
  onRefContextMenu,
  onRefDoubleClick,
  onRowContextMenu,
}) => {
  const isMdDown = useMediaQuery(MD_DOWN_MEDIA_QUERY);
  const isSmDown = useMediaQuery(SM_DOWN_MEDIA_QUERY);
  const showAuthorCol = !isMdDown;
  const showDateCol = !isSmDown;
  // graphCell を除いた desc + (date) + (author) + hash の列数
  const uncommittedColSpan = 2 + (showDateCol ? 1 : 0) + (showAuthorCol ? 1 : 0);

  // テーブル全体で 1 インスタンスを共有する（行・chip 双方の長押しをこれで検出）
  const longPress = useLongPress();

  // uncommitted があれば先頭に仮想行を合成する
  const rows = useMemo(() => {
    const list: {
      hash: string;
      parents: string[];
      isUncommitted: boolean;
    }[] = [];
    if (graph.uncommitted && graph.headHash) {
      list.push({
        hash: UNCOMMITTED_HASH,
        parents: [graph.headHash],
        isUncommitted: true,
      });
    }
    for (const c of graph.commits) {
      list.push({ hash: c.hash, parents: c.parents, isUncommitted: false });
    }
    return list;
  }, [graph]);

  const layout = useMemo(() => {
    const input: GraphInputCommit[] = rows.map((r) => ({
      hash: r.hash,
      parents: r.parents,
    }));
    return computeGraphLayout(input);
  }, [rows]);

  const rowHashes = useMemo(() => rows.map((r) => r.hash), [rows]);

  const graphColWidth =
    Math.min(layout.maxLanes, MAX_VISIBLE_LANES) * LANE_WIDTH + 8;
  const svgWidth = layout.maxLanes * LANE_WIDTH + LANE_WIDTH;
  const svgHeight = rows.length * ROW_HEIGHT;

  // commit を hash で引く（uncommitted 行以外の表示用）
  const commitByHash = useMemo(() => {
    const m = new Map<string, GitGraphData['commits'][number]>();
    for (const c of graph.commits) m.set(c.hash, c);
    return m;
  }, [graph]);

  return (
    <div className={s.wrap}>
      {/* 左端グラフ SVG（テーブル行と同じ ROW_HEIGHT で重ねる） */}
      <div
        className={s.graphOverlay}
        style={{ width: graphColWidth, height: svgHeight }}
      >
        <GitGraphSvg
          layout={layout}
          rowHashes={rowHashes}
          headHash={graph.headHash}
          width={svgWidth}
          height={svgHeight}
        />
      </div>

      <table className={s.table}>
        <colgroup>
          <col style={{ width: graphColWidth }} />
          <col />
          {showDateCol && <col style={{ width: 150 }} />}
          {showAuthorCol && <col style={{ width: 120 }} />}
          <col style={{ width: 76 }} />
        </colgroup>
        <tbody>
          {rows.map((row) => {
            if (row.isUncommitted) {
              const isSelected = selectedHash === UNCOMMITTED_HASH;
              return (
                <tr
                  key="uncommitted"
                  data-hash={UNCOMMITTED_HASH}
                  className={`${s.row} ${s.clickable} ${isSelected ? s.selected : ''}`}
                  onClick={() => {
                    if (longPress.consumeLongPress()) return;
                    onSelectRow(UNCOMMITTED_HASH);
                  }}
                >
                  <td className={s.graphCell} />
                  <td
                    className={`${s.descCol} ${s.uncommitted}`}
                    colSpan={uncommittedColSpan}
                  >
                    Uncommitted Changes ({graph.uncommitted?.fileCount ?? 0})
                  </td>
                </tr>
              );
            }
            const c = commitByHash.get(row.hash);
            if (!c) return null;
            const isSelected = c.hash === selectedHash;
            const isMatch = matchedHashes?.has(c.hash) ?? false;
            const isCurrentMatch = c.hash === currentMatchHash;
            return (
              <tr
                key={c.hash}
                data-hash={c.hash}
                className={`${s.row} ${s.clickable} ${isSelected ? s.selected : ''} ${
                  isMatch ? s.match : ''
                } ${isCurrentMatch ? s.currentMatch : ''}`}
                onClick={() => {
                  if (longPress.consumeLongPress()) return;
                  onSelectRow(c.hash);
                }}
                onContextMenu={
                  onRowContextMenu
                    ? (e) => {
                        e.preventDefault();
                        longPress.cancel();
                        onRowContextMenu(e, c.hash);
                      }
                    : undefined
                }
                {...longPress.bind((p: LongPressPoint) =>
                  onRowContextMenu?.(p, c.hash)
                )}
              >
                <td className={s.graphCell} />
                <td className={s.descCol}>
                  {c.refs.length > 0 && (
                    <span className={s.chips}>
                      {c.refs.map((r) => (
                        <RefChip
                          key={`${r.type}:${r.name}`}
                          r={r}
                          onContextMenu={onRefContextMenu}
                          onDoubleClick={onRefDoubleClick}
                          longPressHandlers={longPress.bind(
                            (p: LongPressPoint) => {
                              onRefContextMenu?.(p, r);
                            }
                          )}
                          onLongPressStop={longPress.cancel}
                        />
                      ))}
                    </span>
                  )}
                  <span className={s.message}>{c.message}</span>
                </td>
                {showDateCol && (
                  <td className={s.dateCol}>{formatGraphDate(c.date)}</td>
                )}
                {showAuthorCol && (
                  <td className={s.authorCol}>{c.author}</td>
                )}
                <td className={s.hashCol}>{c.hash.slice(0, 8)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default GitGraphTable;
