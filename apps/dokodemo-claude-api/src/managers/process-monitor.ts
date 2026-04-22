/**
 * ProcessMonitor - プロセスの監視とクリーンアップ
 *
 * 責務:
 * - 定期的なプロセス監視
 * - 死んだプロセスのクリーンアップ
 * - ヘルスチェック
 *
 * 副作用順序の維持:
 * 1. kill (プロセス終了)
 * 2. terminal close (ターミナル閉鎖)
 * 3. queue update (キュー更新)
 * 4. persistence update (永続化更新)
 */

import { EventEmitter } from 'events';
import {
  isPidAlive,
  generateHealthReport,
  terminateProcess,
  HealthReport,
} from './process-monitor-utils.js';
import { ProcessRegistry } from './process-registry.js';

/**
 * クリーンアップ時に通知するコールバック
 */
export interface CleanupCallbacks {
  onAiSessionCleaned?: (sessionId: string, repositoryPath: string) => void;
  onTerminalCleaned?: (terminalId: string, repositoryPath: string) => void;
}

/**
 * ProcessMonitor 設定
 */
export interface ProcessMonitorConfig {
  monitoringIntervalMs: number;
  gracefulTerminationTimeoutMs: number;
}

const DEFAULT_CONFIG: ProcessMonitorConfig = {
  monitoringIntervalMs: 30000, // 30秒ごと
  gracefulTerminationTimeoutMs: 1000, // SIGTERM から SIGKILL まで 1秒
};

/**
 * ProcessMonitor クラス
 */
export class ProcessMonitor extends EventEmitter {
  private readonly registry: ProcessRegistry;
  private readonly config: ProcessMonitorConfig;
  private readonly callbacks: CleanupCallbacks;
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(
    registry: ProcessRegistry,
    callbacks: CleanupCallbacks = {},
    config: Partial<ProcessMonitorConfig> = {}
  ) {
    super();
    this.registry = registry;
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * プロセス監視を開始
   */
  startMonitoring(): void {
    if (this.monitoringInterval) {
      return; // 既に開始済み
    }

    this.monitoringInterval = setInterval(async () => {
      await this.cleanupDeadProcesses();
    }, this.config.monitoringIntervalMs);

    this.emit('monitoring-started', {
      intervalMs: this.config.monitoringIntervalMs,
    });
  }

  /**
   * プロセス監視を停止
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.emit('monitoring-stopped');
    }
  }

  /**
   * 現在の健康状態を取得
   */
  checkHealth(): HealthReport {
    const aiSessions = this.registry.getAllAiSessions();
    const terminals = this.registry.getAllTerminals();
    return generateHealthReport(aiSessions, terminals);
  }

  /**
   * 死んだプロセスをクリーンアップ
   *
   * 順序:
   * 1. AI セッションのクリーンアップ
   * 2. ターミナルのクリーンアップ
   */
  async cleanupDeadProcesses(): Promise<{
    cleanedAiSessions: number;
    cleanedTerminals: number;
  }> {
    let cleanedAiSessions = 0;
    let cleanedTerminals = 0;

    // AI セッションのクリーンアップ
    const aiSessions = this.registry.getAllAiSessions();
    for (const session of aiSessions) {
      if (!isPidAlive(session.pid)) {
        this.registry.removeAiSession(session.sessionId);
        cleanedAiSessions++;

        // コールバックを呼び出し
        this.callbacks.onAiSessionCleaned?.(
          session.sessionId,
          session.repositoryPath
        );

        // イベントを発火
        this.emit('ai-session-cleaned', {
          sessionId: session.sessionId,
          repositoryPath: session.repositoryPath,
        });
      }
    }

    // ターミナルのクリーンアップ
    const terminals = this.registry.getAllTerminals();
    for (const terminal of terminals) {
      if (!isPidAlive(terminal.pid)) {
        this.registry.removeTerminal(terminal.terminalId);
        cleanedTerminals++;

        // コールバックを呼び出し
        this.callbacks.onTerminalCleaned?.(
          terminal.terminalId,
          terminal.repositoryPath
        );

        // イベントを発火
        this.emit('terminal-cleaned', {
          terminalId: terminal.terminalId,
          repositoryPath: terminal.repositoryPath,
        });
      }
    }

    if (cleanedAiSessions > 0 || cleanedTerminals > 0) {
      this.emit('cleanup-completed', {
        cleanedAiSessions,
        cleanedTerminals,
      });
    }

    return { cleanedAiSessions, cleanedTerminals };
  }

  /**
   * 特定の AI セッションを終了してクリーンアップ
   */
  async terminateAiSession(sessionId: string): Promise<boolean> {
    const session = this.registry.getAiSessionById(sessionId);
    if (!session) {
      return false;
    }

    // プロセスを終了
    if (session.pid) {
      await terminateProcess(
        session.pid,
        this.config.gracefulTerminationTimeoutMs
      );
    }

    // レジストリから削除
    this.registry.removeAiSession(sessionId);

    // イベントを発火
    this.emit('ai-session-terminated', {
      sessionId,
      repositoryPath: session.repositoryPath,
    });

    return true;
  }

  /**
   * 特定のターミナルを終了してクリーンアップ
   */
  async terminateTerminal(terminalId: string): Promise<boolean> {
    const terminal = this.registry.getTerminalById(terminalId);
    if (!terminal) {
      return false;
    }

    // プロセスを終了
    if (terminal.pid) {
      await terminateProcess(
        terminal.pid,
        this.config.gracefulTerminationTimeoutMs
      );
    }

    // レジストリから削除
    this.registry.removeTerminal(terminalId);

    // イベントを発火
    this.emit('terminal-terminated', {
      terminalId,
      repositoryPath: terminal.repositoryPath,
    });

    return true;
  }

  /**
   * 特定のリポジトリのすべてのプロセスを終了
   */
  async terminateAllForRepository(repositoryPath: string): Promise<{
    terminatedAiSessions: number;
    terminatedTerminals: number;
  }> {
    let terminatedAiSessions = 0;
    let terminatedTerminals = 0;

    // AI セッションを終了
    const aiSessions = this.registry
      .getAllAiSessions()
      .filter((s) => s.repositoryPath === repositoryPath);

    for (const session of aiSessions) {
      await this.terminateAiSession(session.sessionId);
      terminatedAiSessions++;
    }

    // ターミナルを終了
    const terminals = this.registry.getTerminalsByRepo(repositoryPath);
    for (const terminal of terminals) {
      await this.terminateTerminal(terminal.terminalId);
      terminatedTerminals++;
    }

    return { terminatedAiSessions, terminatedTerminals };
  }

  /**
   * 監視中かどうか
   */
  isMonitoring(): boolean {
    return this.monitoringInterval !== null;
  }
}
