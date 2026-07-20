import type {
  IOSSimulatorStreamHandle,
  IOSSimulatorStreamSettings,
  IOSSimulatorVideoStreamHandle,
} from '../services/ios-simulator-service.js';
import {
  IOSSimulatorService,
  normalizeStreamSettings,
} from '../services/ios-simulator-service.js';
import type { HandlerContext } from './types.js';

const simulatorService = new IOSSimulatorService();

// スクショポーリング（フォールバック）時の fps 上限
const SCREENSHOT_MAX_FPS = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '不明なエラーが発生しました';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface StartStreamParams {
  udid: string;
  settings: IOSSimulatorStreamSettings;
  supportsVideo: boolean;
}

export function registerIOSSimulatorHandlers({ socket }: HandlerContext): void {
  let streamToken: symbol | null = null;
  let activeStream: IOSSimulatorStreamHandle | null = null;
  let activeVideoStream: IOSSimulatorVideoStreamHandle | null = null;
  let selectedUdid: string | null = null;
  let lastHash: string | null = null;
  let lastTimestamp = 0;
  // 回復要求（ストリーム再起動）用に直近の開始パラメータを保持する
  let lastStartParams: StartStreamParams | null = null;
  let lastVideoRestartAt = 0;
  // startStreaming は await を挟むため、連続呼び出しで古い呼び出しが
  // 後から走って二重ストリームにならないよう世代番号で無効化する
  let startGeneration = 0;

  const stopActiveStream = (): void => {
    activeStream?.stop();
    activeStream = null;
    activeVideoStream?.stop();
    activeVideoStream = null;
  };

  const stopStream = (): void => {
    streamToken = null;
    lastStartParams = null;
    stopActiveStream();
    socket.emit('ios-simulator-status', {
      state: 'idle',
      udid: selectedUdid ?? undefined,
    });
  };

  const ensureBooted = async (udid: string): Promise<void> => {
    const devices = await simulatorService.listBootedDevices();
    if (!devices.some((device) => device.udid === udid)) {
      throw new Error('選択したiOSシミュレータは起動していません');
    }
  };

  const captureAndEmit = async (
    udid: string,
    settings: Parameters<typeof normalizeStreamSettings>[0],
    skipUnchanged: boolean,
    expectedToken?: symbol
  ): Promise<void> => {
    const captured = await simulatorService.captureFrame(
      udid,
      normalizeStreamSettings(settings)
    );
    if (expectedToken && streamToken !== expectedToken) return;
    if (skipUnchanged && captured.hash === lastHash) return;
    lastHash = captured.hash;
    socket.emit('ios-simulator-frame', captured.frame);
  };

  socket.on('ios-simulator-list-devices', async () => {
    try {
      const [devices, idbAvailable] = await Promise.all([
        simulatorService.listBootedDevices(),
        simulatorService.isIdbAvailable(),
      ]);
      socket.emit('ios-simulator-devices', { devices, idbAvailable });
    } catch (error) {
      socket.emit('ios-simulator-error', {
        scope: 'list',
        message: errorMessage(error),
      });
    }
  });

  const startStreaming = async ({
    udid,
    settings,
    supportsVideo,
  }: StartStreamParams): Promise<void> => {
      const generation = ++startGeneration;
      streamToken = null;
      stopActiveStream();
      selectedUdid = udid;
      lastHash = null;
      lastStartParams = { udid, settings, supportsVideo };

      try {
        await ensureBooted(udid);
      } catch (error) {
        socket.emit('ios-simulator-status', {
          state: 'error',
          udid,
          message: errorMessage(error),
        });
        return;
      }
      if (generation !== startGeneration) return;

      const normalizedSettings = normalizeStreamSettings(settings);
      const token = Symbol('ios-simulator-stream');
      streamToken = token;
      const [idbAvailable, ffmpegAvailable] = await Promise.all([
        simulatorService.isIdbAvailable(),
        simulatorService.isFfmpegAvailable(),
      ]);
      if (generation !== startGeneration) return;
      if (streamToken !== token) return;

      if (idbAvailable && ffmpegAvailable && supportsVideo) {
        // H.264 ストリーム: idb の BGRA を ffmpeg(libx264) でエンコードして中継する
        socket.emit('ios-simulator-status', { state: 'streaming', udid });
        let seq = 0;
        activeVideoStream = simulatorService.startVideoStream(
          udid,
          normalizedSettings,
          {
            onConfig: (codec) => {
              if (streamToken !== token) return;
              socket.emit('ios-simulator-video-config', { udid, codec });
            },
            onAccessUnit: ({ data, key }) => {
              if (streamToken !== token) return;
              // 切断中は Socket.IO バッファに溜めない
              // （再接続時はクライアントが start-stream を再送して復旧する）
              if (!socket.connected) return;
              // VideoDecoder 用に単調増加のタイムスタンプ（µs）を振る
              lastTimestamp = Math.max(Date.now() * 1000, lastTimestamp + 1);
              // H.264 は1チャンク欠けると次のキーフレームまで崩れるため、
              // volatile にせず信頼配送で送る（欠落は seq でクライアントが検知）
              socket.emit('ios-simulator-video-chunk', {
                udid,
                data,
                key,
                seq: seq++,
                timestamp: lastTimestamp,
              });
            },
            onError: (error) => {
              if (streamToken !== token) return;
              socket.emit('ios-simulator-error', {
                scope: 'stream',
                message: errorMessage(error),
              });
            },
            onExit: () => {
              if (streamToken !== token) return;
              streamToken = null;
              activeVideoStream = null;
              socket.emit('ios-simulator-status', {
                state: 'error',
                udid,
                message: '映像ストリームが終了しました',
              });
            },
          }
        );
        return;
      }

      if (idbAvailable) {
        // idb の BGRA ストリームを独立 JPEG フレームとして中継する
        socket.emit('ios-simulator-status', { state: 'streaming', udid });
        activeStream = simulatorService.startStream(
          udid,
          normalizedSettings,
          {
            onFrame: (frame) => {
              if (streamToken !== token) return;
              // 回線が細いときは古いフレームを捨てて遅延を溜めない
              socket.volatile.emit('ios-simulator-frame', frame);
            },
            onError: (error) => {
              if (streamToken !== token) return;
              socket.emit('ios-simulator-error', {
                scope: 'stream',
                message: errorMessage(error),
              });
            },
            onExit: () => {
              if (streamToken !== token) return;
              streamToken = null;
              activeStream = null;
              socket.emit('ios-simulator-status', {
                state: 'error',
                udid,
                message: '映像ストリームが終了しました',
              });
            },
          }
        );
        return;
      }

      // フォールバック: simctl スクショのポーリング
      socket.emit('ios-simulator-status', {
        state: idbAvailable ? 'streaming' : 'view-only',
        udid,
        message: idbAvailable ? undefined : 'idbがないため表示のみです',
      });

      const fps = Math.min(normalizedSettings.fps, SCREENSHOT_MAX_FPS);
      while (streamToken === token) {
        const startedAt = Date.now();
        try {
          await captureAndEmit(udid, normalizedSettings, true, token);
        } catch (error) {
          if (streamToken === token) {
            socket.emit('ios-simulator-error', {
              scope: 'stream',
              message: errorMessage(error),
            });
          }
        }
        const intervalMs = 1_000 / fps;
        await delay(Math.max(50, intervalMs - (Date.now() - startedAt)));
      }
  };

  socket.on('ios-simulator-start-stream', (params) => {
    void startStreaming(params);
  });

  socket.on('ios-simulator-video-recover', () => {
    // 欠落検知・デコードエラーからの回復要求。ストリームを再起動して
    // 新しい SPS+PPS+キーフレームを配信する（連続要求はデバウンス）
    const params = lastStartParams;
    if (!params?.supportsVideo) return;
    const now = Date.now();
    if (now - lastVideoRestartAt < 1_500) return;
    lastVideoRestartAt = now;
    void startStreaming(params);
  });

  socket.on('ios-simulator-stop-stream', stopStream);

  socket.on('ios-simulator-refresh', async ({ udid, settings }) => {
    selectedUdid = udid;
    try {
      await ensureBooted(udid);
      await captureAndEmit(udid, settings, false);
    } catch (error) {
      socket.emit('ios-simulator-error', {
        scope: 'stream',
        message: errorMessage(error),
      });
    }
  });

  socket.on(
    'ios-simulator-tap',
    async ({ udid, x, y, frameWidth, frameHeight }) => {
      if (udid !== selectedUdid || frameWidth <= 0 || frameHeight <= 0) {
        socket.emit('ios-simulator-error', {
          scope: 'interaction',
          message: '操作対象の画面を先に取得してください',
        });
        return;
      }
      try {
        await simulatorService.tap(udid, x, y, frameWidth, frameHeight);
      } catch (error) {
        socket.emit('ios-simulator-error', {
          scope: 'interaction',
          message: errorMessage(error),
        });
      }
    }
  );

  socket.on(
    'ios-simulator-swipe',
    async ({
      udid,
      startX,
      startY,
      endX,
      endY,
      durationMs,
      frameWidth,
      frameHeight,
    }) => {
      if (udid !== selectedUdid || frameWidth <= 0 || frameHeight <= 0) {
        socket.emit('ios-simulator-error', {
          scope: 'interaction',
          message: '操作対象の画面を先に取得してください',
        });
        return;
      }
      try {
        await simulatorService.swipe(
          udid,
          startX,
          startY,
          endX,
          endY,
          durationMs,
          frameWidth,
          frameHeight
        );
      } catch (error) {
        socket.emit('ios-simulator-error', {
          scope: 'interaction',
          message: errorMessage(error),
        });
      }
    }
  );

  socket.on('disconnect', () => {
    streamToken = null;
    lastStartParams = null;
    stopActiveStream();
    selectedUdid = null;
  });
}
