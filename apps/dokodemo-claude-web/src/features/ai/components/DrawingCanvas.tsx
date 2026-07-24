import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { X, Check, Undo2, Trash2, Maximize } from 'lucide-react';
import s from './DrawingCanvas.module.scss';

interface DrawingCanvasProps {
  isOpen: boolean;
  /** 赤入れ対象の画像URL。未指定なら白紙キャンバス */
  backgroundImageUrl?: string | null;
  onClose: () => void;
  /** 完了時に合成PNGを受け取る */
  onComplete: (file: File) => void;
}

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  width: number;
  points: Point[];
}

const PEN_COLORS = [
  '#ef4444', // 赤（デフォルト）
  '#3b82f6', // 青
  '#eab308', // 黄
  '#111827', // 黒
  '#ffffff', // 白
];

// 画面上での見た目のペン太さ（px）。ズーム倍率で割ってキャンバス座標系に変換する
const PEN_SCREEN_WIDTH = 4;

// 白紙キャンバスの解像度上限
const BLANK_CANVAS_MAX = 3000;

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
 */
const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  isOpen,
  backgroundImageUrl,
  onClose,
  onComplete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);

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
  const [strokeCount, setStrokeCount] = useState(0);
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
    for (const stroke of strokesRef.current) {
      strokePath(ctx, stroke);
    }
  }, []);

  // キャンバス初期化（背景画像の読み込み / 白紙の生成）
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let cancelled = false;
    strokesRef.current = [];
    currentStrokeRef.current = null;
    pointersRef.current.clear();
    pinchRef.current = null;
    multiTouchRef.current = false;
    setStrokeCount(0);

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
  }, [isOpen, backgroundImageUrl, redrawAll, fitView]);

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
    if (
      strokesRef.current.length > 0 &&
      !window.confirm('描いた内容を破棄しますか？')
    ) {
      return;
    }
    onClose();
  }, [onClose]);

  // Escで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isReady) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      containerRef.current?.setPointerCapture(e.pointerId);

      const rect = containerRef.current?.getBoundingClientRect();
      pointersRef.current.set(e.pointerId, {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      });

      if (pointersRef.current.size === 2) {
        // 2本目の指: 描きかけのストロークを取り消してピンチ操作へ移行
        multiTouchRef.current = true;
        if (currentStrokeRef.current) {
          strokesRef.current.pop();
          currentStrokeRef.current = null;
          redrawAll();
        }
        beginPinch();
        return;
      }

      if (pointersRef.current.size === 1 && !multiTouchRef.current) {
        const point = toCanvasPoint(e.clientX, e.clientY);
        const stroke: Stroke = {
          color: penColor,
          width: PEN_SCREEN_WIDTH / viewRef.current.scale,
          points: [point],
        };
        currentStrokeRef.current = stroke;
        strokesRef.current.push(stroke);
        strokePath(canvasRef.current!.getContext('2d')!, stroke);
      }
    },
    [isReady, penColor, toCanvasPoint, redrawAll, beginPinch]
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
          setStrokeCount(strokesRef.current.length);
        }
      }
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redrawAll();
  }, [redrawAll]);

  const handleClear = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    if (!window.confirm('すべての描き込みを消しますか？')) return;
    strokesRef.current = [];
    setStrokeCount(0);
    redrawAll();
  }, [redrawAll]);

  const handleComplete = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isExporting) return;
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
  }, [backgroundImageUrl, isExporting, onComplete]);

  if (!isOpen) return null;

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
          disabled={!isReady || isExporting || (!backgroundImageUrl && strokeCount === 0)}
          className={s.completeButton}
        >
          <Check size={16} strokeWidth={2.5} />
          <span>完了</span>
        </button>
      </div>

      {/* キャンバス */}
      <div
        ref={containerRef}
        className={s.canvasArea}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div ref={wrapperRef} className={s.canvasWrapper}>
          <canvas ref={canvasRef} className={s.canvas} />
        </div>
      </div>

      {/* ツールバー */}
      <div className={s.toolBar}>
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
          <button
            onClick={handleUndo}
            disabled={strokeCount === 0}
            className={s.toolButton}
            aria-label="元に戻す"
            title="元に戻す"
          >
            <Undo2 size={16} strokeWidth={2} />
          </button>
          <button
            onClick={handleClear}
            disabled={strokeCount === 0}
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
