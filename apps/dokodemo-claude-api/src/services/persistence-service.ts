/**
 * 永続化サービス
 * JSONファイルへの読み書きを共通化
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Result, Ok, Err } from '../utils/result.js';
import { PersistenceError } from '../utils/errors.js';

export class PersistenceService {
  // ファイル単位の書き込みチェーン。同一ファイルへの save が並行したとき、
  // 直前の save 完了を待ってから次が走るようにして lost update を防ぐ。
  private readonly writeChains = new Map<string, Promise<unknown>>();
  // tmp ファイル名のサフィックスを衝突なく一意化するためのカウンタ
  private tmpCounter = 0;

  constructor(private readonly processesDir: string) {}

  /**
   * ファイルパスを取得
   */
  private getFilePath(filename: string): string {
    return path.join(this.processesDir, filename);
  }

  /**
   * 同一ファイルへの操作を順次直列化する
   */
  private serializeWrite<T>(
    filePath: string,
    op: () => Promise<T>
  ): Promise<T> {
    const prev = this.writeChains.get(filePath) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.writeChains.set(filePath, next);
    const cleanup = (): void => {
      if (this.writeChains.get(filePath) === next) {
        this.writeChains.delete(filePath);
      }
    };
    next.then(cleanup, cleanup);
    return next;
  }

  /**
   * processesディレクトリが存在することを確認
   */
  async ensureDir(): Promise<Result<void, PersistenceError>> {
    try {
      await fs.mkdir(this.processesDir, { recursive: true });
      return Ok(undefined);
    } catch (e) {
      return Err(PersistenceError.writeFailed(this.processesDir, e));
    }
  }

  /**
   * JSONファイルを読み込む
   * ファイルが存在しない場合はnullを返す
   */
  async load<T>(filename: string): Promise<Result<T | null, PersistenceError>> {
    const filePath = this.getFilePath(filename);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      if (data.trim() === '') {
        return Ok(null);
      }
      const parsed = JSON.parse(data) as T;
      return Ok(parsed);
    } catch (e) {
      // ファイルが存在しない場合はnullを返す（エラーではない）
      if (this.isFileNotFoundError(e)) {
        return Ok(null);
      }

      // JSONパースエラー
      if (e instanceof SyntaxError) {
        console.error(`[PersistenceService] JSONパースエラー: ${filePath}`, e);
        return Err(PersistenceError.parseFailed(filePath, e));
      }

      // その他の読み込みエラー
      console.error(`[PersistenceService] 読み込みエラー: ${filePath}`, e);
      return Err(PersistenceError.readFailed(filePath, e));
    }
  }

  /**
   * JSONファイルに保存する
   *
   * 書き込みは tmp ファイル経由の rename で原子的に行い、同一ファイルへの
   * 並行 save は serializeWrite でチェーン化して lost update を防ぐ。
   */
  async save<T>(
    filename: string,
    data: T
  ): Promise<Result<void, PersistenceError>> {
    const filePath = this.getFilePath(filename);

    return this.serializeWrite(filePath, async () => {
      const tmpPath = `${filePath}.tmp.${process.pid}.${++this
        .tmpCounter}`;
      try {
        await fs.mkdir(this.processesDir, { recursive: true });

        const json = JSON.stringify(data, null, 2);
        await fs.writeFile(tmpPath, json, 'utf-8');
        await fs.rename(tmpPath, filePath);

        return Ok(undefined);
      } catch (e) {
        await fs.unlink(tmpPath).catch(() => {});
        console.error(`[PersistenceService] 書き込みエラー: ${filePath}`, e);
        return Err(PersistenceError.writeFailed(filePath, e));
      }
    });
  }

  /**
   * ファイルを削除する
   */
  async remove(filename: string): Promise<Result<void, PersistenceError>> {
    const filePath = this.getFilePath(filename);

    try {
      await fs.unlink(filePath);
      return Ok(undefined);
    } catch (e) {
      // ファイルが存在しない場合は成功とみなす
      if (this.isFileNotFoundError(e)) {
        return Ok(undefined);
      }

      console.error(`[PersistenceService] 削除エラー: ${filePath}`, e);
      return Err(PersistenceError.deleteFailed(filePath, e));
    }
  }

  /**
   * ファイルが存在するか確認
   */
  async exists(filename: string): Promise<boolean> {
    const filePath = this.getFilePath(filename);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Map形式のデータを保存
   */
  async saveMap<K extends string, V>(
    filename: string,
    map: Map<K, V>,
    valueTransformer?: (value: V) => unknown
  ): Promise<Result<void, PersistenceError>> {
    const entries: Array<[K, unknown]> = [];

    for (const [key, value] of map.entries()) {
      const transformedValue = valueTransformer
        ? valueTransformer(value)
        : value;
      entries.push([key, transformedValue]);
    }

    return this.save(filename, entries);
  }

  /**
   * Map形式のデータを読み込む
   */
  async loadMap<K extends string, V>(
    filename: string,
    valueTransformer?: (value: unknown) => V
  ): Promise<Result<Map<K, V> | null, PersistenceError>> {
    const result = await this.load<Array<[K, unknown]>>(filename);

    if (!result.ok) {
      return result;
    }

    if (result.value === null) {
      return Ok(null);
    }

    const map = new Map<K, V>();

    for (const [key, value] of result.value) {
      const transformedValue = valueTransformer
        ? valueTransformer(value)
        : (value as V);
      map.set(key, transformedValue);
    }

    return Ok(map);
  }

  /**
   * ファイルが見つからないエラーかどうかを判定
   */
  private isFileNotFoundError(e: unknown): boolean {
    return (
      e instanceof Error &&
      'code' in e &&
      (e as NodeJS.ErrnoException).code === 'ENOENT'
    );
  }
}
