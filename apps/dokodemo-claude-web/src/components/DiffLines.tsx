import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronUp, ChevronDown } from 'lucide-react';
import s from './DiffLines.module.scss';

interface DiffCell {
  type: 'context' | 'addition' | 'deletion';
  lineNumber: number;
  content: string;
}

type DiffRow =
  | { kind: 'line'; left: DiffCell | null; right: DiffCell | null }
  | { kind: 'separator' };

/** 連続する変更行のまとまり（ジャンプ・ミニマップの単位） */
interface ChangeBlock {
  start: number;
  end: number;
  hasAddition: boolean;
  hasDeletion: boolean;
}

/**
 * unified diff をパースして左右分割表示用の行データに変換する。
 * 削除ブロックと追加ブロックは行単位でペアリングし、
 * 片側だけの行は反対側を空欄（null）にする。
 */
function parseSideBySide(diff: string): DiffRow[] {
  const lines = diff.split('\n');
  const rows: DiffRow[] = [];
  let oldNum = 0;
  let newNum = 0;
  let sawHunk = false;
  let dels: DiffCell[] = [];
  let adds: DiffCell[] = [];

  const flush = () => {
    const count = Math.max(dels.length, adds.length);
    for (let i = 0; i < count; i++) {
      rows.push({
        kind: 'line',
        left: dels[i] ?? null,
        right: adds[i] ?? null,
      });
    }
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line.startsWith('@@')) {
      flush();
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldNum = parseInt(match[1], 10);
        newNum = parseInt(match[2], 10);
      }
      // ハンクが分かれている場合のみ省略区切りを入れる
      if (sawHunk) {
        rows.push({ kind: 'separator' });
      }
      sawHunk = true;
      continue;
    }

    // ハンク前のヘッダー行（diff/index/---/+++）は表示しない
    if (!sawHunk) continue;

    // "\ No newline at end of file"
    if (line.startsWith('\\')) continue;

    if (line.startsWith('+')) {
      adds.push({
        type: 'addition',
        lineNumber: newNum++,
        content: line.substring(1),
      });
    } else if (line.startsWith('-')) {
      dels.push({
        type: 'deletion',
        lineNumber: oldNum++,
        content: line.substring(1),
      });
    } else if (line.startsWith(' ')) {
      flush();
      const content = line.substring(1);
      rows.push({
        kind: 'line',
        left: { type: 'context', lineNumber: oldNum++, content },
        right: { type: 'context', lineNumber: newNum++, content },
      });
    }
    // それ以外（末尾の空行など）は無視
  }
  flush();

  return rows;
}

/**
 * monospace前提の表示幅（ch換算）。全角級の文字は2ch扱いにする。
 */
function displayWidthCh(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
  }
  return width;
}

/** 折り返しOFF時の列幅計算に使う各種最大値 */
function computeMetrics(rows: DiffRow[]): {
  maxLeftCh: number;
  maxRightCh: number;
  maxLineNumber: number;
} {
  let maxLeftCh = 0;
  let maxRightCh = 0;
  let maxLineNumber = 1;
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    if (row.left) {
      maxLeftCh = Math.max(maxLeftCh, displayWidthCh(row.left.content));
      maxLineNumber = Math.max(maxLineNumber, row.left.lineNumber);
    }
    if (row.right) {
      maxRightCh = Math.max(maxRightCh, displayWidthCh(row.right.content));
      maxLineNumber = Math.max(maxLineNumber, row.right.lineNumber);
    }
  }
  return { maxLeftCh, maxRightCh, maxLineNumber };
}

/** 連続する変更行をブロックにまとめる */
function computeChangeBlocks(rows: DiffRow[]): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  let current: ChangeBlock | null = null;

  rows.forEach((row, index) => {
    const hasDeletion = row.kind === 'line' && row.left?.type === 'deletion';
    const hasAddition = row.kind === 'line' && row.right?.type === 'addition';
    if (!hasDeletion && !hasAddition) {
      current = null;
      return;
    }
    if (current && current.end === index - 1) {
      current.end = index;
      current.hasAddition ||= hasAddition;
      current.hasDeletion ||= hasDeletion;
    } else {
      current = { start: index, end: index, hasAddition, hasDeletion };
      blocks.push(current);
    }
  });

  return blocks;
}

function cellClasses(cell: DiffCell | null): {
  num: string;
  content: string;
} {
  if (!cell) {
    return { num: s.cellEmpty, content: s.cellEmpty };
  }
  switch (cell.type) {
    case 'addition':
      return {
        num: `${s.bgAddition} ${s.lineNumAddition}`,
        content: `${s.bgAddition} ${s.textAddition}`,
      };
    case 'deletion':
      return {
        num: `${s.bgDeletion} ${s.lineNumDeletion}`,
        content: `${s.bgDeletion} ${s.textDeletion}`,
      };
    default:
      return {
        num: s.lineNumDefault,
        content: s.textContext,
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 1行分の推定高さ（px）。実高は measureElement で補正される */
const ESTIMATED_ROW_HEIGHT = 20;

interface DiffLinesProps {
  /** 差分テキスト */
  diff: string;
  /** 折り返し */
  wordWrap?: boolean;
}

/**
 * 差分をVSCode風の左右分割（左=変更前、右=変更後）で描画する。
 * 巨大ファイルでも耐えられるよう、行は仮想スクロールで描画する。
 * 左右の仕切り（右ペインの行番号列）はドラッグで位置調整でき、ダブルクリックでリセット。
 * 右端のミニマップ（overview ruler）と↑↓ボタンで変更行へジャンプできる。
 * このコンポーネント自身がスクロールコンテナを持つ（親は高さを与えるだけでよい）。
 * DiffViewer と Git Graph のコミット詳細で共用する。
 */
const DiffLines: React.FC<DiffLinesProps> = ({ diff, wordWrap = false }) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // 仕切り位置: wrap時は左右比率、noWrap時は左内容列の実幅px（nullで自動 = 最長行幅）
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [leftColPx, setLeftColPx] = useState<number | null>(null);

  const rows = useMemo(() => parseSideBySide(diff), [diff]);
  const metrics = useMemo(() => computeMetrics(rows), [rows]);
  const changeBlocks = useMemo(() => computeChangeBlocks(rows), [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 20,
  });

  // 行番号列の幅（桁数 + 余白）
  const numColCh = String(metrics.maxLineNumber).length + 2;

  // 折り返しOFF: 仮想化で行が絶対配置になるため、内容列の幅を最長行から固定で与えて
  // 全行の列位置を揃える（横スクロールはコンテナ全体で行う）
  const gridTemplateColumns = wordWrap
    ? `${numColCh}ch minmax(0, ${splitRatio}fr) ${numColCh}ch minmax(0, ${1 - splitRatio}fr)`
    : `${numColCh}ch ${
        leftColPx != null
          ? `${leftColPx}px`
          : `minmax(${metrics.maxLeftCh}ch, 1fr)`
      } ${numColCh}ch minmax(${metrics.maxRightCh}ch, 1fr)`;

  // 内容セルの左右padding（0.5rem x 2 x 2列）ぶんを上乗せした最小幅
  const innerMinWidth = wordWrap
    ? undefined
    : leftColPx != null
      ? `calc(${numColCh * 2 + metrics.maxRightCh}ch + ${leftColPx}px + 2rem)`
      : `calc(${numColCh * 2 + metrics.maxLeftCh + metrics.maxRightCh}ch + 2rem)`;

  /** 仕切り（右ペイン行番号列）のドラッグ開始 */
  const handleDividerPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const cell = e.currentTarget;
    const row = cell.parentElement;
    if (!row) return;

    const numColW = (row.children[0] as HTMLElement).offsetWidth;
    // 右ペイン行番号列のoffsetLeft = 行番号列幅 + 左内容列幅
    const startLeftW = cell.offsetLeft - numColW;
    const contentTotal = row.clientWidth - numColW * 2;
    const startX = e.clientX;
    const isWrap = wordWrap;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const newLeftW = startLeftW + (ev.clientX - startX);
      if (isWrap) {
        setSplitRatio(clamp(newLeftW / contentTotal, 0.1, 0.9));
      } else {
        setLeftColPx(clamp(newLeftW, 60, 10000));
      }
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 仕切り位置をリセット */
  const handleDividerReset = () => {
    setSplitRatio(0.5);
    setLeftColPx(null);
  };

  /** 前/次の変更ブロックへスクロール */
  const jumpToChange = (dir: 1 | -1) => {
    if (changeBlocks.length === 0) return;
    const offset = virtualizer.scrollOffset ?? 0;
    const topIndex =
      virtualizer.getVirtualItems().find((item) => item.end > offset)?.index ??
      0;

    let target: ChangeBlock | undefined;
    if (dir === 1) {
      target = changeBlocks.find((b) => b.start > topIndex);
    } else {
      target = [...changeBlocks].reverse().find((b) => b.start < topIndex);
    }
    // 端まで行ったら反対側へループ
    if (!target) {
      target = dir === 1 ? changeBlocks[0] : changeBlocks[changeBlocks.length - 1];
    }
    virtualizer.scrollToIndex(target.start, { align: 'start' });
  };

  /** ミニマップのクリック/ドラッグでその位置へスクロール */
  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const ruler = rulerRef.current;
    const scroller = scrollerRef.current;
    if (!ruler || !scroller) return;
    const rect = ruler.getBoundingClientRect();

    const scrollTo = (clientY: number) => {
      const frac = clamp((clientY - rect.top) / rect.height, 0, 1);
      scroller.scrollTop =
        frac * virtualizer.getTotalSize() - scroller.clientHeight / 2;
    };
    scrollTo(e.clientY);

    const onMove = (ev: PointerEvent) => scrollTo(ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className={s.wrapper}>
      <div ref={scrollerRef} className={s.scroller}>
        <div
          className={s.inner}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            minWidth: innerMinWidth,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];
            const rowStyle: React.CSSProperties = {
              transform: `translateY(${virtualItem.start}px)`,
            };

            if (row.kind === 'separator') {
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className={s.separator}
                  style={rowStyle}
                >
                  ⋯
                </div>
              );
            }

            const left = cellClasses(row.left);
            const right = cellClasses(row.right);

            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className={s.diffRow}
                style={{ ...rowStyle, gridTemplateColumns }}
              >
                <span className={`${s.lineNum} ${left.num}`}>
                  {row.left?.lineNumber ?? ''}
                </span>
                <span
                  className={`${wordWrap ? s.contentColWrap : s.contentCol} ${left.content}`}
                >
                  {row.left?.content ?? ''}
                </span>
                <span
                  className={`${s.lineNum} ${s.divider} ${right.num}`}
                  onPointerDown={handleDividerPointerDown}
                  onDoubleClick={handleDividerReset}
                  title="ドラッグで仕切りを移動 / ダブルクリックでリセット"
                >
                  {row.right?.lineNumber ?? ''}
                </span>
                <span
                  className={`${wordWrap ? s.contentColWrap : s.contentCol} ${right.content}`}
                >
                  {row.right?.content ?? ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ミニマップ（overview ruler）: 変更位置のマーク + クリックでジャンプ */}
      <div
        ref={rulerRef}
        className={s.ruler}
        onPointerDown={handleRulerPointerDown}
      >
        {changeBlocks.map((block, i) => {
          const top = (block.start / rows.length) * 100;
          const height = Math.max(
            ((block.end - block.start + 1) / rows.length) * 100,
            0.5
          );
          const colorClass =
            block.hasAddition && block.hasDeletion
              ? s.rulerMarkMixed
              : block.hasAddition
                ? s.rulerMarkAddition
                : s.rulerMarkDeletion;
          return (
            <div
              key={i}
              className={`${s.rulerMark} ${colorClass}`}
              style={{ top: `${top}%`, height: `${height}%` }}
            />
          );
        })}
      </div>

      {/* 変更ブロックへのジャンプボタン */}
      {changeBlocks.length > 0 && (
        <div className={s.jumpButtons}>
          <button
            className={s.jumpButton}
            onClick={() => jumpToChange(-1)}
            title="前の変更へ"
          >
            <ChevronUp size={14} />
          </button>
          <button
            className={s.jumpButton}
            onClick={() => jumpToChange(1)}
            title="次の変更へ"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default DiffLines;
