import React, { useState, useEffect } from 'react';
import type { CustomAiButton, CustomAiButtonScope } from '../types';
import s from './KeyboardButtons.module.scss';

interface KeyboardButtonsProps {
  disabled?: boolean;
  onSendArrowKey?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSendEnter: () => void;
  onSendInterrupt?: () => void;
  onSendEscape?: () => void;
  onClearAi?: () => void;
  onSendResume?: () => void;
  onSendUsage?: () => void;
  onSendPreview?: () => void;
  onSendMode?: () => void;
  onSendAltT?: () => void;
  onChangeModel?: (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => void;
  onSendCommit?: () => void;
  currentProvider?: string;
  providerInfo?: {
    clearTitle: string;
  };

  // カスタム送信ボタン
  currentRepositoryPath?: string;
  customButtons: CustomAiButton[];
  onExecuteCustomButton: (command: string) => void;
  onCreateCustomButton: (
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  onUpdateCustomButton: (
    id: string,
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  onDeleteCustomButton: (id: string) => void;
}

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; button: CustomAiButton }
  | null;

interface CustomButtonDialogProps {
  state: { mode: 'add' } | { mode: 'edit'; button: CustomAiButton };
  currentRepositoryPath?: string;
  onSubmit: (
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  onDelete?: () => void;
  onClose: () => void;
}

function CustomButtonDialog({
  state,
  currentRepositoryPath,
  onSubmit,
  onDelete,
  onClose,
}: CustomButtonDialogProps) {
  const initialName = state.mode === 'edit' ? state.button.name : '';
  const initialCommand = state.mode === 'edit' ? state.button.command : '';
  // 既存ボタンの編集時は既存scopeを採用、新規追加時はリポジトリ固有がデフォルト。
  // ただし現在のリポジトリが未選択なら共通のみ選択可能。
  const initialIsGlobal =
    state.mode === 'edit'
      ? state.button.scope === 'global'
      : !currentRepositoryPath;
  const [name, setName] = useState(initialName);
  const [command, setCommand] = useState(initialCommand);
  const [isGlobal, setIsGlobal] = useState(initialIsGlobal);

  // リポジトリパスが取得できない場合は強制的に共通にする
  const scopeToggleDisabled = !currentRepositoryPath;
  const effectiveIsGlobal = scopeToggleDisabled ? true : isGlobal;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const canSubmit = name.trim().length > 0 && command.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const scope: CustomAiButtonScope = effectiveIsGlobal
      ? 'global'
      : 'repository';
    const repoPath =
      scope === 'repository' ? currentRepositoryPath : undefined;
    onSubmit(name.trim(), command.trim(), scope, repoPath);
  };

  const handleDelete = () => {
    if (!onDelete) return;
    if (window.confirm('このボタンを削除しますか？')) {
      onDelete();
    }
  };

  return (
    <div
      className={s.dialogOverlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={s.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className={s.dialogTitle}>
          {state.mode === 'edit' ? 'ボタンを編集' : 'ボタンを追加'}
        </h3>
        <div className={s.dialogField}>
          <label className={s.dialogLabel} htmlFor="custom-btn-name">
            ボタン名
          </label>
          <input
            id="custom-btn-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: レビュー"
            className={s.dialogInput}
            autoFocus
          />
        </div>
        <div className={s.dialogField}>
          <label className={s.dialogLabel} htmlFor="custom-btn-command">
            送信コマンド
          </label>
          <textarea
            id="custom-btn-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="例: /review"
            className={s.dialogTextarea}
          />
        </div>
        <div className={s.dialogCheckboxField}>
          <input
            id="custom-btn-global"
            type="checkbox"
            className={s.dialogCheckbox}
            checked={effectiveIsGlobal}
            disabled={scopeToggleDisabled}
            onChange={(e) => setIsGlobal(e.target.checked)}
          />
          <label className={s.dialogCheckboxLabel} htmlFor="custom-btn-global">
            <span className={s.dialogCheckboxLabelText}>
              全プロジェクトで共通
            </span>
            <span className={s.dialogCheckboxLabelHelp}>
              {scopeToggleDisabled
                ? 'リポジトリが選択されていないため、共通ボタンとして作成されます'
                : 'オフにすると現在のリポジトリでのみ表示されます'}
            </span>
          </label>
        </div>
        <div className={s.dialogButtons}>
          {state.mode === 'edit' && onDelete && (
            <button
              type="button"
              className={s.dialogDeleteButton}
              onClick={handleDelete}
            >
              削除
            </button>
          )}
          <button
            type="button"
            className={s.dialogCancelButton}
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="button"
            className={s.dialogSubmitButton}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export const KeyboardButtons: React.FC<KeyboardButtonsProps> = ({
  disabled = false,
  onSendArrowKey,
  onSendEnter,
  onSendInterrupt,
  onSendEscape,
  onClearAi,
  onSendResume,
  onSendUsage,
  onSendPreview,
  onSendMode,
  onSendAltT,
  onChangeModel,
  onSendCommit,
  currentProvider = 'claude',
  providerInfo,
  currentRepositoryPath,
  customButtons,
  onExecuteCustomButton,
  onCreateCustomButton,
  onUpdateCustomButton,
  onDeleteCustomButton,
}) => {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showAux, setShowAux] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState>(null);

  const isClaude = currentProvider === 'claude';

  const hasAuxButtons =
    onSendInterrupt ||
    (isClaude && (onSendAltT || onSendResume || onSendUsage || onSendPreview));

  const handleDialogSubmit = (
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => {
    if (!dialogState) return;
    if (dialogState.mode === 'add') {
      onCreateCustomButton(name, command, scope, repositoryPath);
    } else {
      onUpdateCustomButton(
        dialogState.button.id,
        name,
        command,
        scope,
        repositoryPath
      );
    }
    setDialogState(null);
  };

  const handleDialogDelete = () => {
    if (dialogState?.mode !== 'edit') return;
    onDeleteCustomButton(dialogState.button.id);
    setDialogState(null);
  };

  return (
    <div className={s.root}>
      {/* 上段: 方向キーとEnterボタン */}
      <div className={s.topRow}>
        {onSendArrowKey && (
          <div className={s.arrowKeysWrapper}>
            <div className={s.arrowGrid}>
              <div></div>
              <button type="button" onClick={() => onSendArrowKey('up')} disabled={disabled} className={s.arrowKey} title="上キー">↑</button>
              <div></div>
              <button type="button" onClick={() => onSendArrowKey('left')} disabled={disabled} className={s.arrowKey} title="左キー">←</button>
              <button type="button" onClick={() => onSendArrowKey('down')} disabled={disabled} className={s.arrowKey} title="下キー">↓</button>
              <button type="button" onClick={() => onSendArrowKey('right')} disabled={disabled} className={s.arrowKey} title="右キー">→</button>
            </div>
          </div>
        )}
        <div className={s.enterWrapper}>
          <button type="button" onClick={onSendEnter} disabled={disabled} className={s.enterButton}>
            Enter
          </button>
        </div>
      </div>

      {/* 破壊系行 */}
      {(onSendEscape || onClearAi) && (
        <div className={s.row}>
          {onSendEscape && (
            <button type="button" onClick={onSendEscape} disabled={disabled} className={s.escButton} title="エスケープキー (ESC)">
              ESC
            </button>
          )}
          {onClearAi && (
            <button type="button" onClick={onClearAi} disabled={disabled} className={s.clearButton} title={providerInfo?.clearTitle || 'クリア'}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* モード系行（Claude のみ） */}
      {isClaude && (onSendMode || onChangeModel || onSendCommit) && (
        <div className={s.row}>
          {onSendMode && (
            <button type="button" onClick={onSendMode} disabled={disabled} className={s.modeButton} title="モード切り替え (Shift+Tab)">
              Mode
            </button>
          )}
          {onChangeModel && (
            <div className={s.modelWrapper}>
              <button type="button" onClick={() => setShowModelMenu(!showModelMenu)} disabled={disabled} className={s.modelButton} title="モデルを選択">
                Model
              </button>
              {showModelMenu && (
                <div className={s.modelMenu}>
                  <button type="button" onClick={() => { onChangeModel('default'); setShowModelMenu(false); }} className={s.modelMenuItem}>Default</button>
                  <button type="button" onClick={() => { onChangeModel('Opus'); setShowModelMenu(false); }} className={s.modelMenuItem}>Opus</button>
                  <button type="button" onClick={() => { onChangeModel('Sonnet'); setShowModelMenu(false); }} className={s.modelMenuItem}>Sonnet</button>
                  <button type="button" onClick={() => { onChangeModel('OpusPlan'); setShowModelMenu(false); }} className={s.modelMenuItem}>OpusPlan</button>
                </div>
              )}
            </div>
          )}
          {onSendCommit && (
            <button type="button" onClick={onSendCommit} disabled={disabled} className={s.commitButton} title="コミット (/commit)">
              Commit
            </button>
          )}
        </div>
      )}

      {/* 補助系行（折りたたみ） */}
      {hasAuxButtons && (
        <div className={s.auxSection}>
          <button
            type="button"
            onClick={() => setShowAux(!showAux)}
            className={s.moreToggle}
            title="その他のボタンを表示"
          >
            {showAux ? '▲ その他' : '▼ その他'}
          </button>
          {showAux && (
            <div className={s.row}>
              {onSendInterrupt && (
                <button type="button" onClick={onSendInterrupt} disabled={disabled} className={s.grayButton} title="プロセスを中断 (Ctrl+C)">
                  Ctrl+C
                </button>
              )}
              {isClaude && onSendAltT && (
                <button type="button" onClick={onSendAltT} disabled={disabled} className={s.grayButton} title="Alt+Tキーを送信">
                  Alt+T
                </button>
              )}
              {isClaude && onSendResume && (
                <button type="button" onClick={onSendResume} disabled={disabled} className={s.grayButton} title="セッションを再開 (/resume)">
                  Resume
                </button>
              )}
              {isClaude && onSendUsage && (
                <button type="button" onClick={onSendUsage} disabled={disabled} className={s.grayButton} title="使用状況を表示 (/usage)">
                  Usage
                </button>
              )}
              {isClaude && onSendPreview && (
                <button type="button" onClick={onSendPreview} disabled={disabled} className={s.grayButton} title="プレビュースキルを送信 (/dokodemo-claude-tools:dokodemo-preview)">
                  Preview
                </button>
              )}

            </div>
          )}
        </div>
      )}

      {/* カスタム行 */}
      <div className={s.customSection}>
        <div className={s.customHeader}>カスタム</div>
        <div className={s.row}>
          {customButtons.map((btn) => {
            const scopeLabel =
              btn.scope === 'global' ? '共通' : 'プロジェクト固有';
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => onExecuteCustomButton(btn.command)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setDialogState({ mode: 'edit', button: btn });
                }}
                disabled={disabled}
                className={s.customButton}
                title={`${btn.command}\n[${scopeLabel}]（右クリックで編集）`}
              >
                {btn.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setDialogState({ mode: 'add' })}
            className={s.addButton}
            title="ボタンを追加"
            aria-label="カスタムボタンを追加"
          >
            ＋
          </button>
        </div>
      </div>

      {dialogState && (
        <CustomButtonDialog
          key={dialogState.mode === 'edit' ? `edit-${dialogState.button.id}` : 'add'}
          state={dialogState}
          currentRepositoryPath={currentRepositoryPath}
          onSubmit={handleDialogSubmit}
          onDelete={dialogState.mode === 'edit' ? handleDialogDelete : undefined}
          onClose={() => setDialogState(null)}
        />
      )}
    </div>
  );
};
