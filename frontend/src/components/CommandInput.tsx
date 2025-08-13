import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';

interface CommandInputProps {
  onSendCommand: (command: string) => void;
  onSendArrowKey?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSendInterrupt?: () => void;
  onSendEscape?: () => void;
  onClearClaude?: () => void;
  onChangeModel?: (model: 'default' | 'Opus' | 'Sonnet') => void;
  disabled?: boolean;
}

export interface CommandInputRef {
  focus: () => void;
}

const CommandInput = forwardRef<CommandInputRef, CommandInputProps>(
  (
    {
      onSendCommand,
      onSendArrowKey,
      onSendInterrupt,
      onSendEscape,
      onClearClaude,
      onChangeModel,
      disabled = false,
    },
    ref
  ) => {
    const [command, setCommand] = useState('');
    const [showModelMenu, setShowModelMenu] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const sendCommand = () => {
      if (disabled) return;

      if (command.trim()) {
        // コマンドが入力されている場合：通常のコマンド送信
        // コマンド送信
        onSendCommand(command);
        setCommand('');
      } else {
        // コマンドが入力されていない場合：エンターキーを送信
        onSendCommand('\r');
      }
    };

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      sendCommand();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      // Ctrl+Enter または Cmd+Enter で送信
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendCommand();
        return;
      }

      // ESCキーでESC送信
      if (e.key === 'Escape' && onSendEscape) {
        e.preventDefault();
        onSendEscape();
        return;
      }
    };

    // フォーカスを自動で設定
    useEffect(() => {
      if (!disabled && inputRef.current) {
        inputRef.current.focus();
      }
    }, [disabled]);

    // refでフォーカスメソッドを公開
    useImperativeHandle(ref, () => ({
      focus: () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      },
    }));

    return (
      <div className="space-y-3 sm:space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          <div>
            <textarea
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? 'リポジトリを選択してください...'
                  : 'Claude CLIへの指示を入力してください'
              }
              className="w-full px-3 py-2.5 sm:py-2 border border-gray-600 bg-gray-800 text-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 resize-none text-sm sm:text-base placeholder-gray-400"
              rows={3}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col space-y-4">
            {/* 上段: 方向キーとEnterボタン */}
            <div className="flex items-center justify-center space-x-6">
              {/* 方向キーボタン */}
              {onSendArrowKey && (
                <div className="flex flex-col items-center">
                  <div className="grid grid-cols-3 gap-1">
                    <div></div>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('up')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                      title="上キー"
                    >
                      ↑
                    </button>
                    <div></div>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('left')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                      title="左キー"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('down')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                      title="下キー"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendArrowKey('right')}
                      disabled={disabled}
                      className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-sm font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                      title="右キー"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}

              {/* 送信ボタン */}
              <div className="flex flex-col items-center">
                <button
                  type="submit"
                  disabled={disabled}
                  className="bg-blue-600 text-white px-8 py-3 sm:px-6 sm:py-2.5 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium min-h-[2.5rem] flex items-center touch-manipulation"
                >
                  Enter
                </button>
              </div>
            </div>

            {/* 下段: 制御ボタン群 */}
            <div className="flex items-center justify-center">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                {onSendInterrupt && (
                  <button
                    type="button"
                    onClick={onSendInterrupt}
                    disabled={disabled}
                    className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                    title="プロセスを中断 (Ctrl+C)"
                  >
                    Ctrl+C
                  </button>
                )}
                {onSendEscape && (
                  <button
                    type="button"
                    onClick={onSendEscape}
                    disabled={disabled}
                    className="flex items-center justify-center w-14 h-9 sm:w-16 sm:h-10 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-red-600 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-red-400 touch-manipulation"
                    title="エスケープキー (ESC)"
                  >
                    ESC
                  </button>
                )}
                {onClearClaude && (
                  <button
                    type="button"
                    onClick={onClearClaude}
                    disabled={disabled}
                    className="flex items-center justify-center w-14 h-9 sm:w-16 sm:h-10 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-gray-500 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-gray-400 touch-manipulation"
                    title="Claude CLIをクリア (/clear)"
                  >
                    Clear
                  </button>
                )}
                {onChangeModel && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowModelMenu(!showModelMenu)}
                      disabled={disabled}
                      className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-purple-600 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-purple-400 touch-manipulation"
                      title="モデルを選択"
                    >
                      Model
                    </button>
                    {showModelMenu && (
                      <div className="absolute bottom-full left-0 mb-2 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-10 min-w-[100px]">
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('default');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-gray-600 rounded-t-md"
                        >
                          Default
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('Opus');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-gray-600"
                        >
                          Opus
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onChangeModel('Sonnet');
                            setShowModelMenu(false);
                          }}
                          className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-gray-600 rounded-b-md"
                        >
                          Sonnet
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onSendCommand('/commit')}
                  disabled={disabled}
                  className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-green-600 text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-green-400 touch-manipulation"
                  title="コミット (/commit)"
                >
                  Commit
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    );
  }
);

CommandInput.displayName = 'CommandInput';

export default CommandInput;
