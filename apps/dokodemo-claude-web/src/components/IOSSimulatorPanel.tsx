import {
  Component,
  useRef,
  useState,
  type ErrorInfo,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Smartphone } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { useIOSSimulator } from '../hooks/useIOSSimulator';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import s from './IOSSimulatorPanel.module.scss';

type SimulatorSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface IOSSimulatorPanelProps {
  socket: SimulatorSocket | null;
}

interface PointerStart {
  pointerId: number;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  startedAt: number;
}

function normalizedPoint(
  element: HTMLImageElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  };
}

export function IOSSimulatorPanel({ socket }: IOSSimulatorPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const simulator = useIOSSimulator({ socket, isOpen });
  const visibleFrame =
    simulator.frame?.udid === simulator.selectedUdid ? simulator.frame : null;
  const canInteract = simulator.idbAvailable && Boolean(visibleFrame);

  const handlePointerDown = (event: PointerEvent<HTMLImageElement>): void => {
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

  const handlePointerUp = (event: PointerEvent<HTMLImageElement>): void => {
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
    <section className={`${s.panel} ${isOpen ? s.open : ''}`}>
      <header className={s.header}>
        <button
          type="button"
          className={s.headerToggle}
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
        >
          <Smartphone size={16} aria-hidden="true" />
          <span>iOS Simulator</span>
          <span className={`${s.statusDot} ${s[simulator.status]}`} />
          {isOpen ? (
            <ChevronDown size={16} aria-hidden="true" />
          ) : (
            <ChevronUp size={16} aria-hidden="true" />
          )}
        </button>
      </header>

      {isOpen && (
        <div className={s.body}>
          <div className={s.deviceRow}>
            <select
              className={s.deviceSelect}
              value={simulator.selectedUdid}
              onChange={(event) =>
                simulator.setSelectedUdid(event.target.value)
              }
              disabled={simulator.isLoadingDevices}
              aria-label="起動済みiOSシミュレータ"
            >
              {simulator.devices.length === 0 && (
                <option value="">
                  {simulator.isLoadingDevices
                    ? '検索中…'
                    : '起動済みデバイスなし'}
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
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
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
            {simulator.selectedUdid && !visibleFrame && (
              <p className={s.empty}>画面を取得しています…</p>
            )}
            {visibleFrame && (
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
      )}
    </section>
  );
}

interface IOSSimulatorPanelBoundaryProps {
  children: ReactNode;
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
      return <div className={s.fallback}>iOS Simulator panel error</div>;
    }
    return this.props.children;
  }
}
