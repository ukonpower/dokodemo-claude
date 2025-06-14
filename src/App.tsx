import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { 
  ClaudeMessage, 
  GitRepository, 
  ServerToClientEvents, 
  ClientToServerEvents 
} from './types';

import RepositoryManager from './components/RepositoryManager';
import ClaudeOutput from './components/ClaudeOutput';
import CommandInput from './components/CommandInput';

function App() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [currentRepo, setCurrentRepo] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socketInstance = io('http://localhost:3001');
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      setIsConnected(true);
      console.log('サーバーに接続しました');
      // 接続時にリポジトリ一覧を取得
      socketInstance.emit('list-repos');
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
      console.log('サーバーから切断されました');
    });

    socketInstance.on('repos-list', (data) => {
      setRepositories(data.repos);
    });

    socketInstance.on('claude-output', (message) => {
      setMessages(prev => [...prev, message]);
    });

    socketInstance.on('repo-cloned', (data) => {
      const message: ClaudeMessage = {
        id: Date.now().toString(),
        type: 'system',
        content: data.message,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, message]);
    });

    socketInstance.on('repo-switched', (data) => {
      if (data.success) {
        setCurrentRepo(data.currentPath);
      }
      const message: ClaudeMessage = {
        id: Date.now().toString(),
        type: 'system',
        content: data.message,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, message]);
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
      setMessages([]); // リポジトリ切り替え時にメッセージをクリア
    }
  };

  const handleSendCommand = (command: string) => {
    if (socket) {
      socket.emit('send-command', { command });
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

          {/* メインエリア - Claude CLI */}
          <div className="lg:col-span-3 space-y-4">
            {/* Claude出力エリア */}
            <ClaudeOutput messages={messages} />

            {/* コマンド入力エリア */}
            <CommandInput
              onSendCommand={handleSendCommand}
              disabled={!isConnected || !currentRepo}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
