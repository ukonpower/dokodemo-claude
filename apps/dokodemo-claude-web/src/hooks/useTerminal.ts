import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  CommandShortcut,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';
import { repositoryIdMap } from '../utils/repository-id-map';

// メッセージクリーンアップ設定
// xterm.jsが独自にscrollbackバッファを管理するため、毎回のsliceは不要
// 閾値を超えた場合のみターミナルごとにクリーンアップする
const TERMINAL_MESSAGES_CLEANUP_THRESHOLD = 2000;
const TERMINAL_MESSAGES_KEEP_PER_TERMINAL = 300;

/**
 * useTerminal フックの戻り値
 */
export interface UseTerminalReturn {
  // 状態
  terminals: Terminal[];
  activeTerminalId: string;
  terminalMessages: TerminalMessage[];
  terminalHistories: Map<string, TerminalOutputLine[]>;
  isTerminalsLoaded: boolean;
  shortcuts: CommandShortcut[];

  // アクション
  createTerminal: (cwd: string, name?: string) => void;
  closeTerminal: (terminalId: string) => void;
  sendInput: (terminalId: string, input: string) => void;
  sendSignal: (terminalId: string, signal: string) => void;
  resize: (terminalId: string, cols: number, rows: number) => void;
  setActiveTerminalId: (terminalId: string) => void;

  // ショートカット関連
  createShortcut: (name: string, command: string) => void;
  deleteShortcut: (shortcutId: string) => void;
  executeShortcut: (shortcutId: string, terminalId: string) => void;

  // クリア関数（リポジトリ切り替え時用）
  clearState: () => void;
}

/**
 * ターミナル操作を管理するカスタムフック
 */
export function useTerminal(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseTerminalReturn {
  // 状態
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [isTerminalsLoaded, setIsTerminalsLoaded] = useState(false);
  const [activeTerminalId, setActiveTerminalId] = useState<string>('');
  const [terminalMessages, setTerminalMessages] = useState<TerminalMessage[]>(
    []
  );
  const [terminalHistories, setTerminalHistories] = useState<
    Map<string, TerminalOutputLine[]>
  >(new Map());
  const [shortcuts, setShortcuts] = useState<CommandShortcut[]>([]);

  // Ref
  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // Socketイベントリスナー
  useEffect(() => {
    if (!socket) return;

    // ターミナル一覧
    const handleTerminalsList = (
      data: Parameters<ServerToClientEvents['terminals-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid && data.rid !== currentRid) {
        return;
      }
      setTerminals(data.terminals);
      setIsTerminalsLoaded(true);
    };

    // ターミナル作成
    const handleTerminalCreated = (
      terminal: Parameters<ServerToClientEvents['terminal-created']>[0]
    ) => {
      if (terminal.cwd !== currentRepoRef.current) {
        return;
      }
      setTerminals((prev) => [...prev, terminal]);
      // 最初のターミナル作成時にデフォルトショートカットが作成されるため、リストを再取得
      const rid = repositoryIdMap.getRid(currentRepoRef.current);
      if (rid) {
        socket.emit('list-shortcuts', { rid });
      }
    };

    // ターミナル出力
    const handleTerminalOutput = (
      message: Parameters<ServerToClientEvents['terminal-output']>[0]
    ) => {
      setTerminalMessages((prev) => {
        const newMessages = [...prev, message];
        if (newMessages.length > TERMINAL_MESSAGES_CLEANUP_THRESHOLD) {
          // ターミナルごとに最新メッセージのみ保持
          const byTerminal = new Map<string, TerminalMessage[]>();
          for (const msg of newMessages) {
            const arr = byTerminal.get(msg.terminalId) || [];
            arr.push(msg);
            byTerminal.set(msg.terminalId, arr);
          }
          const cleaned: TerminalMessage[] = [];
          for (const msgs of byTerminal.values()) {
            cleaned.push(
              ...msgs.slice(-TERMINAL_MESSAGES_KEEP_PER_TERMINAL)
            );
          }
          return cleaned;
        }
        return newMessages;
      });
    };

    // ターミナル終了
    const handleTerminalClosed = (
      data: Parameters<ServerToClientEvents['terminal-closed']>[0]
    ) => {
      setTerminals((prev) => prev.filter((t) => t.id !== data.terminalId));
      setTerminalMessages((prev) =>
        prev.filter((m) => m.terminalId !== data.terminalId)
      );
      setTerminalHistories((prev) => {
        const newHistories = new Map(prev);
        newHistories.delete(data.terminalId);
        return newHistories;
      });
    };

    // ターミナル出力履歴
    const handleTerminalOutputHistory = (
      data: Parameters<ServerToClientEvents['terminal-output-history']>[0]
    ) => {
      setTerminalHistories((prev) => {
        const newHistories = new Map(prev);
        newHistories.set(data.terminalId, data.history);
        return newHistories;
      });
    };

    // ショートカット一覧
    const handleShortcutsList = (
      data: Parameters<ServerToClientEvents['shortcuts-list']>[0]
    ) => {
      setShortcuts(data.shortcuts);
    };

    socket.on('terminals-list', handleTerminalsList);
    socket.on('terminal-created', handleTerminalCreated);
    socket.on('terminal-output', handleTerminalOutput);
    socket.on('terminal-closed', handleTerminalClosed);
    socket.on('terminal-output-history', handleTerminalOutputHistory);
    socket.on('shortcuts-list', handleShortcutsList);

    return () => {
      socket.off('terminals-list', handleTerminalsList);
      socket.off('terminal-created', handleTerminalCreated);
      socket.off('terminal-output', handleTerminalOutput);
      socket.off('terminal-closed', handleTerminalClosed);
      socket.off('terminal-output-history', handleTerminalOutputHistory);
      socket.off('shortcuts-list', handleShortcutsList);
    };
  }, [socket]);

  // アクション関数
  const createTerminal = useCallback(
    (cwd: string, name?: string) => {
      if (socket) {
        const rid = repositoryIdMap.getRid(cwd);
        socket.emit('create-terminal', { rid, cwd, name });
      }
    },
    [socket]
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      if (socket) {
        socket.emit('close-terminal', { terminalId });
      }
    },
    [socket]
  );

  const sendInput = useCallback(
    (terminalId: string, input: string) => {
      if (socket) {
        socket.emit('terminal-input', { terminalId, input });
      }
    },
    [socket]
  );

  const sendSignal = useCallback(
    (terminalId: string, signal: string) => {
      if (socket) {
        socket.emit('terminal-signal', { terminalId, signal });
      }
    },
    [socket]
  );

  const resize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      if (socket) {
        socket.emit('terminal-resize', { terminalId, cols, rows });
      }
    },
    [socket]
  );

  // ショートカット関連
  const createShortcut = useCallback(
    (name: string, command: string) => {
      if (socket && currentRepo) {
        const rid = repositoryIdMap.getRid(currentRepo);
        if (!rid) return;
        const shortcutData = {
          command,
          rid,
          ...(name.trim() ? { name: name.trim() } : {}),
        };
        socket.emit('create-shortcut', shortcutData);
      }
    },
    [socket, currentRepo]
  );

  const deleteShortcut = useCallback(
    (shortcutId: string) => {
      if (socket) {
        socket.emit('delete-shortcut', { shortcutId });
      }
    },
    [socket]
  );

  const executeShortcut = useCallback(
    (shortcutId: string, terminalId: string) => {
      if (socket) {
        socket.emit('execute-shortcut', { shortcutId, terminalId });
      }
    },
    [socket]
  );

  // 状態クリア
  const clearState = useCallback(() => {
    setTerminals([]);
    setIsTerminalsLoaded(false);
    setTerminalMessages([]);
    setTerminalHistories(new Map());
    setShortcuts([]);
  }, []);

  // リポジトリ切り替え時に状態をリセット
  useEffect(() => {
    clearState();
  }, [currentRepo, clearState]);

  return {
    terminals,
    activeTerminalId,
    terminalMessages,
    terminalHistories,
    isTerminalsLoaded,
    shortcuts,
    createTerminal,
    closeTerminal,
    sendInput,
    sendSignal,
    resize,
    setActiveTerminalId,
    createShortcut,
    deleteShortcut,
    executeShortcut,
    clearState,
  };
}
