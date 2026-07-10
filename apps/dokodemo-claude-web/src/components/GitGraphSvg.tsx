import React from 'react';
import type { GraphLayout } from '../utils/git-graph-layout';
import {
  GRAPH_COLORS,
  UNCOMMITTED_COLOR,
  ROW_HEIGHT,
  LANE_WIDTH,
} from '../utils/git-graph-layout';

/** レイアウト入力に合成する Uncommitted 仮想コミットの hash */
export const UNCOMMITTED_HASH = '*';

interface GitGraphSvgProps {
  layout: GraphLayout;
  /** レイアウトに渡したものと同じ順序の hash 配列（row → hash 解決用） */
  rowHashes: string[];
  headHash: string;
  /** 追加の縦オフセット（詳細行展開などで row ごとに y をずらす場合に使用） */
  rowYOffsets?: number[];
  width: number;
  height: number;
}

const DOT_RADIUS = 4;

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/**
 * グラフのレーン・線・ドットを描く SVG。
 * テーブルの各行と行高（ROW_HEIGHT）を共有し、左端のグラフ列へ絶対配置される。
 */
const GitGraphSvg: React.FC<GitGraphSvgProps> = ({
  layout,
  rowHashes,
  headHash,
  rowYOffsets,
  width,
  height,
}) => {
  // row 中央の y（詳細行展開の追加オフセットを加味）
  const rowCenterY = (row: number): number => {
    const base = row * ROW_HEIGHT + ROW_HEIGHT / 2;
    return base + (rowYOffsets?.[row] ?? 0);
  };

  const isUncommitted = (row: number): boolean =>
    rowHashes[row] === UNCOMMITTED_HASH;

  return (
    <svg
      className="git-graph-svg"
      width={width}
      height={height}
      style={{ display: 'block' }}
    >
      {/* エッジ（線・ベジェ） */}
      {layout.edges.map((edge, i) => {
        const x1 = laneX(edge.fromLane);
        const y1 = rowCenterY(edge.row);
        const x2 = laneX(edge.toLane);
        const y2 = rowCenterY(edge.row + 1);
        const color = isUncommitted(edge.row)
          ? UNCOMMITTED_COLOR
          : GRAPH_COLORS[edge.colorIndex % GRAPH_COLORS.length];

        if (edge.fromLane === edge.toLane) {
          return (
            <line
              key={`e${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={2}
            />
          );
        }
        const ym = (y1 + y2) / 2;
        return (
          <path
            key={`e${i}`}
            d={`M ${x1} ${y1} C ${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}`}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        );
      })}

      {/* ノード（ドット） */}
      {layout.nodes.map((node, i) => {
        const cx = laneX(node.lane);
        const cy = rowCenterY(node.row);
        const uncommitted = isUncommitted(node.row);
        const color = uncommitted
          ? UNCOMMITTED_COLOR
          : GRAPH_COLORS[node.colorIndex % GRAPH_COLORS.length];
        const isHead = !uncommitted && rowHashes[node.row] === headHash;

        if (isHead) {
          // HEAD コミット: 中空円（背景色塗り + レーン色ストローク）
          return (
            <circle
              key={`n${i}`}
              cx={cx}
              cy={cy}
              r={DOT_RADIUS}
              fill="#0a0a0a"
              stroke={color}
              strokeWidth={2}
            />
          );
        }
        return (
          <circle key={`n${i}`} cx={cx} cy={cy} r={DOT_RADIUS} fill={color} />
        );
      })}
    </svg>
  );
};

export default GitGraphSvg;
