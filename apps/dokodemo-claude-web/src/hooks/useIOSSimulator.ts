import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  IOSSimulatorDevice,
  IOSSimulatorFrame,
  IOSSimulatorStreamSettings,
  ServerToClientEvents,
} from '../types';

type SimulatorSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SimulatorStatus = 'idle' | 'streaming' | 'view-only' | 'error';

interface UseIOSSimulatorOptions {
  socket: SimulatorSocket | null;
}

export interface UseIOSSimulatorReturn {
  devices: IOSSimulatorDevice[];
  selectedUdid: string;
  setSelectedUdid: (udid: string) => void;
  settings: IOSSimulatorStreamSettings;
  setSettings: (settings: IOSSimulatorStreamSettings) => void;
  isLive: boolean;
  setIsLive: (isLive: boolean) => void;
  isLoadingDevices: boolean;
  idbAvailable: boolean;
  status: SimulatorStatus;
  statusMessage: string;
  error: string;
  frame: IOSSimulatorFrame | null;
  frameUrl: string;
  // H.264 ストリーム表示用。videoActive の間は canvas に直接描画される
  videoCanvasRef: RefObject<HTMLCanvasElement | null>;
  videoActive: boolean;
  hasVideoFrame: boolean;
  refreshDevices: () => void;
  refreshFrame: () => void;
  tap: (x: number, y: number) => void;
  swipe: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number
  ) => void;
}

const DEFAULT_SETTINGS: IOSSimulatorStreamSettings = {
  fps: 30,
  scale: 0.5,
  quality: 70,
};

const supportsVideo = typeof VideoDecoder === 'function';

// マウント中 = パネル表示中として扱う（表示側がマウントを制御する）
export function useIOSSimulator({
  socket,
}: UseIOSSimulatorOptions): UseIOSSimulatorReturn {
  const [devices, setDevices] = useState<IOSSimulatorDevice[]>([]);
  const [selectedUdid, setSelectedUdid] = useState('');
  const [settings, setSettings] =
    useState<IOSSimulatorStreamSettings>(DEFAULT_SETTINGS);
  const [isLive, setIsLive] = useState(true);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [idbAvailable, setIdbAvailable] = useState(false);
  const [status, setStatus] = useState<SimulatorStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<IOSSimulatorFrame | null>(null);
  const [frameUrl, setFrameUrl] = useState('');
  const [videoActive, setVideoActive] = useState(false);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);
  const frameUrlRef = useRef('');
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const awaitingKeyRef = useRef(true);
  // tap/swipe の向き判定用に、最後に表示したフレームのピクセル寸法を持つ
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);

  const closeDecoder = useCallback(() => {
    const decoder = decoderRef.current;
    decoderRef.current = null;
    awaitingKeyRef.current = true;
    if (decoder && decoder.state !== 'closed') decoder.close();
  }, []);

  const resetVideo = useCallback(() => {
    closeDecoder();
    setVideoActive(false);
    setHasVideoFrame(false);
  }, [closeDecoder]);

  const refreshDevices = useCallback(() => {
    if (!socket) return;
    setIsLoadingDevices(true);
    setError('');
    socket.emit('ios-simulator-list-devices');
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleDevices: ServerToClientEvents['ios-simulator-devices'] = (
      data
    ) => {
      setDevices(data.devices);
      setIdbAvailable(data.idbAvailable);
      setIsLoadingDevices(false);
      setSelectedUdid((currentUdid) => {
        if (data.devices.some((device) => device.udid === currentUdid)) {
          return currentUdid;
        }
        return data.devices[0]?.udid ?? '';
      });
    };
    const handleFrame: ServerToClientEvents['ios-simulator-frame'] = (
      nextFrame
    ) => {
      const nextUrl = URL.createObjectURL(
        new Blob([nextFrame.image], { type: nextFrame.mimeType })
      );
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = nextUrl;
      frameSizeRef.current = {
        width: nextFrame.width,
        height: nextFrame.height,
      };
      setFrame(nextFrame);
      setFrameUrl(nextUrl);
      setError('');
    };
    const handleVideoConfig: ServerToClientEvents['ios-simulator-video-config'] =
      ({ codec }) => {
        closeDecoder();
        const decoder = new VideoDecoder({
          output: (videoFrame) => {
            const canvas = videoCanvasRef.current;
            if (canvas) {
              const { displayWidth, displayHeight } = videoFrame;
              if (canvas.width !== displayWidth) canvas.width = displayWidth;
              if (canvas.height !== displayHeight) {
                canvas.height = displayHeight;
              }
              canvas
                .getContext('2d')
                ?.drawImage(videoFrame, 0, 0, displayWidth, displayHeight);
              frameSizeRef.current = {
                width: displayWidth,
                height: displayHeight,
              };
              setHasVideoFrame(true);
              setError('');
            }
            videoFrame.close();
          },
          error: (decodeError) => {
            setError(`映像のデコードに失敗しました: ${decodeError.message}`);
          },
        });
        // Annex B 形式なので description は渡さない
        decoder.configure({ codec, optimizeForLatency: true });
        decoderRef.current = decoder;
        awaitingKeyRef.current = true;
        setVideoActive(true);
      };
    const handleVideoChunk: ServerToClientEvents['ios-simulator-video-chunk'] =
      ({ data, key, timestamp }) => {
        const decoder = decoderRef.current;
        if (!decoder || decoder.state !== 'configured') return;
        if (awaitingKeyRef.current && !key) return;
        awaitingKeyRef.current = false;
        decoder.decode(
          new EncodedVideoChunk({
            type: key ? 'key' : 'delta',
            timestamp,
            data: new Uint8Array(data),
          })
        );
      };
    const handleStatus: ServerToClientEvents['ios-simulator-status'] = (
      nextStatus
    ) => {
      setStatus(nextStatus.state);
      setStatusMessage(nextStatus.message ?? '');
    };
    const handleError: ServerToClientEvents['ios-simulator-error'] = (
      nextError
    ) => {
      setError(nextError.message);
      if (nextError.scope === 'list') setIsLoadingDevices(false);
    };
    const handleConnect = (): void => {
      refreshDevices();
    };

    socket.on('ios-simulator-devices', handleDevices);
    socket.on('ios-simulator-frame', handleFrame);
    socket.on('ios-simulator-video-config', handleVideoConfig);
    socket.on('ios-simulator-video-chunk', handleVideoChunk);
    socket.on('ios-simulator-status', handleStatus);
    socket.on('ios-simulator-error', handleError);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('ios-simulator-devices', handleDevices);
      socket.off('ios-simulator-frame', handleFrame);
      socket.off('ios-simulator-video-config', handleVideoConfig);
      socket.off('ios-simulator-video-chunk', handleVideoChunk);
      socket.off('ios-simulator-status', handleStatus);
      socket.off('ios-simulator-error', handleError);
      socket.off('connect', handleConnect);
    };
  }, [closeDecoder, refreshDevices, socket]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!socket) return;
    if (!isLive || !selectedUdid) {
      resetVideo();
      socket.emit('ios-simulator-stop-stream');
      return;
    }
    socket.emit('ios-simulator-start-stream', {
      udid: selectedUdid,
      settings,
      supportsVideo,
    });
    return () => {
      resetVideo();
      socket.emit('ios-simulator-stop-stream');
    };
  }, [isLive, resetVideo, selectedUdid, settings, socket]);

  useEffect(() => {
    return () => {
      if (frameUrlRef.current) URL.revokeObjectURL(frameUrlRef.current);
    };
  }, []);

  const refreshFrame = useCallback(() => {
    if (!socket || !selectedUdid) return;
    setError('');
    socket.emit('ios-simulator-refresh', { udid: selectedUdid, settings });
  }, [selectedUdid, settings, socket]);

  const tap = useCallback(
    (x: number, y: number) => {
      const frameSize = frameSizeRef.current;
      if (!socket || !selectedUdid || !idbAvailable || !frameSize) return;
      socket.emit('ios-simulator-tap', {
        udid: selectedUdid,
        x,
        y,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
      });
    },
    [idbAvailable, selectedUdid, socket]
  );

  const swipe = useCallback(
    (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      durationMs: number
    ) => {
      const frameSize = frameSizeRef.current;
      if (!socket || !selectedUdid || !idbAvailable || !frameSize) return;
      socket.emit('ios-simulator-swipe', {
        udid: selectedUdid,
        startX,
        startY,
        endX,
        endY,
        durationMs,
        frameWidth: frameSize.width,
        frameHeight: frameSize.height,
      });
    },
    [idbAvailable, selectedUdid, socket]
  );

  return {
    devices,
    selectedUdid,
    setSelectedUdid,
    settings,
    setSettings,
    isLive,
    setIsLive,
    isLoadingDevices,
    idbAvailable,
    status,
    statusMessage,
    error,
    frame,
    frameUrl,
    videoCanvasRef,
    videoActive,
    hasVideoFrame,
    refreshDevices,
    refreshFrame,
    tap,
    swipe,
  };
}
