import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  AiOutputLine,
  AiInstance,
  AiProvider,
  CommandType,
  GitWorktree,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

const MAX_MESSAGES = 5000;

export interface UseWorktreeDashboardReturn {
  primaryInstances: Map<string, AiInstance>;
  outputByRid: Map<string, AiOutputLine[]>;
  refresh: () => void;
  sendCommand: (rid: string, command: string, type?: CommandType) => void;
  /** 指定 rid のプライマリインスタンスの PTY をリサイズ */
  resizeInstance: (rid: string, cols: number, rows: number) => void;
  broadcastPrompt: (
    rids: string[],
    prompt: string,
    options: {
      sendClearBefore?: boolean;
      sendCommitAfter?: boolean;
      model?: string;
    }
  ) => void;
}

/**
 * ダッシュボード用: 親リポジトリ配下の全 worktree から AI 出力 / プライマリ
 * インスタンス / diff サマリを同時購読する。
 *
 * 既存の useAiCli は currentRepo 単一の購読を行うが、ダッシュボードは複数
 * worktree の出力を並列に受信する必要がある。
 */
export function useWorktreeDashboard(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  worktrees: GitWorktree[],
  repoProvidersByRid: Map<string, AiProvider>
): UseWorktreeDashboardReturn {
  const [primaryInstances, setPrimaryInstances] = useState<
    Map<string, AiInstance>
  >(new Map());
  const [outputByRid, setOutputByRid] = useState<Map<string, AiOutputLine[]>>(
    new Map()
  );

  // worktree の rid 集合（イベント受信時のフィルタ用）
  const worktreeRidsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const set = new Set<string>();
    for (const wt of worktrees) {
      const rid = repositoryIdMap.getRid(wt.path);
      if (rid) set.add(rid);
    }
    worktreeRidsRef.current = set;
  }, [worktrees]);

  // 自動起動を要求済みの rid。ai-instances-list で primary が無いとわかった
  // タイミングで ensure-primary-instance を打つが、その結果が反映されるまで
  // 何度も emit しないようにここで重複抑止する
  const ensureRequestedRef = useRef<Set<string>>(new Set());
  // 最新の provider マップ（ハンドラから参照するため ref で持つ）
  const repoProvidersRef = useRef(repoProvidersByRid);
  useEffect(() => {
    repoProvidersRef.current = repoProvidersByRid;
  }, [repoProvidersByRid]);

  // worktree 一覧が変わるたびに、各 rid に対して必要な情報を取得
  useEffect(() => {
    if (!socket) return;
    for (const wt of worktrees) {
      const rid = repositoryIdMap.getRid(wt.path);
      if (!rid) continue;
      socket.emit('list-ai-instances', { rid });
    }
  }, [socket, worktrees]);

  // 受信ハンドラを購読
  useEffect(() => {
    if (!socket) return;

    const handleInstancesList = (
      data: Parameters<ServerToClientEvents['ai-instances-list']>[0]
    ) => {
      if (!worktreeRidsRef.current.has(data.rid)) return;
      const primary = data.instances.find((i) => i.isPrimary);
      setPrimaryInstances((prev) => {
        const next = new Map(prev);
        if (primary) {
          next.set(data.rid, primary);
        } else {
          next.delete(data.rid);
        }
        return next;
      });
      if (primary) {
        socket.emit('get-ai-history', { instanceId: primary.instanceId });
        ensureRequestedRef.current.delete(data.rid);
      } else if (!ensureRequestedRef.current.has(data.rid)) {
        // 未起動なので自動でプライマリを起こす
        const provider = repoProvidersRef.current.get(data.rid) ?? 'claude';
        ensureRequestedRef.current.add(data.rid);
        socket.emit('ensure-primary-instance', {
          rid: data.rid,
          provider,
        });
      }
    };

    const handleInstanceCreated = (
      data: Parameters<ServerToClientEvents['ai-instance-created']>[0]
    ) => {
      if (!worktreeRidsRef.current.has(data.rid)) return;
      if (!data.instance.isPrimary) return;
      setPrimaryInstances((prev) => {
        const next = new Map(prev);
        next.set(data.rid, data.instance);
        return next;
      });
      socket.emit('get-ai-history', { instanceId: data.instance.instanceId });
    };

    const handleInstanceUpdated = (
      data: Parameters<ServerToClientEvents['ai-instance-updated']>[0]
    ) => {
      if (!worktreeRidsRef.current.has(data.rid)) return;
      setPrimaryInstances((prev) => {
        const cur = prev.get(data.rid);
        if (data.instance.isPrimary) {
          const next = new Map(prev);
          next.set(data.rid, data.instance);
          return next;
        }
        // プライマリでなくなった: 該当 instance なら削除
        if (!cur || cur.instanceId !== data.instance.instanceId) return prev;
        const next = new Map(prev);
        next.delete(data.rid);
        return next;
      });
    };

    const handleOutputHistory = (
      data: Parameters<ServerToClientEvents['ai-output-history']>[0]
    ) => {
      if (!worktreeRidsRef.current.has(data.rid)) return;
      setOutputByRid((prev) => {
        const next = new Map(prev);
        next.set(data.rid, data.history.slice(-MAX_MESSAGES));
        return next;
      });
    };

    const handleOutputLine = (
      data: Parameters<ServerToClientEvents['ai-output-line']>[0]
    ) => {
      if (!worktreeRidsRef.current.has(data.rid)) return;
      setOutputByRid((prev) => {
        const cur = prev.get(data.rid) ?? [];
        if (cur.some((m) => m.id === data.outputLine.id)) return prev;
        const next = new Map(prev);
        next.set(data.rid, [...cur, data.outputLine].slice(-MAX_MESSAGES));
        return next;
      });
    };

    const handleOutputCleared = (
      data: Parameters<ServerToClientEvents['ai-output-cleared']>[0]
    ) => {
      if (!worktreeRidsRef.current.has(data.rid)) return;
      setOutputByRid((prev) => {
        const next = new Map(prev);
        next.set(data.rid, []);
        return next;
      });
    };

    socket.on('ai-instances-list', handleInstancesList);
    socket.on('ai-instance-created', handleInstanceCreated);
    socket.on('ai-instance-updated', handleInstanceUpdated);
    socket.on('ai-output-history', handleOutputHistory);
    socket.on('ai-output-line', handleOutputLine);
    socket.on('ai-output-cleared', handleOutputCleared);

    return () => {
      socket.off('ai-instances-list', handleInstancesList);
      socket.off('ai-instance-created', handleInstanceCreated);
      socket.off('ai-instance-updated', handleInstanceUpdated);
      socket.off('ai-output-history', handleOutputHistory);
      socket.off('ai-output-line', handleOutputLine);
      socket.off('ai-output-cleared', handleOutputCleared);
    };
  }, [socket]);

  const refresh = useCallback(() => {
    if (!socket) return;
    for (const rid of worktreeRidsRef.current) {
      socket.emit('list-ai-instances', { rid });
    }
  }, [socket]);

  const sendCommand = useCallback(
    (rid: string, command: string, type: CommandType = 'prompt') => {
      if (!socket) return;
      const inst = primaryInstances.get(rid);
      if (!inst) return;
      socket.emit('send-command', {
        command,
        instanceId: inst.instanceId,
        type,
      });
      // prompt/clear/commit は Enter を後送（useAiCli と同じ挙動）
      if (type !== 'raw') {
        setTimeout(() => {
          socket.emit('send-command', {
            command: '\r',
            instanceId: inst.instanceId,
            type: 'raw',
          });
        }, 300);
      }
    },
    [socket, primaryInstances]
  );

  const resizeInstance = useCallback(
    (rid: string, cols: number, rows: number) => {
      if (!socket) return;
      const inst = primaryInstances.get(rid);
      if (!inst) return;
      socket.emit('ai-resize', {
        instanceId: inst.instanceId,
        cols,
        rows,
      });
    },
    [socket, primaryInstances]
  );

  const broadcastPrompt = useCallback(
    (
      rids: string[],
      prompt: string,
      options: {
        sendClearBefore?: boolean;
        sendCommitAfter?: boolean;
        model?: string;
      }
    ) => {
      if (!socket) return;
      for (const rid of rids) {
        // worktree の rid は repos-process-status に含まれないため、
        // primary instance の provider を優先し、最後に 'claude' へフォールバック。
        const provider =
          primaryInstances.get(rid)?.provider ??
          repoProvidersByRid.get(rid) ??
          'claude';
        socket.emit('add-to-prompt-queue', {
          rid,
          provider,
          prompt,
          sendClearBefore: options.sendClearBefore,
          isAutoCommit: options.sendCommitAfter,
          model: options.model,
        });
      }
    },
    [socket, primaryInstances, repoProvidersByRid]
  );

  return {
    primaryInstances,
    outputByRid,
    refresh,
    sendCommand,
    resizeInstance,
    broadcastPrompt,
  };
}
