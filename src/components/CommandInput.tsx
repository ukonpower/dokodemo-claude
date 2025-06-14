import React, { useState, useRef, useEffect } from 'react';

interface CommandInputProps {
  onSendCommand: (command: string) => void;
  disabled?: boolean;
}

const CommandInput: React.FC<CommandInputProps> = ({ onSendCommand, disabled = false }) => {
  const [command, setCommand] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || disabled) return;

    // コマンド履歴に追加
    setCommandHistory(prev => [...prev, command]);
    setHistoryIndex(-1);

    // コマンド送信
    onSendCommand(command);
    setCommand('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+Enter または Cmd+Enter で送信
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
      return;
    }

    // 上下キーでコマンド履歴をナビゲート
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex + 1;
        if (newIndex < commandHistory.length) {
          setHistoryIndex(newIndex);
          setCommand(commandHistory[commandHistory.length - 1 - newIndex]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand('');
      }
    }
  };

  // フォーカスを自動で設定
  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [disabled]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">
          コマンド入力
        </h2>
      </div>
      
      <form onSubmit={handleSubmit} className="p-4">
        <div className="space-y-3">
          <div>
            <textarea
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? "リポジトリを選択してください..."
                  : "Claude CLIへの指示を入力してください (Ctrl+Enter で送信)"
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 resize-none"
              rows={3}
              disabled={disabled}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {disabled ? (
                "サーバーに接続してリポジトリを選択してください"
              ) : (
                <>
                  <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded">
                    Ctrl
                  </kbd>
                  +
                  <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded">
                    Enter
                  </kbd>
                  で送信 | 
                  <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded">
                    ↑↓
                  </kbd>
                  で履歴
                </>
              )}
            </div>
            
            <button
              type="submit"
              disabled={disabled || !command.trim()}
              className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              送信
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CommandInput;