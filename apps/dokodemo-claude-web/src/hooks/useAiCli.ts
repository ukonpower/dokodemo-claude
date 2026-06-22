import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  AiProvider,
  AiOutputLine,
  AiInstance,
  ServerToClientEvents,
  ClientToServerEvents,
  CommandType,
  CommandConfig,
  PermissionMode,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';
import {
  getLastAiTab,
  setLastAiTab,
  type SavedAiTab,
} from '../utils/last-tab-storage';

/**
 * useAiCli フックの戻り値
 */
export interface UseAiCliReturn {
  // インスタンス
  aiInstances: AiInstance[];
  activeInstance: AiInstance | undefined;
  primaryInstance: AiInstance | undefined;
  currentAiMessages: AiOutputLine[];
  aiTerminalSize: { cols: number; rows: number } | null;

  // タブ操作
  activateInstance: (instanceId: string) => void;
  createInstance: (provider: AiProvider) => void;
  closeInstance: (instanceId: string) => void;
  renameInstance: (instanceId: string, displayName: string) => void;

  // アクション（active instance に対する操作）
  sendCommand: (command: string) => void;
  sendArrowKey: (direction: 'up' | 'down' | 'left' | 'right') => void;
  sendAltT: () => void;
  sendInterrupt: () => void;
  sendEscape: () => void;
  sendClear: () => void;
  sendCommit: () => void;
  sendPreview: () => void;
  sendResume: () => void;
  sendUsage: () => void;
  sendMode: () => void;
  changeModel: (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => void;

  // プライマリ専用
  changePrimaryProvider: (provider: AiProvider) => void;

  restartCli: () => void;
  clearHistory: () => void;
  handleKeyInput: (key: string) => void;
  handleResize: (cols: number, rows: number) => void;
  handleReload: (cols: number, rows: number) => void;

  // ターミナルサイズの参照
  setAiTerminalSize: (size: { cols: number; rows: number } | null) => void;
  onOutputReceived: () => void;

  clearState: () => void;
}

/**
 * localStorage から permissionMode 設定を取得
 * ユーザが明示的に選択していなければ undefined を返し、Claude CLI の既定
 * 権限確認モードで起動させる。サイレントに dangerous/auto に倒さない。
 */
function getPermissionModeSetting(): PermissionMode | undefined {
  try {
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings.permissionMode)
        return settings.permissionMode as PermissionMode;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

const commandConfigs: Record<CommandType, CommandConfig> = {
  prompt: { needsEnter: true },
  clear: { needsEnter: true },
  commit: { needsEnter: true },
  raw: { needsEnter: false },
};

// フロントで保持する出力履歴の件数。バックエンドの maxOutputLines と
// 揃える（小さいと再取得時にここで履歴が切り詰められ遡れなくなる）。
const MAX_MESSAGES = 5000;

/**
 * インスタンスから localStorage に保存する安定キーを生成する。
 * instanceId はサーバ揮発のため保存しない。
 */
function toSavedAiTab(
  inst: AiInstance,
  allInstances: AiInstance[]
): SavedAiTab {
  if (inst.isPrimary) {
    return { provider: inst.provider, isPrimary: true };
  }
  const subs = allInstances
    .filter((i) => !i.isPrimary && i.provider === inst.provider)
    .sort((a, b) => a.order - b.order);
  const subOrder = subs.findIndex((i) => i.instanceId === inst.instanceId);
  return {
    provider: inst.provider,
    isPrimary: false,
    subOrder: subOrder >= 0 ? subOrder : 0,
  };
}

/**
 * 安定キーに合うインスタンスを探す。見つからなければ undefined。
 */
function findInstanceFromSaved(
  saved: SavedAiTab,
  instances: AiInstance[]
): AiInstance | undefined {
  if (saved.isPrimary) {
    return instances.find(
      (i) => i.isPrimary && i.provider === saved.provider
    );
  }
  const subs = instances
    .filter((i) => !i.isPrimary && i.provider === saved.provider)
    .sort((a, b) => a.order - b.order);
  return subs[saved.subOrder ?? 0];
}

/**
 * 「フォールバック先 instanceId」を一意に決定する。
 * 保存値がマッチすればそれを、無ければプライマリを返す。
 */
function pickFallbackInstanceId(
  instances: AiInstance[],
  repoPath: string
): string {
  if (instances.length === 0) return '';
  const saved = getLastAiTab(repoPath);
  if (saved) {
    const matched = findInstanceFromSaved(saved, instances);
    if (matched) return matched.instanceId;
  }
  const primary = instances.find((i) => i.isPrimary);
  return primary?.instanceId ?? instances[0]?.instanceId ?? '';
}

/**
 * AI CLI 状態とコマンド送信を管理するカスタムフック
 * マルチインスタンス対応版
 */
export function useAiCli(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  onOutputReceived?: () => void
): UseAiCliReturn {
  const [aiInstances, setAiInstances] = useState<AiInstance[]>([]);
  const [activeInstanceId, setActiveInstanceId] = useState<string>('');
  const [messagesByInstance, setMessagesByInstance] = useState<
    Map<string, AiOutputLine[]>
  >(new Map());

  const [aiTerminalSize, setAiTerminalSize] = useState<{
    cols: number;
    rows: number;
  } | null>(null);

  // 派生値
  const activeInstance = aiInstances.find(
    (i) => i.instanceId === activeInstanceId
  );
  const primaryInstance = aiInstances.find((i) => i.isPrimary);
  const currentAiMessages = messagesByInstance.get(activeInstanceId) ?? [];

  // refs（イベントハンドラ内で最新値を参照）
  const currentRepoRef = useRef(currentRepo);
  const activeInstanceIdRef = useRef(activeInstanceId);
  const aiInstancesRef = useRef(aiInstances);
  const aiTerminalSizeRef = useRef(aiTerminalSize);
  // 自分が createInstance を呼んだ回数。ai-instance-created の都度 1 ずつ消費し、自動アクティブ化する
  const pendingActivateCountRef = useRef(0);
  const onOutputReceivedRef = useRef(onOutputReceived);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    activeInstanceIdRef.current = activeInstanceId;
  }, [activeInstanceId]);
  useEffect(() => {
    aiInstancesRef.current = aiInstances;
  }, [aiInstances]);
  useEffect(() => {
    aiTerminalSizeRef.current = aiTerminalSize;
  }, [aiTerminalSize]);
  useEffect(() => {
    onOutputReceivedRef.current = onOutputReceived;
  }, [onOutputReceived]);

  // 現在の rid を解決するヘルパー
  const getCurrentRid = useCallback(
    () => repositoryIdMap.getRid(currentRepoRef.current) ?? '',
    []
  );

  // Socket イベントリスナー
  useEffect(() => {
    if (!socket) return;

    const handleInstancesList = (
      data: Parameters<ServerToClientEvents['ai-instances-list']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      setAiInstances(data.instances);
      setActiveInstanceId((prev) => {
        if (data.instances.some((i) => i.instanceId === prev)) return prev;
        return pickFallbackInstanceId(data.instances, currentRepoRef.current);
      });
    };

    const handleInstanceCreated = (
      data: Parameters<ServerToClientEvents['ai-instance-created']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      setAiInstances((prev) => {
        if (prev.some((i) => i.instanceId === data.instance.instanceId)) {
          return prev.map((i) =>
            i.instanceId === data.instance.instanceId ? data.instance : i
          );
        }
        return [...prev, data.instance];
      });
      // 自分が作成リクエストを送ったぶんだけ、新規インスタンスを自動アクティブ化する
      // （他クライアントの broadcast で勝手にタブ切替されないようカウンタで制御）
      if (pendingActivateCountRef.current > 0) {
        pendingActivateCountRef.current -= 1;
        setActiveInstanceId(data.instance.instanceId);
      }
    };

    const handleInstanceUpdated = (
      data: Parameters<ServerToClientEvents['ai-instance-updated']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      setAiInstances((prev) =>
        prev.map((i) =>
          i.instanceId === data.instance.instanceId ? data.instance : i
        )
      );
    };

    const handleInstanceClosed = (
      data: Parameters<ServerToClientEvents['ai-instance-closed']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      setAiInstances((prev) =>
        prev.filter((i) => i.instanceId !== data.instanceId)
      );
      setMessagesByInstance((prev) => {
        if (!prev.has(data.instanceId)) return prev;
        const next = new Map(prev);
        next.delete(data.instanceId);
        return next;
      });
      setActiveInstanceId((prev) => {
        if (prev !== data.instanceId) return prev;
        // 閉じたタブがアクティブだった: プライマリへフォールバック
        return ''; // 次の instances-list / 既存 instances でプライマリへ
      });
    };

    const handleAiOutputLine = (
      data: Parameters<ServerToClientEvents['ai-output-line']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid && data.rid !== currentRid) return;

      setMessagesByInstance((prev) => {
        const existing = prev.get(data.instanceId) ?? [];
        if (existing.some((m) => m.id === data.outputLine.id)) {
          return prev;
        }
        const updated = [...existing, data.outputLine].slice(-MAX_MESSAGES);
        const next = new Map(prev);
        next.set(data.instanceId, updated);
        return next;
      });

      onOutputReceivedRef.current?.();
    };

    const handleAiOutputHistory = (
      data: Parameters<ServerToClientEvents['ai-output-history']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      setMessagesByInstance((prev) => {
        const next = new Map(prev);
        next.set(data.instanceId, data.history);
        return next;
      });
      onOutputReceivedRef.current?.();
    };

    const handleAiSessionCreated = (
      data: Parameters<ServerToClientEvents['ai-session-created']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      // sessionId を該当インスタンスに反映
      setAiInstances((prev) =>
        prev.map((i) =>
          i.instanceId === data.instanceId
            ? { ...i, sessionId: data.sessionId }
            : i
        )
      );
    };

    const handleAiRestarted = (
      data: Parameters<ServerToClientEvents['ai-restarted']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      if (data.success && data.sessionId) {
        setAiInstances((prev) =>
          prev.map((i) =>
            i.instanceId === data.instanceId
              ? { ...i, sessionId: data.sessionId }
              : i
          )
        );
      }
    };

    const handleAiOutputCleared = (
      data: Parameters<ServerToClientEvents['ai-output-cleared']>[0]
    ) => {
      const currentRid = getCurrentRid();
      if (data.rid !== currentRid) return;
      setMessagesByInstance((prev) => {
        const next = new Map(prev);
        next.set(data.instanceId, []);
        return next;
      });
    };

    socket.on('ai-instances-list', handleInstancesList);
    socket.on('ai-instance-created', handleInstanceCreated);
    socket.on('ai-instance-updated', handleInstanceUpdated);
    socket.on('ai-instance-closed', handleInstanceClosed);
    socket.on('ai-output-line', handleAiOutputLine);
    socket.on('ai-output-history', handleAiOutputHistory);
    socket.on('ai-session-created', handleAiSessionCreated);
    socket.on('ai-restarted', handleAiRestarted);
    socket.on('ai-output-cleared', handleAiOutputCleared);

    return () => {
      socket.off('ai-instances-list', handleInstancesList);
      socket.off('ai-instance-created', handleInstanceCreated);
      socket.off('ai-instance-updated', handleInstanceUpdated);
      socket.off('ai-instance-closed', handleInstanceClosed);
      socket.off('ai-output-line', handleAiOutputLine);
      socket.off('ai-output-history', handleAiOutputHistory);
      socket.off('ai-session-created', handleAiSessionCreated);
      socket.off('ai-restarted', handleAiRestarted);
      socket.off('ai-output-cleared', handleAiOutputCleared);
    };
  }, [socket, getCurrentRid]);

  // 閉じたタブがアクティブだった場合のフォールバック
  useEffect(() => {
    if (!activeInstanceId && aiInstances.length > 0) {
      setActiveInstanceId(
        pickFallbackInstanceId(aiInstances, currentRepoRef.current)
      );
    }
  }, [activeInstanceId, aiInstances]);

  // active instance に対するコマンド送信
  const sendCommandToActive = useCallback(
    (command: string, type: CommandType = 'raw') => {
      if (!socket || !activeInstanceIdRef.current) return;
      const config = commandConfigs[type];
      socket.emit('send-command', {
        command,
        instanceId: activeInstanceIdRef.current,
        type,
      });

      if (config.needsEnter) {
        setTimeout(() => {
          socket.emit('send-command', {
            command: '\r',
            instanceId: activeInstanceIdRef.current,
            type: 'raw',
          });
        }, 300);
      }
    },
    [socket]
  );

  // アクション関数
  const sendCommand = useCallback(
    (command: string) => {
      sendCommandToActive(command, command === '\r' ? 'raw' : 'prompt');
    },
    [sendCommandToActive]
  );

  const sendArrowKey = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      const arrowKeys = {
        up: '\x1b[A',
        down: '\x1b[B',
        right: '\x1b[C',
        left: '\x1b[D',
      };
      sendCommandToActive(arrowKeys[direction], 'raw');
    },
    [sendCommandToActive]
  );

  const sendAltT = useCallback(() => {
    sendCommandToActive('\x1bt', 'raw');
  }, [sendCommandToActive]);

  const sendInterrupt = useCallback(() => {
    if (!socket || !activeInstanceIdRef.current) return;
    socket.emit('ai-interrupt', {
      instanceId: activeInstanceIdRef.current,
    });
  }, [socket]);

  const sendEscape = useCallback(() => {
    sendCommandToActive('\x1b', 'raw');
  }, [sendCommandToActive]);

  const sendClear = useCallback(() => {
    sendCommandToActive('/clear', 'clear');
  }, [sendCommandToActive]);

  const sendCommit = useCallback(() => {
    sendCommandToActive('/dokodemo-claude-tools:commit-push', 'commit');
  }, [sendCommandToActive]);

  const sendPreview = useCallback(() => {
    sendCommandToActive('/dokodemo-claude-tools:dokodemo-preview', 'prompt');
  }, [sendCommandToActive]);

  const sendResume = useCallback(() => {
    sendCommandToActive('/resume', 'prompt');
  }, [sendCommandToActive]);

  const sendUsage = useCallback(() => {
    sendCommandToActive('/usage', 'prompt');
  }, [sendCommandToActive]);

  const sendMode = useCallback(() => {
    sendCommandToActive('\x1b[Z', 'raw');
  }, [sendCommandToActive]);

  const changeModel = useCallback(
    (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => {
      const modelValue = model === 'OpusPlan' ? 'opusplan' : model;
      sendCommandToActive(`/model ${modelValue}`, 'prompt');
    },
    [sendCommandToActive]
  );

  // プライマリの provider 切替
  const changePrimaryProvider = useCallback(
    (newProvider: AiProvider) => {
      if (!socket || !currentRepoRef.current) return;
      // プライマリの provider が変わるとアクティブな AI タブ自体も「新プロバイダの
      // プライマリ」に変わるため、保存値も同期する。
      setLastAiTab(currentRepoRef.current, {
        provider: newProvider,
        isPrimary: true,
      });
      socket.emit('switch-repo', {
        path: currentRepoRef.current,
        provider: newProvider,
        initialSize: aiTerminalSizeRef.current || undefined,
        permissionMode: getPermissionModeSetting(),
      });
    },
    [socket]
  );

  const restartCli = useCallback(() => {
    if (!socket || !activeInstanceIdRef.current) return;
    socket.emit('clear-ai-output', {
      instanceId: activeInstanceIdRef.current,
    });
    socket.emit('restart-ai-cli', {
      instanceId: activeInstanceIdRef.current,
      initialSize: aiTerminalSizeRef.current || undefined,
      permissionMode: getPermissionModeSetting(),
    });
  }, [socket]);

  const clearHistory = useCallback(() => {
    if (!socket || !activeInstanceIdRef.current) return;
    socket.emit('clear-ai-output', {
      instanceId: activeInstanceIdRef.current,
    });
  }, [socket]);

  const handleKeyInput = useCallback(
    (key: string) => {
      sendCommandToActive(key, 'raw');
    },
    [sendCommandToActive]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      setAiTerminalSize({ cols, rows });
      if (!socket || !activeInstanceIdRef.current) return;
      socket.emit('ai-resize', {
        instanceId: activeInstanceIdRef.current,
        cols,
        rows,
      });
    },
    [socket]
  );

  const handleReload = useCallback(
    (cols: number, rows: number) => {
      if (!socket || !activeInstanceIdRef.current) return;
      socket.emit('ai-resize', {
        instanceId: activeInstanceIdRef.current,
        cols,
        rows,
      });
      socket.emit('get-ai-history', {
        instanceId: activeInstanceIdRef.current,
      });
    },
    [socket]
  );

  // タブ操作
  const activateInstance = useCallback((instanceId: string) => {
    setActiveInstanceId(instanceId);
    const inst = aiInstancesRef.current.find(
      (i) => i.instanceId === instanceId
    );
    if (inst) {
      setLastAiTab(
        currentRepoRef.current,
        toSavedAiTab(inst, aiInstancesRef.current)
      );
    }
  }, []);

  const createInstance = useCallback(
    (provider: AiProvider) => {
      if (!socket || !currentRepoRef.current) return;
      const rid = getCurrentRid();
      if (!rid) return;
      pendingActivateCountRef.current += 1;
      socket.emit('create-ai-instance', {
        rid,
        provider,
        initialSize: aiTerminalSizeRef.current || undefined,
        permissionMode: getPermissionModeSetting(),
      });
    },
    [socket, getCurrentRid]
  );

  const closeInstance = useCallback(
    (instanceId: string) => {
      if (!socket) return;
      socket.emit('close-ai-instance', { instanceId });
    },
    [socket]
  );

  const renameInstance = useCallback(
    (instanceId: string, displayName: string) => {
      if (!socket) return;
      socket.emit('rename-ai-instance', { instanceId, displayName });
    },
    [socket]
  );

  // 状態クリア（リポジトリ切替時用）
  const clearState = useCallback(() => {
    setAiInstances([]);
    setActiveInstanceId('');
    setMessagesByInstance(new Map());
    pendingActivateCountRef.current = 0;
  }, []);

  useEffect(() => {
    clearState();
  }, [currentRepo, clearState]);

  return {
    aiInstances,
    activeInstance,
    primaryInstance,
    currentAiMessages,
    aiTerminalSize,

    activateInstance,
    createInstance,
    closeInstance,
    renameInstance,

    sendCommand,
    sendArrowKey,
    sendAltT,
    sendInterrupt,
    sendEscape,
    sendClear,
    sendCommit,
    sendPreview,
    sendResume,
    sendUsage,
    sendMode,
    changeModel,
    changePrimaryProvider,
    restartCli,
    clearHistory,
    handleKeyInput,
    handleResize,
    handleReload,

    setAiTerminalSize,
    onOutputReceived: onOutputReceived || (() => {}),
    clearState,
  };
}
