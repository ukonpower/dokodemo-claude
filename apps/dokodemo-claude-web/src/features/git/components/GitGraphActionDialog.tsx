import React, { useState, useEffect, useRef } from 'react';
import { useOverlayClose } from '@/shared/hooks/useOverlayClose';
import s from './GitGraphActionDialog.module.scss';

export interface GitGraphDialogCheckbox {
  key: string;
  label: string;
  defaultChecked: boolean;
}

export interface GitGraphDialogInput {
  label: string;
  defaultValue: string;
  placeholder?: string;
}

interface GitGraphActionDialogProps {
  message: string;
  input?: GitGraphDialogInput;
  checkboxes?: GitGraphDialogCheckbox[];
  confirmLabel: string;
  /**
   * 実行される git コマンドのプレビュー。入力値・チェック状態から組み立てて返す。
   * 指定すると確認ボタンの上に実行コマンドを表示し、実際に何が走るかを明示する。
   */
  previewCommand?: (state: {
    inputValue: string;
    checks: Record<string, boolean>;
  }) => string;
  onConfirm: (result: {
    inputValue: string;
    checks: Record<string, boolean>;
  }) => void;
  onCancel: () => void;
}

/**
 * checkout / merge の確認ダイアログ
 * （vscode-git-graph のアクションダイアログ相当: メッセージ + 入力 + チェックボックス + Yes/Cancel）
 */
const GitGraphActionDialog: React.FC<GitGraphActionDialogProps> = ({
  message,
  input,
  checkboxes,
  confirmLabel,
  previewCommand,
  onConfirm,
  onCancel,
}) => {
  const [inputValue, setInputValue] = useState(input?.defaultValue ?? '');
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const cb of checkboxes ?? []) init[cb.key] = cb.defaultChecked;
    return init;
  });

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const confirmDisabled = input !== undefined && inputValue.trim() === '';

  const overlayProps = useOverlayClose(onCancel);

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm({ inputValue: inputValue.trim(), checks });
  };

  return (
    <div className={s.overlay} {...overlayProps}>
      <div className={s.dialog}>
        <div className={s.message}>{message}</div>

        {input && (
          <label className={s.inputRow}>
            <span className={s.inputLabel}>{input.label}</span>
            <input
              ref={inputRef}
              className={s.textInput}
              type="text"
              value={inputValue}
              placeholder={input.placeholder}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
              }}
            />
          </label>
        )}

        {checkboxes && checkboxes.length > 0 && (
          <div className={s.checkboxes}>
            {checkboxes.map((cb) => (
              <label key={cb.key} className={s.checkboxRow}>
                <input
                  type="checkbox"
                  checked={checks[cb.key] ?? false}
                  onChange={(e) =>
                    setChecks((prev) => ({
                      ...prev,
                      [cb.key]: e.target.checked,
                    }))
                  }
                />
                <span>{cb.label}</span>
              </label>
            ))}
          </div>
        )}

        {previewCommand && (
          <div className={s.commandPreview}>
            <span className={s.commandLabel}>実行するコマンド</span>
            <code className={s.commandCode}>
              {previewCommand({ inputValue: inputValue.trim(), checks })}
            </code>
          </div>
        )}

        <div className={s.buttons}>
          <button
            className={s.confirmButton}
            onClick={handleConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
          <button className={s.cancelButton} onClick={onCancel}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
};

export default GitGraphActionDialog;
