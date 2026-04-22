import { v4 as uuidv4 } from 'uuid';
import type { AiOutputLine, AiProvider } from '../types/index.js';
import { EventEmitter } from 'events';
import { RingBuffer } from '../utils/ring-buffer.js';

/**
 * AI出力管理クラス
 * AI CLI（Claude, Codex等）の出力履歴の管理を担当
 * メモリベースで動作し、永続化は行わない
 */
export class AiOutputManager extends EventEmitter {
  private static readonly MAX_HISTORY_LINES = 500;

  private outputHistories = new Map<string, RingBuffer<AiOutputLine>>();

  constructor() {
    super();
  }

  /**
   * リポジトリとプロバイダーの組み合わせからキーを生成
   */
  private getHistoryKey(repositoryPath: string, provider: AiProvider): string {
    return `${repositoryPath}:${provider}`;
  }

  /**
   * AI出力履歴を追加
   */
  addOutputLine(
    repositoryPath: string,
    provider: AiProvider,
    content: string,
    type: 'stdout' | 'stderr' | 'system' = 'stdout'
  ): AiOutputLine {
    const key = this.getHistoryKey(repositoryPath, provider);
    let history = this.outputHistories.get(key);

    if (!history) {
      history = new RingBuffer<AiOutputLine>(AiOutputManager.MAX_HISTORY_LINES);
      this.outputHistories.set(key, history);
    }

    const outputLine: AiOutputLine = {
      id: uuidv4(),
      content,
      timestamp: Date.now(),
      type,
      provider,
    };

    history.push(outputLine);

    return outputLine;
  }

  /**
   * AI出力履歴を取得
   */
  getOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): AiOutputLine[] {
    const key = this.getHistoryKey(repositoryPath, provider);
    const history = this.outputHistories.get(key);
    return history?.toArray() || [];
  }

  /**
   * AI出力履歴をクリア
   */
  clearOutputHistory(repositoryPath: string, provider: AiProvider): boolean {
    const key = this.getHistoryKey(repositoryPath, provider);

    // メモリをクリア
    const history = this.outputHistories.get(key);
    if (history) {
      history.clear();
      return true;
    }

    return false;
  }

  /**
   * 特定のリポジトリの全プロバイダーの出力履歴をクリア
   */
  clearAllOutputHistoriesForRepository(repositoryPath: string): void {
    const providers: AiProvider[] = ['claude'];

    for (const provider of providers) {
      this.clearOutputHistory(repositoryPath, provider);
    }
  }

  /**
   * シャットダウン: メモリをクリア
   */
  shutdown(): void {
    this.outputHistories.clear();
  }
}
