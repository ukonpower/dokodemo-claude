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
import { EventEmitter } from 'events';
import {
  AiProvider,
  AiOutputLine,
  AiInstance,
  PermissionMode,
} from '../types/index.js';
import { RingBuffer } from '../utils/ring-buffer.js';
import { cleanChildEnv, getDokodemoApiBaseUrl } from '../utils/clean-env.js';
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
  maxOutputLines: 500,
  gracefulTerminationTimeoutMs: 2000,
};

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
        if (permissionMode === 'dangerous' || permissionMode === undefined) {
          args.push('--dangerously-skip-permissions');
        } else if (permissionMode === 'auto') {
          args.push('--permission-mode', 'acceptEdits', '--enable-auto-mode');
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

    const aiProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: options.initialSize?.cols ?? 120,
      rows: options.initialSize?.rows ?? 30,
      cwd: instance.repositoryPath,
      env: cleanChildEnv({
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
        CLAUDECODE: undefined,
        DOKODEMO_API_BASE_URL: getDokodemoApiBaseUrl(),
      }),
    });

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
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
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
      return { instance: primary, session };
    }

    return await this.createInstance({
      repositoryPath,
      repositoryName,
      provider,
      isPrimary: true,
      initialSize: options?.initialSize,
      permissionMode: options?.permissionMode,
    });
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
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
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
        return { instance: primary, session: existing };
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

    return { instance: primary, session };
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
