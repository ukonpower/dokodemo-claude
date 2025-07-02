import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  GitRepository,
  GitBranch,
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  ClaudeOutputLine,
  CommandShortcut,
  ServerToClientEvents,
  ClientToServerEvents
} from './types';

import RepositoryManager from './components/RepositoryManager';
import ClaudeOutput from './components/ClaudeOutput';
import CommandInput from './components/CommandInput';
import TerminalManager from './components/TerminalManager';
import BranchSelector from './components/BranchSelector';

function App() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [rawOutput, setRawOutput] = useState<string>(''); // 生ログを保持
  const [currentRepo, setCurrentRepo] = useState<string>(() => {
    // URLのクエリパラメータからリポジトリパスを復元
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('repo') || '';
  });

  // ブラウザの戻る/進むボタン対応
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const repoFromUrl = urlParams.get('repo') || '';
      
      if (repoFromUrl !== currentRepo) {
        setCurrentRepo(repoFromUrl);
        if (!repoFromUrl) {
          setRawOutput('');
          setCurrentSessionId('');
          // ホームに戻る際はターミナル状態もクリア
          setTerminals([]);
          setTerminalMessages([]);
          setTerminalHistories(new Map());
          setShortcuts([]);
          setBranches([]);
          setCurrentBranch('');
        } else {
          // 別のリポジトリに切り替わる場合は、そのリポジトリのターミナル一覧を取得
          if (socket) {
            socket.emit('list-terminals', { repositoryPath: repoFromUrl });
            socket.emit('get-claude-history', { repositoryPath: repoFromUrl });
            socket.emit('list-shortcuts', { repositoryPath: repoFromUrl });
          }
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentRepo]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // currentRepoの最新値を保持するref
  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // ターミナル関連の状態
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalMessages, setTerminalMessages] = useState<TerminalMessage[]>([]);
  const [terminalHistories, setTerminalHistories] = useState<Map<string, TerminalOutputLine[]>>(new Map());

  // コマンドショートカット関連の状態
  const [shortcuts, setShortcuts] = useState<CommandShortcut[]>([]);
  
  // ブランチ関連の状態
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');

  useEffect(() => {
    let reconnectTimeout: number;
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000; // 2秒

    const createConnection = () => {
      // 現在のホストを自動検出してSocket.IO接続
      const socketUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:8001'
        : `http://${window.location.hostname}:8001`;
      
      const socketInstance = io(socketUrl, {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000
      });
      
      setSocket(socketInstance);

      socketInstance.on('connect', () => {
        console.log(`[Frontend] Connected to server`);
        setIsConnected(true);
        setIsReconnecting(false);
        setConnectionAttempts(0);
        
        // 接続時にリポジトリ一覧を取得
        socketInstance.emit('list-repos');
        console.log(`[Frontend] Emitted list-repos`);
        
        // 少し遅延を入れてcurrentRepoRef の値が確実に設定されてから履歴取得
        setTimeout(() => {
          const currentPath = currentRepoRef.current;
          console.log(`[Frontend] Delayed check - currentRepo: ${currentPath}`);
          
          if (currentPath) {
            console.log(`[Frontend] Current repo detected after delay: ${currentPath}`);
            socketInstance.emit('list-terminals', { repositoryPath: currentPath });
            console.log(`[Frontend] Emitted list-terminals for: ${currentPath}`);
            // Claude履歴も取得
            socketInstance.emit('get-claude-history', { repositoryPath: currentPath });
            console.log(`[Frontend] Emitted get-claude-history for: ${currentPath}`);
            // ショートカット一覧も取得
            socketInstance.emit('list-shortcuts', { repositoryPath: currentPath });
            console.log(`[Frontend] Emitted list-shortcuts for: ${currentPath}`);
            // ブランチ一覧も取得
            socketInstance.emit('list-branches', { repositoryPath: currentPath });
            console.log(`[Frontend] Emitted list-branches for: ${currentPath}`);
          } else {
            console.log(`[Frontend] No current repo detected after delay`);
          }
        }, 100); // 100ms遅延
      });

      socketInstance.on('disconnect', (reason) => {
        setIsConnected(false);
        
        // 自動再接続の場合は手動再接続を試行
        if (reason === 'io server disconnect') {
          setIsReconnecting(true);
          attemptReconnect();
        }
      });

      socketInstance.on('connect_error', () => {
        setIsConnected(false);
        setIsReconnecting(true);
        attemptReconnect();
      });

      return socketInstance;
    };

    const attemptReconnect = () => {
      if (connectionAttempts < maxReconnectAttempts) {
        setConnectionAttempts(prev => prev + 1);
        reconnectTimeout = setTimeout(() => {
          createConnection();
        }, reconnectDelay * (connectionAttempts + 1)); // 指数バックオフ
      } else {
        setIsReconnecting(false);
      }
    };

    const socketInstance = createConnection();

    socketInstance.on('repos-list', (data) => {
      setRepositories(data.repos);
    });

    // 生ログの受信（現在のリポジトリと一致する場合のみ表示）
    socketInstance.on('claude-raw-output', (data) => {
      // repositoryPathが指定されていて、現在のリポジトリと一致する場合のみ表示
      if (!data.repositoryPath || data.repositoryPath === currentRepoRef.current) {
        setRawOutput(prev => prev + data.content);
      }
    });

    socketInstance.on('repo-cloned', (data) => {
      setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
    });

    socketInstance.on('repo-created', (data) => {
      setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
    });

    socketInstance.on('repo-deleted', (data) => {
      if (data.success) {
        // 削除されたリポジトリが現在選択中のリポジトリの場合、リポジトリ選択画面に戻る
        if (currentRepoRef.current === data.path) {
          setCurrentRepo('');
          setRawOutput('');
          setCurrentSessionId('');
          setTerminals([]);
          setTerminalMessages([]);
          setTerminalHistories(new Map());
          setShortcuts([]);
          setBranches([]);
          setCurrentBranch('');
          // URLからリポジトリパラメータを削除
          const url = new URL(window.location.href);
          url.searchParams.delete('repo');
          window.history.replaceState({}, '', url.toString());
        }
      }
      setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
    });

    socketInstance.on('repo-switched', (data) => {
      if (data.success) {
        setCurrentRepo(data.currentPath);
        setCurrentSessionId(data.sessionId || '');
        // リポジトリ切り替え時は出力履歴をクリアしない（履歴は別途受信）
        
        // ターミナル・ブランチ関連状態をクリア
        setTerminals([]);
        setTerminalMessages([]);
        setTerminalHistories(new Map());
        setShortcuts([]);
        setBranches([]);
        setCurrentBranch('');
        
        // URLにリポジトリパスを保存
        const url = new URL(window.location.href);
        url.searchParams.set('repo', data.currentPath);
        window.history.replaceState({}, '', url.toString());
        
        // 新しいリポジトリのターミナル一覧を取得
        socketInstance.emit('list-terminals', { repositoryPath: data.currentPath });
        
        // 新しいリポジトリのショートカット一覧を取得
        socketInstance.emit('list-shortcuts', { repositoryPath: data.currentPath });
        
        // 新しいリポジトリのブランチ一覧を取得
        socketInstance.emit('list-branches', { repositoryPath: data.currentPath });
      }
      // システムメッセージは表示しない（Claude CLIの出力のみを表示）
    });

    // Claude セッション作成イベント
    socketInstance.on('claude-session-created', (data) => {
      if (data.repositoryPath === currentRepoRef.current) {
        setCurrentSessionId(data.sessionId);
        setRawOutput(prev => prev + `\n[SYSTEM] Claude CLI セッション開始: ${data.repositoryName}\n`);
      }
    });

    // Claude出力履歴受信イベント
    socketInstance.on('claude-output-history', (data) => {
      console.log(`[Frontend] Received Claude history for ${data.repositoryPath}, lines: ${data.history.length}`);
      if (data.repositoryPath === currentRepoRef.current) {
        console.log(`[Frontend] Applying Claude history (${data.history.length} lines) to current repo: ${currentRepoRef.current}`);
        // 履歴を復元（既存の出力を置き換え）
        const historyOutput = data.history
          .map((line: ClaudeOutputLine) => line.content)
          .join('');
        setRawOutput(historyOutput);
        console.log(`[Frontend] Claude history applied, output length: ${historyOutput.length}`);
      } else {
        console.log(`[Frontend] Ignoring Claude history for different repo: ${data.repositoryPath} (current: ${currentRepoRef.current})`);
      }
    });

    // ターミナル関連のイベントハンドラ
    socketInstance.on('terminals-list', (data) => {
      setTerminals(data.terminals);
      // バックエンドが自動で履歴を送信するため、手動での履歴取得は不要
    });

    socketInstance.on('terminal-created', (terminal) => {
      setTerminals(prev => [...prev, terminal]);
    });

    socketInstance.on('terminal-output', (message) => {
      setTerminalMessages(prev => [...prev, message]);
    });

    socketInstance.on('terminal-closed', (data) => {
      setTerminals(prev => prev.filter(t => t.id !== data.terminalId));
      setTerminalMessages(prev => prev.filter(m => m.terminalId !== data.terminalId));
      setTerminalHistories(prev => {
        const newHistories = new Map(prev);
        newHistories.delete(data.terminalId);
        return newHistories;
      });
    });

    // ターミナル出力履歴の受信
    socketInstance.on('terminal-output-history', (data) => {
      setTerminalHistories(prev => {
        const newHistories = new Map(prev);
        newHistories.set(data.terminalId, data.history);
        return newHistories;
      });
    });

    // コマンドショートカット関連のイベントハンドラ
    socketInstance.on('shortcuts-list', (data) => {
      setShortcuts(data.shortcuts);
    });

    socketInstance.on('shortcut-created', (data) => {
      if (data.success) {
        setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
      } else {
        setRawOutput(prev => prev + `\n[ERROR] ${data.message}\n`);
      }
    });

    socketInstance.on('shortcut-deleted', (data) => {
      if (data.success) {
        setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
      } else {
        setRawOutput(prev => prev + `\n[ERROR] ${data.message}\n`);
      }
    });

    socketInstance.on('shortcut-executed', (data) => {
      if (!data.success) {
        setRawOutput(prev => prev + `\n[ERROR] ${data.message}\n`);
      }
    });
    
    // ブランチ関連のイベントハンドラ
    socketInstance.on('branches-list', (data) => {
      if (data.repositoryPath === currentRepoRef.current) {
        setBranches(data.branches);
        const current = data.branches.find((b: GitBranch) => b.current);
        if (current) {
          setCurrentBranch(current.name);
        }
      }
    });
    
    socketInstance.on('branch-switched', (data) => {
      if (data.repositoryPath === currentRepoRef.current) {
        if (data.success) {
          setCurrentBranch(data.currentBranch);
          setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
        } else {
          setRawOutput(prev => prev + `\n[ERROR] ${data.message}\n`);
        }
      }
    });

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      socketInstance.disconnect();
    };
  }, [connectionAttempts]); // connectionAttemptsの変更のみ監視

  const handleCloneRepository = (url: string, name: string) => {
    if (socket) {
      socket.emit('clone-repo', { url, name });
    }
  };

  const handleCreateRepository = (name: string) => {
    if (socket) {
      socket.emit('create-repo', { name });
    }
  };

  const handleDeleteRepository = (path: string, name: string) => {
    if (socket) {
      socket.emit('delete-repo', { path, name });
    }
  };

  const handleSwitchRepository = (path: string) => {
    if (socket) {
      socket.emit('switch-repo', { path });
      // URLにリポジトリパスを保存
      const url = new URL(window.location.href);
      url.searchParams.set('repo', path);
      window.history.pushState({}, '', url.toString());
    }
  };

  const handleBackToRepoSelection = () => {
    setCurrentRepo('');
    setRawOutput(''); // CLIログをクリア
    // URLからリポジトリパラメータを削除
    const url = new URL(window.location.href);
    url.searchParams.delete('repo');
    window.history.pushState({}, '', url.toString());
  };

  // コマンドショートカット関連のハンドラ
  const handleCreateShortcut = (name: string, command: string) => {
    if (socket && currentRepo) {
      const shortcutData = {
        command,
        repositoryPath: currentRepo,
        ...(name.trim() ? { name: name.trim() } : {}) // nameが入力されている場合のみ追加
      };
      socket.emit('create-shortcut', shortcutData);
    }
  };

  const handleDeleteShortcut = (shortcutId: string) => {
    if (socket) {
      socket.emit('delete-shortcut', { shortcutId });
    }
  };

  const handleExecuteShortcut = (shortcutId: string, terminalId: string) => {
    if (socket) {
      socket.emit('execute-shortcut', { shortcutId, terminalId });
    }
  };

  const handleSendCommand = (command: string) => {
    if (socket) {
      socket.emit('send-command', { 
        command,
        sessionId: currentSessionId,
        repositoryPath: currentRepo
      });
    }
  };

  const handleSendArrowKey = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (socket) {
      // 方向キーに対応するANSIエスケープシーケンス
      const arrowKeys = {
        up: '\x1b[A',
        down: '\x1b[B',
        right: '\x1b[C',
        left: '\x1b[D'
      };
      socket.emit('send-command', { 
        command: arrowKeys[direction],
        sessionId: currentSessionId,
        repositoryPath: currentRepo
      });
    }
  };

  const handleSendInterrupt = () => {
    if (socket) {
      socket.emit('claude-interrupt', {
        sessionId: currentSessionId,
        repositoryPath: currentRepo
      });
    }
  };

  const handleSendEscape = () => {
    if (socket) {
      socket.emit('send-command', { 
        command: '\x1b', // ESC (ASCII 27)
        sessionId: currentSessionId,
        repositoryPath: currentRepo
      });
    }
  };

  const handleClearClaude = () => {
    if (socket) {
      socket.emit('send-command', { 
        command: '/clear',
        sessionId: currentSessionId,
        repositoryPath: currentRepo
      });
    }
  };

  // ターミナル関連のハンドラ
  const handleCreateTerminal = (cwd: string, name?: string) => {
    if (socket) {
      socket.emit('create-terminal', { cwd, name });
    }
  };

  const handleTerminalInput = (terminalId: string, input: string) => {
    if (socket) {
      socket.emit('terminal-input', { terminalId, input });
    }
  };

  const handleTerminalSignal = (terminalId: string, signal: string) => {
    if (socket) {
      socket.emit('terminal-signal', { terminalId, signal });
    }
  };

  const handleCloseTerminal = (terminalId: string) => {
    if (socket) {
      socket.emit('close-terminal', { terminalId });
    }
  };
  
  // ブランチ関連のハンドラ
  const handleSwitchBranch = (branchName: string) => {
    if (socket && currentRepo) {
      socket.emit('switch-branch', { repositoryPath: currentRepo, branchName });
    }
  };

  // リポジトリが選択されていない場合はリポジトリ管理画面を表示
  if (!currentRepo) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="min-h-screen flex flex-col">
          {/* ヘッダー */}
          <header className="bg-gray-800 shadow-sm border-b border-gray-700">
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-white">
                    dokodemo-claude
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-300 mt-1">
                    Claude Code CLI Web Interface
                  </p>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-green-500' : 
                    isReconnecting ? 'bg-yellow-500' : 'bg-red-500'
                  }`}></div>
                  <span className="text-xs text-gray-300 font-medium">
                    {isConnected ? '接続中' : 
                     isReconnecting ? `再接続中 (${connectionAttempts})` : '未接続'}
                  </span>
                </div>
              </div>
            </div>
          </header>

          {/* メインコンテンツ */}
          <main className="flex-1 flex items-center justify-center p-3 sm:p-4">
            <div className="w-full max-w-4xl">
              <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-4 sm:px-8 sm:py-6 bg-gradient-to-r from-gray-700 to-gray-600 text-white">
                  <h2 className="text-lg sm:text-xl font-semibold text-center">
                    リポジトリを選択してください
                  </h2>
                  <p className="text-gray-200 text-xs sm:text-sm text-center mt-2">
                    既存のリポジトリを選択するか、新しいリポジトリをクローンしてください
                  </p>
                </div>
                <div className="p-4 sm:p-8">
                  <RepositoryManager
                    repositories={repositories}
                    currentRepo={currentRepo}
                    onCloneRepository={handleCloneRepository}
                    onCreateRepository={handleCreateRepository}
                    onSwitchRepository={handleSwitchRepository}
                    isConnected={isConnected}
                  />
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // リポジトリが選択されている場合はメイン画面を表示
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-gray-800 shadow-sm border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
            <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
              <button
                onClick={handleBackToRepoSelection}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-200 bg-gray-700 border border-gray-600 rounded-md hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors flex-shrink-0"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="hidden xs:inline">リポジトリ選択</span>
                <span className="xs:hidden">戻る</span>
              </button>
              <div className="border-l border-gray-600 pl-2 sm:pl-4 min-w-0 flex-1">
                <h1 className="text-sm sm:text-lg font-semibold text-white truncate">
                  {currentRepo.split('/').pop() || 'プロジェクト'}
                </h1>
                <p className="text-xs text-gray-400 truncate max-w-full sm:max-w-96">{currentRepo}</p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : 
                  isReconnecting ? 'bg-yellow-500' : 'bg-red-500'
                }`}></div>
                <span className="text-xs text-gray-300 font-medium">
                  {isConnected ? '接続中' : 
                   isReconnecting ? `再接続中 (${connectionAttempts})` : '未接続'}
                </span>
                {currentSessionId && (
                  <span className="text-xs text-blue-400 font-mono">
                    #{currentSessionId.split('-')[1]}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 lg:px-8 py-4 sm:py-6 flex flex-col space-y-4 sm:space-y-6">
        {/* ブランチセレクター */}
        <div className="flex items-center space-x-4">
          <BranchSelector
            branches={branches}
            currentBranch={currentBranch}
            onSwitchBranch={handleSwitchBranch}
            isConnected={isConnected}
          />
          <span className="text-sm text-gray-400">
            現在のブランチ: <span className="font-mono text-blue-400">{currentBranch || '不明'}</span>
          </span>
        </div>
        
        {/* Claude CLI セクション */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700 flex-1 flex flex-col min-h-80 sm:min-h-96">
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-gray-700 bg-gray-750 rounded-t-lg">
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Claude CLI
            </h2>
          </div>
          <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-6">
            {/* Claude出力エリア */}
            <div className="flex-1 min-h-0">
              <ClaudeOutput rawOutput={rawOutput} />
            </div>

            {/* Claude コマンド入力エリア */}
            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-700">
              <CommandInput
                onSendCommand={handleSendCommand}
                onSendArrowKey={handleSendArrowKey}
                onSendInterrupt={handleSendInterrupt}
                onSendEscape={handleSendEscape}
                onClearClaude={handleClearClaude}
                disabled={!isConnected || !currentRepo}
              />
            </div>
          </div>
        </section>

        {/* ターミナルエリア */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700 flex-1 flex flex-col min-h-80 sm:min-h-96">
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-gray-700 bg-gray-750 rounded-t-lg">
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              ターミナル
            </h2>
          </div>
          <div className="flex-1 min-h-0 p-3 sm:p-6">
            <TerminalManager
              terminals={terminals}
              messages={terminalMessages}
              histories={terminalHistories}
              shortcuts={shortcuts}
              currentRepo={currentRepo}
              isConnected={isConnected}
              onCreateTerminal={handleCreateTerminal}
              onTerminalInput={handleTerminalInput}
              onTerminalSignal={handleTerminalSignal}
              onCloseTerminal={handleCloseTerminal}
              onCreateShortcut={handleCreateShortcut}
              onDeleteShortcut={handleDeleteShortcut}
              onExecuteShortcut={handleExecuteShortcut}
            />
          </div>
        </section>

        {/* リポジトリ削除セクション */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700">
          <div className="px-4 sm:px-6 py-4">
            <h3 className="text-base font-semibold text-white mb-3">
              リポジトリを削除
            </h3>
            <div className="text-center">
              <p className="text-sm text-gray-300 mb-4">
                このリポジトリを完全に削除します（この操作は元に戻せません）
              </p>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={!isConnected}
                className="inline-flex items-center justify-center px-6 py-2 text-sm font-medium text-red-200 bg-red-900 border border-red-700 rounded-md hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                削除
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* 削除確認ダイアログ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-700">
            <div className="flex items-center space-x-3 mb-4">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-white">
                  リポジトリを削除しますか？
                </h3>
              </div>
            </div>
            <div className="mb-6">
              <div className="bg-red-900 rounded-md p-4 mb-4 border border-red-700">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h4 className="text-sm font-medium text-red-200">
                      注意: この操作は元に戻せません
                    </h4>
                    <div className="mt-2 text-sm text-red-300">
                      <ul className="list-disc list-inside space-y-1">
                        <li>リポジトリディレクトリ全体が削除されます</li>
                        <li>Claude CLIセッションが終了されます</li>
                        <li>実行中のターミナルが全て終了されます</li>
                        <li>履歴データがすべて消去されます</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-700 rounded-md p-3 border border-gray-600">
                <p className="text-sm font-medium text-white">{currentRepo.split('/').pop()}</p>
                <p className="text-xs text-gray-400 mt-1">{currentRepo}</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const repoName = currentRepo.split('/').pop() || '';
                  handleDeleteRepository(currentRepo, repoName);
                  setShowDeleteConfirm(false);
                }}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors font-medium"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;