import path from 'path';
import type { HandlerContext, TypedServer, TypedSocket } from './types.js';
import type { AiProvider, AiOutputLine } from '../types/index.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { emitIdMappingUpdated } from './id-mapping-helpers.js';

/**
 * リポジトリパスから rid を解決
 */
function resolveRid(repositoryPath: string): string {
  return repositoryIdManager.tryGetId(repositoryPath) || '';
}

/**
 * システムメッセージを ai-output-line として送信
 */
function emitSystemMessage(
  socket: TypedSocket,
  content: string,
  options: { rid: string; instanceId: string; provider: AiProvider }
): void {
  const outputLine: AiOutputLine = {
    id: `system-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    content,
    timestamp: Date.now(),
    type: 'system',
    provider: options.provider,
  };

  socket.emit('ai-output-line', {
    rid: options.rid,
    instanceId: options.instanceId,
    provider: options.provider,
    outputLine,
  });
}

/**
 * インスタンス一覧を broadcast
 */
function broadcastInstancesList(
  io: TypedServer,
  processManager: HandlerContext['processManager'],
  repositoryPath: string
): void {
  const rid = resolveRid(repositoryPath);
  if (!rid) return;
  const instances = processManager.aiSessionManager.getInstancesByRepo(
    repositoryPath
  );
  io.emit('ai-instances-list', { rid, instances });
}

/**
 * AIセッション関連の Socket.IO イベントハンドラーを登録
 */
export function registerAiSessionHandlers(ctx: HandlerContext): void {
  const { io, socket, processManager, setClientActiveRepository } = ctx;

  // リポジトリの切り替え（プライマリ確保 + provider 切替）
  socket.on('switch-repo', async (data) => {
    const { path: repoPath, provider, initialSize, permissionMode } = data;

    setClientActiveRepository(socket.id, repoPath || '');

    if (!repoPath) return;

    try {
      const targetProvider =
        provider ?? processManager.getSelectedProvider(repoPath);
      if (provider) {
        await processManager.setSelectedProvider(repoPath, provider);
      }

      // プライマリが既にあって provider が異なる場合は切替、無ければ確保
      const existingPrimary =
        processManager.aiSessionManager.getPrimaryInstance(repoPath);
      let primary;
      let session;
      if (existingPrimary && existingPrimary.provider !== targetProvider) {
        const r = await processManager.switchPrimaryProvider(
          repoPath,
          targetProvider,
          { initialSize, permissionMode }
        );
        primary = r.instance;
        session = r.session;
      } else {
        const r = await processManager.ensurePrimaryInstance(
          repoPath,
          targetProvider,
          { initialSize, permissionMode }
        );
        primary = r.instance;
        session = r.session;
      }

      const rid = repositoryIdManager.getId(repoPath);
      void emitIdMappingUpdated(io, ctx.repositories);

      processManager.resetCompletedAiExecutionStatuses(repoPath);

      socket.emit('repo-switched', {
        success: true,
        message: `リポジトリを切り替えました: ${repoPath} (${targetProvider})`,
        currentPath: repoPath,
        rid,
        primaryInstanceId: primary.instanceId,
        primaryProvider: primary.provider,
      });

      // 全クライアントへインスタンス一覧を broadcast
      broadcastInstancesList(io, processManager, repoPath);

      // プライマリの出力履歴を送信
      try {
        const history = processManager.aiSessionManager.getOutputHistory(
          primary.instanceId
        );
        socket.emit('ai-output-history', {
          rid,
          instanceId: primary.instanceId,
          provider: primary.provider,
          history,
        });
      } catch {
        // ignore
      }

      // プロンプトキュー（プライマリ用）の状態を送信
      try {
        const queueState = processManager.getPromptQueueState(
          repoPath,
          primary.provider
        );
        if (queueState) {
          socket.emit('prompt-queue-updated', {
            rid,
            provider: primary.provider,
            queue: queueState.queue,
            isProcessing: queueState.isProcessing,
            isPaused: queueState.isPaused,
            currentItemId: queueState.currentItemId,
          });
        }
      } catch {
        // ignore
      }

      // session 変数は spawn 完了を呼び出し側に通知するためだけに使うので参照のみ
      void session;
    } catch (error) {
      console.error('[switch-repo] failed:', error);
      socket.emit('repo-switched', {
        success: false,
        message: `リポジトリの切り替えに失敗しました`,
        currentPath: '',
      });
    }
  });

  // インスタンス一覧の明示的な取得
  socket.on('list-ai-instances', (data) => {
    const { rid } = data;
    try {
      const repoPath = repositoryIdManager.getPath(rid);
      const instances =
        processManager.aiSessionManager.getInstancesByRepo(repoPath);
      socket.emit('ai-instances-list', { rid, instances });
    } catch {
      // 存在しない rid
    }
  });

  // サブインスタンス作成
  socket.on('create-ai-instance', async (data) => {
    const { rid, provider, initialSize, permissionMode } = data;
    try {
      const repositoryPath = repositoryIdManager.getPath(rid);
      const { instance } = await processManager.createSubInstance(
        repositoryPath,
        provider,
        { initialSize, permissionMode }
      );

      // broadcast でタブ追加を全クライアントへ
      broadcastInstancesList(io, processManager, repositoryPath);

      // 履歴は空なので送信不要だが、初期 ai-output-history を返しておく
      socket.emit('ai-output-history', {
        rid,
        instanceId: instance.instanceId,
        provider: instance.provider,
        history: [],
      });
    } catch (error) {
      console.error('[create-ai-instance] failed:', error);
    }
  });

  // サブインスタンスを閉じる
  socket.on('close-ai-instance', async (data) => {
    const { instanceId } = data;
    const instance =
      processManager.aiSessionManager.getInstance(instanceId);
    if (!instance) return;
    if (instance.isPrimary) return; // プライマリは閉じられない

    try {
      await processManager.closeInstance(instanceId);
      broadcastInstancesList(io, processManager, instance.repositoryPath);
    } catch (error) {
      console.error('[close-ai-instance] failed:', error);
    }
  });

  // 表示名を変更
  socket.on('rename-ai-instance', (data) => {
    const { instanceId, displayName } = data;
    const instance =
      processManager.aiSessionManager.getInstance(instanceId);
    if (!instance) return;
    processManager.aiSessionManager.renameInstance(instanceId, displayName);
    broadcastInstancesList(io, processManager, instance.repositoryPath);
  });

  // コマンド送信
  socket.on('send-command', (data) => {
    const { command, instanceId } = data;
    const instance =
      processManager.aiSessionManager.getInstance(instanceId);
    if (!instance) {
      console.warn('[send-command] instance not found:', instanceId);
      return;
    }
    const success = processManager.sendToInstance(instanceId, command);
    if (!success) {
      emitSystemMessage(socket, `CLIセッションエラー: 入力に失敗しました\n`, {
        rid: resolveRid(instance.repositoryPath),
        instanceId,
        provider: instance.provider,
      });
    }
  });

  // 中断（Ctrl+C）
  socket.on('ai-interrupt', (data) => {
    const { instanceId } = data;
    if (!instanceId) return;
    processManager.sendSignalToInstance(instanceId, '\x03');
  });

  // 履歴取得
  socket.on('get-ai-history', (data) => {
    const { instanceId } = data;
    const instance =
      processManager.aiSessionManager.getInstance(instanceId);
    if (!instance) return;
    const rid = resolveRid(instance.repositoryPath);
    const history =
      processManager.aiSessionManager.getOutputHistory(instanceId);
    socket.emit('ai-output-history', {
      rid,
      instanceId,
      provider: instance.provider,
      history,
    });
  });

  // 履歴クリア
  socket.on('clear-ai-output', (data) => {
    const { instanceId } = data;
    const instance =
      processManager.aiSessionManager.getInstance(instanceId);
    if (!instance) return;
    processManager.aiSessionManager.clearOutputHistory(instanceId);
    const rid = resolveRid(instance.repositoryPath);
    socket.emit('ai-output-cleared', {
      rid,
      instanceId,
      provider: instance.provider,
      success: true,
    });
  });

  // CLI 再起動（同一 instanceId、PTY だけ作り直し）
  socket.on('restart-ai-cli', async (data) => {
    const { instanceId, initialSize, permissionMode } = data;
    const instance =
      processManager.aiSessionManager.getInstance(instanceId);
    if (!instance) return;

    try {
      const result = await processManager.restartInstance(instanceId, {
        initialSize,
        permissionMode,
      });
      if (!result) return;

      const rid = resolveRid(instance.repositoryPath);
      const providerName =
        instance.provider === 'claude' ? 'Claude CLI' : 'Codex CLI';

      socket.emit('ai-restarted', {
        success: true,
        message: `${providerName}を再起動しました`,
        rid,
        instanceId,
        provider: instance.provider,
        sessionId: result.session.id,
      });

      emitSystemMessage(
        socket,
        `\n=== ${providerName}を再起動しました ===\n`,
        { rid, instanceId, provider: instance.provider }
      );
    } catch (error) {
      console.error('[restart-ai-cli] failed:', error);
      const rid = resolveRid(instance.repositoryPath);
      const providerName =
        instance.provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
      socket.emit('ai-restarted', {
        success: false,
        message: `${providerName}の再起動に失敗しました`,
        rid,
        instanceId,
        provider: instance.provider,
      });
      emitSystemMessage(
        socket,
        `\n=== ${providerName}の再起動に失敗しました ===\n`,
        { rid, instanceId, provider: instance.provider }
      );
    }
  });

  // リサイズ
  socket.on('ai-resize', (data) => {
    const { instanceId, cols, rows } = data;
    processManager.resizeInstance(instanceId, cols, rows);
  });

  // ai-output イベントを socket emit に変換（ai-session-manager → process-manager → ここ）
  // 注: server.ts 側で emit を一括で行うので、ここでは何もしない（既存パターンとの整合性のため）
  void io;
  void path;
}
