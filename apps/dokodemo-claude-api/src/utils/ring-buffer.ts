/**
 * 固定容量のRing Buffer（循環バッファ）
 * 容量を超えると古い要素が自動的に上書きされる
 * 配列のslice()によるGC圧力を軽減
 */
export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0; // 次に書き込む位置
  private size = 0; // 現在の要素数

  constructor(private capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.buffer = new Array(capacity);
  }

  /**
   * 要素を追加
   */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * 配列として取得（古い順）
   */
  toArray(): T[] {
    if (this.size === 0) {
      return [];
    }

    const result: T[] = new Array(this.size);

    if (this.size < this.capacity) {
      // バッファが満杯でない場合は先頭から
      for (let i = 0; i < this.size; i++) {
        result[i] = this.buffer[i] as T;
      }
    } else {
      // バッファが満杯の場合はheadから読み始める
      for (let i = 0; i < this.size; i++) {
        result[i] = this.buffer[(this.head + i) % this.capacity] as T;
      }
    }

    return result;
  }

  /**
   * 現在の要素数を取得
   */
  get length(): number {
    return this.size;
  }

  /**
   * バッファをクリア
   */
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }

  /**
   * 容量を取得
   */
  getCapacity(): number {
    return this.capacity;
  }
}
