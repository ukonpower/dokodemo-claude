import React, { useEffect, useRef } from 'react';
import type { ClaudeMessage } from '../types';

interface ClaudeOutputProps {
  messages: ClaudeMessage[];
}

const ClaudeOutput: React.FC<ClaudeOutputProps> = ({ messages }) => {
  const outputRef = useRef<HTMLDivElement>(null);

  // 新しいメッセージが追加されたら自動スクロール
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [messages]);

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getMessageClassName = (type: ClaudeMessage['type']): string => {
    const baseClass = 'claude-message';
    switch (type) {
      case 'user':
        return `${baseClass} claude-message-user`;
      case 'claude':
        return `${baseClass} claude-message-claude`;
      case 'system':
        return `${baseClass} claude-message-system`;
      default:
        return baseClass;
    }
  };

  const getMessagePrefix = (type: ClaudeMessage['type']): string => {
    switch (type) {
      case 'user':
        return 'あなた';
      case 'claude':
        return 'Claude';
      case 'system':
        return 'システム';
      default:
        return '';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">
          Claude Code CLI 出力
        </h2>
      </div>
      
      <div
        ref={outputRef}
        className="h-96 overflow-y-auto p-0"
      >
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-sm">Claude CLIの出力がここに表示されます</p>
              <p className="text-xs mt-1">
                リポジトリを選択してClaude CLIを開始してください
              </p>
            </div>
          </div>
        ) : (
          <div>
            {messages.map((message) => (
              <div
                key={message.id}
                className={getMessageClassName(message.type)}
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    {getMessagePrefix(message.type)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatTimestamp(message.timestamp)}
                  </span>
                </div>
                <div className="text-sm text-gray-900">
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                    {message.content}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaudeOutput;