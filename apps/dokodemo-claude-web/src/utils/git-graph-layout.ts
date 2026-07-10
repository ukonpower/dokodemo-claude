// Git Graph のレーン割当（DOM 非依存の純関数）
//
// vscode-git-graph 準拠のコミットグラフを描くための、レーン（縦線の列）割当。
// 入力はコミットの hash と parents のみ。上（新しいコミット）から 1 パスで
// レーンを割り当て、ノード（ドット）とエッジ（線分）を返す。

export const GRAPH_COLORS = [
  '#0085d9',
  '#d9008f',
  '#00d90a',
  '#d98500',
  '#a300d9',
  '#ff0000',
  '#00d9cc',
  '#e138e8',
  '#85d900',
  '#dc5b23',
  '#6f24d6',
  '#ffcc00',
];
export const UNCOMMITTED_COLOR = '#808080';
export const ROW_HEIGHT = 24;
export const LANE_WIDTH = 16;

export interface GraphInputCommit {
  hash: string;
  parents: string[];
}
export interface GraphNode {
  row: number;
  lane: number;
  colorIndex: number;
}
export interface GraphEdge {
  row: number;
  fromLane: number;
  toLane: number;
  colorIndex: number;
}
// row: この行(row)と次行(row+1)の間の線分
export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  maxLanes: number;
}

interface Lane {
  hash: string; // このレーンが次に到達を待っているコミット hash（expectedHash）
  colorIndex: number;
}

/**
 * コミット配列（新しい順）からグラフのノード・エッジを計算する。
 *
 * エッジの row 定義（GitGraphSvg と厳密に共有する）:
 *   - `row = i` のエッジは「行 i（上端）と行 i+1（下端）の間の縦区間」を表す。
 *   - `fromLane` は上端（行 i）での列、`toLane` は下端（行 i+1）での列。
 *   - 全エッジは自区間の上端の行 i で、次コミット(commits[i+1])を先読みして生成する。
 *     合流（複数の子が同じ親を持つ）も、親の直上区間の上端行での先読みとして
 *     自然に生成されるため、row i-1 のような別扱いはしない。
 *
 * レーン列は安定（左詰めしない）。空きは null 穴として残し、新規レーンは最左の穴を
 * 再利用（無ければ末尾に追加）する。これにより行間でレーンが横シフトしないため、
 * シフトエッジを別途生成する必要が無い。
 */
/**
 * unix 秒を `YYYY-MM-DD HH:mm`（ローカルタイム）に整形する
 */
export function formatGraphDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function computeGraphLayout(commits: GraphInputCommit[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let maxLanes = 0;
  let nextColor = 0;
  const numColors = GRAPH_COLORS.length;

  const lanes: (Lane | null)[] = [];

  const laneIndexOf = (hash: string): number =>
    lanes.findIndex((l) => l !== null && l.hash === hash);
  const allocLane = (lane: Lane): number => {
    const hole = lanes.findIndex((l) => l === null);
    if (hole !== -1) {
      lanes[hole] = lane;
      return hole;
    }
    lanes.push(lane);
    return lanes.length - 1;
  };
  const trimTrailingNull = (): void => {
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  };

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];

    // --- ノード配置: c.hash を待つ最左レーン。無ければ新規レーンを確保 ---
    let nodeCol = laneIndexOf(c.hash);
    if (nodeCol === -1) {
      nodeCol = allocLane({
        hash: c.hash,
        colorIndex: nextColor++ % numColors,
      });
    }
    const nodeColorIndex = (lanes[nodeCol] as Lane).colorIndex;
    nodes.push({ row: i, lane: nodeCol, colorIndex: nodeColorIndex });

    // このノード行で新規に枝分かれした親レーンは、線の起点(top)がノード列になる。
    const branchOriginCols = new Set<number>();

    // --- c.hash を待つ他のレーン（このノードへ合流してくる子ら）を消す ---
    for (let j = 0; j < lanes.length; j++) {
      const l = lanes[j];
      if (j !== nodeCol && l !== null && l.hash === c.hash) {
        lanes[j] = null;
      }
    }

    // --- ノードレーンを第1親へ継続。root なら消滅 ---
    if (c.parents.length === 0) {
      lanes[nodeCol] = null;
    } else {
      lanes[nodeCol] = { hash: c.parents[0], colorIndex: nodeColorIndex };
    }

    // --- 追加の親（merge の 2 番目以降）を分岐レーンに ---
    for (let k = 1; k < c.parents.length; k++) {
      const ph = c.parents[k];
      if (laneIndexOf(ph) === -1) {
        const col = allocLane({
          hash: ph,
          colorIndex: nextColor++ % numColors,
        });
        branchOriginCols.add(col);
      }
      // 既存レーンが待っている場合はそこへ合流（新規レーン不要）。
    }

    trimTrailingNull();
    maxLanes = Math.max(maxLanes, nodeCol + 1, lanes.length);

    // --- segment i→i+1 のエッジ生成（最終行は次が無いので描かない） ---
    if (i + 1 < commits.length) {
      const next = commits[i + 1];
      const nextNodeCol = laneIndexOf(next.hash); // -1 なら次行は新規（合流なし）
      for (let col = 0; col < lanes.length; col++) {
        const lane = lanes[col];
        if (lane === null) continue;
        const fromCol = branchOriginCols.has(col) ? nodeCol : col;
        const toCol =
          nextNodeCol !== -1 && lane.hash === next.hash ? nextNodeCol : col;
        edges.push({
          row: i,
          fromLane: fromCol,
          toLane: toCol,
          colorIndex: lane.colorIndex,
        });
      }
    }
  }

  return { nodes, edges, maxLanes };
}
