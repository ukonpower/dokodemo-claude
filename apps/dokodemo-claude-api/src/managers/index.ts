/**
 * マネージャーモジュールのエクスポート
 */

export { ShortcutManager, type TerminalWriter } from './shortcut-manager.js';
export { CustomAiButtonManager } from './custom-ai-button-manager.js';
export {
  TerminalManager,
  type TerminalOutputLine,
  type PersistedTerminal,
  type ActiveTerminal,
} from './terminal-manager.js';
export {
  PromptQueueManager,
  type QueueAiSessionAdapter,
} from './prompt-queue-manager.js';
export {
  ProcessRegistry,
  type AiSessionRecord,
  type TerminalRecord,
  createSessionKey,
  parseSessionKey,
} from './process-registry.js';
export {
  isPidAlive,
  getDeadAiSessions,
  getAliveAiSessions,
  getDeadTerminals,
  getAliveTerminals,
  generateHealthReport,
  terminateProcess,
  type HealthReport,
} from './process-monitor-utils.js';
export {
  ProcessMonitor,
  type CleanupCallbacks,
  type ProcessMonitorConfig,
} from './process-monitor.js';
export {
  AISessionManager,
  type ActiveAiSession,
  type CreateSessionOptions,
  type EnsureSessionOptions,
  type AISessionManagerConfig,
} from './ai-session-manager.js';
