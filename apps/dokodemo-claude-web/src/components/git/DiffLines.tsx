import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Highlight, themes } from 'prism-react-renderer';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { detectDiffLanguage } from '@/utils/diff-language';
import '@/shared/utils/prism-languages';
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

/** 折り返しOFF時の横スクロール幅計算に使う各種最大値 */
function computeMetrics(rows: DiffRow[]): {
  maxContentCh: number;
  maxLineNumber: number;
} {
  let maxContentCh = 0;
  let maxLineNumber = 1;
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    if (row.left) {
      maxContentCh = Math.max(maxContentCh, displayWidthCh(row.left.content));
      maxLineNumber = Math.max(maxLineNumber, row.left.lineNumber);
    }
    if (row.right) {
      maxContentCh = Math.max(maxContentCh, displayWidthCh(row.right.content));
      maxLineNumber = Math.max(maxLineNumber, row.right.lineNumber);
    }
  }
  return { maxContentCh, maxLineNumber };
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

function cellClasses(
  cell: DiffCell | null,
  hasLanguage: boolean
): {
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
        content: `${s.bgAddition} ${hasLanguage ? '' : s.textAddition}`,
      };
    case 'deletion':
      return {
        num: `${s.bgDeletion} ${s.lineNumDeletion}`,
        content: `${s.bgDeletion} ${hasLanguage ? '' : s.textDeletion}`,
      };
    default:
      return {
        num: s.lineNumDefault,
        content: s.textContext,
      };
  }
}

// 1行分のコードをシンタックスハイライトして inline に描画する。
// 行単位のトークナイズなので複数行コメントの継続は表現されないが、diff 用途では許容する
const HighlightedCode = React.memo(function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  return (
    <Highlight theme={themes.vsDark} code={code} language={language}>
      {({ tokens, getTokenProps }) => (
        <>
          {tokens[0]?.map((token, i) => (
            <span
              key={i}
              {...(getTokenProps({ token }) as React.HTMLAttributes<HTMLSpanElement>)}
            />
          ))}
        </>
      )}
    </Highlight>
  );
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 1行分の推定高さ（px）。実高は measureElement で補正される */
const ESTIMATED_ROW_HEIGHT = 20;

interface DiffLinesProps {
  /** 差分テキスト */
  diff: string;
  /** ファイルパス（シンタックスハイライトの言語判定に使用） */
  filePath?: string;
  /** 折り返し */
  wordWrap?: boolean;
}

/**
 * 差分をVSCode風の左右分割（左=変更前、右=変更後）で描画する。
 * 巨大ファイルでも耐えられるよう、行は仮想スクロールで描画する。
 *
 * 折り返しOFF時の横スクロールは「仕切り・行番号は画面に固定し、テキストだけが
 * 左右ペインの中でスクロールする」方式（VSCodeのside-by-side相当）。
 * 実装上は行の枠を translateX(+scrollLeft) で画面に留め、テキストを
 * translateX(-scrollLeft) で流す（CSS変数 --dc-hscroll 経由、再レンダーなし）。
 *
 * 左右の仕切り（右ペインの行番号列）はドラッグで比率を調整でき、ダブルクリックでリセット。
 * 右端のミニマップ（overview ruler）と↑↓ボタンで変更行へジャンプできる。
 * このコンポーネント自身がスクロールコンテナを持つ（親は高さを与えるだけでよい）。
 * DiffViewer と Git Graph のコミット詳細で共用する。
 */
const DiffLines: React.FC<DiffLinesProps> = ({
  diff,
  filePath,
  wordWrap = false,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const language = useMemo(
    () => (filePath ? detectDiffLanguage(filePath) : null),
    [filePath]
  );

  // 左右ペインの分割比率（両モード共通）
  const [splitRatio, setSplitRatio] = useState(0.5);
  // スクロールバーを除いた表示幅。行の枠はこの幅で画面に固定する
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  // 表示高さ（ミニマップの表示範囲インジケーター用）
  const [paneHeight, setPaneHeight] = useState<number | null>(null);

  const rows = useMemo(() => parseSideBySide(diff), [diff]);
  const metrics = useMemo(() => computeMetrics(rows), [rows]);
  const changeBlocks = useMemo(() => computeChangeBlocks(rows), [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 20,
  });

  // 表示幅の追従（リサイズ・スクロールバー出現）
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      setPaneWidth(scroller.clientWidth);
      setPaneHeight(scroller.clientHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // 横スクロール位置をCSS変数に反映（再レンダーせずテキストだけ流す）
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    innerRef.current?.style.setProperty(
      '--dc-hscroll',
      `${e.currentTarget.scrollLeft}px`
    );
  };

  // 折り返し切替時は横スクロールをリセット
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollLeft = 0;
    innerRef.current?.style.setProperty('--dc-hscroll', '0px');
  }, [wordWrap]);

  // 行番号列の幅（桁数 + 余白）
  const numColCh = String(metrics.maxLineNumber).length + 2;

  // 仕切りは常にビューポート基準の比率位置（デフォルト中央）
  const gridTemplateColumns = `${numColCh}ch minmax(0, ${splitRatio}fr) ${numColCh}ch minmax(0, ${1 - splitRatio}fr)`;

  // 折り返しOFF: 最長行がペイン内でスクロールしきれる幅のダミー領域を確保する
  // （狭い方のペイン = min(ratio, 1-ratio) 側でも末尾まで読めるようにする）
  const narrowRatio = Math.min(splitRatio, 1 - splitRatio);
  const innerMinWidth = wordWrap
    ? undefined
    : `max(100%, calc(${Math.round((1 - narrowRatio) * 100)}% + ${
        metrics.maxContentCh + numColCh * 2
      }ch + 2rem))`;

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

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const newLeftW = startLeftW + (ev.clientX - startX);
      setSplitRatio(clamp(newLeftW / contentTotal, 0.1, 0.9));
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

  // 行の枠を画面に固定するためのスタイル（横スクロール分だけ逆方向に補正）
  const rowWidth = paneWidth != null ? `${paneWidth}px` : '100%';

  const renderContent = (cell: DiffCell | null, contentClass: string) => {
    const inner =
      language && cell ? (
        <HighlightedCode code={cell.content} language={language} />
      ) : (
        (cell?.content ?? '')
      );
    return (
      <span
        className={`${wordWrap ? s.contentColWrap : s.contentCol} ${contentClass}`}
      >
        {wordWrap ? inner : <span className={s.hscrollText}>{inner}</span>}
      </span>
    );
  };

  return (
    <div className={s.wrapper}>
      <div ref={scrollerRef} className={s.scroller} onScroll={handleScroll}>
        <div
          ref={innerRef}
          className={s.inner}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            minWidth: innerMinWidth,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = rows[virtualItem.index];
            const rowStyle: React.CSSProperties = {
              transform: `translate(var(--dc-hscroll, 0px), ${virtualItem.start}px)`,
              width: rowWidth,
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

            const left = cellClasses(row.left, language != null);
            const right = cellClasses(row.right, language != null);

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
                {renderContent(row.left, left.content)}
                <span
                  className={`${s.lineNum} ${s.divider} ${right.num}`}
                  onPointerDown={handleDividerPointerDown}
                  onDoubleClick={handleDividerReset}
                  title="ドラッグで仕切りを移動 / ダブルクリックでリセット"
                >
                  {row.right?.lineNumber ?? ''}
                </span>
                {renderContent(row.right, right.content)}
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
        {/* 現在の表示範囲インジケーター（スクロールバーのthumb相当） */}
        {paneHeight != null && virtualizer.getTotalSize() > paneHeight && (
          <div
            className={s.rulerViewport}
            style={{
              top: `${((virtualizer.scrollOffset ?? 0) / virtualizer.getTotalSize()) * 100}%`,
              height: `${(paneHeight / virtualizer.getTotalSize()) * 100}%`,
            }}
          />
        )}
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
