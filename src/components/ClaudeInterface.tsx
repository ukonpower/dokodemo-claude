import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { ClaudeMessage, GitRepository } from '../types';

export default function ClaudeInterface() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [command, setCommand] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        type: 'system',
        content: 'Claude Code Web Interface に接続しました',
        timestamp: Date.now()
      }]);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('repos-list', (data: { repos: GitRepository[] }) => {
      setRepositories(data.repos);
    });

    newSocket.on('claude-output', (message: ClaudeMessage) => {
      setMessages(prev => [...prev, message]);
    });

    newSocket.emit('list-repos');

    return () => newSocket.close();
  }, []);

  const handleCloneRepo = () => {
    if (!socket || !repoUrl.trim()) return;
    
    const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
    socket.emit('clone-repo', { url: repoUrl, path: repoName });
    setRepoUrl('');
  };

  const handleSwitchRepo = (path: string) => {
    if (!socket) return;
    socket.emit('switch-repo', { path });
    setSelectedRepo(path);
  };

  const handleSendCommand = () => {
    if (!socket || !command.trim()) return;
    
    const userMessage: ClaudeMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: command,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, userMessage]);
    socket.emit('send-command', { command });
    setCommand('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSendCommand();
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg">
        <div className="border-b p-4">
          <h1 className="text-2xl font-bold text-gray-800">
            Claude Code Web Interface
          </h1>
          <div className="mt-2 text-sm">
            接続状況: 
            <span className={`ml-2 px-2 py-1 rounded ${
              isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {isConnected ? '接続中' : '切断'}
            </span>
          </div>
        </div>

        <div className="p-4 border-b bg-gray-50">
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                リポジトリURL:
              </label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleCloneRepo}
                disabled={!isConnected || !repoUrl.trim()}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300"
              >
                Clone
              </button>
            </div>
          </div>

          {repositories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                現在のプロジェクト:
              </label>
              <select
                value={selectedRepo}
                onChange={(e) => handleSwitchRepo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">プロジェクトを選択</option>
                {repositories.map((repo) => (
                  <option key={repo.path} value={repo.path}>
                    {repo.path} ({repo.status})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Claude Code CLI 出力表示エリア
          </h2>
          <div className="bg-black text-green-400 p-4 rounded h-96 overflow-y-auto font-mono text-sm">
            {messages.length === 0 ? (
              <div>claude&gt; 待機中...</div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="mb-2">
                  <span className={
                    message.type === 'user' ? 'text-blue-400' :
                    message.type === 'system' ? 'text-yellow-400' :
                    'text-green-400'
                  }>
                    {message.type === 'user' ? 'user>' :
                     message.type === 'system' ? 'system>' : 'claude>'}
                  </span>
                  <span className="ml-2">{message.content}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            コマンド入力:
          </label>
          <div className="flex gap-2">
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Claudeへの指示を入力してください... (Ctrl+Enter で送信)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
            />
            <button
              onClick={handleSendCommand}
              disabled={!isConnected || !command.trim()}
              className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 self-end"
            >
              送信
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Ctrl+Enter でも送信できます
          </p>
        </div>
      </div>
    </div>
  );
}