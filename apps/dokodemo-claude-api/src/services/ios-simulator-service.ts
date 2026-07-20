import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createReadStream, promises as fs } from 'fs';
import type { ReadStream } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

const XCRUN_PATH = '/usr/bin/xcrun';
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export interface IOSSimulatorDevice {
  udid: string;
  name: string;
  runtime: string;
  deviceTypeIdentifier: string;
}

export interface IOSSimulatorStreamSettings {
  fps: number;
  scale: number;
  quality: number;
}

export interface IOSSimulatorStreamHandlers {
  onFrame: (frame: IOSSimulatorFrame) => void;
  onError: (error: Error) => void;
  onExit: () => void;
}

export interface IOSSimulatorStreamHandle {
  stop: () => void;
}

export interface IOSSimulatorFrame {
  udid: string;
  image: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  pointWidth?: number;
  pointHeight?: number;
  capturedAt: number;
}

interface ScreenDimensions {
  widthPoints: number;
  heightPoints: number;
  widthPixels: number;
  heightPixels: number;
}

interface CommandResult {
  stdout: Buffer;
  stderr: string;
}

interface SimctlDeviceRecord {
  udid?: unknown;
  name?: unknown;
  state?: unknown;
  isAvailable?: unknown;
  deviceTypeIdentifier?: unknown;
}

interface SimctlListResponse {
  devices?: Record<string, SimctlDeviceRecord[]>;
}

interface IdbDescribeResponse {
  screen_dimensions?: {
    width?: unknown;
    height?: unknown;
    width_points?: unknown;
    height_points?: unknown;
  };
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
  // idb は最初のコマンド実行時に companion デーモンを子として起動し、
  // companion は親のプロセスグループを引き継ぐ。detached で切り離さないと
  // サーバ再起動のグループkillに companion が巻き込まれて死ぬ
  detached = false
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finishWithError = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill('SIGKILL');
      reject(error);
    };

    const timeout = setTimeout(() => {
      finishWithError(new Error(`${command} がタイムアウトしました`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        finishWithError(new Error(`${command} の出力が上限を超えました`));
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', finishWithError);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code !== 0) {
        reject(
          new Error(
            stderr || `${command} が終了コード ${String(code)} で失敗しました`
          )
        );
        return;
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
    });
  });
}

function parseJson<T>(buffer: Buffer, source: string): T {
  try {
    return JSON.parse(buffer.toString('utf8')) as T;
  } catch {
    throw new Error(`${source} の応答を読み取れませんでした`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// companion が死んでも /tmp/idb/state にエントリが残っていると idb は
// 自動復旧せずこのエラーを出し続ける（disconnect でエントリを消すと直る）
function isCompanionConnectError(message: string): boolean {
  return message.includes('Failed to connect to companion');
}

function readPngSize(png: Buffer): { width: number; height: number } {
  const pngSignature = '89504e470d0a1a0a';
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('シミュレータのスクリーンショットがPNGではありません');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function orientDimensions(
  screen: ScreenDimensions,
  pixelWidth: number,
  pixelHeight: number
): ScreenDimensions {
  const pixelsAreLandscape = pixelWidth > pixelHeight;
  const pointsAreLandscape = screen.widthPoints > screen.heightPoints;
  if (pixelsAreLandscape === pointsAreLandscape) return screen;
  return {
    widthPoints: screen.heightPoints,
    heightPoints: screen.widthPoints,
    widthPixels: screen.heightPixels,
    heightPixels: screen.widthPixels,
  };
}

export class IOSSimulatorService {
  private idbAvailablePromise: Promise<boolean> | null = null;
  private readonly screenDimensions = new Map<
    string,
    Promise<ScreenDimensions | null>
  >();

  async isIdbAvailable(): Promise<boolean> {
    if (!this.idbAvailablePromise) {
      this.idbAvailablePromise = runCommand('idb', ['--help'], 5_000)
        .then(() => true)
        .catch(() => false);
    }
    return this.idbAvailablePromise;
  }

  // companion 接続エラー時は state エントリを消して1回だけリトライする
  private async runIdb(
    args: string[],
    udid: string | null,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<CommandResult> {
    try {
      return await runCommand('idb', args, timeoutMs, true);
    } catch (error) {
      if (
        udid &&
        error instanceof Error &&
        isCompanionConnectError(error.message)
      ) {
        await this.recoverCompanion(udid);
        return runCommand('idb', args, timeoutMs, true);
      }
      throw error;
    }
  }

  private async recoverCompanion(udid: string): Promise<void> {
    try {
      await runCommand('idb', ['disconnect', udid], COMMAND_TIMEOUT_MS, true);
    } catch {
      // disconnect の失敗は無視して後続のリトライに任せる
    }
  }

  async listBootedDevices(): Promise<IOSSimulatorDevice[]> {
    const { stdout } = await runCommand(XCRUN_PATH, [
      'simctl',
      'list',
      'devices',
      'booted',
      '-j',
    ]);
    const response = parseJson<SimctlListResponse>(stdout, 'simctl');
    const devices: IOSSimulatorDevice[] = [];

    for (const [runtime, records] of Object.entries(response.devices ?? {})) {
      if (!runtime.includes('.iOS-')) continue;
      for (const record of records) {
        if (
          typeof record.udid !== 'string' ||
          typeof record.name !== 'string' ||
          typeof record.deviceTypeIdentifier !== 'string' ||
          record.state !== 'Booted' ||
          record.isAvailable === false
        ) {
          continue;
        }
        devices.push({
          udid: record.udid,
          name: record.name,
          runtime:
            runtime
              .split('.')
              .pop()
              ?.replace(/^iOS-/, 'iOS ')
              .replaceAll('-', '.') ?? runtime,
          deviceTypeIdentifier: record.deviceTypeIdentifier,
        });
      }
    }
    return devices;
  }

  async captureFrame(
    udid: string,
    settings: IOSSimulatorStreamSettings
  ): Promise<{ frame: IOSSimulatorFrame; hash: string }> {
    // Xcode 26 の simctl はヘルプに反して "-" を stdout ではなく通常の
    // ファイル名として扱うため、明示的な一時ファイルを経由する。
    const screenshotPath = path.join(
      os.tmpdir(),
      `dokodemo-simulator-${randomUUID()}.png`
    );
    let png: Buffer;
    try {
      await runCommand(XCRUN_PATH, [
        'simctl',
        'io',
        udid,
        'screenshot',
        '--type=png',
        screenshotPath,
      ]);
      png = await fs.readFile(screenshotPath);
    } finally {
      await fs.rm(screenshotPath, { force: true });
    }
    const { width, height } = readPngSize(png);
    const scale = clamp(settings.scale, 0.25, 1);
    const quality = Math.round(clamp(settings.quality, 35, 95));
    const outputWidth = Math.max(1, Math.round(width * scale));
    const image = await sharp(png)
      .resize({ width: outputWidth, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    const screen = await this.getScreenDimensions(udid);
    const orientedScreen = screen
      ? orientDimensions(screen, width, height)
      : null;

    return {
      frame: {
        udid,
        image,
        mimeType: 'image/jpeg',
        width,
        height,
        pointWidth: orientedScreen?.widthPoints,
        pointHeight: orientedScreen?.heightPoints,
        capturedAt: Date.now(),
      },
      hash: createHash('sha1').update(png).digest('hex'),
    };
  }

  // idb の H.264 は動きの大きい場面で参照フレームが数秒間崩れ、
  // mjpeg / minicap は companion(1.1.8) が出力ゼロのままストリームを閉じるため、
  // フレーム独立の BGRA ストリームを JPEG へ変換して中継する。
  // 注意: node の stdio パイプ（実体は socketpair）を stdout に渡すと idb が
  // 映像を書き出さない（ファイル/FIFO なら書く）ため、FIFO 経由で受信する。
  startStream(
    udid: string,
    settings: IOSSimulatorStreamSettings,
    handlers: IOSSimulatorStreamHandlers
  ): IOSSimulatorStreamHandle {
    const normalized = normalizeStreamSettings(settings);
    let child: ChildProcess | null = null;
    let reader: ReadStream | null = null;
    let fifoPath = '';
    let stopped = false;
    let companionRetryUsed = false;
    let pendingFrame: Buffer | null = null;
    let lastRawFrame: Buffer | null = null;
    let encoding = false;

    // FIFO の読み取り側 open がブロックしたまま残らないよう、
    // 書き込み側を一度開いてから閉じ、reader と FIFO を破棄する
    const releaseFifo = async (
      fifo: string,
      fifoReader: ReadStream | null
    ): Promise<void> => {
      try {
        const fh = await fs.open(fifo, 'a');
        await fh.close();
      } catch {
        // FIFO が既に無い場合などは無視
      }
      fifoReader?.destroy();
      await fs.rm(fifo, { force: true });
    };

    const finishWithError = (error: Error): void => {
      if (stopped) return;
      stopped = true;
      handlers.onError(error);
      handlers.onExit();
    };

    const startAttempt = async (): Promise<void> => {
      const screen = await this.getScreenDimensions(udid);
      if (!screen) {
        throw new Error('idbからシミュレータの解像度を取得できませんでした');
      }
      const width = Math.max(
        1,
        Math.floor(screen.widthPixels * normalized.scale)
      );
      const height = Math.max(
        1,
        Math.floor(screen.heightPixels * normalized.scale)
      );
      // idb の raw 行は 64 byte 境界（BGRA 16px単位）まで padding される。
      const strideWidth = Math.ceil(width / 16) * 16;
      const frameBytes = strideWidth * height * 4;
      // idb(Python)→FIFO の中継スループットが実測 約23Mピクセル/秒で頭打ちのため、
      // それを超える fps を要求しても届かない。上限内に丸めて安定させる。
      const fps = Math.max(
        1,
        Math.min(
          normalized.fps,
          Math.floor(24_000_000 / (strideWidth * height))
        )
      );

      const encodePendingFrame = async (): Promise<void> => {
        if (encoding) return;
        encoding = true;
        try {
          while (!stopped && pendingFrame) {
            const raw = pendingFrame;
            pendingFrame = null;
            // 静止画面では同一内容のフレームが送られ続けるため、
            // 変化のないフレームはスキップして通信量とCPUを抑える
            if (lastRawFrame?.equals(raw)) continue;
            lastRawFrame = raw;
            const image = await sharp(raw, {
              raw: { width: strideWidth, height, channels: 4 },
            })
              .extract({ left: 0, top: 0, width, height })
              // idb の出力は BGRA。JPEG 化前に RGB 順へ戻す。
              .recomb([
                [0, 0, 1],
                [0, 1, 0],
                [1, 0, 0],
              ])
              // mozjpeg は実測 45ms/フレームで 30fps に追いつかず遅延の主因になる。
              // libjpeg-turbo(約4.5ms) で低遅延を優先する（サイズ増は quality で調整）
              .jpeg({ quality: normalized.quality })
              .toBuffer();
            if (stopped) return;
            handlers.onFrame({
              udid,
              image,
              mimeType: 'image/jpeg',
              width,
              height,
              pointWidth: screen.widthPoints,
              pointHeight: screen.heightPoints,
              capturedAt: Date.now(),
            });
          }
        } finally {
          encoding = false;
        }
      };

      fifoPath = path.join(
        os.tmpdir(),
        `dokodemo-simulator-${randomUUID()}.fifo`
      );
      const currentFifo = fifoPath;
      await runCommand('/usr/bin/mkfifo', [currentFifo]);
      if (stopped) {
        await fs.rm(currentFifo, { force: true });
        return;
      }
      const command = [
        'exec idb video-stream',
        `--udid '${udid}'`,
        '--format rbga',
        // --fps 省略（dynamic fps）はフレームがほぼ来ないため必ず明示する
        `--fps ${String(fps)}`,
        `--scale-factor ${String(normalized.scale)}`,
        `> '${currentFifo}'`,
      ].join(' ');
      const stderrChunks: Buffer[] = [];
      child = spawn('/bin/sh', ['-c', command], {
        stdio: ['ignore', 'ignore', 'pipe'],
        // PYTHONUNBUFFERED: idb(Python) の 8KB ブロックバッファを無効化して
        // フレームを書き込み単位で即時配信させる
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        // サーバのグループkillに companion を巻き込まない
        detached: true,
      });
      const currentReader = createReadStream(currentFifo);
      reader = currentReader;
      // チャンクごとの Buffer.concat はフレームあたり百数十MBのメモリコピーに
      // なりイベントループを飽和させる（実測でフレーム配信が止まる）ため、
      // 固定長バッファへ書き足して1フレームぶん貯まったら切り出す。
      let frameFill = 0;
      const frameFillBuffer = Buffer.allocUnsafe(frameBytes);
      currentReader.on('data', (chunk) => {
        if (stopped) return;
        const nextChunk = chunk as Buffer;
        let offset = 0;
        let gotFrame = false;
        while (offset < nextChunk.length) {
          const copyBytes = Math.min(
            nextChunk.length - offset,
            frameBytes - frameFill
          );
          nextChunk.copy(
            frameFillBuffer,
            frameFill,
            offset,
            offset + copyBytes
          );
          frameFill += copyBytes;
          offset += copyBytes;
          if (frameFill === frameBytes) {
            // 変換中に次が来たら最新フレームで上書きし、遅延を防ぐ。
            pendingFrame = Buffer.from(frameFillBuffer);
            frameFill = 0;
            gotFrame = true;
          }
        }
        if (!gotFrame) return;
        void encodePendingFrame().catch((error: unknown) => {
          finishWithError(
            error instanceof Error
              ? error
              : new Error('映像フレームのJPEG変換に失敗しました')
          );
        });
      });
      currentReader.on('error', (error) => {
        finishWithError(error);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        // エラーメッセージ用に末尾だけ保持する
        stderrChunks.push(chunk);
        while (stderrChunks.length > 20) stderrChunks.shift();
      });
      child.on('error', finishWithError);
      child.on('close', (code) => {
        if (stopped) return;
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        // companion が死んで state が残っている場合は復旧して1回だけやり直す
        if (!companionRetryUsed && isCompanionConnectError(stderr)) {
          companionRetryUsed = true;
          pendingFrame = null;
          lastRawFrame = null;
          void releaseFifo(currentFifo, currentReader);
          void this.recoverCompanion(udid)
            .then(() => startAttempt())
            .catch((error: unknown) => {
              finishWithError(
                error instanceof Error
                  ? error
                  : new Error('idb video-stream の再起動に失敗しました')
              );
            });
          return;
        }
        stopped = true;
        if (code !== 0) {
          handlers.onError(
            new Error(
              stderr ||
                `idb video-stream が終了コード ${String(code)} で失敗しました`
            )
          );
        }
        handlers.onExit();
        void releaseFifo(currentFifo, currentReader);
      });
    };

    void startAttempt().catch((error: unknown) => {
      finishWithError(
        error instanceof Error
          ? error
          : new Error('idb video-stream の起動に失敗しました')
      );
    });

    return {
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        child?.kill('SIGKILL');
        if (fifoPath) void releaseFifo(fifoPath, reader);
      },
    };
  }

  async tap(
    udid: string,
    normalizedX: number,
    normalizedY: number,
    frameWidth: number,
    frameHeight: number
  ): Promise<void> {
    const point = await this.toDevicePoint(
      udid,
      normalizedX,
      normalizedY,
      frameWidth,
      frameHeight
    );
    await this.runIdb(
      ['ui', 'tap', String(point.x), String(point.y), '--udid', udid],
      udid
    );
  }

  async swipe(
    udid: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number,
    frameWidth: number,
    frameHeight: number
  ): Promise<void> {
    const start = await this.toDevicePoint(
      udid,
      startX,
      startY,
      frameWidth,
      frameHeight
    );
    const end = await this.toDevicePoint(
      udid,
      endX,
      endY,
      frameWidth,
      frameHeight
    );
    const durationSeconds = clamp(durationMs, 100, 3_000) / 1_000;
    await this.runIdb(
      [
        'ui',
        'swipe',
        String(start.x),
        String(start.y),
        String(end.x),
        String(end.y),
        '--duration',
        String(durationSeconds),
        '--udid',
        udid,
      ],
      udid
    );
  }

  private getScreenDimensions(udid: string): Promise<ScreenDimensions | null> {
    let promise = this.screenDimensions.get(udid);
    if (!promise) {
      promise = this.loadScreenDimensions(udid).then((screen) => {
        // 失敗(null)はキャッシュしない（companion 復旧後に再取得できるように）
        if (!screen) this.screenDimensions.delete(udid);
        return screen;
      });
      this.screenDimensions.set(udid, promise);
    }
    return promise;
  }

  private async loadScreenDimensions(
    udid: string
  ): Promise<ScreenDimensions | null> {
    if (!(await this.isIdbAvailable())) return null;
    try {
      const { stdout } = await this.runIdb(
        ['describe', '--udid', udid, '--json'],
        udid
      );
      const response = parseJson<IdbDescribeResponse>(stdout, 'idb');
      const widthPixels = response.screen_dimensions?.width;
      const heightPixels = response.screen_dimensions?.height;
      const widthPoints = response.screen_dimensions?.width_points;
      const heightPoints = response.screen_dimensions?.height_points;
      if (
        typeof widthPixels !== 'number' ||
        typeof heightPixels !== 'number' ||
        typeof widthPoints !== 'number' ||
        typeof heightPoints !== 'number'
      ) {
        return null;
      }
      return { widthPixels, heightPixels, widthPoints, heightPoints };
    } catch {
      return null;
    }
  }

  private async toDevicePoint(
    udid: string,
    normalizedX: number,
    normalizedY: number,
    frameWidth: number,
    frameHeight: number
  ): Promise<{ x: number; y: number }> {
    const screen = await this.getScreenDimensions(udid);
    if (!screen) {
      throw new Error('idbからデバイスの論理解像度を取得できませんでした');
    }
    const oriented = orientDimensions(screen, frameWidth, frameHeight);
    return {
      x: Math.round(clamp(normalizedX, 0, 1) * oriented.widthPoints),
      y: Math.round(clamp(normalizedY, 0, 1) * oriented.heightPoints),
    };
  }
}

export function normalizeStreamSettings(
  settings: IOSSimulatorStreamSettings
): IOSSimulatorStreamSettings {
  return {
    fps: Math.round(clamp(settings.fps, 1, 30)),
    scale: clamp(settings.scale, 0.25, 1),
    quality: Math.round(clamp(settings.quality, 35, 95)),
  };
}
