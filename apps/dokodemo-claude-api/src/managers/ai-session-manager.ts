/**
 * AISessionManager - AI CLI セッションのマルチインスタンス管理
 *
 * 1 リポジトリに対し複数の AiInstance（タブ）を保持し、各 instance に
 * 1 つの ActiveAiSession (PTY) を結びつける。
 *
 * - プライマリ : リポジトリオープン時に自動生成、閉じられない（provider 切替時は kill→spawn して instanceId 維持）
 * - サブ       : ユーザ操作で作成、閉じられる、provider 固定
 */

import * as pty from 'node-pty';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  AiProvider,
  AiOutputLine,
  AiInstance,
  PermissionMode,
} from '../types/index.js';
import { RingBuffer } from '../utils/ring-buffer.js';
import {
  cleanChildEnv,
  getDokodemoApiBaseUrl,
  getDokodemoMcpUrl,
  resolveCommandPath,
} from '../utils/clean-env.js';
import { diagnoseSpawnHelper } from '../utils/node-pty-repair.js';
import { ProcessRegistry } from './process-registry.js';

/**
 * アクティブな AI セッション（PTY 接続）
 */
export interface ActiveAiSession {
  id: string; // sessionId
  instanceId: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  isActive: boolean;
  isPty: boolean;
  process: pty.IPty;
  provider: AiProvider;
  createdAt: number;
  lastAccessedAt: number;
  outputHistory: AiOutputLine[];
}

export interface CreateInstanceOptions {
  repositoryPath: string;
  repositoryName: string;
  provider: AiProvider;
  isPrimary: boolean;
  displayName?: string;
  initialSize?: { cols: number; rows: number };
  permissionMode?: PermissionMode;
}

export interface AISessionManagerConfig {
  maxOutputLines: number;
  gracefulTerminationTimeoutMs: number;
}

const DEFAULT_CONFIG: AISessionManagerConfig = {
  // 出力履歴の保持件数。リロード／再接続／タブ・プロバイダ切替で履歴を
  // 取り直す際にここまで遡れる。Claude Code は TUI 再描画フレームを多く
  // 吐くため、500 では直近しか残らず履歴を遡れない。xterm の scrollback
  // (10000 行) と釣り合う 5000 チャンクを保持する。
  maxOutputLines: 5000,
  gracefulTerminationTimeoutMs: 2000,
};

// コールドスタート（claude/codex CLI を新規 spawn した直後）の起動完了待ち
// パラメータ。CLI の TUI 入力ハンドラが起動しきる前にプロンプト＋Enter を
// 送ると Enter が取りこぼされて送信されない。PTY 出力が一定時間途切れた
// （＝初期描画が落ち着いた）ことを検知してから送信を始めることで取りこぼしを防ぐ。
// CLI が初期出力を始めるまでの最低待機時間。これ未満では「落ち着いた」と判定しない。
const SESSION_READY_MIN_WAIT_MS = 1500;
// PTY 出力がこの時間途切れたら初期描画が完了したとみなす。
const SESSION_READY_QUIET_PERIOD_MS = 600;
// 環境差で出力が止まらない場合に待機を打ち切る上限。
const SESSION_READY_MAX_WAIT_MS = 10000;
// 出力静止判定のポーリング間隔。
const SESSION_READY_POLL_INTERVAL_MS = 100;

export class AISessionManager extends EventEmitter {
  private readonly registry: ProcessRegistry;
  private readonly config: AISessionManagerConfig;

  // instanceId → AiInstance
  private instances = new Map<string, AiInstance>();
  // instanceId → ActiveAiSession
  private activeSessions = new Map<string, ActiveAiSession>();
  // sessionId → instanceId
  private sessionIdIndex = new Map<string, string>();
  // instanceId → RingBuffer
  private outputBuffers = new Map<string, RingBuffer<AiOutputLine>>();

  private sessionCounter = 0;
  private instanceCounter = 0;

  constructor(
    registry: ProcessRegistry,
    config: Partial<AISessionManagerConfig> = {}
  ) {
    super();
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getProviderCommand(provider: AiProvider, permissionMode?: PermissionMode): {
    command: string;
    args: string[];
  } {
    switch (provider) {
      case 'claude': {
        const claudeCommand = process.env.CLAUDE_CLI_COMMAND || 'claude';
        const args: string[] = [];
        // permissionMode が undefined のときは「未指定＝最強権限」と扱うとサイレントに
        // dangerous で起動してしまうので、安全側の 'auto' を既定として倒す。
        const mode: PermissionMode = permissionMode ?? 'auto';
        if (mode === 'dangerous') {
          args.push('--dangerously-skip-permissions');
        } else if (mode === 'auto') {
          args.push('--permission-mode', 'auto');
        }
        return { command: claudeCommand, args };
      }
      case 'codex': {
        const codexCommand = process.env.CODEX_CLI_COMMAND || 'codex';
        return {
          command: codexCommand,
          args: ['--dangerously-bypass-approvals-and-sandbox'],
        };
      }
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  private generateSessionId(provider: AiProvider): string {
    return `${provider}-${++this.sessionCounter}-${Date.now()}`;
  }

  private generateInstanceId(isPrimary: boolean): string {
    const prefix = isPrimary ? 'primary' : 'sub';
    return `${prefix}-${++this.instanceCounter}-${Date.now()}`;
  }

  /**
   * 内部用: PTY を起動して ActiveAiSession を作る
   */
  private spawnSession(
    instance: AiInstance,
    repositoryName: string,
    options: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): ActiveAiSession {
    const { command, args } = this.getProviderCommand(
      instance.provider,
      options.permissionMode
    );
    const sessionId = this.generateSessionId(instance.provider);

    // cwd（リポジトリパス）が存在しない場合は node-pty が "posix_spawnp failed"
    // という原因の判別不能な汎用エラーを投げてしまうため、事前に検証して
    // 具体的なメッセージを返す。
    if (!fs.existsSync(instance.repositoryPath)) {
      throw new Error(
        `リポジトリパスが存在しません: ${instance.repositoryPath}`
      );
    }

    const childEnv = cleanChildEnv({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      CLAUDECODE: undefined,
      DOKODEMO_API_BASE_URL: getDokodemoApiBaseUrl(),
      DOKODEMO_MCP_URL: getDokodemoMcpUrl(),
    });

    // コマンドが PATH から解決できなければ "posix_spawnp failed" になるので
    // 事前に絶対パス解決して、解決失敗時は明確なエラーを投げる。
    const resolvedCommand = resolveCommandPath(command, childEnv);
    if (!resolvedCommand) {
      throw new Error(
        `${instance.provider} CLI が見つかりません: "${command}" は PATH 上で実行可能ファイルとして解決できませんでした。` +
          ` ~/.local/bin など CLI のインストール先が PATH に含まれているかご確認ください。` +
          ` (PATH="${childEnv.PATH ?? ''}")`
      );
    }

    let aiProcess: pty.IPty;
    try {
      aiProcess = pty.spawn(resolvedCommand, args, {
        name: 'xterm-color',
        cols: options.initialSize?.cols ?? 120,
        rows: options.initialSize?.rows ?? 30,
        cwd: instance.repositoryPath,
        env: childEnv,
      });
    } catch (error) {
      // node-pty の元エラーには cwd / command が含まれていないため、
      // 原因特定できるように情報を付与し直す。
      // posix_spawnp failed の場合は spawn-helper のモード診断を付加する。
      const reason = error instanceof Error ? error.message : String(error);
      const helperHint =
        reason.includes('posix_spawnp') ? diagnoseSpawnHelper() : null;
      throw new Error(
        `${instance.provider} CLI の起動に失敗しました: ${reason} ` +
          `(command="${resolvedCommand}", cwd="${instance.repositoryPath}")` +
          (helperHint ? ` ${helperHint}` : '')
      );
    }

    const session: ActiveAiSession = {
      id: sessionId,
      instanceId: instance.instanceId,
      repositoryPath: instance.repositoryPath,
      repositoryName,
      pid: aiProcess.pid,
      isActive: true,
      isPty: true,
      process: aiProcess,
      provider: instance.provider,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      outputHistory: [],
    };

    let pendingOutput = '';
    let flushScheduled = false;

    aiProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
      pendingOutput += data;

      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(() => {
          const bufferedData = pendingOutput;
          pendingOutput = '';
          flushScheduled = false;

          const outputLine = this.addToOutputHistory(
            session,
            bufferedData,
            'stdout'
          );

          this.emit('ai-output', {
            instanceId: session.instanceId,
            sessionId: session.id,
            repositoryPath: session.repositoryPath,
            provider: session.provider,
            outputLine,
          });
        });
      }
    });

    aiProcess.onExit(({ exitCode, signal }) => {
      session.isActive = false;

      this.emit('ai-exit', {
        instanceId: session.instanceId,
        sessionId: session.id,
        repositoryPath: session.repositoryPath,
        exitCode,
        signal,
        provider: session.provider,
      });

      // セッションだけクリーンアップ。instance レコードは残す（再起動可能性あり）
      this.activeSessions.delete(instance.instanceId);
      this.sessionIdIndex.delete(session.id);
      this.registry.removeAiSession(session.id);

      const inst = this.instances.get(instance.instanceId);
      if (inst) {
        inst.sessionId = undefined;
        this.emit('ai-instance-updated', {
          instanceId: inst.instanceId,
          instance: { ...inst },
        });
      }
    });

    this.activeSessions.set(instance.instanceId, session);
    this.sessionIdIndex.set(session.id, instance.instanceId);

    this.registry.registerAiSession({
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      provider: session.provider,
      pid: session.pid,
      status: 'running',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
    });

    return session;
  }

  /**
   * 新規インスタンスを作成（PTY も起動）
   */
  async createInstance(
    options: CreateInstanceOptions
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
    const instanceId = this.generateInstanceId(options.isPrimary);
    const order = this.getNextOrder(options.repositoryPath, options.isPrimary);

    const instance: AiInstance = {
      instanceId,
      repositoryPath: options.repositoryPath,
      provider: options.provider,
      isPrimary: options.isPrimary,
      displayName: options.displayName,
      order,
      createdAt: Date.now(),
      sessionId: undefined,
    };

    this.instances.set(instanceId, instance);

    const session = this.spawnSession(instance, options.repositoryName, {
      initialSize: options.initialSize,
      permissionMode: options.permissionMode,
    });

    instance.sessionId = session.id;

    this.emit('ai-instance-created', {
      instanceId,
      instance: { ...instance },
    });
    this.emit('ai-session-created', {
      instanceId,
      sessionId: session.id,
      repositoryPath: instance.repositoryPath,
      provider: instance.provider,
    });

    return { instance, session };
  }

  /**
   * プライマリインスタンスを確保（無ければ作成）
   * provider が異なる場合は switchPrimaryProvider と組み合わせて呼び出し側で対応
   */
  async ensurePrimaryInstance(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{
    instance: AiInstance;
    session: ActiveAiSession;
    coldStart: boolean;
  }> {
    const primary = this.getPrimaryInstance(repositoryPath);
    if (primary) {
      // セッションが死んでいれば spawn し直す
      let session = this.activeSessions.get(primary.instanceId);
      if (!session || !session.isActive) {
        session = this.spawnSession(primary, repositoryName, options ?? {});
        primary.sessionId = session.id;
        this.emit('ai-instance-updated', {
          instanceId: primary.instanceId,
          instance: { ...primary },
        });
        // 新規に PTY を spawn したのでコールドスタート
        return { instance: primary, session, coldStart: true };
      } else if (options?.initialSize) {
        try {
          session.process.resize(
            options.initialSize.cols,
            options.initialSize.rows
          );
        } catch {
          // ignore
        }
      }

      // provider 切替が必要な場合は呼び出し側で switchPrimaryProvider を呼ぶ
      // 既存セッションを再利用したのでコールドスタートではない
      return { instance: primary, session, coldStart: false };
    }

    const created = await this.createInstance({
      repositoryPath,
      repositoryName,
      provider,
      isPrimary: true,
      initialSize: options?.initialSize,
      permissionMode: options?.permissionMode,
    });
    // プライマリが無く新規作成したのでコールドスタート
    return { ...created, coldStart: true };
  }

  /**
   * プライマリの provider を切り替える
   * 既存セッションを kill して同じ instanceId のまま新規 spawn
   */
  async switchPrimaryProvider(
    repositoryPath: string,
    newProvider: AiProvider,
    repositoryName: string,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{
    instance: AiInstance;
    session: ActiveAiSession;
    coldStart: boolean;
  }> {
    const primary = this.getPrimaryInstance(repositoryPath);
    if (!primary) {
      return await this.ensurePrimaryInstance(
        repositoryPath,
        repositoryName,
        newProvider,
        options
      );
    }

    if (primary.provider === newProvider) {
      const existing = this.activeSessions.get(primary.instanceId);
      if (existing && existing.isActive) {
        // 既存セッションを再利用したのでコールドスタートではない
        return { instance: primary, session: existing, coldStart: false };
      }
    }

    // 既存セッションを終了
    await this.terminateSession(primary.instanceId);

    // provider 更新
    primary.provider = newProvider;
    primary.sessionId = undefined;

    // 出力履歴をクリア（provider が変わるので過去のは保持しない）
    this.outputBuffers.delete(primary.instanceId);

    // 新規 spawn
    const session = this.spawnSession(primary, repositoryName, options ?? {});
    primary.sessionId = session.id;

    this.emit('ai-instance-updated', {
      instanceId: primary.instanceId,
      instance: { ...primary },
    });

    // PTY を作り直したのでコールドスタート
    return { instance: primary, session, coldStart: true };
  }

  /**
   * インスタンスの再起動（同一 instanceId、PTY だけ作り直す）
   */
  async restartInstance(
    instanceId: string,
    repositoryName: string,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{ instance: AiInstance; session: ActiveAiSession } | null> {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    await this.terminateSession(instanceId);
    this.outputBuffers.delete(instanceId);

    const session = this.spawnSession(instance, repositoryName, options ?? {});
    instance.sessionId = session.id;

    this.emit('ai-instance-updated', {
      instanceId: instance.instanceId,
      instance: { ...instance },
    });

    return { instance, session };
  }

  /**
   * インスタンスを閉じる（プライマリは閉じられない）
   */
  async closeInstance(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    if (instance.isPrimary) {
      throw new Error('プライマリインスタンスは閉じられません');
    }

    await this.terminateSession(instanceId);

    this.instances.delete(instanceId);
    this.outputBuffers.delete(instanceId);

    this.emit('ai-instance-closed', {
      instanceId,
      repositoryPath: instance.repositoryPath,
    });

    return true;
  }

  /**
   * 表示名を更新
   */
  renameInstance(instanceId: string, displayName: string): AiInstance | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    instance.displayName = displayName;

    this.emit('ai-instance-updated', {
      instanceId,
      instance: { ...instance },
    });

    return instance;
  }

  /**
   * PTY を kill するヘルパー（instances Map には触らない）
   */
  private async terminateSession(instanceId: string): Promise<boolean> {
    const session = this.activeSessions.get(instanceId);
    if (!session) return false;

    try {
      const exitPromise = new Promise<void>((resolve) => {
        session.process.onExit(() => resolve());
      });

      session.process.kill('SIGTERM');

      const killTimeout = setTimeout(() => {
        if (this.activeSessions.has(instanceId)) {
          try {
            session.process.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, this.config.gracefulTerminationTimeoutMs);

      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);

      clearTimeout(killTimeout);

      this.activeSessions.delete(instanceId);
      this.sessionIdIndex.delete(session.id);
      this.registry.removeAiSession(session.id);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 入力送信（instanceId 経由）
   */
  sendInput(instanceId: string, input: string): boolean {
    const session = this.activeSessions.get(instanceId);
    if (!session || !session.isActive || !session.process) return false;

    try {
      session.process.write(input);
      session.lastAccessedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 入力送信（sessionId 経由 — キュー Adapter 用）
   */
  sendInputBySessionId(sessionId: string, input: string): boolean {
    const instanceId = this.sessionIdIndex.get(sessionId);
    if (!instanceId) return false;
    return this.sendInput(instanceId, input);
  }

  /**
   * コールドスタート直後のセッションが入力受付可能になるまで待つ。
   * PTY 出力が SESSION_READY_QUIET_PERIOD_MS 途切れたら初期描画完了とみなして
   * resolve する。CLI が初期出力を始める前に誤判定しないよう最低
   * SESSION_READY_MIN_WAIT_MS は待ち、出力が止まらない環境では
   * SESSION_READY_MAX_WAIT_MS で打ち切る。
   */
  async waitForSessionReady(sessionId: string): Promise<void> {
    const instanceId = this.sessionIdIndex.get(sessionId);
    if (!instanceId) return;
    const session = this.activeSessions.get(instanceId);
    if (!session) return;

    const start = Date.now();
    await new Promise<void>((resolve) => {
      const check = () => {
        const elapsed = Date.now() - start;
        // lastAccessedAt は PTY 出力受信のたびに更新される
        const quietFor = Date.now() - session.lastAccessedAt;

        if (elapsed >= SESSION_READY_MAX_WAIT_MS) {
          resolve();
          return;
        }
        if (
          elapsed >= SESSION_READY_MIN_WAIT_MS &&
          quietFor >= SESSION_READY_QUIET_PERIOD_MS
        ) {
          resolve();
          return;
        }
        setTimeout(check, SESSION_READY_POLL_INTERVAL_MS);
      };
      setTimeout(check, SESSION_READY_POLL_INTERVAL_MS);
    });
  }

  /**
   * シグナル送信
   */
  sendSignal(instanceId: string, signal: string): boolean {
    return this.sendInput(instanceId, signal);
  }

  /**
   * リサイズ
   */
  resizeInstance(instanceId: string, cols: number, rows: number): boolean {
    const session = this.activeSessions.get(instanceId);
    if (!session || !session.isActive || !session.process?.resize) return false;

    try {
      session.process.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  // ====================
  // 出力履歴管理
  // ====================

  private addToOutputHistory(
    session: ActiveAiSession,
    content: string,
    type: 'stdout' | 'stderr' | 'system'
  ): AiOutputLine {
    const outputLine: AiOutputLine = {
      id: `${session.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type,
      provider: session.provider,
    };

    let buffer = this.outputBuffers.get(session.instanceId);
    if (!buffer) {
      buffer = new RingBuffer<AiOutputLine>(this.config.maxOutputLines);
      this.outputBuffers.set(session.instanceId, buffer);
    }
    buffer.push(outputLine);
    session.outputHistory = buffer.toArray();

    return outputLine;
  }

  getOutputHistory(instanceId: string): AiOutputLine[] {
    const buffer = this.outputBuffers.get(instanceId);
    if (buffer) return buffer.toArray();
    return [];
  }

  clearOutputHistory(instanceId: string): boolean {
    const buffer = this.outputBuffers.get(instanceId);
    if (buffer) {
      buffer.clear();
    }
    const session = this.activeSessions.get(instanceId);
    if (session) {
      session.outputHistory = [];
    }
    return true;
  }

  // ====================
  // インスタンス取得
  // ====================

  getInstance(instanceId: string): AiInstance | undefined {
    const instance = this.instances.get(instanceId);
    return instance ? { ...instance } : undefined;
  }

  getInstancesByRepo(repositoryPath: string): AiInstance[] {
    return Array.from(this.instances.values())
      .filter((i) => i.repositoryPath === repositoryPath)
      .sort((a, b) => a.order - b.order)
      .map((i) => ({ ...i }));
  }

  getPrimaryInstance(repositoryPath: string): AiInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.repositoryPath === repositoryPath && instance.isPrimary) {
        return instance;
      }
    }
    return undefined;
  }

  getSession(instanceId: string): ActiveAiSession | undefined {
    return this.activeSessions.get(instanceId);
  }

  getSessionById(sessionId: string): ActiveAiSession | undefined {
    const instanceId = this.sessionIdIndex.get(sessionId);
    if (!instanceId) return undefined;
    return this.activeSessions.get(instanceId);
  }

  getInstanceBySessionId(sessionId: string): AiInstance | undefined {
    const instanceId = this.sessionIdIndex.get(sessionId);
    if (!instanceId) return undefined;
    return this.getInstance(instanceId);
  }

  isValidSessionId(sessionId: string): boolean {
    return this.sessionIdIndex.has(sessionId);
  }

  // ====================
  // ユーティリティ
  // ====================

  private getNextOrder(repositoryPath: string, isPrimary: boolean): number {
    if (isPrimary) return 0; // プライマリは常に先頭
    const subs = Array.from(this.instances.values()).filter(
      (i) => i.repositoryPath === repositoryPath && !i.isPrimary
    );
    return subs.length === 0
      ? 1
      : Math.max(...subs.map((i) => i.order)) + 1;
  }

  /**
   * リポジトリ全インスタンスを終了
   */
  async closeAllInstancesByRepo(repositoryPath: string): Promise<number> {
    const targets = this.getInstancesByRepo(repositoryPath);
    let closed = 0;

    for (const inst of targets) {
      await this.terminateSession(inst.instanceId);
      this.instances.delete(inst.instanceId);
      this.outputBuffers.delete(inst.instanceId);
      this.emit('ai-instance-closed', {
        instanceId: inst.instanceId,
        repositoryPath: inst.repositoryPath,
      });
      closed++;
    }

    return closed;
  }

  /**
   * シャットダウン: 全 PTY を kill
   */
  async shutdown(): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    for (const instanceId of this.activeSessions.keys()) {
      tasks.push(this.terminateSession(instanceId));
    }
    await Promise.all(tasks);
    this.instances.clear();
    this.outputBuffers.clear();
  }
}
