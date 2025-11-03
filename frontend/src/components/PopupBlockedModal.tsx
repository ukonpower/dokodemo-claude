import React from 'react';

interface PopupBlockedModalProps {
  isOpen: boolean;
  url: string;
  onClose: () => void;
  onOpenInNewTab: () => void;
}

export const PopupBlockedModal: React.FC<PopupBlockedModalProps> = ({
  isOpen,
  onClose,
  onOpenInNewTab,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-dark-bg-secondary rounded-lg shadow-2xl max-w-md w-full p-6 border border-dark-border-light"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex-shrink-0">
            <svg
              className="h-6 w-6 text-yellow-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1-1.732-1-2.5 0L4.268 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-medium text-white">
              ポップアップがブロックされました
            </h3>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-300 leading-relaxed">
            code-serverを開くにはポップアップを許可するか、下のボタンから別タブで開いてください。
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="flex-1 bg-dark-bg-tertiary text-gray-300 py-2 px-4 rounded-lg hover:bg-dark-bg-hover focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-light transition-all duration-150 font-medium"
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              onOpenInNewTab();
              onClose();
            }}
            className="flex-1 bg-dark-accent-blue text-white py-2 px-4 rounded-lg hover:bg-dark-accent-blue-hover focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-accent-blue transition-all duration-150 font-medium shadow-md"
          >
            別タブで開く
          </button>
        </div>
      </div>
    </div>
  );
};
