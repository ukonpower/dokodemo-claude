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
  fps: number;
  scale: number;
  quality: number;
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

  async tap(
    udid: string,
    normalizedX: number,
    normalizedY: number,
    frame: IOSSimulatorFrame
  ): Promise<void> {
    const point = this.toDevicePoint(normalizedX, normalizedY, frame);
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
    frame: IOSSimulatorFrame
  ): Promise<void> {
    const start = this.toDevicePoint(startX, startY, frame);
    const end = this.toDevicePoint(endX, endY, frame);
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

  private toDevicePoint(
    normalizedX: number,
    normalizedY: number,
    frame: IOSSimulatorFrame
  ): { x: number; y: number } {
    if (!frame.pointWidth || !frame.pointHeight) {
      throw new Error('idbからデバイスの論理解像度を取得できませんでした');
    }
    return {
      x: Math.round(clamp(normalizedX, 0, 1) * frame.pointWidth),
      y: Math.round(clamp(normalizedY, 0, 1) * frame.pointHeight),
    };
  }
}

export function normalizeStreamSettings(
  settings: IOSSimulatorStreamSettings
): IOSSimulatorStreamSettings {
  return {
    fps: Math.round(clamp(settings.fps, 1, 5)),
    scale: clamp(settings.scale, 0.25, 1),
    quality: Math.round(clamp(settings.quality, 35, 95)),
  };
}
