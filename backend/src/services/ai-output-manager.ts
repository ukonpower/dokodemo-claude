import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { AiOutputLine, AiProvider } from '../types/index.js';
import { EventEmitter } from 'events';

/**
 * AI出力管理クラス
 * AI CLI（Claude, Codex等）の出力履歴の管理を担当
 */
export class AiOutputManager extends EventEmitter {
  private outputHistories = new Map<string, AiOutputLine[]>(); // key: `${repositoryPath}:${provider}`
  private processesDir: string;

  constructor(processesDir: string) {
    super();
    this.processesDir = processesDir;
  }

  /**
   * リポジトリとプロバイダーの組み合わせからキーを生成
   */
  private getHistoryKey(repositoryPath: string, provider: AiProvider): string {
    return `${repositoryPath}:${provider}`;
  }

  /**
   * AI出力履歴ファイルのパスを取得
   */
  private getHistoryFilePath(
    repositoryPath: string,
    provider: AiProvider
  ): string {
    const repoName = path.basename(repositoryPath);
    return path.join(
      this.processesDir,
      repoName,
      `${provider}-output-history.json`
    );
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
      history = [];
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

    // 履歴をファイルに保存（非同期・ノンブロッキング）
    this.saveHistoryToFile(repositoryPath, provider, history).catch((err) => {
      console.error(
        `AI出力履歴の保存に失敗 (${repositoryPath}, ${provider}):`,
        err
      );
    });

    return outputLine;
  }

  /**
   * AI出力履歴を取得
   */
  async getOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<AiOutputLine[]> {
    const key = this.getHistoryKey(repositoryPath, provider);
    let history = this.outputHistories.get(key);

    if (!history) {
      // メモリに存在しない場合はファイルから読み込み
      history = await this.loadHistoryFromFile(repositoryPath, provider);
      this.outputHistories.set(key, history);
    }

    return history;
  }

  /**
   * AI出力履歴をクリア
   */
  async clearOutputHistory(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<boolean> {
    const key = this.getHistoryKey(repositoryPath, provider);

    // メモリから削除
    this.outputHistories.set(key, []);

    // ファイルから削除
    try {
      const historyFilePath = this.getHistoryFilePath(repositoryPath, provider);
      await fs.unlink(historyFilePath);
      return true;
    } catch (error) {
      // ファイルが存在しない場合は正常終了
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return true;
      }
      throw error;
    }
  }

  /**
   * 特定のリポジトリの全プロバイダーの出力履歴をクリア
   */
  async clearAllOutputHistoriesForRepository(
    repositoryPath: string
  ): Promise<void> {
    const providers: AiProvider[] = ['claude', 'codex'];

    for (const provider of providers) {
      try {
        await this.clearOutputHistory(repositoryPath, provider);
      } catch (error) {
        console.error(
          `${provider}の出力履歴クリアに失敗 (${repositoryPath}):`,
          error
        );
      }
    }
  }

  /**
   * AI出力履歴をファイルから読み込み
   */
  private async loadHistoryFromFile(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<AiOutputLine[]> {
    try {
      const historyFilePath = this.getHistoryFilePath(repositoryPath, provider);
      const data = await fs.readFile(historyFilePath, 'utf-8');
      const history = JSON.parse(data) as AiOutputLine[];

      // プロバイダー情報が欠けている古いデータへの対応
      return history.map((line) => ({
        ...line,
        provider: line.provider || provider,
      }));
    } catch (error) {
      // ファイルが存在しない場合は空の配列を返す
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * AI出力履歴をファイルに保存
   */
  private async saveHistoryToFile(
    repositoryPath: string,
    provider: AiProvider,
    history: AiOutputLine[]
  ): Promise<void> {
    try {
      const historyFilePath = this.getHistoryFilePath(repositoryPath, provider);
      const historyDir = path.dirname(historyFilePath);

      // ディレクトリが存在しない場合は作成
      await fs.mkdir(historyDir, { recursive: true });

      // 履歴をJSON形式で保存
      await fs.writeFile(historyFilePath, JSON.stringify(history, null, 2), {
        encoding: 'utf-8',
      });
    } catch (error) {
      console.error(
        `AI出力履歴の保存に失敗 (${repositoryPath}, ${provider}):`,
        error
      );
      throw error;
    }
  }

  /**
   * 初期化: 既存の履歴ファイルをメモリにロード
   */
  async initialize(): Promise<void> {
    try {
      const processEntries = await fs.readdir(this.processesDir, {
        withFileTypes: true,
      });

      for (const entry of processEntries) {
        if (entry.isDirectory()) {
          const repoName = entry.name;
          const repoProcessDir = path.join(this.processesDir, repoName);

          // 各プロバイダーの履歴ファイルをロード
          const providers: AiProvider[] = ['claude', 'codex'];
          for (const provider of providers) {
            try {
              const historyFilePath = path.join(
                repoProcessDir,
                `${provider}-output-history.json`
              );
              const data = await fs.readFile(historyFilePath, 'utf-8');
              const history = JSON.parse(data) as AiOutputLine[];

              // メモリに保存（repositoryPathはプロセスディレクトリから推測）
              const key = `${repoProcessDir}:${provider}`;
              this.outputHistories.set(
                key,
                history.map((line) => ({
                  ...line,
                  provider: line.provider || provider,
                }))
              );
            } catch (error) {
              // ファイルが存在しない場合はスキップ
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error(
                  `AI出力履歴の読み込みに失敗 (${repoName}, ${provider}):`,
                  error
                );
              }
            }
          }
        }
      }
    } catch (error) {
      // processesディレクトリが存在しない場合は作成
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(this.processesDir, { recursive: true });
      }
    }
  }

  /**
   * シャットダウン: すべての履歴をファイルに保存
   */
  async shutdown(): Promise<void> {
    const savePromises: Promise<void>[] = [];

    for (const [key, history] of this.outputHistories.entries()) {
      const [repositoryPath, provider] = key.split(':') as [string, AiProvider];
      savePromises.push(
        this.saveHistoryToFile(repositoryPath, provider, history)
      );
    }

    await Promise.all(savePromises);
  }
}
