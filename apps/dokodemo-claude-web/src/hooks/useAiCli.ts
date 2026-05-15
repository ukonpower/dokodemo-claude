import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  AiProvider,
  AiOutputLine,
  ServerToClientEvents,
  ClientToServerEvents,
  CommandType,
  CommandConfig,
  PermissionMode,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

/**
 * useAiCli フックの戻り値
 */
export interface UseAiCliReturn {
  // 状態
  currentAiMessages: AiOutputLine[];
  aiMessages: Map<AiProvider, AiOutputLine[]>;
  currentProvider: AiProvider;
  currentSessionId: string;
  aiSessionIds: Map<AiProvider, string>;
  aiTerminalSize: { cols: number; rows: number } | null;

  // アクション
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
  changeProvider: (provider: AiProvider) => void;
  syncProvider: (provider: AiProvider) => void;
  restartCli: () => void;
  clearHistory: () => void;
  handleKeyInput: (key: string) => void;
  handleResize: (cols: number, rows: number) => void;
  handleReload: (cols: number, rows: number) => void;

  // セッターとコールバック
  setAiTerminalSize: (size: { cols: number; rows: number } | null) => void;
  onOutputReceived: () => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * localStorage から permissionMode 設定を取得
 */
function getPermissionModeSetting(): PermissionMode {
  try {
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      const settings = JSON.parse(saved);
      if (settings.permissionMode) return settings.permissionMode as PermissionMode;
      // 旧形式の bypassPermission フォールバック
      if (settings.bypassPermission === false) return 'disabled';
    }
  } catch { /* ignore */ }
  return 'dangerous';
}

/**
 * コマンドタイプごとの設定
 */
const commandConfigs: Record<CommandType, CommandConfig> = {
  prompt: { needsEnter: true },
  clear: { needsEnter: true },
  commit: { needsEnter: true },
  raw: { needsEnter: false },
};

/**
 * AI CLI状態とコマンド送信を管理するカスタムフック
 */
export function useAiCli(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string,
  onOutputReceived?: () => void
): UseAiCliReturn {
  // プロバイダー
  const [currentProvider, setCurrentProvider] = useState<AiProvider>('claude');

  // プロバイダー別メッセージ管理
  const [aiMessages, setAiMessages] = useState<Map<AiProvider, AiOutputLine[]>>(
    new Map()
  );
  const [currentAiMessages, setCurrentAiMessages] = useState<AiOutputLine[]>(
    []
  );

  // セッション管理
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [aiSessionIds, setAiSessionIds] = useState<Map<AiProvider, string>>(
    new Map()
  );

  // ターミナルサイズ
  const [aiTerminalSize, setAiTerminalSize] = useState<{
    cols: number;
    rows: number;
  } | null>(null);

  // Ref（イベントハンドラ内で最新値を参照）
  const currentProviderRef = useRef(currentProvider);
  const currentRepoRef = useRef(currentRepo);
  const currentSessionIdRef = useRef(currentSessionId);
  const aiMessagesRef = useRef(aiMessages);
  const aiSessionIdsRef = useRef(aiSessionIds);
  const aiTerminalSizeRef = useRef(aiTerminalSize);

  useEffect(() => {
    currentProviderRef.current = currentProvider;
  }, [currentProvider]);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  useEffect(() => {
    aiMessagesRef.current = aiMessages;
  }, [aiMessages]);
  useEffect(() => {
    aiSessionIdsRef.current = aiSessionIds;
  }, [aiSessionIds]);
  useEffect(() => {
    aiTerminalSizeRef.current = aiTerminalSize;
  }, [aiTerminalSize]);

  // プロバイダー変更時に currentAiMessages を同期
  useEffect(() => {
    const nextMessages = aiMessages.get(currentProvider) || [];
    setCurrentAiMessages([...nextMessages]);
  }, [aiMessages, currentProvider]);

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // AI出力行受信
    const handleAiOutputLine = (
      data: Parameters<ServerToClientEvents['ai-output-line']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      const ridMatch = !data.rid || data.rid === currentRid;

      if (ridMatch) {
        const provider = data.provider;

        setAiMessages((prevMessages) => {
          const newMessages = new Map(prevMessages);
          const currentMessages = newMessages.get(provider) || [];

          // 重複チェック
          const isDuplicate = currentMessages.some(
            (msg) => msg.id === data.outputLine.id
          );
          if (isDuplicate) {
            return prevMessages;
          }

          const updatedMessages = [...currentMessages, data.outputLine];

          // 最大行数を超えた場合、古いデータを削除
          const MAX_MESSAGES = 500;
          const finalMessages =
            updatedMessages.length > MAX_MESSAGES
              ? updatedMessages.slice(-MAX_MESSAGES)
              : updatedMessages;

          newMessages.set(provider, finalMessages);

          if (provider === currentProviderRef.current) {
            setCurrentAiMessages([...finalMessages]);
          }

          return newMessages;
        });

        onOutputReceived?.();
      }
    };

    // AI出力履歴受信
    const handleAiOutputHistory = (
      data: Parameters<ServerToClientEvents['ai-output-history']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;

      const provider = data.provider || 'claude';
      const historyMessages: AiOutputLine[] = data.history;

      const existingMessages = aiMessagesRef.current.get(provider) || [];
      if (historyMessages.length === 0 && existingMessages.length > 0) {
        return;
      }

      setAiMessages((prevMessages) => {
        const newMessages = new Map(prevMessages);
        newMessages.set(provider, historyMessages);

        if (provider === currentProviderRef.current) {
          setCurrentAiMessages([...historyMessages]);
        }

        return newMessages;
      });

      onOutputReceived?.();
    };

    // セッション作成
    const handleAiSessionCreated = (
      data: Parameters<ServerToClientEvents['ai-session-created']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setAiSessionIds((prevIds) => {
          const newIds = new Map(prevIds);
          newIds.set(data.provider, data.sessionId);
          return newIds;
        });
        if (data.provider === currentProviderRef.current) {
          setCurrentSessionId(data.sessionId);
        }
      }
    };

    // セッションID更新
    const handleAiSessionIdUpdated = (
      data: Parameters<ServerToClientEvents['ai-session-id-updated']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        setAiSessionIds((prevIds) => {
          const newIds = new Map(prevIds);
          newIds.set(data.provider, data.sessionId);
          return newIds;
        });
        if (data.provider === currentProviderRef.current) {
          setCurrentSessionId(data.sessionId);
        }
      }
    };

    // AI再起動
    const handleAiRestarted = (
      data: Parameters<ServerToClientEvents['ai-restarted']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (
        data.rid === currentRid &&
        data.provider === currentProviderRef.current
      ) {
        if (data.success && data.sessionId) {
          setCurrentSessionId(data.sessionId);
          setAiSessionIds((prevIds) => {
            const newIds = new Map(prevIds);
            newIds.set(data.provider, data.sessionId!);
            return newIds;
          });
        }
      }
    };

    // AI出力クリア
    const handleAiOutputCleared = (
      data: Parameters<ServerToClientEvents['ai-output-cleared']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid === currentRid) {
        const provider = data.provider || 'claude';
        setAiMessages((prevMessages) => {
          const newMessages = new Map(prevMessages);
          newMessages.set(provider, []);
          if (provider === currentProviderRef.current) {
            setCurrentAiMessages([]);
          }
          return newMessages;
        });
      }
    };

    socket.on('ai-output-line', handleAiOutputLine);
    socket.on('ai-output-history', handleAiOutputHistory);
    socket.on('ai-session-created', handleAiSessionCreated);
    socket.on('ai-session-id-updated', handleAiSessionIdUpdated);
    socket.on('ai-restarted', handleAiRestarted);
    socket.on('ai-output-cleared', handleAiOutputCleared);

    return () => {
      socket.off('ai-output-line', handleAiOutputLine);
      socket.off('ai-output-history', handleAiOutputHistory);
      socket.off('ai-session-created', handleAiSessionCreated);
      socket.off('ai-session-id-updated', handleAiSessionIdUpdated);
      socket.off('ai-restarted', handleAiRestarted);
      socket.off('ai-output-cleared', handleAiOutputCleared);
    };
  }, [socket, onOutputReceived]);

  // AI CLIにコマンドを送信するヘルパー関数
  const sendCommandToAi = useCallback(
    (command: string, type: CommandType = 'raw', options?: { sessionId?: string }) => {
      if (!socket || !currentRepo) return;

      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;

      const config = commandConfigs[type];
      const targetSessionId = options?.sessionId ||
        aiSessionIdsRef.current.get(currentProviderRef.current) ||
        '';

      socket.emit('send-command', {
        command,
        sessionId: targetSessionId,
        rid,
        provider: currentProviderRef.current,
      });

      if (config.needsEnter) {
        setTimeout(() => {
          socket.emit('send-command', {
            command: '\r',
            sessionId: targetSessionId,
            rid,
            provider: currentProviderRef.current,
          });
        }, 300);
      }
    },
    [socket, currentRepo]
  );

  // アクション関数
  const sendCommand = useCallback(
    (command: string) => {
      if (command === '\r') {
        sendCommandToAi(command, 'raw');
      } else {
        sendCommandToAi(command, 'prompt');
      }
    },
    [sendCommandToAi]
  );

  const sendArrowKey = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      const arrowKeys = {
        up: '\x1b[A',
        down: '\x1b[B',
        right: '\x1b[C',
        left: '\x1b[D',
      };
      sendCommandToAi(arrowKeys[direction], 'raw');
    },
    [sendCommandToAi]
  );

  const sendAltT = useCallback(() => {
    sendCommandToAi('\x1bt', 'raw');
  }, [sendCommandToAi]);

  const sendInterrupt = useCallback(() => {
    if (socket) {
      const rid = currentRepo ? repositoryIdMap.getRid(currentRepo) : undefined;
      socket.emit('ai-interrupt', {
        sessionId: aiSessionIdsRef.current.get(currentProviderRef.current) || currentSessionIdRef.current,
        rid,
        provider: currentProviderRef.current,
      });
    }
  }, [socket, currentRepo]);

  const sendEscape = useCallback(() => {
    sendCommandToAi('\x1b', 'raw');
  }, [sendCommandToAi]);

  const sendClear = useCallback(() => {
    sendCommandToAi('/clear', 'clear');
  }, [sendCommandToAi]);

  const sendCommit = useCallback(() => {
    sendCommandToAi('/dokodemo-claude-tools:commit-push', 'commit');
  }, [sendCommandToAi]);

  const sendPreview = useCallback(() => {
    sendCommandToAi('/dokodemo-claude-tools:dokodemo-preview', 'prompt');
  }, [sendCommandToAi]);

  const sendResume = useCallback(() => {
    sendCommandToAi('/resume', 'prompt');
  }, [sendCommandToAi]);

  const sendUsage = useCallback(() => {
    sendCommandToAi('/usage', 'prompt');
  }, [sendCommandToAi]);

  const sendMode = useCallback(() => {
    sendCommandToAi('\x1b[Z', 'raw');
  }, [sendCommandToAi]);

  const changeModel = useCallback(
    (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => {
      const modelValue = model === 'OpusPlan' ? 'opusplan' : model;
      sendCommandToAi(`/model ${modelValue}`, 'prompt');
    },
    [sendCommandToAi]
  );

  const changeProvider = useCallback(
    (newProvider: AiProvider) => {
      if (!socket || !currentRepo) return;

      setCurrentProvider(newProvider);

      socket.emit('switch-repo', {
        path: currentRepo,
        provider: newProvider,
        initialSize: aiTerminalSizeRef.current || undefined,
        permissionMode: getPermissionModeSetting(),
      });
    },
    [socket, currentRepo]
  );

  const syncProvider = useCallback((provider: AiProvider) => {
    setCurrentProvider((prevProvider) =>
      prevProvider === provider ? prevProvider : provider
    );
  }, []);

  const restartCli = useCallback(() => {
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('clear-ai-output', {
        rid,
        provider: currentProviderRef.current,
      });
      socket.emit('restart-ai-cli', {
        rid,
        provider: currentProviderRef.current,
        initialSize: aiTerminalSizeRef.current || undefined,
        permissionMode: getPermissionModeSetting(),
      });
    }
  }, [socket, currentRepo]);

  const clearHistory = useCallback(() => {
    if (socket && currentRepo) {
      const rid = repositoryIdMap.getRid(currentRepo);
      if (!rid) return;
      socket.emit('clear-ai-output', {
        rid,
        provider: currentProviderRef.current,
      });
    }
  }, [socket, currentRepo]);

  const handleKeyInput = useCallback(
    (key: string) => {
      sendCommandToAi(key, 'raw');
    },
    [sendCommandToAi]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      setAiTerminalSize({ cols, rows });

      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        socket.emit('ai-resize', {
          rid,
          provider: currentProviderRef.current,
          cols,
          rows,
        });
      }
    },
    [socket, currentRepo]
  );

  const handleReload = useCallback(
    (cols: number, rows: number) => {
      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        socket.emit('ai-resize', {
          rid,
          provider: currentProviderRef.current,
          cols,
          rows,
        });
        socket.emit('get-ai-history', {
          rid,
          provider: currentProviderRef.current,
        });
      }
    },
    [socket, currentRepo]
  );

  // 状態クリア（リポジトリ切り替え時用）
  const clearState = useCallback(() => {
    setAiMessages(new Map());
    setCurrentAiMessages([]);
    setCurrentSessionId('');
    setAiSessionIds(new Map());
    // currentProvider は repo-switched 後に syncProvider で上書きされるので触らない
  }, []);

  // リポジトリ切り替え時に状態をリセット
  useEffect(() => {
    clearState();
  }, [currentRepo, clearState]);

  return {
    currentAiMessages,
    aiMessages,
    currentProvider,
    currentSessionId,
    aiSessionIds,
    aiTerminalSize,
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
    changeProvider,
    syncProvider,
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
