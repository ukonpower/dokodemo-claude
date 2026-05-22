import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import {
  CommandShortcut,
  AiProvider,
  AiInstance,
  PromptQueueItem,
  PromptQueueState,
  RepoProcessStatus,
  PermissionMode,
  AiExecutionStatus,
  RepoDisplayAiStatus,
} from './types/index.js';

import { PersistenceService } from './services/persistence-service.js';
import {
  ShortcutManager,
  TerminalManager,
  PromptQueueManager,
  ProcessRegistry,
  ProcessMonitor,
  CustomAiButtonManager,
  WorktreeSyncManager,
  AISessionManager,
  type ActiveAiSession,
  type ActiveTerminal,
  type TerminalOutputLine,
} from './managers/index.js';

interface AiExecutionState {
  instanceId: string;
  status: AiExecutionStatus;
}

interface PersistedSelectedProvider {
  repositoryPath: string;
  provider: AiProvider;
  updatedAt: number;
}

/**
 * 永続プロセス管理システム
 * AIインスタンス管理は AISessionManager に委譲する
 */
export class ProcessManager extends EventEmitter {
  private readonly persistenceService: PersistenceService;
  public readonly shortcutManager: ShortcutManager;
  public readonly terminalManager: TerminalManager;
  public readonly promptQueueManager: PromptQueueManager;
  public readonly customAiButtonManager: CustomAiButtonManager;
  public readonly worktreeSyncManager: WorktreeSyncManager;

  public readonly processRegistry: ProcessRegistry;
  public readonly processMonitor: ProcessMonitor;
  public readonly aiSessionManager: AISessionManager;

  // 実行状態: instanceId キー
  private aiExecutionStates: Map<string, AiExecutionState> = new Map();
  private selectedProviders: Map<string, PersistedSelectedProvider> = new Map();
  private processesDir: string;
  private selectedProvidersFile = 'repo-provider-preferences.json';

  private processMonitoringInterval: NodeJS.Timeout | null = null;

  constructor(processesDir: string) {
    super();
    this.processesDir = processesDir;

    this.persistenceService = new PersistenceService(processesDir);
    this.processRegistry = new ProcessRegistry();
    this.aiSessionManager = new AISessionManager(this.processRegistry);

    // AISessionManager のイベントを ProcessManager 経由で再 emit
    this.aiSessionManager.on('ai-output', (data) =>
      this.emit('ai-output', data)
    );
    this.aiSessionManager.on('ai-exit', (data) => this.emit('ai-exit', data));
    this.aiSessionManager.on('ai-session-created', (data) =>
      this.emit('ai-session-created', data)
    );
    this.aiSessionManager.on('ai-instance-created', (data) =>
      this.emit('ai-instance-created', data)
    );
    this.aiSessionManager.on('ai-instance-updated', (data) =>
      this.emit('ai-instance-updated', data)
    );
    this.aiSessionManager.on('ai-instance-closed', (data) =>
      this.emit('ai-instance-closed', data)
    );

    this.processMonitor = new ProcessMonitor(this.processRegistry, {
      onAiSessionCleaned: (sessionId, repositoryPath) => {
        this.emit('ai-session-cleaned', { sessionId, repositoryPath });
      },
      onTerminalCleaned: (terminalId, repositoryPath) => {
        this.emit('terminal-cleaned', { terminalId, repositoryPath });
      },
    });

    this.terminalManager = new TerminalManager(this.persistenceService);
    this.terminalManager.on('terminal-created', (data) =>
      this.emit('terminal-created', data)
    );
    this.terminalManager.on('terminal-output', (data) =>
      this.emit('terminal-output', data)
    );
    this.terminalManager.on('terminal-exit', (data) =>
      this.emit('terminal-exit', data)
    );

    this.shortcutManager = new ShortcutManager(this.persistenceService, {
      writeToTerminal: (terminalId: string, data: string) => {
        return this.sendToTerminal(terminalId, data);
      },
    });

    this.customAiButtonManager = new CustomAiButtonManager(
      this.persistenceService
    );

    // WorktreeSyncManager: 親リポジトリごとに worktree 作成時の同期設定を保持
    this.worktreeSyncManager = new WorktreeSyncManager(this.persistenceService);

    // PromptQueueManager: プライマリインスタンスのセッションを返すアダプター
    this.promptQueueManager = new PromptQueueManager(this.persistenceService, {
      getSession: (repositoryPath: string, provider) => {
        const primary = this.aiSessionManager.getPrimaryInstance(
          repositoryPath
        );
        if (!primary || primary.provider !== provider || !primary.sessionId)
          return null;
        return {
          id: primary.sessionId,
          repositoryPath,
          provider,
        };
      },
      sendCommand: (sessionId: string, command: string) => {
        this.aiSessionManager.sendInputBySessionId(sessionId, command);
      },
      ensureSession: async (repositoryPath: string, provider: AiProvider) => {
        const repositoryName = path.basename(repositoryPath);
        const primary = this.aiSessionManager.getPrimaryInstance(
          repositoryPath
        );

        if (primary && primary.provider !== provider) {
          // プライマリの provider を強制的に合わせる
          const { instance, session } =
            await this.aiSessionManager.switchPrimaryProvider(
              repositoryPath,
              provider,
              repositoryName
            );
          return {
            id: session.id,
            repositoryPath: instance.repositoryPath,
            provider: instance.provider,
          };
        }

        const { instance, session } =
          await this.aiSessionManager.ensurePrimaryInstance(
            repositoryPath,
            repositoryName,
            provider
          );
        return {
          id: session.id,
          repositoryPath: instance.repositoryPath,
          provider: instance.provider,
        };
      },
      getSessionStatus: (sessionId: string) => {
        const session = this.aiSessionManager.getSessionById(sessionId);
        return session ? { isActive: session.isActive } : null;
      },
      isPrimaryAiBusy: (repositoryPath: string, provider: AiProvider) => {
        const primary = this.aiSessionManager.getPrimaryInstance(
          repositoryPath
        );
        if (!primary || primary.provider !== provider) return false;
        return this.getAiExecutionStatus(primary.instanceId) === 'running';
      },
    });
    this.promptQueueManager.on('prompt-queue-updated', (data) =>
      this.emit('prompt-queue-updated', data)
    );
    this.promptQueueManager.on('prompt-queue-processing-started', (data) =>
      this.emit('prompt-queue-processing-started', data)
    );
    this.promptQueueManager.on('prompt-queue-processing-completed', (data) =>
      this.emit('prompt-queue-processing-completed', data)
    );
  }

  // ====================
  // プロバイダー選択
  // ====================

  private async loadSelectedProviders(): Promise<void> {
    const result = await this.persistenceService.loadMap<
      string,
      PersistedSelectedProvider
    >(
      this.selectedProvidersFile,
      (value) => value as PersistedSelectedProvider
    );

    if (!result.ok || result.value === null) {
      this.selectedProviders = new Map();
      return;
    }

    this.selectedProviders = result.value;
  }

  private async persistSelectedProviders(): Promise<void> {
    const result = await this.persistenceService.saveMap(
      this.selectedProvidersFile,
      this.selectedProviders
    );

    if (!result.ok) {
      console.error(
        '[ProcessManager] 選択中プロバイダーの保存に失敗:',
        result.error
      );
    }
  }

  getSelectedProvider(repositoryPath: string): AiProvider {
    return this.selectedProviders.get(repositoryPath)?.provider ?? 'claude';
  }

  async setSelectedProvider(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    const current = this.getSelectedProvider(repositoryPath);
    if (current === provider) {
      return;
    }

    this.selectedProviders.set(repositoryPath, {
      repositoryPath,
      provider,
      updatedAt: Date.now(),
    });

    await this.persistSelectedProviders();
    this.emit('selected-provider-changed', {
      repositoryPath,
      provider,
    });
  }

  // ====================
  // 実行状態（instanceId キー）
  // ====================

  getAiExecutionStatus(instanceId: string): AiExecutionStatus {
    return this.aiExecutionStates.get(instanceId)?.status ?? 'idle';
  }

  setAiExecutionStatus(instanceId: string, status: AiExecutionStatus): void {
    const current = this.aiExecutionStates.get(instanceId)?.status ?? 'idle';
    if (current === status) return;

    if (status === 'idle') {
      this.aiExecutionStates.delete(instanceId);
    } else {
      this.aiExecutionStates.set(instanceId, { instanceId, status });
    }

    const instance = this.aiSessionManager.getInstance(instanceId);
    this.emit('ai-execution-status-changed', {
      instanceId,
      status,
      repositoryPath: instance?.repositoryPath,
      provider: instance?.provider,
    });
  }

  /**
   * リポジトリ内全インスタンスの completed → idle にリセット
   */
  resetCompletedAiExecutionStatuses(repositoryPath: string): void {
    const instances = this.aiSessionManager.getInstancesByRepo(repositoryPath);
    for (const instance of instances) {
      if (this.getAiExecutionStatus(instance.instanceId) === 'completed') {
        this.setAiExecutionStatus(instance.instanceId, 'idle');
      }
    }
  }

  // ====================
  // 初期化／ライフサイクル
  // ====================

  async initialize(): Promise<void> {
    await this.ensureProcessesDir();
    await this.loadSelectedProviders();
    await this.shortcutManager.initialize();
    await this.promptQueueManager.initialize();
    await this.customAiButtonManager.initialize();
    await this.worktreeSyncManager.initialize();

    this.startProcessMonitoring();
  }

  private async ensureProcessesDir(): Promise<void> {
    try {
      await fs.access(this.processesDir);
    } catch {
      await fs.mkdir(this.processesDir, { recursive: true });
    }
  }

  private startProcessMonitoring(): void {
    this.processMonitoringInterval = setInterval(async () => {
      await this.cleanupDeadProcesses();
    }, 30000);
  }

  private async cleanupDeadProcesses(): Promise<void> {
    const cleanedTerminals = this.terminalManager.cleanupDeadProcesses();
    for (const { terminalId, repositoryPath } of cleanedTerminals) {
      this.emit('terminal-cleaned', { terminalId, repositoryPath });
    }
  }

  // ====================
  // ターミナル（委譲）
  // ====================

  async createTerminal(
    repositoryPath: string,
    repositoryName: string,
    name?: string,
    initialSize?: { cols: number; rows: number }
  ): Promise<ActiveTerminal> {
    const result = await this.terminalManager.createTerminal(
      repositoryPath,
      repositoryName,
      name,
      initialSize
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value;
  }

  sendToTerminal(terminalId: string, input: string): boolean {
    const result = this.terminalManager.sendToTerminal(terminalId, input);
    return result.ok;
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
    const result = this.terminalManager.resizeTerminal(terminalId, cols, rows);
    return result.ok;
  }

  sendSignalToTerminal(terminalId: string, signal: string): boolean {
    const result = this.terminalManager.sendSignalToTerminal(
      terminalId,
      signal
    );
    return result.ok;
  }

  async closeTerminal(terminalId: string): Promise<boolean> {
    const result = await this.terminalManager.closeTerminal(terminalId);
    return result.ok;
  }

  getTerminalsByRepository(repositoryPath: string): ActiveTerminal[] {
    return this.terminalManager.getTerminalsByRepository(repositoryPath);
  }

  getAllTerminals(): ActiveTerminal[] {
    return this.terminalManager.getAllTerminals();
  }

  getTerminalOutputHistory(terminalId: string): TerminalOutputLine[] {
    return this.terminalManager.getTerminalOutputHistory(terminalId);
  }

  // ====================
  // AI インスタンス操作（AISessionManager に委譲する薄いラッパー）
  // ====================

  async ensurePrimaryInstance(
    repositoryPath: string,
    provider: AiProvider,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
    const repositoryName = path.basename(repositoryPath);
    return await this.aiSessionManager.ensurePrimaryInstance(
      repositoryPath,
      repositoryName,
      provider,
      options
    );
  }

  async switchPrimaryProvider(
    repositoryPath: string,
    provider: AiProvider,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
    const repositoryName = path.basename(repositoryPath);
    return await this.aiSessionManager.switchPrimaryProvider(
      repositoryPath,
      provider,
      repositoryName,
      options
    );
  }

  async createSubInstance(
    repositoryPath: string,
    provider: AiProvider,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
      displayName?: string;
    }
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
    const repositoryName = path.basename(repositoryPath);
    return await this.aiSessionManager.createInstance({
      repositoryPath,
      repositoryName,
      provider,
      isPrimary: false,
      displayName: options?.displayName,
      initialSize: options?.initialSize,
      permissionMode: options?.permissionMode,
    });
  }

  async restartInstance(
    instanceId: string,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{ instance: AiInstance; session: ActiveAiSession } | null> {
    const instance = this.aiSessionManager.getInstance(instanceId);
    if (!instance) return null;
    const repositoryName = path.basename(instance.repositoryPath);
    return await this.aiSessionManager.restartInstance(
      instanceId,
      repositoryName,
      options
    );
  }

  async closeInstance(instanceId: string): Promise<boolean> {
    return await this.aiSessionManager.closeInstance(instanceId);
  }

  sendToInstance(instanceId: string, input: string): boolean {
    return this.aiSessionManager.sendInput(instanceId, input);
  }

  sendSignalToInstance(instanceId: string, signal: string): boolean {
    return this.aiSessionManager.sendSignal(instanceId, signal);
  }

  resizeInstance(instanceId: string, cols: number, rows: number): boolean {
    return this.aiSessionManager.resizeInstance(instanceId, cols, rows);
  }

  // ====================
  // リポジトリプロセスクリーンアップ
  // ====================

  async cleanupRepositoryProcesses(repositoryPath: string): Promise<void> {
    const instances = this.aiSessionManager.getInstancesByRepo(repositoryPath);
    for (const instance of instances) {
      try {
        // closeInstance はプライマリで throw するので、まずは強制 close 用に session だけ kill
        if (instance.isPrimary) {
          // プライマリは PTY を落とすが instance レコードは消えない
          // 完全削除のためにフラグを書き換えてから close
          const internal = this.aiSessionManager.getInstance(
            instance.instanceId
          );
          if (internal) {
            // 直接的な強制削除パスが必要なので closeAllInstancesByRepo を使う
          }
        }
      } catch {
        // ignore
      }
      this.aiExecutionStates.delete(instance.instanceId);
    }

    // まとめて削除
    await this.aiSessionManager.closeAllInstancesByRepo(repositoryPath);

    const repoTerminals =
      this.terminalManager.getTerminalsByRepository(repositoryPath);
    await Promise.all(repoTerminals.map((t) => this.closeTerminal(t.id)));

    await this.cleanupRepositoryShortcuts(repositoryPath);
    await this.cleanupRepositoryPromptQueues(repositoryPath);
  }

  async stopRepositoryProcesses(repositoryPath: string): Promise<{
    aiSessionsClosed: number;
    terminalsClosed: number;
    success: boolean;
  }> {
    const aiSessionsClosed =
      await this.aiSessionManager.closeAllInstancesByRepo(repositoryPath);

    const repoTerminals =
      this.terminalManager.getTerminalsByRepository(repositoryPath);
    let terminalsClosed = 0;
    await Promise.all(
      repoTerminals.map((t) =>
        this.closeTerminal(t.id).then((ok) => {
          if (ok) terminalsClosed++;
        })
      )
    );

    const providers: AiProvider[] = ['claude', 'codex'];
    for (const provider of providers) {
      await this.pausePromptQueue(repositoryPath, provider);
    }

    // インスタンスごとの実行状態クリア（全クリア相当: 残ってないため）
    for (const [instanceId] of this.aiExecutionStates) {
      this.aiExecutionStates.delete(instanceId);
    }

    return { aiSessionsClosed, terminalsClosed, success: true };
  }

  // ====================
  // RepoProcessStatus
  // ====================

  getRepositoryProcessStatus(
    repositoryPath: string,
    rid: string
  ): RepoProcessStatus {
    const instances = this.aiSessionManager.getInstancesByRepo(repositoryPath);
    const primary = instances.find((i) => i.isPrimary);

    const primaryProvider = primary?.provider;
    const primaryStatus = primary
      ? this.getAiExecutionStatus(primary.instanceId)
      : undefined;

    const selectedProvider = this.getSelectedProvider(repositoryPath);

    const terminals =
      this.terminalManager.getTerminalsByRepository(repositoryPath).length;

    let promptQueuePending = 0;
    const providers: AiProvider[] = ['claude', 'codex'];
    for (const provider of providers) {
      const queue = this.promptQueueManager.getQueue(repositoryPath, provider);
      promptQueuePending += queue.filter((i) => i.status === 'pending').length;
    }

    let displayAiStatus: RepoDisplayAiStatus = 'ready';
    if (primaryStatus === 'running') {
      displayAiStatus = 'running';
    } else if (primaryStatus === 'completed') {
      displayAiStatus = 'done';
    }

    const displayProvider = primaryProvider ?? selectedProvider;

    return {
      rid,
      repositoryPath,
      aiInstancesTotal: instances.length,
      terminals,
      promptQueuePending,
      selectedProvider,
      primaryProvider,
      primaryStatus,
      displayAiStatus,
      displayProvider,
    };
  }

  getAllRepositoriesProcessStatus(
    repositoryPaths: { path: string; rid: string }[]
  ): RepoProcessStatus[] {
    return repositoryPaths.map(({ path, rid }) =>
      this.getRepositoryProcessStatus(path, rid)
    );
  }

  // ====================
  // コマンドショートカット（委譲）
  // ====================

  async createShortcut(
    name: string | undefined,
    command: string,
    repositoryPath: string
  ): Promise<CommandShortcut> {
    const result = await this.shortcutManager.createShortcut(
      name,
      command,
      repositoryPath
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value;
  }

  async deleteShortcut(shortcutId: string): Promise<boolean> {
    const result = await this.shortcutManager.deleteShortcut(shortcutId);
    return result.ok;
  }

  getShortcutsByRepository(repositoryPath: string): CommandShortcut[] {
    return this.shortcutManager.getShortcutsByRepository(repositoryPath);
  }

  executeShortcut(shortcutId: string, terminalId: string): boolean {
    const terminal = this.terminalManager.getTerminal(terminalId);
    const repositoryPath = terminal?.repositoryPath;
    const result = this.shortcutManager.executeShortcut(
      shortcutId,
      terminalId,
      repositoryPath
    );
    return result.ok && result.value;
  }

  async cleanupRepositoryShortcuts(repositoryPath: string): Promise<void> {
    await this.shortcutManager.cleanupRepositoryShortcuts(repositoryPath);
  }

  // ====================
  // システム終了時
  // ====================

  async shutdown(): Promise<void> {
    if (this.processMonitoringInterval) {
      clearInterval(this.processMonitoringInterval);
      this.processMonitoringInterval = null;
    }

    await this.aiSessionManager.shutdown();
    await this.terminalManager.shutdown();
    await this.shortcutManager.shutdown();
  }

  // ====================
  // プロンプトキュー（委譲）
  // ====================

  async addToPromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    prompt: string,
    sendClearBefore?: boolean,
    isAutoCommit?: boolean,
    model?: string,
    isCodexReview?: boolean
  ): Promise<PromptQueueItem> {
    const result = await this.promptQueueManager.addToQueue(
      repositoryPath,
      provider,
      prompt,
      { sendClearBefore, isAutoCommit, model, isCodexReview }
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    return result.value;
  }

  async triggerQueueFromHook(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.triggerFromHook(repositoryPath, provider);
  }

  getPromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): PromptQueueItem[] {
    return this.promptQueueManager.getQueue(repositoryPath, provider);
  }

  getPromptQueueState(
    repositoryPath: string,
    provider: AiProvider
  ): PromptQueueState | undefined {
    return this.promptQueueManager.getQueueState(repositoryPath, provider);
  }

  async removeFromPromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<boolean> {
    const result = await this.promptQueueManager.removeFromQueue(
      repositoryPath,
      provider,
      itemId
    );
    return result.ok;
  }

  async requeuePromptItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<boolean> {
    const result = await this.promptQueueManager.requeueItem(
      repositoryPath,
      provider,
      itemId
    );
    return result.ok;
  }

  async forceSendPromptItem(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string
  ): Promise<boolean> {
    const result = await this.promptQueueManager.forceSendItem(
      repositoryPath,
      provider,
      itemId
    );
    return result.ok;
  }

  async clearPromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.clearQueue(repositoryPath, provider);
  }

  async pausePromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.pauseQueue(repositoryPath, provider);
  }

  async resumePromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.resumeQueue(repositoryPath, provider);
  }

  async cancelCurrentQueueItem(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<boolean> {
    const result = await this.promptQueueManager.cancelCurrentItem(
      repositoryPath,
      provider
    );

    if (result.ok) {
      return true;
    }

    console.error(
      `[${provider}] キューアイテムのキャンセルに失敗:`,
      result.error.message
    );
    return false;
  }

  async reorderPromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    reorderedQueue: PromptQueueItem[]
  ): Promise<void> {
    const itemIds = reorderedQueue.map((item) => item.id);
    await this.promptQueueManager.reorderQueue(
      repositoryPath,
      provider,
      itemIds
    );
  }

  async updatePromptQueue(
    repositoryPath: string,
    provider: AiProvider,
    itemId: string,
    prompt?: string,
    sendClearBefore?: boolean,
    isAutoCommit?: boolean,
    model?: string,
    isCodexReview?: boolean
  ): Promise<boolean> {
    const result = await this.promptQueueManager.updateItem(
      repositoryPath,
      provider,
      itemId,
      { prompt, sendClearBefore, isAutoCommit, model, isCodexReview }
    );
    return result.ok && result.value;
  }

  async resetPromptQueue(
    repositoryPath: string,
    provider: AiProvider
  ): Promise<void> {
    await this.promptQueueManager.resetQueue(repositoryPath, provider);
  }

  async cleanupRepositoryPromptQueues(repositoryPath: string): Promise<void> {
    await this.promptQueueManager.cleanupRepository(repositoryPath);
  }
}
