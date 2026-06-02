/**
 * 開発サーバーのポート検出マネージャー
 *
 * 各ターミナル（bash PTY）の子孫プロセスが LISTEN している TCP ポートを
 * `ps` でプロセスツリーを辿り、Linux/WSL では `ss`、macOS では `lsof` で取得する。
 * フレームワークの出力フォーマットに依存せず、実際に開いているポートのみを検出する。
 *
 * 注: Linux/WSL では `lsof` ではなく `ss`（netlink/sock_diag）を使用する。
 * Next.js の next-server は process.title を "next-server (v15.5.15)" に変更するため、
 * /proc/PID/stat の comm フィールドが入れ子括弧 "(next-server (v1)" になり、
 * lsof の stat パーサが破綻して該当プロセスのソケットを取りこぼす（特に WSL 環境）。
 * ss はプロセス名に依存せずソケットを列挙できるため、この問題を回避できる。
 * 一方 macOS には ss が無く、lsof は /proc を使わない実装で上記問題も起きないため lsof を使う。
 */

import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

// Linux/WSL では ss、それ以外（macOS）では lsof を使用する
const USE_SS = os.platform() === 'linux';

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
 * `lsof -F pcn` の機械可読出力をパースして、LISTEN中の (pid, command, port) を返す（macOS 用）
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

/**
 * `ss -tlnpH` の出力をパースして、LISTEN中の (pid, command, port) を返す（Linux/WSL 用）
 *
 * ss の各行は以下のような形式（列はスペース区切り）:
 *   LISTEN 0  511  *:3001  *:*  users:(("next-server (v1",pid=319542,fd=24))
 * 1つのソケットを複数プロセスが共有する場合、users:(...) に複数の pid が並ぶ。
 */
function parseSs(ssOutput: string): Array<{
  pid: number;
  command: string;
  port: number;
}> {
  const results: Array<{ pid: number; command: string; port: number }> = [];
  // users:(("name",pid=N,fd=M),("name2",pid=M,...)) から (name, pid) を抜き出す
  const procRegex = /\("([^"]*)",pid=(\d+)/g;
  for (const line of ssOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    // 先頭列が State。LISTEN 行のみを対象とする
    if (cols[0] !== 'LISTEN') continue;
    // Local Address:Port は4列目。例: "*:3001" / "127.0.0.1:8000" / "[::1]:8000"
    const localAddr = cols[3];
    if (!localAddr) continue;
    const portMatch = localAddr.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    // プロセス情報（users:...）が無い行はスキップ
    const usersIndex = trimmed.indexOf('users:');
    if (usersIndex === -1) continue;
    const procPart = trimmed.slice(usersIndex);
    procRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = procRegex.exec(procPart)) !== null) {
      results.push({
        pid: Number(match[2]),
        command: match[1],
        port,
      });
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

      // Linux/WSL は ss、macOS は lsof でLISTEN中のTCPソケットを取得
      // ss: -t:TCP -l:LISTEN -n:数値 -p:プロセス -H:ヘッダ無し
      // lsof: 機械可読形式（該当なしは終了コード1だが出力は得る）
      const portCommand = USE_SS
        ? 'ss -tlnpH'
        : 'lsof -nP -iTCP -sTCP:LISTEN -F pcn';
      const [psOutput, portOutput] = await Promise.all([
        execAsync('ps -eo pid=,ppid=', { maxBuffer: 1024 * 1024 }).then(
          (r) => r.stdout
        ),
        execAsync(portCommand, {
          maxBuffer: 4 * 1024 * 1024,
        })
          .then((r) => r.stdout)
          .catch((e: { stdout?: string }) => e.stdout || ''),
      ]);

      const childrenMap = buildChildrenMap(psOutput);
      const listening = USE_SS
        ? parseSs(portOutput)
        : parseLsof(portOutput);

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
