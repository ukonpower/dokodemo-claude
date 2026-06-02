/**
 * 開発サーバーのポート検出マネージャー
 *
 * 各ターミナル（bash PTY）の子孫プロセスが LISTEN している TCP ポートを
 * `ps` でプロセスツリーを辿り `lsof` で取得する。
 * フレームワークの出力フォーマットに依存せず、実際に開いているポートのみを検出する。
 */

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ポーリング間隔（ミリ秒）
const POLL_INTERVAL_MS = 4000;

/**
 * 検出されたポート情報
 */
export interface DetectedPort {
  terminalId: string;
  port: number;
  pid: number;
  command: string;
}

/**
 * ポート検出の対象ターミナル
 */
export interface PortDetectorTarget {
  id: string;
  pid: number;
  repositoryPath: string;
}

/**
 * `ps -eo pid=,ppid=` の出力から ppid → 子pid配列のマップを構築
 */
function buildChildrenMap(psOutput: string): Map<number, number[]> {
  const childrenMap = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isNaN(pid) || Number.isNaN(ppid)) continue;
    const arr = childrenMap.get(ppid) || [];
    arr.push(pid);
    childrenMap.set(ppid, arr);
  }
  return childrenMap;
}

/**
 * 指定 pid を起点とした子孫 pid の集合（起点自身を含む）を取得
 */
function collectDescendants(
  rootPid: number,
  childrenMap: Map<number, number[]>
): Set<number> {
  const result = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    const children = childrenMap.get(current);
    if (!children) continue;
    for (const child of children) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

/**
 * `lsof -F pcn` の機械可読出力をパースして、LISTEN中の (pid, command, port) を返す
 */
function parseLsof(lsofOutput: string): Array<{
  pid: number;
  command: string;
  port: number;
}> {
  const results: Array<{ pid: number; command: string; port: number }> = [];
  let currentPid = 0;
  let currentCommand = '';
  for (const line of lsofOutput.split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      currentPid = Number(value);
      currentCommand = '';
    } else if (tag === 'c') {
      currentCommand = value;
    } else if (tag === 'n') {
      // 例: "*:8000" / "127.0.0.1:8000" / "[::1]:8000"
      const match = value.match(/:(\d+)$/);
      if (match && currentPid) {
        results.push({
          pid: currentPid,
          command: currentCommand,
          port: Number(match[1]),
        });
      }
    }
  }
  return results;
}

export class PortDetector extends EventEmitter {
  private interval: ReturnType<typeof setInterval> | null = null;
  // リポジトリごとの最後に検出したポート情報（キャッシュ兼変化検知用）
  private lastPorts = new Map<string, DetectedPort[]>();
  private polling = false;

  constructor(private readonly getTargets: () => PortDetectorTarget[]) {
    super();
  }

  start(): void {
    if (this.interval) return;
    void this.poll(); // 起動直後に1回検出してキャッシュを満たす
    this.interval = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  /**
   * 指定リポジトリの最後に検出したポート情報を取得（接続直後の初期表示用）
   */
  getPorts(repositoryPath: string): DetectedPort[] {
    return this.lastPorts.get(repositoryPath) || [];
  }

  /**
   * 検出済みの全リポジトリ（全worktree）のポート情報を取得
   */
  getAllPorts(): Array<{ repositoryPath: string; ports: DetectedPort[] }> {
    return Array.from(this.lastPorts.entries()).map(
      ([repositoryPath, ports]) => ({ repositoryPath, ports })
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.lastPorts.clear();
  }

  /**
   * 1回のポーリングを実行し、変化のあったリポジトリについて 'ports-updated' を emit
   */
  private async poll(): Promise<void> {
    if (this.polling) return; // 前回のポーリングが未完了ならスキップ
    this.polling = true;
    try {
      const targets = this.getTargets();
      if (targets.length === 0) {
        // ターミナルが無い場合、過去に通知したリポジトリへ空を通知してクリア
        for (const repositoryPath of this.lastPorts.keys()) {
          this.emit('ports-updated', { repositoryPath, ports: [] });
        }
        this.lastPorts.clear();
        return;
      }

      const [psOutput, lsofOutput] = await Promise.all([
        execAsync('ps -eo pid=,ppid=', { maxBuffer: 1024 * 1024 }).then(
          (r) => r.stdout
        ),
        // LISTEN中のTCPソケットを機械可読形式で取得（該当なしは終了コード1だが出力は得る）
        execAsync('lsof -nP -iTCP -sTCP:LISTEN -F pcn', {
          maxBuffer: 4 * 1024 * 1024,
        })
          .then((r) => r.stdout)
          .catch((e: { stdout?: string }) => e.stdout || ''),
      ]);

      const childrenMap = buildChildrenMap(psOutput);
      const listening = parseLsof(lsofOutput);

      // リポジトリごとにポートを集約（同一ポートのIPv4/IPv6重複を除去）
      const portsByRepository = new Map<string, DetectedPort[]>();
      for (const target of targets) {
        const descendants = collectDescendants(target.pid, childrenMap);
        const seen = new Set<number>();
        for (const entry of listening) {
          if (!descendants.has(entry.pid)) continue;
          if (seen.has(entry.port)) continue;
          seen.add(entry.port);
          const arr = portsByRepository.get(target.repositoryPath) || [];
          arr.push({
            terminalId: target.id,
            port: entry.port,
            pid: entry.pid,
            command: entry.command,
          });
          portsByRepository.set(target.repositoryPath, arr);
        }
      }

      // 対象となった全リポジトリ（ポート0件含む）について変化を判定して通知
      const repositoryPaths = new Set<string>([
        ...targets.map((t) => t.repositoryPath),
        ...this.lastPorts.keys(),
      ]);
      for (const repositoryPath of repositoryPaths) {
        const ports = (portsByRepository.get(repositoryPath) || []).sort(
          (a, b) => a.port - b.port
        );
        const prev = this.lastPorts.get(repositoryPath);
        if (prev && JSON.stringify(prev) === JSON.stringify(ports)) continue;
        if (ports.length === 0 && !prev) {
          continue; // もともと通知していないリポジトリの空通知は不要
        }
        if (ports.length === 0) {
          this.lastPorts.delete(repositoryPath);
        } else {
          this.lastPorts.set(repositoryPath, ports);
        }
        this.emit('ports-updated', { repositoryPath, ports });
      }
    } catch (e) {
      console.error('[PortDetector] ポート検出に失敗しました', e);
    } finally {
      this.polling = false;
    }
  }
}
