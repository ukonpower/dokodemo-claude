import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  GitRepository,
  Terminal,
  TerminalMessage,
  ServerToClientEvents,
  ClientToServerEvents
} from './types';

import RepositoryManager from './components/RepositoryManager';
import ClaudeOutput from './components/ClaudeOutput';
import CommandInput from './components/CommandInput';
import TerminalManager from './components/TerminalManager';

function App() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [rawOutput, setRawOutput] = useState<string>(''); // 生ログを保持
  const [currentRepo, setCurrentRepo] = useState<string>('');
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // ターミナル関連の状態
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalMessages, setTerminalMessages] = useState<TerminalMessage[]>([]);

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
        setIsConnected(true);
        setIsReconnecting(false);
        setConnectionAttempts(0);
        
        // 接続時にリポジトリ一覧を取得
        socketInstance.emit('list-repos');
        
        // 現在のリポジトリのターミナル一覧を取得
        if (currentRepo) {
          socketInstance.emit('list-terminals', { repositoryPath: currentRepo });
        } else {
          socketInstance.emit('list-terminals');
        }
      });

      socketInstance.on('disconnect', (reason) => {
        setIsConnected(false);
        console.log('Socket disconnected:', reason);
        
        // 自動再接続の場合は手動再接続を試行
        if (reason === 'io server disconnect') {
          setIsReconnecting(true);
          attemptReconnect();
        }
      });

      socketInstance.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
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
          console.log(`Reconnecting... attempt ${connectionAttempts + 1}`);
          createConnection();
        }, reconnectDelay * (connectionAttempts + 1)); // 指数バックオフ
      } else {
        setIsReconnecting(false);
        console.error('Max reconnection attempts reached');
      }
    };

    const socketInstance = createConnection();

    socketInstance.on('repos-list', (data) => {
      setRepositories(data.repos);
    });

    // 生ログの受信
    socketInstance.on('claude-raw-output', (data) => {
      setRawOutput(prev => prev + data.content);
    });

    socketInstance.on('repo-cloned', (data) => {
      setRawOutput(prev => prev + `\n[SYSTEM] ${data.message}\n`);
    });

    socketInstance.on('repo-switched', (data) => {
      if (data.success) {
        setCurrentRepo(data.currentPath);
        setCurrentSessionId(data.sessionId || '');
        setRawOutput(''); // リポジトリ切り替え時にログをクリア
        // スクロールを最上部に戻す
        window.scrollTo(0, 0);
        
        // 新しいリポジトリのターミナル一覧を取得
        socketInstance.emit('list-terminals', { repositoryPath: data.currentPath });
      }
      // システムメッセージは表示しない（Claude CLIの出力のみを表示）
    });

    // Claude セッション作成イベント
    socketInstance.on('claude-session-created', (data) => {
      if (data.repositoryPath === currentRepo) {
        setCurrentSessionId(data.sessionId);
      }
      setRawOutput(prev => prev + `\n[SYSTEM] Claude CLI セッション開始: ${data.repositoryName}\n`);
    });

    // ターミナル関連のイベントハンドラ
    socketInstance.on('terminals-list', (data) => {
      setTerminals(data.terminals);
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
    });

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      socketInstance.disconnect();
    };
  }, [currentRepo, connectionAttempts]); // currentRepoとconnectionAttemptsの変更も監視

  const handleCloneRepository = (url: string, name: string) => {
    if (socket) {
      socket.emit('clone-repo', { url, name });
    }
  };

  const handleSwitchRepository = (path: string) => {
    if (socket) {
      socket.emit('switch-repo', { path });
    }
  };

  const handleBackToRepoSelection = () => {
    setCurrentRepo('');
    setRawOutput(''); // CLIログをクリア
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

  // リポジトリが選択されていない場合はリポジトリ管理画面を表示
  if (!currentRepo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="min-h-screen flex flex-col">
          {/* ヘッダー */}
          <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900">
                    dokodemo-claude
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-600 mt-1">
                    Claude Code CLI Web Interface
                  </p>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-green-500' : 
                    isReconnecting ? 'bg-yellow-500' : 'bg-red-500'
                  }`}></div>
                  <span className="text-xs text-gray-500 font-medium">
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
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-4 sm:px-8 sm:py-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                  <h2 className="text-lg sm:text-xl font-semibold text-center">
                    リポジトリを選択してください
                  </h2>
                  <p className="text-blue-100 text-xs sm:text-sm text-center mt-2">
                    既存のリポジトリを選択するか、新しいリポジトリをクローンしてください
                  </p>
                </div>
                <div className="p-4 sm:p-8">
                  <RepositoryManager
                    repositories={repositories}
                    currentRepo={currentRepo}
                    onCloneRepository={handleCloneRepository}
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
            <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
              <button
                onClick={handleBackToRepoSelection}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors flex-shrink-0"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="hidden xs:inline">リポジトリ選択</span>
                <span className="xs:hidden">戻る</span>
              </button>
              <div className="border-l border-gray-300 pl-2 sm:pl-4 min-w-0 flex-1">
                <h1 className="text-sm sm:text-lg font-semibold text-gray-900 truncate">
                  {currentRepo.split('/').pop() || 'プロジェクト'}
                </h1>
                <p className="text-xs text-gray-500 truncate max-w-full sm:max-w-96">{currentRepo}</p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-green-500' : 
                  isReconnecting ? 'bg-yellow-500' : 'bg-red-500'
                }`}></div>
                <span className="text-xs text-gray-500 font-medium">
                  {isConnected ? '接続中' : 
                   isReconnecting ? `再接続中 (${connectionAttempts})` : '未接続'}
                </span>
                {currentSessionId && (
                  <span className="text-xs text-blue-600 font-mono">
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
        {/* Claude CLI セクション */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Claude CLI
            </h2>
          </div>
          <div className="p-3 sm:p-6">
            {/* Claude出力エリア */}
            <ClaudeOutput rawOutput={rawOutput} />

            {/* Claude コマンド入力エリア */}
            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-100">
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
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 flex-1 flex flex-col min-h-80 sm:min-h-96">
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-gray-200 bg-gray-50 rounded-t-lg">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              ターミナル
            </h2>
          </div>
          <div className="flex-1 min-h-0 p-3 sm:p-6">
            <TerminalManager
              terminals={terminals}
              messages={terminalMessages}
              currentRepo={currentRepo}
              isConnected={isConnected}
              onCreateTerminal={handleCreateTerminal}
              onTerminalInput={handleTerminalInput}
              onTerminalSignal={handleTerminalSignal}
              onCloseTerminal={handleCloseTerminal}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;