import type { IOSSimulatorFrame } from '../services/ios-simulator-service.js';
import {
  IOSSimulatorService,
  normalizeStreamSettings,
} from '../services/ios-simulator-service.js';
import type { HandlerContext } from './types.js';

const simulatorService = new IOSSimulatorService();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '不明なエラーが発生しました';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function registerIOSSimulatorHandlers({ socket }: HandlerContext): void {
  let streamToken: symbol | null = null;
  let selectedUdid: string | null = null;
  let lastFrame: IOSSimulatorFrame | null = null;
  let lastHash: string | null = null;

  const stopStream = (): void => {
    streamToken = null;
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
    lastFrame = captured.frame;
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

  socket.on('ios-simulator-start-stream', async ({ udid, settings }) => {
    streamToken = null;
    selectedUdid = udid;
    lastFrame = null;
    lastHash = null;

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

    const normalizedSettings = normalizeStreamSettings(settings);
    const token = Symbol('ios-simulator-stream');
    streamToken = token;
    const idbAvailable = await simulatorService.isIdbAvailable();
    if (streamToken !== token) return;
    socket.emit('ios-simulator-status', {
      state: idbAvailable ? 'streaming' : 'view-only',
      udid,
      message: idbAvailable ? undefined : 'idbがないため表示のみです',
    });

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
      const intervalMs = 1_000 / normalizedSettings.fps;
      await delay(Math.max(50, intervalMs - (Date.now() - startedAt)));
    }
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

  socket.on('ios-simulator-tap', async ({ udid, x, y }) => {
    if (udid !== selectedUdid || !lastFrame || lastFrame.udid !== udid) {
      socket.emit('ios-simulator-error', {
        scope: 'interaction',
        message: '操作対象の画面を先に取得してください',
      });
      return;
    }
    try {
      await simulatorService.tap(udid, x, y, lastFrame);
    } catch (error) {
      socket.emit('ios-simulator-error', {
        scope: 'interaction',
        message: errorMessage(error),
      });
    }
  });

  socket.on(
    'ios-simulator-swipe',
    async ({ udid, startX, startY, endX, endY, durationMs }) => {
      if (udid !== selectedUdid || !lastFrame || lastFrame.udid !== udid) {
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
          lastFrame
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
    selectedUdid = null;
    lastFrame = null;
  });
}
