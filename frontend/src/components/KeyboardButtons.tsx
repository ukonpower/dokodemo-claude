import React, { useState } from 'react';

/**
 * KeyboardButtons コンポーネントのプロパティ
 */
interface KeyboardButtonsProps {
  /** ボタンの無効化状態 */
  disabled?: boolean;
  /** 方向キー送信ハンドラ（オプション） */
  onSendArrowKey?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  /** Enter送信ハンドラ */
  onSendEnter: () => void;
  /** Ctrl+C送信ハンドラ（オプション） */
  onSendInterrupt?: () => void;
  /** ESC送信ハンドラ（オプション） */
  onSendEscape?: () => void;
  /** Clear送信ハンドラ（オプション） */
  onClearAi?: () => void;
  /** Tab送信ハンドラ（オプション） */
  onSendTabKey?: (shift: boolean) => void;
  /** モデル変更ハンドラ（オプション） */
  onChangeModel?: (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => void;
  /** 現在のプロバイダー（'claude' | 'codex'） */
  currentProvider?: string;
  /** プロバイダー情報（クリアボタンのツールチップ用） */
  providerInfo?: {
    clearTitle: string;
  };
}

/**
 * キーボード操作用のボタン群コンポーネント
 * 方向キー、Enter、Ctrl+C、ESC、Clear、Mode、Model、Commitなどのボタンを表示
 */
export const KeyboardButtons: React.FC<KeyboardButtonsProps> = ({
  disabled = false,
  onSendArrowKey,
  onSendEnter,
  onSendInterrupt,
  onSendEscape,
  onClearAi,
  onSendTabKey,
  onChangeModel,
  currentProvider = 'claude',
  providerInfo,
}) => {
  const [showModelMenu, setShowModelMenu] = useState(false);

  return (
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
                className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                title="上キー"
              >
                ↑
              </button>
              <div></div>
              <button
                type="button"
                onClick={() => onSendArrowKey('left')}
                disabled={disabled}
                className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                title="左キー"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => onSendArrowKey('down')}
                disabled={disabled}
                className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                title="下キー"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onSendArrowKey('right')}
                disabled={disabled}
                className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
                title="右キー"
              >
                →
              </button>
            </div>
          </div>
        )}

        {/* Enterボタン */}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={onSendEnter}
            disabled={disabled}
            className="bg-dark-bg-tertiary border border-gray-500 text-dark-text-primary px-8 py-3 sm:px-6 sm:py-2.5 rounded-lg hover:bg-dark-bg-hover hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold min-h-[2.5rem] flex items-center touch-manipulation shadow-lg transition-all duration-150"
          >
            Enter
          </button>
        </div>
      </div>

      {/* 下段: 制御ボタン群 */}
      <div className="flex items-center justify-center">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {/* Ctrl+Cボタン */}
          {onSendInterrupt && (
            <button
              type="button"
              onClick={onSendInterrupt}
              disabled={disabled}
              className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-dark-bg-secondary border border-gray-500 hover:bg-dark-bg-hover hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-gray-400 touch-manipulation shadow-md transition-all duration-150"
              title="プロセスを中断 (Ctrl+C)"
            >
              Ctrl+C
            </button>
          )}

          {/* ESCボタン */}
          {onSendEscape && (
            <button
              type="button"
              onClick={onSendEscape}
              disabled={disabled}
              className="flex items-center justify-center w-14 h-9 sm:w-16 sm:h-10 bg-dark-bg-secondary border border-dark-accent-red hover:bg-dark-bg-hover hover:border-dark-accent-red-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-red touch-manipulation shadow-md transition-all duration-150"
              title="エスケープキー (ESC)"
            >
              ESC
            </button>
          )}

          {/* Clearボタン */}
          {onClearAi && (
            <button
              type="button"
              onClick={onClearAi}
              disabled={disabled}
              className="flex items-center justify-center w-14 h-9 sm:w-16 sm:h-10 bg-dark-bg-secondary border border-dark-accent-cyan hover:bg-dark-bg-hover hover:border-dark-accent-cyan-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-cyan touch-manipulation shadow-md transition-all duration-150"
              title={providerInfo?.clearTitle || 'クリア'}
            >
              Clear
            </button>
          )}

          {/* 改行（Claude Code専用ボタン用） */}
          <div className="w-full"></div>

          {/* Claude Code専用ボタン: Mode */}
          {currentProvider === 'claude' && onSendTabKey && (
            <button
              type="button"
              onClick={() => onSendTabKey(true)}
              disabled={disabled}
              className="flex items-center justify-center w-20 h-9 sm:w-24 sm:h-10 bg-dark-bg-secondary border border-dark-accent-orange hover:bg-dark-bg-hover hover:border-dark-accent-orange-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-orange touch-manipulation shadow-md transition-all duration-150"
              title="モード切り替え"
            >
              Mode
            </button>
          )}

          {/* Claude Code専用ボタン: Model */}
          {currentProvider === 'claude' && onChangeModel && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelMenu(!showModelMenu)}
                disabled={disabled}
                className="flex items-center justify-center w-16 h-9 sm:w-18 sm:h-10 bg-dark-bg-secondary border border-dark-accent-purple hover:bg-dark-bg-hover hover:border-dark-accent-purple-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-purple touch-manipulation shadow-md transition-all duration-150"
                title="モデルを選択"
              >
                Model
              </button>
              {showModelMenu && (
                <div className="absolute bottom-full left-0 mb-2 bg-dark-bg-secondary border border-dark-border-light rounded-lg shadow-2xl z-10 min-w-[100px] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      onChangeModel('default');
                      setShowModelMenu(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeModel('Opus');
                      setShowModelMenu(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                  >
                    Opus
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeModel('Sonnet');
                      setShowModelMenu(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                  >
                    Sonnet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeModel('OpusPlan');
                      setShowModelMenu(false);
                    }}
                    className="block w-full text-left px-3 py-2 text-xs text-dark-text-primary hover:bg-dark-bg-hover transition-colors duration-150"
                  >
                    OpusPlan
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Claude Code専用ボタン: Commit */}
          {currentProvider === 'claude' && onSendTabKey && (
            <button
              type="button"
              onClick={() => onSendTabKey(false)}
              disabled={disabled}
              className="flex items-center justify-center w-20 h-9 sm:w-24 sm:h-10 bg-dark-bg-secondary border border-dark-accent-green hover:bg-dark-bg-hover hover:border-dark-accent-green-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-mono text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-dark-accent-green touch-manipulation shadow-md transition-all duration-150"
              title="コミット (/commit)"
            >
              Commit
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
