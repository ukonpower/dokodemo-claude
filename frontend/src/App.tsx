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
  const [isConnected, setIsConnected] = useState(false);
  
  // ターミナル関連の状態
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalMessages, setTerminalMessages] = useState<TerminalMessage[]>([]);

  useEffect(() => {
    const socketInstance = io('http://localhost:3001');
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      setIsConnected(true);
      // 接続時にリポジトリ一覧とターミナル一覧を取得
      socketInstance.emit('list-repos');
      socketInstance.emit('list-terminals');
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

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
        setRawOutput(''); // リポジトリ切り替え時にログをクリア
      }
      // システムメッセージは表示しない（Claude CLIの出力のみを表示）
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
      socketInstance.disconnect();
    };
  }, []);

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

  const handleSendCommand = (command: string) => {
    if (socket) {
      socket.emit('send-command', { command });
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        {/* ヘッダー */}
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            dokodemo-claude
          </h1>
          <p className="text-gray-600">
            Claude Code CLI Web Interface
          </p>
          <div className="mt-2 flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-gray-500">
              {isConnected ? 'サーバー接続中' : 'サーバー未接続'}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* サイドバー - リポジトリ管理 */}
          <div className="lg:col-span-1">
            <RepositoryManager
              repositories={repositories}
              currentRepo={currentRepo}
              onCloneRepository={handleCloneRepository}
              onSwitchRepository={handleSwitchRepository}
              isConnected={isConnected}
            />
          </div>

          {/* メインエリア - Claude CLI & Terminal */}
          <div className="lg:col-span-3 space-y-4">
            {/* Claude出力エリア */}
            <ClaudeOutput rawOutput={rawOutput} />

            {/* ターミナルエリア */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">ターミナル</h2>
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

            {/* Claude コマンド入力エリア */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Claude コマンド</h2>
              <CommandInput
                onSendCommand={handleSendCommand}
                disabled={!isConnected || !currentRepo}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;