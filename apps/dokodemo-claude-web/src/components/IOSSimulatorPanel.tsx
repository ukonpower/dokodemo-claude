import {
  Component,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { RefreshCw, Smartphone, X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { useIOSSimulator } from '../hooks/useIOSSimulator';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import s from './IOSSimulatorPanel.module.scss';

type SimulatorSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface PointerStart {
  pointerId: number;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  startedAt: number;
}

function normalizedPoint(
  element: HTMLElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

interface IOSSimulatorBodyProps {
  socket: SimulatorSocket | null;
}

// デバイス選択・設定・画面表示の本体。マウント中のみストリームが動くため、
// 表示側（フローティング / SidePanel タブ）がマウントを制御する
function IOSSimulatorBody({ socket }: IOSSimulatorBodyProps) {
  const pointerStartRef = useRef<PointerStart | null>(null);
  const simulator = useIOSSimulator({ socket });
  const visibleFrame =
    simulator.frame?.udid === simulator.selectedUdid ? simulator.frame : null;
  const showVideo = simulator.videoActive;
  const hasScreen = showVideo ? simulator.hasVideoFrame : Boolean(visibleFrame);
  const canInteract = simulator.idbAvailable && hasScreen;

  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (!canInteract || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(
      event.currentTarget,
      event.clientX,
      event.clientY
    );
    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: performance.now(),
    };
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>): void => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const end = normalizedPoint(
      event.currentTarget,
      event.clientX,
      event.clientY
    );
    const movement = Math.hypot(
      event.clientX - start.clientX,
      event.clientY - start.clientY
    );
    const durationMs = performance.now() - start.startedAt;
    if (movement < 10) {
      simulator.tap(end.x, end.y);
      return;
    }
    simulator.swipe(start.x, start.y, end.x, end.y, durationMs);
  };

  return (
    <div className={s.body}>
      <div className={s.deviceRow}>
        <span
          className={`${s.statusDot} ${s[simulator.status]}`}
          title={simulator.status}
        />
        <select
          className={s.deviceSelect}
          value={simulator.selectedUdid}
          onChange={(event) => simulator.setSelectedUdid(event.target.value)}
          disabled={simulator.isLoadingDevices}
          aria-label="起動済みiOSシミュレータ"
        >
          {simulator.devices.length === 0 && (
            <option value="">
              {simulator.isLoadingDevices ? '検索中…' : '起動済みデバイスなし'}
            </option>
          )}
          {simulator.devices.map((device) => (
            <option key={device.udid} value={device.udid}>
              {device.name} · {device.runtime}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={s.iconButton}
          onClick={simulator.refreshDevices}
          aria-label="デバイス一覧を更新"
          title="デバイス一覧を更新"
        >
          <RefreshCw
            size={15}
            className={simulator.isLoadingDevices ? s.spinning : ''}
          />
        </button>
      </div>

      <div className={s.settingsRow}>
        <label>
          <span>fps</span>
          <select
            value={simulator.settings.fps}
            onChange={(event) =>
              simulator.setSettings({
                ...simulator.settings,
                fps: Number(event.target.value),
              })
            }
          >
            <option value={0}>auto</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
        </label>
        <label>
          <span>size</span>
          <select
            value={simulator.settings.scale}
            onChange={(event) =>
              simulator.setSettings({
                ...simulator.settings,
                scale: Number(event.target.value),
              })
            }
          >
            <option value={0.25}>25%</option>
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
          </select>
        </label>
        <label>
          <span>quality</span>
          <select
            value={simulator.settings.quality}
            onChange={(event) =>
              simulator.setSettings({
                ...simulator.settings,
                quality: Number(event.target.value),
              })
            }
          >
            <option value={45}>low</option>
            <option value={70}>mid</option>
            <option value={90}>high</option>
          </select>
        </label>
        <label className={s.liveToggle}>
          <input
            type="checkbox"
            checked={simulator.isLive}
            onChange={(event) => simulator.setIsLive(event.target.checked)}
            disabled={!simulator.selectedUdid}
          />
          <span>live</span>
        </label>
        <button
          type="button"
          className={s.iconButton}
          onClick={simulator.refreshFrame}
          disabled={!simulator.selectedUdid}
          aria-label="画面を手動更新"
          title="画面を手動更新"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {!simulator.idbAvailable && simulator.devices.length > 0 && (
        <p className={s.notice}>idbがないため表示のみモードです</p>
      )}
      {simulator.statusMessage && (
        <p className={s.notice}>{simulator.statusMessage}</p>
      )}
      {simulator.error && <p className={s.error}>{simulator.error}</p>}

      <div className={s.screenArea}>
        {!simulator.selectedUdid && (
          <p className={s.empty}>起動済みのiOSシミュレータがありません</p>
        )}
        {simulator.selectedUdid && !hasScreen && (
          <p className={s.empty}>画面を取得しています…</p>
        )}
        {/* H.264 ストリーム時は decoder が直接描画する canvas を表示する */}
        <canvas
          ref={simulator.videoCanvasRef}
          aria-label="iOSシミュレータの画面"
          className={`${s.screen} ${canInteract ? s.interactive : ''}`}
          style={showVideo && hasScreen ? undefined : { display: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            pointerStartRef.current = null;
          }}
        />
        {!showVideo && visibleFrame && (
          <img
            src={simulator.frameUrl}
            alt="iOSシミュレータの画面"
            className={`${s.screen} ${canInteract ? s.interactive : ''}`}
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              pointerStartRef.current = null;
            }}
          />
        )}
      </div>
    </div>
  );
}

// フローティングパネルの位置（ドラッグで移動した座標）を保存する
const FLOATING_POS_KEY = 'dokodemo-ios-simulator-pos';

interface FloatingPos {
  x: number;
  y: number;
}

interface DragStart {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

function getStoredFloatingPos(): FloatingPos | null {
  try {
    const raw = localStorage.getItem(FLOATING_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FloatingPos;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface IOSSimulatorFloatingPanelProps {
  socket: SimulatorSocket | null;
  onClose: () => void;
}

// PC 用フローティングパネル。SidePanel のメニューから起動し、ヘッダーのドラッグで移動できる
export function IOSSimulatorFloatingPanel({
  socket,
  onClose,
}: IOSSimulatorFloatingPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const dragStartRef = useRef<DragStart | null>(null);
  const [pos, setPos] = useState<FloatingPos | null>(getStoredFloatingPos);

  const clampPos = (x: number, y: number): FloatingPos => {
    const width = panelRef.current?.getBoundingClientRect().width ?? 0;
    return {
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      // ヘッダーが画面外に出て掴めなくならない範囲に収める
      y: Math.max(0, Math.min(y, window.innerHeight - 40)),
    };
  };

  const handleDragPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
  };

  const handleDragPointerMove = (event: PointerEvent<HTMLElement>): void => {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPos(clampPos(event.clientX - drag.offsetX, event.clientY - drag.offsetY));
  };

  const handleDragPointerUp = (event: PointerEvent<HTMLElement>): void => {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    if (pos) {
      try {
        localStorage.setItem(FLOATING_POS_KEY, JSON.stringify(pos));
      } catch {
        // ignore
      }
    }
  };

  // 保存座標がウィンドウリサイズで画面外に残らないよう適用時にもクランプする
  const style: CSSProperties | undefined = pos
    ? {
        left: Math.max(0, Math.min(pos.x, window.innerWidth - 80)),
        top: Math.max(0, Math.min(pos.y, window.innerHeight - 40)),
        right: 'auto',
        bottom: 'auto',
      }
    : undefined;

  return (
    <section ref={panelRef} className={s.floating} style={style}>
      <header
        className={s.dragHeader}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        onPointerCancel={() => {
          dragStartRef.current = null;
        }}
      >
        <Smartphone size={16} aria-hidden="true" />
        <span className={s.title}>iOS Simulator</span>
        <button
          type="button"
          className={s.closeButton}
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="閉じる"
          title="閉じる"
        >
          <X size={15} />
        </button>
      </header>
      <IOSSimulatorBody socket={socket} />
    </section>
  );
}

interface IOSSimulatorInlinePanelProps {
  socket: SimulatorSocket | null;
}

// SidePanel タブ（スマホ）用のインライン表示
export function IOSSimulatorInlinePanel({
  socket,
}: IOSSimulatorInlinePanelProps) {
  return (
    <div className={s.inline}>
      <IOSSimulatorBody socket={socket} />
    </div>
  );
}

interface IOSSimulatorPanelBoundaryProps {
  children: ReactNode;
  variant?: 'floating' | 'inline';
}

interface IOSSimulatorPanelBoundaryState {
  hasError: boolean;
}

export class IOSSimulatorPanelBoundary extends Component<
  IOSSimulatorPanelBoundaryProps,
  IOSSimulatorPanelBoundaryState
> {
  state: IOSSimulatorPanelBoundaryState = { hasError: false };

  static getDerivedStateFromError(): IOSSimulatorPanelBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('iOS Simulator panel error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const fallbackClass =
        this.props.variant === 'inline' ? s.fallbackInline : s.fallback;
      return <div className={fallbackClass}>iOS Simulator panel error</div>;
    }
    return this.props.children;
  }
}
