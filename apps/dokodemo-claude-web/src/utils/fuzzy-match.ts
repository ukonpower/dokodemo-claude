// VSCode コマンドパレット風のサブシーケンス fuzzy マッチャー。
// クエリ文字が順序を保って target に現れていれば match。連続マッチ・単語境界・先頭一致でボーナス、
// gap でペナルティを与えてスコアを算出する。matches はハイライト用に target 上の一致 index を返す。

export interface FuzzyMatchResult {
  score: number;
  matches: number[];
}

const BONUS_BOUNDARY = 8;
const BONUS_CONSECUTIVE = 5;
const BONUS_FIRST_CHAR = 6;
const BONUS_CAMEL = 7;
const PENALTY_GAP_START = -3;
const PENALTY_GAP_EXTEND = -1;
const NEG_INF = -1e9;

const BOUNDARY_RE = /[/\\_\-. ]/;

function isWordBoundary(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1];
  return BOUNDARY_RE.test(prev);
}

function isCamelBoundary(target: string, i: number): boolean {
  if (i === 0) return false;
  const prev = target[i - 1];
  const cur = target[i];
  return prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z';
}

export function fuzzyMatch(query: string, target: string): FuzzyMatchResult | null {
  if (query.length === 0) return { score: 0, matches: [] };
  if (query.length > target.length) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const qLen = q.length;
  const tLen = t.length;

  // サブシーケンスとして成立するかを先に確認（早期 reject）。
  let qi = 0;
  for (let i = 0; i < tLen && qi < qLen; i++) {
    if (t[i] === q[qi]) qi++;
  }
  if (qi < qLen) return null;

  // M[i][j] = q[0..i] が t[0..j] にマッチして j で終わる時の最良スコア。
  const M: number[][] = Array.from({ length: qLen }, () => new Array(tLen).fill(NEG_INF));
  const parent: number[][] = Array.from({ length: qLen }, () => new Array(tLen).fill(-1));

  for (let j = 0; j < tLen; j++) {
    if (t[j] !== q[0]) continue;
    let score = 0;
    if (j === 0) {
      score += BONUS_FIRST_CHAR;
    } else if (isCamelBoundary(target, j)) {
      score += BONUS_CAMEL;
    } else if (isWordBoundary(target, j)) {
      score += BONUS_BOUNDARY;
    }
    if (j > 0) {
      score += PENALTY_GAP_START + PENALTY_GAP_EXTEND * (j - 1);
    }
    M[0][j] = score;
  }

  for (let i = 1; i < qLen; i++) {
    for (let j = i; j < tLen; j++) {
      if (t[j] !== q[i]) continue;
      let best = NEG_INF;
      let bestK = -1;
      for (let k = i - 1; k < j; k++) {
        const prev = M[i - 1][k];
        if (prev === NEG_INF) continue;
        let score = prev;
        const gap = j - k - 1;
        if (gap === 0) {
          score += BONUS_CONSECUTIVE;
        } else {
          score += PENALTY_GAP_START + PENALTY_GAP_EXTEND * (gap - 1);
        }
        if (isCamelBoundary(target, j)) {
          score += BONUS_CAMEL;
        } else if (isWordBoundary(target, j)) {
          score += BONUS_BOUNDARY;
        }
        if (score > best) {
          best = score;
          bestK = k;
        }
      }
      M[i][j] = best;
      parent[i][j] = bestK;
    }
  }

  let bestScore = NEG_INF;
  let bestEnd = -1;
  for (let j = qLen - 1; j < tLen; j++) {
    if (M[qLen - 1][j] > bestScore) {
      bestScore = M[qLen - 1][j];
      bestEnd = j;
    }
  }

  if (bestEnd === -1) return null;

  const matches: number[] = new Array(qLen);
  let i = qLen - 1;
  let j = bestEnd;
  while (i >= 0 && j >= 0) {
    matches[i] = j;
    j = parent[i][j];
    i--;
  }

  return { score: bestScore, matches };
}
