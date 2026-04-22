import path from 'path';
import type { HandlerContext, TypedSocket } from './types.js';
import type { AiProvider, AiOutputLine } from '../types/index.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { emitIdMappingUpdated } from './id-mapping-helpers.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';

/**
 * システムメッセージをai-output-line形式で送信するヘルパー関数
 */
function emitSystemMessage(
  socket: TypedSocket,
  content: string,
  options?: {
    sessionId?: string;
    rid?: string;
    provider?: AiProvider;
  }
): void {
  const provider = options?.provider || 'claude';
  const outputLine: AiOutputLine = {
    id: `system-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    content,
    timestamp: Date.now(),
    type: 'system',
    provider,
  };

  socket.emit('ai-output-line', {
    sessionId: options?.sessionId || '',
    rid: options?.rid || '',
    provider,
    outputLine,
  });
}

/**
 * AIセッション関連のSocket.IOイベントハンドラーを登録
 */
export function registerAiSessionHandlers(ctx: HandlerContext): void {
  const { io, socket, processManager, setClientActiveRepository } = ctx;

  // リポジトリの切り替え
  socket.on('switch-repo', async (data) => {
    const { path: repoPath, provider, initialSize, permissionMode } = data;

    setClientActiveRepository(socket.id, repoPath || '');

    if (!repoPath) {
      return;
    }

    try {
      const repoName = path.basename(repoPath);
      const effectiveProvider =
        provider ?? processManager.getSelectedProvider(repoPath);

      if (provider) {
        await processManager.setSelectedProvider(repoPath, provider);
      }

      const session = await processManager.getOrCreateAiSession(
        repoPath,
        repoName,
        effectiveProvider,
        initialSize,
        permissionMode
      );

      // リポジトリIDを取得（パスから決定的に算出）
      const rid = repositoryIdManager.getId(repoPath);

      // 全クライアントに最新の id-mapping を通知
      void emitIdMappingUpdated(io, ctx.repositories);

      processManager.resetCompletedAiExecutionStatuses(repoPath);

      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath} (${effectiveProvider})`,
        currentPath: repoPath,
        rid,
        sessionId: session.id,
        provider: effectiveProvider,
      });

      // 出力履歴を送信
      try {
        const outputHistory = await processManager.getAiOutputHistory(
          repoPath,
          effectiveProvider
        );
        socket.emit('ai-output-history', {
          rid,
          history: outputHistory,
          provider: effectiveProvider,
        });
      } catch {
        // Failed to get output history
      }

      // プロンプトキューの状態を送信
      try {
        const queueState = processManager.getPromptQueueState(
          repoPath,
          effectiveProvider
        );
        if (queueState) {
          socket.emit('prompt-queue-updated', {
            rid,
            provider: effectiveProvider,
            queue: queueState.queue,
            isProcessing: queueState.isProcessing,
            isPaused: queueState.isPaused,
            currentItemId: queueState.currentItemId,
          });
        }
      } catch {
        // Failed to get queue state
      }
    } catch {
      socket.emit('repo-switched', {
        success: false,
        message: `リポジトリの切り替えに失敗しました`,
        currentPath: '',
      });
    }
  });

  // AI CLIへのコマンド送信
  socket.on('send-command', async (data) => {
    const {
      command,
      sessionId,
      rid,
      repositoryPath: rawRepositoryPath,
      provider = 'claude',
    } = data;

    // ridまたはrepositoryPathからパスを解決
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawRepositoryPath,
    });

    let targetSessionId: string | undefined = sessionId;

    // sessionIdが渡された場合、有効性をチェック
    if (
      targetSessionId &&
      !processManager.isValidAiSessionId(targetSessionId)
    ) {
      // 無効なsessionIdは無視してrepositoryPathから再検索
      targetSessionId = undefined;
    }

    if (!targetSessionId && repositoryPath) {
      const session = processManager.getAiSessionByRepository(
        repositoryPath,
        provider
      );
      if (session) {
        targetSessionId = session.id;

        // フロントエンドに正しいsessionIdを通知
        const rid = repositoryIdManager.tryGetId(repositoryPath) || '';
        socket.emit('ai-session-id-updated', {
          rid,
          provider,
          sessionId: targetSessionId,
        });
      }
    }

    if (!targetSessionId) {
      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      emitSystemMessage(
        socket,
        `${providerName}セッションが開始されていません。リポジトリを選択してください。\n`,
        { provider }
      );
      return;
    }

    const success = processManager.sendToAiSession(targetSessionId, command);

    if (!success) {
      emitSystemMessage(
        socket,
        `CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`,
        { provider }
      );
      return;
    }
  });

  // AI CLIへのCtrl+C中断送信
  socket.on('ai-interrupt', (data) => {
    const {
      sessionId,
      rid,
      repositoryPath: rawRepositoryPath,
      provider = 'claude',
    } = data || {};

    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawRepositoryPath,
    });

    let targetSessionId = sessionId;

    if (!targetSessionId && repositoryPath) {
      const session = processManager.getAiSessionByRepository(
        repositoryPath,
        provider
      );
      if (session) {
        targetSessionId = session.id;
      }
    }

    if (!targetSessionId) {
      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      emitSystemMessage(
        socket,
        `${providerName}セッションが開始されていません。\n`,
        { provider }
      );
      return;
    }

    const success = processManager.sendSignalToAiSession(
      targetSessionId,
      '\x03'
    );
    if (!success) {
      emitSystemMessage(
        socket,
        `CLIセッションエラー: セッション ${targetSessionId} が見つかりません\n`,
        { provider }
      );
    }
  });

  // AI CLI履歴の取得
  socket.on('get-ai-history', async (data) => {
    const { rid, repositoryPath: rawRepositoryPath, provider } = data;

    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawRepositoryPath,
    });

    if (!repositoryPath || !provider) {
      return;
    }

    // リクエストで受け取ったridを優先使用（ワークツリー対応）
    const responseRid =
      rid || repositoryIdManager.tryGetId(repositoryPath) || '';

    try {
      const outputHistory = await processManager.getAiOutputHistory(
        repositoryPath,
        provider
      );
      socket.emit('ai-output-history', {
        rid: responseRid,
        history: outputHistory,
        provider,
      });
    } catch {
      socket.emit('ai-output-history', {
        rid: responseRid,
        history: [],
        provider,
      });
    }
  });

  // AI出力履歴のクリア
  socket.on('clear-ai-output', async (data) => {
    const { rid, repositoryPath: rawRepositoryPath, provider } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawRepositoryPath,
    });
    if (!repositoryPath || !provider) {
      return;
    }
    try {
      const success = await processManager.clearAiOutputHistory(
        repositoryPath,
        provider
      );
      if (success) {
        const resolvedRid = repositoryIdManager.tryGetId(repositoryPath) || '';
        socket.emit('ai-output-cleared', {
          rid: resolvedRid,
          provider,
          success: true,
        });
      }
    } catch {
      // エラーは無視
    }
  });

  // AI CLIの再起動
  socket.on('restart-ai-cli', async (data) => {
    const {
      rid,
      repositoryPath: rawRepositoryPath,
      provider,
      initialSize,
      permissionMode,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawRepositoryPath,
    });
    if (!repositoryPath || !provider) {
      return;
    }

    try {
      const repoName = path.basename(repositoryPath);
      const session = await processManager.ensureAiSession(
        repositoryPath,
        repoName,
        provider,
        { forceRestart: true, initialSize, permissionMode }
      );

      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      const rid = repositoryIdManager.tryGetId(repositoryPath) || '';

      socket.emit('ai-restarted', {
        success: true,
        message: `${providerName}を再起動しました`,
        rid,
        provider,
        sessionId: session.id,
      });

      emitSystemMessage(socket, `\n=== ${providerName}を再起動しました ===\n`, {
        rid,
        provider,
      });
    } catch {
      const providerName = provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      const rid = repositoryIdManager.tryGetId(repositoryPath) || '';

      socket.emit('ai-restarted', {
        success: false,
        message: `${providerName}の再起動に失敗しました`,
        rid,
        provider,
      });

      emitSystemMessage(
        socket,
        `\n=== ${providerName}の再起動に失敗しました ===\n`,
        { rid, provider }
      );
    }
  });

  // AI CLIのリサイズ
  socket.on('ai-resize', (data) => {
    const {
      rid,
      repositoryPath: rawRepositoryPath,
      provider,
      cols,
      rows,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawRepositoryPath,
    });
    if (repositoryPath) {
      processManager.resizeAiSession(repositoryPath, provider, cols, rows);
    }
  });
}
