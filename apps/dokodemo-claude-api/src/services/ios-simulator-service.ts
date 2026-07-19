import { createHash, randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
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
  // 0 は auto（idb の dynamic fps = 画面変化時のみフレーム送信）
  fps: number;
  scale: number;
  quality: number;
}

export interface IOSSimulatorVideoAccessUnit {
  data: Buffer;
  key: boolean;
}

export interface IOSSimulatorVideoStreamHandlers {
  onConfig: (codec: string) => void;
  onAccessUnit: (accessUnit: IOSSimulatorVideoAccessUnit) => void;
  onError: (error: Error) => void;
  onExit: () => void;
}

export interface IOSSimulatorVideoStreamHandle {
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
    width_points?: unknown;
    height_points?: unknown;
  };
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
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
  };
}

const START_CODE = Buffer.from([0, 0, 0, 1]);
// stdout の書き込みが途切れてからこの時間経てば、バッファ末尾を完全な NAL とみなす
// （Annex B は次の start code が来ないと NAL 終端を確定できないため、
//  dynamic fps で次フレームが来ない間、最後のフレームが未配信のまま残るのを防ぐ）
const TAIL_FLUSH_DELAY_MS = 40;

type NalUnit = Buffer;

function nalType(nal: NalUnit): number {
  return nal[0] & 0x1f;
}

// idb video-stream の H.264 Annex B ストリームを逐次パースし、
// アクセスユニット（=1フレーム）単位で組み立てる
export class AnnexBStreamParser {
  private buffer: Buffer = Buffer.alloc(0);
  private pendingNals: NalUnit[] = [];
  private sps: NalUnit | null = null;
  private pps: NalUnit | null = null;
  private emittedCodec: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onConfig: (codec: string) => void,
    private readonly onAccessUnit: (
      accessUnit: IOSSimulatorVideoAccessUnit
    ) => void
  ) {}

  push(chunk: Buffer): void {
    this.clearFlushTimer();
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : chunk;

    // 00 00 01（00 00 00 01 の末尾3バイトを含む）の位置を列挙する
    const starts: number[] = [];
    let index = 0;
    while (true) {
      const found = this.buffer.indexOf(START_CODE.subarray(1), index);
      if (found === -1) break;
      starts.push(found);
      index = found + 3;
    }

    // 隣り合う start code の間を完全な NAL として処理し、
    // 最後の start code 以降（終端未確定）はバッファに残す
    for (let i = 0; i + 1 < starts.length; i++) {
      let end = starts[i + 1];
      if (this.buffer[end - 1] === 0) end -= 1; // 4バイト start code の先頭 0
      this.processNal(this.buffer.subarray(starts[i] + 3, end));
    }
    if (starts.length > 0) {
      this.buffer = this.buffer.subarray(starts[starts.length - 1]);
      this.flushTimer = setTimeout(() => {
        this.flushTail();
      }, TAIL_FLUSH_DELAY_MS);
    }
  }

  dispose(): void {
    this.clearFlushTimer();
    this.buffer = Buffer.alloc(0);
    this.pendingNals = [];
  }

  private flushTail(): void {
    // バッファは start code から始まっている。中身があれば完全な NAL とみなす
    if (this.buffer.length > 4) {
      this.processNal(this.buffer.subarray(3));
      this.buffer = Buffer.alloc(0);
    }
  }

  private processNal(nal: NalUnit): void {
    if (nal.length === 0) return;
    const type = nalType(nal);
    if (type === 7) {
      this.sps = nal;
      const codec = `avc1.${Buffer.from(nal.subarray(1, 4)).toString('hex')}`;
      if (codec !== this.emittedCodec) {
        this.emittedCodec = codec;
        this.onConfig(codec);
      }
      return;
    }
    if (type === 8) {
      this.pps = nal;
      return;
    }
    if (type === 1 || type === 5) {
      // VCL NAL でアクセスユニットが完結する（idb は 1フレーム=1スライス）
      const key = type === 5;
      const nals =
        key && this.sps && this.pps
          ? [this.sps, this.pps, ...this.pendingNals, nal]
          : [...this.pendingNals, nal];
      this.pendingNals = [];
      const parts: Buffer[] = [];
      for (const unit of nals) {
        parts.push(START_CODE, unit);
      }
      this.onAccessUnit({ data: Buffer.concat(parts), key });
      return;
    }
    // SEI / AUD などは次の VCL NAL と同じアクセスユニットに含める
    this.pendingNals.push(nal);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
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

  // idb video-stream を起動し、H.264 アクセスユニット単位でコールバックする
  startVideoStream(
    udid: string,
    settings: IOSSimulatorStreamSettings,
    handlers: IOSSimulatorVideoStreamHandlers
  ): IOSSimulatorVideoStreamHandle {
    const normalized = normalizeStreamSettings(settings);
    const args = [
      'video-stream',
      '--udid',
      udid,
      '--format',
      'h264',
      '--compression-quality',
      String(normalized.quality / 100),
      '--scale-factor',
      String(normalized.scale),
    ];
    if (normalized.fps > 0) {
      args.push('--fps', String(normalized.fps));
    }

    const child = spawn('idb', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const parser = new AnnexBStreamParser(
      handlers.onConfig,
      handlers.onAccessUnit
    );
    const stderrChunks: Buffer[] = [];
    let stopped = false;

    child.stdout.on('data', (chunk: Buffer) => {
      if (!stopped) parser.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // メッセージ用に末尾だけ保持する
      stderrChunks.push(chunk);
      while (stderrChunks.length > 20) stderrChunks.shift();
    });
    child.on('error', (error) => {
      if (stopped) return;
      stopped = true;
      parser.dispose();
      handlers.onError(error);
    });
    child.on('close', (code) => {
      if (stopped) return;
      stopped = true;
      parser.dispose();
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        handlers.onError(
          new Error(stderr || `idb video-stream が終了コード ${String(code)} で失敗しました`)
        );
      }
      handlers.onExit();
    });

    return {
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        parser.dispose();
        child.kill('SIGKILL');
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
    await runCommand('idb', [
      'ui',
      'tap',
      String(point.x),
      String(point.y),
      '--udid',
      udid,
    ]);
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
    await runCommand('idb', [
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
    ]);
  }

  private getScreenDimensions(udid: string): Promise<ScreenDimensions | null> {
    let promise = this.screenDimensions.get(udid);
    if (!promise) {
      promise = this.loadScreenDimensions(udid);
      this.screenDimensions.set(udid, promise);
    }
    return promise;
  }

  private async loadScreenDimensions(
    udid: string
  ): Promise<ScreenDimensions | null> {
    if (!(await this.isIdbAvailable())) return null;
    try {
      const { stdout } = await runCommand('idb', [
        'describe',
        '--udid',
        udid,
        '--json',
      ]);
      const response = parseJson<IdbDescribeResponse>(stdout, 'idb');
      const widthPoints = response.screen_dimensions?.width_points;
      const heightPoints = response.screen_dimensions?.height_points;
      if (typeof widthPoints !== 'number' || typeof heightPoints !== 'number') {
        return null;
      }
      return { widthPoints, heightPoints };
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
    fps: Math.round(clamp(settings.fps, 0, 30)),
    scale: clamp(settings.scale, 0.25, 1),
    quality: Math.round(clamp(settings.quality, 35, 95)),
  };
}
