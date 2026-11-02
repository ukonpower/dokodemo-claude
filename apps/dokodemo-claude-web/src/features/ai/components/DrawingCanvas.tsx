import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  X,
  Check,
  Undo2,
  Redo2,
  Trash2,
  Maximize,
  Pencil,
  Type,
} from 'lucide-react';
import { findImageFileInClipboardData } from '@/features/ai/utils/clipboard-image';
import s from './DrawingCanvas.module.scss';

interface DrawingCanvasProps {
  isOpen: boolean;
  /** 赤入れ対象の画像URL。未指定なら白紙キャンバス */
  backgroundImageUrl?: string | null;
  onClose: () => void;
  /** 完了時に合成PNGを受け取る */
  onComplete: (file: File) => void;
  /**
   * 開いている間に画像が貼り付けられたとき、その画像を受け取る。
   * 背景の差し替えは呼び出し側が backgroundImageUrl を更新して行う。未指定なら貼り付けを扱わない
   */
  onPasteImage?: (file: File) => void;
  /** 白紙で何も描いていない間だけキャンバス上に出す案内文 */
  notice?: string | null;
}

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  kind: 'stroke';
  color: string;
  width: number;
  points: Point[];
}

/** キャンバスに描き込んだ文字。座標・サイズはキャンバス座標系 */
interface TextItem {
  kind: 'text';
  color: string;
  fontSize: number;
  /** 文字ブロック左上の位置 */
  x: number;
  y: number;
  /** 改行を含みうる */
  text: string;
}

/** undo/redo 履歴の 1 単位。ストロークと文字を同列に積む */
type DrawItem = Stroke | TextItem;

/** 入力中の文字。確定するまでは履歴に積まず、キャンバス上の textarea で編集する */
interface TextDraft {
  x: number;
  y: number;
  value: string;
}

type Tool = 'pen' | 'text';

const PEN_COLORS = [
  '#ef4444', // 赤（デフォルト）
  '#3b82f6', // 青
  '#eab308', // 黄
  '#111827', // 黒
  '#ffffff', // 白
];

interface PenSize {
  id: 'thin' | 'medium' | 'thick';
  label: string;
  /** キャンバス短辺に対する線幅の比率 */
  ratio: number;
  /** キャンバス短辺に対する文字サイズの比率（文字ツールで使う） */
  textRatio: number;
  /** ツールバーで太さを示すドットのクラス */
  dotClassName: string;
  /** 文字ツール中にツールバーで大きさを示す「A」のクラス */
  glyphClassName: string;
}

// 線幅は画面ではなくキャンバス（画像）基準で決め、ズームしても画像に対する太さを変えない。
// 絶対 px にすると高解像度の画像ほど線が細く見えるため、短辺に対する比率で持つ。
// 短辺を基準にするのは、フィット表示では短辺側が画面に収まることが多く、
// 解像度・アスペクト比の違う画像でもフィット表示時の見た目の太さがほぼ揃うため。
// 値の目安: iPhone スクショ（短辺 1170px）でキャンバス上 約6 / 12 / 23px、
// スマホでフィット表示したとき画面上 約1.6 / 3.3 / 6.5px（従来の固定 4px が「中」付近）。
// 細=文字への注釈、中=通常の赤入れ、太=囲み・強調 を想定し、各段で倍にして差を見分けやすくしている
// 文字サイズも線幅と同じ理由で短辺比率で持つ。
// 値の目安: スマホでフィット表示したとき画面上 約11 / 16 / 25px（小さな注記 / 通常 / 見出し）。
// iPhone スクショ（1170×2532）も白紙キャンバス（画面の 2 倍）も、縦長で高さ側に合わせてフィットするためほぼ同じ見た目になる
const PEN_SIZES: PenSize[] = [
  {
    id: 'thin',
    label: '細',
    ratio: 0.005,
    textRatio: 0.035,
    dotClassName: s.penSizeDotThin,
    glyphClassName: s.textSizeGlyphThin,
  },
  {
    id: 'medium',
    label: '中',
    ratio: 0.01,
    textRatio: 0.05,
    dotClassName: s.penSizeDotMedium,
    glyphClassName: s.textSizeGlyphMedium,
  },
  {
    id: 'thick',
    label: '太',
    ratio: 0.02,
    textRatio: 0.08,
    dotClassName: s.penSizeDotThick,
    glyphClassName: s.textSizeGlyphThick,
  },
];

// 極端に小さい画像で線が 1px 未満になり消えて見えるのを防ぐ下限（キャンバス px）
const PEN_MIN_WIDTH = 1;

// 文字サイズの下限（キャンバス px）。
// iOS Safari は 16px 未満の入力欄にフォーカスするとページを自動ズームするため、入力中の textarea がこれを下回らないようにする
// （index.scss の入力欄 16px 固定を .textInput で上書きしているので、ズーム防止はこの下限が担う）
const TEXT_MIN_FONT_SIZE = 16;

// 文字の書体。キャンバス描画と入力中の textarea で同じ値を使い、確定前後で見た目をずらさない
const TEXT_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Segoe UI", sans-serif';
const TEXT_FONT_WEIGHT = 700;
// 行の高さ（文字サイズに対する倍率）。textarea の line-height とキャンバスの行送りで共有する
const TEXT_LINE_HEIGHT = 1.25;

// これ以上指が動いたらタップではなくドラッグとみなし、文字入力を開かない（画面 px）
const TAP_MOVE_TOLERANCE = 10;

// 白紙キャンバスの解像度上限
const BLANK_CANVAS_MAX = 3000;

/** ペンサイズとキャンバス寸法から、キャンバス座標系での線幅を求める */
function penWidthFor(canvas: HTMLCanvasElement, size: PenSize): number {
  const shortSide = Math.min(canvas.width, canvas.height);
  return Math.max(shortSide * size.ratio, PEN_MIN_WIDTH);
}

/** ペンサイズとキャンバス寸法から、キャンバス座標系での文字サイズを求める */
function textSizeFor(canvas: HTMLCanvasElement, size: PenSize): number {
  const shortSide = Math.min(canvas.width, canvas.height);
  return Math.max(shortSide * size.textRatio, TEXT_MIN_FONT_SIZE);
}

function textFont(fontSize: number): string {
  return `${TEXT_FONT_WEIGHT} ${fontSize}px ${TEXT_FONT_FAMILY}`;
}

// 入力中 textarea の幅をキャンバスと同じ計測で決めるための使い回し用コンテキスト
let measureContext: CanvasRenderingContext2D | null = null;

/** 複数行テキストのうち最も長い行の幅（キャンバス px）を測る */
function measureTextWidth(lines: string[], fontSize: number): number {
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d');
  }
  if (!measureContext) return 0;
  measureContext.font = textFont(fontSize);
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, measureContext.measureText(line).width);
  }
  return maxWidth;
}

/** 文字をキャンバスに描く。行ごとに行ボックスの中央へ置き、textarea の行配置と揃える */
function drawText(ctx: CanvasRenderingContext2D, item: TextItem) {
  const lineHeight = item.fontSize * TEXT_LINE_HEIGHT;
  const lines = item.text.split('\n');
  ctx.font = textFont(item.fontSize);
  ctx.fillStyle = item.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], item.x, item.y + lineHeight * (i + 0.5));
  }
}

/** ツールバーのボタンのクラス。選択中のツールは背景の明るさで示す */
function toolButtonClassName(isActive: boolean): string {
  if (isActive) {
    return `${s.toolButton} ${s.toolButtonActive}`;
  }
  return s.toolButton;
}

/** キーボード入力を受け付けるテキスト入力欄か（そこでは標準の undo を優先する） */
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

/** macOS / iOS では Cmd、それ以外では Ctrl を undo/redo の修飾キーとして扱う */
function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function strokePath(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (pts.length === 0) return;

  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = midPoint(pts[i], pts[i + 1]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.stroke();
}

/**
 * 全画面のお絵かきオーバーレイ。
 * 1本指（マウスドラッグ）で描画、2本指でピンチズーム＋パン、ホイールでズーム。
 * 文字ツール中はタップした位置に文字を入力できる。
 */
const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  isOpen,
  backgroundImageUrl,
  onClose,
  onComplete,
  onPasteImage,
  notice,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const itemsRef = useRef<DrawItem[]>([]);
  // undo で取り除いた描き込み。新しい描き込みを確定したら破棄する
  const redoItemsRef = useRef<DrawItem[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  // 文字ツールでタップ判定中の指の位置（画面座標）。動きすぎたら null に戻してタップ扱いしない
  const pendingTapRef = useRef<{ clientX: number; clientY: number } | null>(
    null
  );
  // 入力中の文字。確定処理は blur・Enter・キャンバスのタップ等から重ねて呼ばれうるため、
  // 二重確定しないよう state とは別に同期的に読み書きできる ref を正とする
  const textDraftRef = useRef<TextDraft | null>(null);

  // ビュー変換（キャンバス座標 → 画面座標）
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0, fitScale: 1 });

  // マルチタッチ管理
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{
    d0: number;
    s0: number;
    tx0: number;
    ty0: number;
    mid0: Point;
  } | null>(null);
  // 一度2本指になったら、全ての指が離れるまで描画を再開しない
  const multiTouchRef = useRef(false);

  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penSize, setPenSize] = useState<PenSize>(PEN_SIZES[1]);
  const [tool, setTool] = useState<Tool>('pen');
  const [textDraft, setTextDraftState] = useState<TextDraft | null>(null);
  const [itemCount, setItemCount] = useState(0);
  // redoItemsRef は ref で再描画されないため、redo ボタンの disabled 判定用に件数を別に持つ
  const [redoCount, setRedoCount] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // onClose は親の再レンダーごとに identity が変わりうる（インライン関数）。
  // 初期化 effect の依存に入れるとキャンバスが描画中にリセットされるため ref 経由で参照する
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const applyView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const { scale, tx, ty } = viewRef.current;
    wrapper.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }, []);

  const fitView = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / canvas.width, ch / canvas.height);
    viewRef.current.scale = scale;
    viewRef.current.fitScale = scale;
    viewRef.current.tx = (cw - canvas.width * scale) / 2;
    viewRef.current.ty = (ch - canvas.height * scale) / 2;
    applyView();
  }, [applyView]);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = bgImageRef.current;
    if (bg) {
      ctx.drawImage(bg, 0, 0);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    for (const item of itemsRef.current) {
      if (item.kind === 'stroke') {
        strokePath(ctx, item);
      } else {
        drawText(ctx, item);
      }
    }
  }, []);

  const setTextDraft = useCallback((draft: TextDraft | null) => {
    textDraftRef.current = draft;
    setTextDraftState(draft);
  }, []);

  /** 新しい描き込みを履歴に積む。これ以降 undo 前の続きには戻れなくなる */
  const pushItem = useCallback((item: DrawItem) => {
    itemsRef.current.push(item);
    redoItemsRef.current = [];
    setItemCount(itemsRef.current.length);
    setRedoCount(0);
  }, []);

  /**
   * 入力中の文字を確定してキャンバスに描く。空なら何も積まずに入力を閉じる。
   * 書き出し（完了）直前にも呼ぶため、描画は同期的に済ませる
   */
  const commitText = useCallback(() => {
    const draft = textDraftRef.current;
    if (!draft) return;
    setTextDraft(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 末尾の改行だけが残ると見えない行で文字ブロックが下に伸びるため落とす
    const text = draft.value.replace(/\s+$/, '');
    if (text.trim() === '') return;
    pushItem({
      kind: 'text',
      color: penColor,
      fontSize: textSizeFor(canvas, penSize),
      x: draft.x,
      y: draft.y,
      text,
    });
    redrawAll();
  }, [penColor, penSize, pushItem, redrawAll, setTextDraft]);

  // キャンバス初期化（背景画像の読み込み / 白紙の生成）
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let cancelled = false;
    itemsRef.current = [];
    redoItemsRef.current = [];
    currentStrokeRef.current = null;
    pendingTapRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
    multiTouchRef.current = false;
    setTextDraft(null);
    setItemCount(0);
    setRedoCount(0);

    const init = (width: number, height: number) => {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      redrawAll();
      fitView();
      setIsReady(true);
    };

    if (backgroundImageUrl) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        bgImageRef.current = img;
        init(img.naturalWidth, img.naturalHeight);
      };
      img.onerror = () => {
        if (cancelled) return;
        window.alert('画像の読み込みに失敗しました');
        onCloseRef.current();
      };
      img.src = backgroundImageUrl;
    } else {
      bgImageRef.current = null;
      const width = Math.min(
        Math.round(window.innerWidth * 2),
        BLANK_CANVAS_MAX
      );
      const height = Math.min(
        Math.round(window.innerHeight * 2),
        BLANK_CANVAS_MAX
      );
      init(width, height);
    }

    return () => {
      cancelled = true;
      bgImageRef.current = null;
      setIsReady(false);
    };
  }, [isOpen, backgroundImageUrl, redrawAll, fitView, setTextDraft]);

  // 開いた時点で背面の入力欄にフォーカスが残っていると、Cmd+Z がそちらの undo に
  // 吸われてキャンバスに効かない（見えない入力欄が書き換わる）ため、フォーカスを外す
  useEffect(() => {
    if (!isOpen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && isTextEditingTarget(active)) {
      active.blur();
    }
  }, [isOpen]);

  // 開いている間は背面のスクロールを止める（ImageLightbox と同じ流儀）
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const requestClose = useCallback(() => {
    let hasContent = itemsRef.current.length > 0;
    const draft = textDraftRef.current;
    if (draft && draft.value.trim() !== '') {
      hasContent = true;
    }
    if (hasContent && !window.confirm('描いた内容を破棄しますか？')) {
      return;
    }
    onClose();
  }, [onClose]);

  // Escで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // 文字入力中の Esc は入力の確定に使うため、キャンバスごと閉じない
      if (isTextEditingTarget(e.target)) return;
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, requestClose]);

  // ホイールズーム（React の onWheel は passive になり preventDefault できないため native で張る）
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const view = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.002);
      const next = Math.min(
        Math.max(view.scale * factor, view.fitScale * 0.3),
        Math.max(view.fitScale * 20, 4)
      );
      view.tx = cx - (cx - view.tx) * (next / view.scale);
      view.ty = cy - (cy - view.ty) * (next / view.scale);
      view.scale = next;
      applyView();
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isOpen, applyView]);

  const toCanvasPoint = useCallback((clientX: number, clientY: number): Point => {
    const container = containerRef.current;
    const view = viewRef.current;
    const rect = container?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return {
      x: (clientX - left - view.tx) / view.scale,
      y: (clientY - top - view.ty) / view.scale,
    };
  }, []);

  // 描画中ストロークの末尾セグメントだけを描く（毎moveの全再描画を避ける）
  const drawLatestSegment = useCallback((stroke: Stroke) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pts = stroke.points;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (pts.length === 2) {
      const mid = midPoint(pts[0], pts[1]);
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(mid.x, mid.y);
    } else {
      const a = pts[pts.length - 3];
      const b = pts[pts.length - 2];
      const c = pts[pts.length - 1];
      const m1 = midPoint(a, b);
      const m2 = midPoint(b, c);
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(b.x, b.y, m2.x, m2.y);
    }
    ctx.stroke();
  }, []);

  const beginPinch = useCallback(() => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return;
    const view = viewRef.current;
    pinchRef.current = {
      d0: Math.max(distance(pts[0], pts[1]), 1),
      s0: view.scale,
      tx0: view.tx,
      ty0: view.ty,
      mid0: midPoint(pts[0], pts[1]),
    };
  }, []);

  /** 画面座標の位置に文字入力を開く。タップ位置が 1 行目の縦中央に来るよう配置する */
  const openTextInput = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = toCanvasPoint(clientX, clientY);
      const lineHeight = textSizeFor(canvas, penSize) * TEXT_LINE_HEIGHT;
      // iOS はユーザー操作の処理中に同期で focus() しないとソフトキーボードを出さないため、
      // textarea を即時にマウントしてからこのハンドラ内でフォーカスする
      flushSync(() => {
        setTextDraft({ x: point.x, y: point.y - lineHeight / 2, value: '' });
      });
      textInputRef.current?.focus();
    },
    [penSize, toCanvasPoint, setTextDraft]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isReady) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();

      // 入力中にキャンバスに触れたら、その操作は入力の確定だけに使う（描画や新しい入力は始めない）。
      // pointerdown を preventDefault しているため textarea の blur は起きず、ここで明示的に確定する
      if (textDraftRef.current) {
        commitText();
        return;
      }

      containerRef.current?.setPointerCapture(e.pointerId);

      const rect = containerRef.current?.getBoundingClientRect();
      pointersRef.current.set(e.pointerId, {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      });

      if (pointersRef.current.size === 2) {
        // 2本目の指: 描きかけのストロークを取り消してピンチ操作へ移行
        multiTouchRef.current = true;
        pendingTapRef.current = null;
        if (currentStrokeRef.current) {
          itemsRef.current.pop();
          currentStrokeRef.current = null;
          redrawAll();
        }
        beginPinch();
        return;
      }

      if (pointersRef.current.size === 1 && !multiTouchRef.current) {
        if (tool === 'text') {
          // 2 本指のピンチと区別するため、文字入力は指が離れた時点で開く
          pendingTapRef.current = { clientX: e.clientX, clientY: e.clientY };
          return;
        }
        const point = toCanvasPoint(e.clientX, e.clientY);
        const stroke: Stroke = {
          kind: 'stroke',
          color: penColor,
          width: penWidthFor(canvasRef.current!, penSize),
          points: [point],
        };
        currentStrokeRef.current = stroke;
        itemsRef.current.push(stroke);
        strokePath(canvasRef.current!.getContext('2d')!, stroke);
      }
    },
    [
      isReady,
      tool,
      penColor,
      penSize,
      toCanvasPoint,
      redrawAll,
      beginPinch,
      commitText,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      e.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      pointersRef.current.set(e.pointerId, {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      });

      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const pts = Array.from(pointersRef.current.values());
        const d = Math.max(distance(pts[0], pts[1]), 1);
        const mid = midPoint(pts[0], pts[1]);
        const view = viewRef.current;
        const next = Math.min(
          Math.max(pinch.s0 * (d / pinch.d0), view.fitScale * 0.3),
          Math.max(view.fitScale * 20, 4)
        );
        const ratio = next / pinch.s0;
        view.scale = next;
        view.tx = mid.x - (pinch.mid0.x - pinch.tx0) * ratio;
        view.ty = mid.y - (pinch.mid0.y - pinch.ty0) * ratio;
        applyView();
        return;
      }

      const tap = pendingTapRef.current;
      if (tap) {
        const moved = Math.hypot(e.clientX - tap.clientX, e.clientY - tap.clientY);
        if (moved > TAP_MOVE_TOLERANCE) {
          pendingTapRef.current = null;
        }
        return;
      }

      const stroke = currentStrokeRef.current;
      if (stroke) {
        const point = toCanvasPoint(e.clientX, e.clientY);
        const last = stroke.points[stroke.points.length - 1];
        if (distance(point, last) < 1 / viewRef.current.scale) return;
        stroke.points.push(point);
        drawLatestSegment(stroke);
      }
    },
    [toCanvasPoint, drawLatestSegment, applyView]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);

      if (pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      if (pointersRef.current.size === 0) {
        multiTouchRef.current = false;
        const tap = pendingTapRef.current;
        if (tap) {
          pendingTapRef.current = null;
          openTextInput(tap.clientX, tap.clientY);
          return;
        }
        const stroke = currentStrokeRef.current;
        if (stroke) {
          // 描画中は最終セグメントの中点までしか描いていないため、末尾を締める
          // （そうしないと再描画時に線がわずかに伸びて見た目がずれる）
          const ctx = canvasRef.current?.getContext('2d');
          const pts = stroke.points;
          if (ctx && pts.length >= 2) {
            const prev = pts[pts.length - 2];
            const last = pts[pts.length - 1];
            const mid = midPoint(prev, last);
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(mid.x, mid.y);
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
          }
          currentStrokeRef.current = null;
          // 描画中のストロークは pointerdown 時点で履歴に入れているため、ここでは redo の破棄と件数更新だけ行う
          redoItemsRef.current = [];
          setItemCount(itemsRef.current.length);
          setRedoCount(0);
        }
      }
    },
    [openTextInput]
  );

  // OS 側の割り込み等で指が取り消されたときは、タップとして文字入力を開かない
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pendingTapRef.current = null;
      handlePointerUp(e);
    },
    [handlePointerUp]
  );

  const handleUndo = useCallback(() => {
    // 描画中に undo すると描きかけのストロークと履歴が食い違うため受け付けない
    if (currentStrokeRef.current) return;
    // スマホではツールバーを押しても textarea が blur しないことがあるため、入力中の文字を先に確定して履歴に載せる
    commitText();
    const item = itemsRef.current.pop();
    if (!item) return;
    redoItemsRef.current.push(item);
    setItemCount(itemsRef.current.length);
    setRedoCount(redoItemsRef.current.length);
    redrawAll();
  }, [commitText, redrawAll]);

  const handleRedo = useCallback(() => {
    if (currentStrokeRef.current) return;
    if (textDraftRef.current) return;
    const item = redoItemsRef.current.pop();
    if (!item) return;
    itemsRef.current.push(item);
    setItemCount(itemsRef.current.length);
    setRedoCount(redoItemsRef.current.length);
    redrawAll();
  }, [redrawAll]);

  const selectTool = useCallback(
    (next: Tool) => {
      commitText();
      setTool(next);
    },
    [commitText]
  );

  const handleTextKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 日本語入力の変換確定の Enter では確定しない
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        commitText();
        return;
      }
      // 改行は Shift+Enter。スマホのソフトキーボードの改行キーは確定として扱う
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitText();
      }
    },
    [commitText]
  );

  // 画像の貼り付けで背景を差し替える。
  // capture 段階で拾って伝播を止め、背面の入力欄の paste ハンドラ（アップロード処理）と二重に動かないようにする
  useEffect(() => {
    if (!isOpen || !onPasteImage) return;
    const handlePaste = (e: ClipboardEvent) => {
      const file = findImageFileInClipboardData(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      // 描き込みは差し替え前の画像の座標で持っているため新しい背景には引き継げない。黙って消さずに確認する
      if (itemsRef.current.length > 0) {
        const confirmed = window.confirm(
          '描いた内容を破棄して、貼り付けた画像に差し替えますか？'
        );
        if (!confirmed) return;
      }
      onPasteImage(file);
    };
    window.addEventListener('paste', handlePaste, true);
    return () => window.removeEventListener('paste', handlePaste, true);
  }, [isOpen, onPasteImage]);

  // undo / redo のショートカット。開いている間だけ有効
  useEffect(() => {
    if (!isOpen) return;
    const useMeta = isApplePlatform();
    const handleKeyDown = (e: KeyboardEvent) => {
      // テキスト入力中はブラウザ標準の undo/redo を奪わない
      if (isTextEditingTarget(e.target)) return;
      if (e.altKey) return;
      if (e.key.toLowerCase() !== 'z') return;

      let modifierPressed = e.ctrlKey;
      if (useMeta) {
        modifierPressed = e.metaKey;
      }
      if (!modifierPressed) return;

      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleUndo, handleRedo]);

  const handleClear = useCallback(() => {
    commitText();
    if (itemsRef.current.length === 0) return;
    if (!window.confirm('すべての描き込みを消しますか？')) return;
    itemsRef.current = [];
    redoItemsRef.current = [];
    setItemCount(0);
    setRedoCount(0);
    redrawAll();
  }, [commitText, redrawAll]);

  const handleComplete = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isExporting) return;
    // 入力中の文字も書き出しに含める（commitText はキャンバスへ同期的に描く）
    commitText();
    setIsExporting(true);
    canvas.toBlob((blob) => {
      setIsExporting(false);
      if (!blob) {
        window.alert('画像の書き出しに失敗しました');
        return;
      }
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const prefix = backgroundImageUrl ? 'markup' : 'sketch';
      const file = new File([blob], `${prefix}-${stamp}.png`, {
        type: 'image/png',
      });
      onComplete(file);
    }, 'image/png');
  }, [backgroundImageUrl, isExporting, onComplete, commitText]);

  if (!isOpen) return null;

  let hasDraftText = false;
  if (textDraft && textDraft.value.trim() !== '') {
    hasDraftText = true;
  }

  let showNotice = false;
  if (notice && !backgroundImageUrl && itemCount === 0 && !textDraft) {
    showNotice = true;
  }

  // 入力中の textarea はキャンバスと同じ変換の中に置き、キャンバス座標のまま配置・サイズ指定する
  // （ズームやパンをしても文字が描画位置からずれない）
  let textInputStyle: React.CSSProperties | null = null;
  const canvas = canvasRef.current;
  if (textDraft && canvas) {
    const fontSize = textSizeFor(canvas, penSize);
    const lines = textDraft.value.split('\n');
    const textWidth = measureTextWidth(lines, fontSize);
    // 空のときもキャレットと枠が見える幅を確保し、行末のキャレット分の余白を足す
    const width = Math.max(textWidth, fontSize) + fontSize * 0.5;
    textInputStyle = {
      left: textDraft.x,
      top: textDraft.y,
      width,
      height: fontSize * TEXT_LINE_HEIGHT * lines.length,
      // font-size は inline 指定だと index.scss のモバイル向け 16px !important に負けるため、変数経由で SCSS 側から当てる
      ['--text-input-font-size' as string]: `${fontSize}px`,
      lineHeight: TEXT_LINE_HEIGHT,
      fontFamily: TEXT_FONT_FAMILY,
      fontWeight: TEXT_FONT_WEIGHT,
      color: penColor,
      caretColor: penColor,
    };
  }

  let canvasAreaClassName = s.canvasArea;
  if (tool === 'text') {
    canvasAreaClassName = `${s.canvasArea} ${s.canvasAreaText}`;
  }

  return (
    <div className={s.backdrop}>
      {/* ヘッダー */}
      <div className={s.topBar}>
        <button
          onClick={requestClose}
          className={s.closeButton}
          aria-label="閉じる"
          title="閉じる (Esc)"
        >
          <X size={20} strokeWidth={2.25} />
        </button>
        <span className={s.title}>
          {backgroundImageUrl ? '赤入れ' : 'スケッチ'}
        </span>
        <button
          onClick={handleComplete}
          disabled={
            !isReady ||
            isExporting ||
            (!backgroundImageUrl && itemCount === 0 && !hasDraftText)
          }
          className={s.completeButton}
        >
          <Check size={16} strokeWidth={2.5} />
          <span>完了</span>
        </button>
      </div>

      {/* キャンバス */}
      <div
        ref={containerRef}
        className={canvasAreaClassName}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div ref={wrapperRef} className={s.canvasWrapper}>
          <canvas ref={canvasRef} className={s.canvas} />
          {textDraft && textInputStyle && (
            <textarea
              ref={textInputRef}
              className={s.textInput}
              style={textInputStyle}
              value={textDraft.value}
              onChange={(e) =>
                setTextDraft({ ...textDraft, value: e.target.value })
              }
              onKeyDown={handleTextKeyDown}
              onBlur={commitText}
              // キャンバス側の pointerdown（確定・描画）に渡さず、入力欄内のキャレット移動に使わせる
              onPointerDown={(e) => e.stopPropagation()}
              rows={1}
              wrap="off"
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="キャンバスに書き込む文字"
            />
          )}
        </div>
        {showNotice && <p className={s.notice}>{notice}</p>}
      </div>

      {/* ツールバー */}
      <div className={s.toolBar}>
        <div className={s.toolGroup}>
          <button
            onClick={() => selectTool('pen')}
            className={toolButtonClassName(tool === 'pen')}
            aria-label="ペン"
            aria-pressed={tool === 'pen'}
            title="ペン"
          >
            <Pencil size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => selectTool('text')}
            className={toolButtonClassName(tool === 'text')}
            aria-label="文字"
            aria-pressed={tool === 'text'}
            title="文字（タップした位置に入力）"
          >
            <Type size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={s.colorGroup}>
          {PEN_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => setPenColor(color)}
              className={`${s.colorSwatch} ${penColor === color ? s.colorSwatchActive : ''}`}
              style={{ backgroundColor: color }}
              aria-label={`ペン色 ${color}`}
            />
          ))}
        </div>
        <div className={s.toolGroup}>
          {PEN_SIZES.map((size) => {
            const isActive = penSize.id === size.id;
            // 文字ツール中は同じ 3 段を文字の大きさとして使うため、表示を「A」の大小に切り替える
            let label = `ペンの太さ ${size.label}`;
            let title = `太さ: ${size.label}`;
            let indicator = (
              <span className={`${s.penSizeDot} ${size.dotClassName}`} />
            );
            if (tool === 'text') {
              label = `文字の大きさ ${size.label}`;
              title = `文字の大きさ: ${size.label}`;
              indicator = (
                <span className={`${s.textSizeGlyph} ${size.glyphClassName}`}>
                  A
                </span>
              );
            }
            return (
              <button
                key={size.id}
                onClick={() => setPenSize(size)}
                className={toolButtonClassName(isActive)}
                aria-label={label}
                aria-pressed={isActive}
                title={title}
              >
                {indicator}
              </button>
            );
          })}
        </div>
        <div className={s.toolGroup}>
          <button
            onClick={handleUndo}
            disabled={itemCount === 0 && !hasDraftText}
            className={s.toolButton}
            aria-label="元に戻す"
            title="元に戻す (⌘Z / Ctrl+Z)"
          >
            <Undo2 size={16} strokeWidth={2} />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoCount === 0}
            className={s.toolButton}
            aria-label="やり直す"
            title="やり直す (⇧⌘Z / Ctrl+Shift+Z)"
          >
            <Redo2 size={16} strokeWidth={2} />
          </button>
          <button
            onClick={handleClear}
            disabled={itemCount === 0 && !hasDraftText}
            className={s.toolButton}
            aria-label="すべて消す"
            title="すべて消す"
          >
            <Trash2 size={16} strokeWidth={2} />
          </button>
          <button
            onClick={fitView}
            className={s.toolButton}
            aria-label="表示をリセット"
            title="表示をリセット"
          >
            <Maximize size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DrawingCanvas;
