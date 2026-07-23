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

// quality は H.264 の compression-quality（0-1 に換算）と、JPEG フォールバック時の
// libjpeg-turbo quality の両方に使われる
const DEFAULT_SETTINGS: IOSSimulatorStreamSettings = {
  fps: 30,
  scale: 0.5,
  quality: 60,
};

const supportsVideoDecoder = typeof VideoDecoder === 'function';

// H.264 はキーフレーム間隔が長く（実測 約240フレーム）、1チャンク欠けると
// 次のキーフレームまで映像が崩れ続ける。そのため seq の欠落・デコードエラーを
// 検知したらサーバへ recover を要求し、ストリーム再起動（=即キーフレーム）で
// 復旧する。デコードエラーが続く環境では JPEG フレーム配信へフォールバックする。
const MAX_CONSECUTIVE_DECODE_ERRORS = 3;

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
  // デコードエラーが続いたら true にして JPEG 配信へフォールバックする
  const [videoDisabled, setVideoDisabled] = useState(false);
  const frameUrlRef = useRef('');
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const awaitingKeyRef = useRef(true);
  const lastSeqRef = useRef(-1);
  const consecutiveDecodeErrorsRef = useRef(0);
  const lastRecoverAtRef = useRef(0);
  // 直近の recover 以降にデコードできたフレーム数（自動回復の暴走防止に使う）
  const framesSinceRecoverRef = useRef(0);
  // 再接続時にストリームを再開始するための直近パラメータ
  const streamParamsRef = useRef<{
    udid: string;
    settings: IOSSimulatorStreamSettings;
    supportsVideo: boolean;
  } | null>(null);
  // tap/swipe の向き判定用に、最後に表示したフレームのピクセル寸法を持つ
  const frameSizeRef = useRef<{ width: number; height: number } | null>(null);

  const supportsVideo = supportsVideoDecoder && !videoDisabled;

  const closeDecoder = useCallback(() => {
    const decoder = decoderRef.current;
    decoderRef.current = null;
    awaitingKeyRef.current = true;
    lastSeqRef.current = -1;
    if (decoder && decoder.state !== 'closed') decoder.close();
  }, []);

  const resetVideo = useCallback(() => {
    closeDecoder();
    setVideoActive(false);
    setHasVideoFrame(false);
  }, [closeDecoder]);

  const requestRecover = useCallback(() => {
    if (!socket) return;
    const now = Date.now();
    if (now - lastRecoverAtRef.current < 1_000) return;
    lastRecoverAtRef.current = now;
    framesSinceRecoverRef.current = 0;
    // 回復完了（新ストリームのキーフレーム到着）までデコードを止める
    awaitingKeyRef.current = true;
    socket.emit('ios-simulator-video-recover');
  }, [socket]);

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
              consecutiveDecodeErrorsRef.current = 0;
              framesSinceRecoverRef.current += 1;
              setHasVideoFrame(true);
              setError('');
            }
            videoFrame.close();
          },
          error: (decodeError) => {
            consecutiveDecodeErrorsRef.current += 1;
            if (
              consecutiveDecodeErrorsRef.current >=
              MAX_CONSECUTIVE_DECODE_ERRORS
            ) {
              // この環境では H.264 デコードが安定しない。JPEG 配信へ切り替える
              setVideoDisabled(true);
              return;
            }
            setError(`映像のデコードに失敗しました: ${decodeError.message}`);
            requestRecover();
          },
        });
        try {
          // Annex B 形式なので description は渡さない
          decoder.configure({ codec, optimizeForLatency: true });
        } catch {
          setVideoDisabled(true);
          return;
        }
        decoderRef.current = decoder;
        awaitingKeyRef.current = true;
        lastSeqRef.current = -1;
        setVideoActive(true);
      };
    const handleVideoChunk: ServerToClientEvents['ios-simulator-video-chunk'] =
      ({ data, key, seq, timestamp }) => {
        const decoder = decoderRef.current;
        if (!decoder || decoder.state !== 'configured') return;
        const expectedSeq = lastSeqRef.current + 1;
        lastSeqRef.current = seq;
        if (seq !== expectedSeq && !key) {
          // チャンク欠落: 次のキーフレームまで崩れるため即回復要求
          requestRecover();
          return;
        }
        if (awaitingKeyRef.current && !key) return;
        awaitingKeyRef.current = false;
        try {
          decoder.decode(
            new EncodedVideoChunk({
              type: key ? 'key' : 'delta',
              timestamp,
              data: new Uint8Array(data),
            })
          );
        } catch {
          requestRecover();
        }
      };
    const handleStatus: ServerToClientEvents['ios-simulator-status'] = (
      nextStatus
    ) => {
      setStatus(nextStatus.state);
      setStatusMessage(nextStatus.message ?? '');
      // ストリームが異常終了した場合、直近の回復以降にフレームが出ていた
      // （= 環境自体は健全な）ときだけ自動で再起動を要求する
      if (
        nextStatus.state === 'error' &&
        decoderRef.current &&
        framesSinceRecoverRef.current > 0
      ) {
        requestRecover();
      }
    };
    const handleError: ServerToClientEvents['ios-simulator-error'] = (
      nextError
    ) => {
      setError(nextError.message);
      if (nextError.scope === 'list') setIsLoadingDevices(false);
    };
    const handleConnect = (): void => {
      refreshDevices();
      // 再接続時はサーバ側のストリームが破棄されているため再開始する
      const params = streamParamsRef.current;
      if (params) socket.emit('ios-simulator-start-stream', params);
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
  }, [closeDecoder, refreshDevices, requestRecover, socket]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!socket) return;
    if (!isLive || !selectedUdid) {
      streamParamsRef.current = null;
      resetVideo();
      socket.emit('ios-simulator-stop-stream');
      return;
    }
    const params = { udid: selectedUdid, settings, supportsVideo };
    streamParamsRef.current = params;
    // 未接続時は emit せず、connect ハンドラからの再開始に任せる
    // （Socket.IO の送信バッファ経由と二重に開始しないため）
    if (socket.connected) {
      socket.emit('ios-simulator-start-stream', params);
    }
    return () => {
      streamParamsRef.current = null;
      resetVideo();
      socket.emit('ios-simulator-stop-stream');
    };
  }, [isLive, resetVideo, selectedUdid, settings, socket, supportsVideo]);

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
