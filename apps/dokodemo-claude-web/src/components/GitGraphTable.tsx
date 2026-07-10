import React, { useMemo } from 'react';
import type { GitGraphData, GitGraphRef } from '../types';
import {
  computeGraphLayout,
  formatGraphDate,
  ROW_HEIGHT,
  LANE_WIDTH,
  type GraphInputCommit,
} from '../utils/git-graph-layout';
import GitGraphSvg, { UNCOMMITTED_HASH } from './GitGraphSvg';
import s from './GitGraphTable.module.scss';

interface GitGraphTableProps {
  graph: GitGraphData;
}

// グラフ列に描く最大レーン数（超過分はクリップ）
const MAX_VISIBLE_LANES = 8;

/** ref ラベル chip */
function RefChip({ r }: { r: GitGraphRef }): React.ReactElement {
  const cls =
    r.type === 'head'
      ? s.chipHead
      : r.type === 'tag'
        ? s.chipTag
        : r.type === 'remote'
          ? s.chipRemote
          : s.chipBranch;
  return <span className={`${s.chip} ${cls}`}>{r.name}</span>;
}

/**
 * コミットグラフのテーブル（左端に SVG グラフを絶対配置で重ねる）
 */
const GitGraphTable: React.FC<GitGraphTableProps> = ({ graph }) => {
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
          <col style={{ width: 130 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 76 }} />
        </colgroup>
        <tbody>
          {rows.map((row) => {
            if (row.isUncommitted) {
              return (
                <tr key="uncommitted" className={s.row}>
                  <td className={s.graphCell} />
                  <td className={`${s.descCol} ${s.uncommitted}`} colSpan={4}>
                    Uncommitted Changes ({graph.uncommitted?.fileCount ?? 0})
                  </td>
                </tr>
              );
            }
            const c = commitByHash.get(row.hash);
            if (!c) return null;
            return (
              <tr key={c.hash} className={s.row}>
                <td className={s.graphCell} />
                <td className={s.descCol}>
                  {c.refs.length > 0 && (
                    <span className={s.chips}>
                      {c.refs.map((r) => (
                        <RefChip key={`${r.type}:${r.name}`} r={r} />
                      ))}
                    </span>
                  )}
                  <span className={s.message}>{c.message}</span>
                </td>
                <td className={s.dateCol}>{formatGraphDate(c.date)}</td>
                <td className={s.authorCol}>{c.author}</td>
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
