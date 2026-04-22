/**
 * process-monitor-utils.ts - プロセス監視用の純粋関数
 *
 * 責務:
 * - プロセスの生存確認（純粋関数）
 * - 死んだプロセスのフィルタリング
 */

import { AiSessionRecord, TerminalRecord } from './process-registry.js';

/**
 * PID が生きているかどうかをチェック（純粋関数）
 *
 * process.kill(pid, 0) はシグナルを送らずにプロセスの存在確認のみを行う
 * - プロセスが存在すれば例外なし
 * - プロセスが存在しなければ ESRCH エラー
 */
export function isPidAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 死んだ AI セッションレコードをフィルタリング
 */
export function getDeadAiSessions(
  records: AiSessionRecord[]
): AiSessionRecord[] {
  return records.filter((r) => !isPidAlive(r.pid));
}

/**
 * 生きている AI セッションレコードをフィルタリング
 */
export function getAliveAiSessions(
  records: AiSessionRecord[]
): AiSessionRecord[] {
  return records.filter((r) => isPidAlive(r.pid));
}

/**
 * 死んだターミナルレコードをフィルタリング
 */
export function getDeadTerminals(records: TerminalRecord[]): TerminalRecord[] {
  return records.filter((r) => !isPidAlive(r.pid));
}

/**
 * 生きているターミナルレコードをフィルタリング
 */
export function getAliveTerminals(records: TerminalRecord[]): TerminalRecord[] {
  return records.filter((r) => isPidAlive(r.pid));
}

/**
 * プロセスの健康状態レポート
 */
export interface HealthReport {
  aliveAiSessions: number;
  deadAiSessions: number;
  aliveTerminals: number;
  deadTerminals: number;
  timestamp: number;
}

/**
 * 健康状態レポートを生成
 */
export function generateHealthReport(
  aiSessions: AiSessionRecord[],
  terminals: TerminalRecord[]
): HealthReport {
  const aliveAiSessions = aiSessions.filter((s) => isPidAlive(s.pid)).length;
  const deadAiSessions = aiSessions.length - aliveAiSessions;
  const aliveTerminals = terminals.filter((t) => isPidAlive(t.pid)).length;
  const deadTerminals = terminals.length - aliveTerminals;

  return {
    aliveAiSessions,
    deadAiSessions,
    aliveTerminals,
    deadTerminals,
    timestamp: Date.now(),
  };
}

/**
 * プロセス終了を試みる
 *
 * @param pid プロセスID
 * @param gracefulTimeoutMs SIGTERM 後に SIGKILL を送るまでの待機時間
 * @returns 終了に成功したかどうか
 */
export async function terminateProcess(
  pid: number,
  gracefulTimeoutMs: number = 1000
): Promise<boolean> {
  if (!isPidAlive(pid)) {
    return true; // 既に終了している
  }

  try {
    // まず SIGTERM を送信（graceful shutdown）
    process.kill(pid, 'SIGTERM');

    // 待機
    await new Promise<void>((resolve) =>
      setTimeout(resolve, gracefulTimeoutMs)
    );

    // まだ生きていれば SIGKILL を送信
    if (isPidAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }

    return true;
  } catch {
    return false;
  }
}
