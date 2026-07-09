import React, { useState, useEffect } from 'react';
import type { CustomAiButton, CustomAiButtonScope } from '../types';
import { useModelOptions } from '../hooks/useModelOptions';
import { COMMIT_COMMAND, PREVIEW_COMMAND } from '../hooks/useAiCli';
import { useMediaQuery } from '../hooks';
import s from './KeyboardButtons.module.scss';

// lg 以上（2カラムレイアウト＝物理キーボードのある PC 環境の目安）。
// design-tokens の $breakpoint-lg と揃える。
const DESKTOP_MEDIA_QUERY = '(min-width: 860px)';

interface KeyboardButtonsProps {
  disabled?: boolean;
  onSendArrowKey?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSendEnter: () => void;
  onSendInterrupt?: () => void;
  onSendEscape?: () => void;
  onSendSpace?: () => void;
  onClearAi?: () => void;
  onSendResume?: () => void;
  onSendUsage?: () => void;
  onSendPreview?: () => void;
  onSendMode?: () => void;
  onSendAltT?: () => void;
  onChangeModel?: (model: string) => void;
  onSendCommit?: () => void;
  /** コマンドをプロンプトキューに追加する（プライマリインスタンス表示時のみ渡される） */
  onQueueCommand?: (command: string) => void;
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
  onSendSpace,
  onClearAi,
  onSendResume,
  onSendUsage,
  onSendPreview,
  onSendMode,
  onSendAltT,
  onChangeModel,
  onSendCommit,
  onQueueCommand,
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

  // PC（lg 以上）は物理キーボードがあるため矢印/Enter/ESC/Space の疑似キーは不要。
  // 代わりにコマンド系ボタンを主役として常時表示する。
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  // モデル選択肢（組み込み + API 取得 + カスタム）。
  // 即時 /model 送信メニューのため「未指定」（空値）は除外する。
  const { options: modelOptions } = useModelOptions();
  const selectableModels = modelOptions.filter((o) => o.value !== '');

  const isClaude = currentProvider === 'claude';

  // 操作コマンド（Mode / Model / Ctrl+C）: PC はコマンドバー、モバイルは「その他」に置く
  const hasOpCommands = Boolean(
    onSendInterrupt || (isClaude && (onSendMode || onChangeModel))
  );
  // 出番の少ない補助コマンド（Alt+T / Resume / Usage / Preview）
  const hasExtraCommands = Boolean(
    isClaude && (onSendAltT || onSendResume || onSendUsage || onSendPreview)
  );

  // 「その他」トグルの表示要否。
  // PC は補助コマンドのみ格納するので、それが無ければトグルごと隠す。
  // モバイルはカスタム（＋追加ボタン）が常在するので常に表示。
  const showMoreToggle = isDesktop ? hasExtraCommands : true;

  // 操作コマンド群（PC のコマンドバー / モバイルの「その他」で共用）
  const opCommandButtons = (
    <>
      {isClaude && onSendMode && (
        <button
          type="button"
          onClick={onSendMode}
          disabled={disabled}
          className={s.modeButton}
          title="モード切り替え (Shift+Tab)"
        >
          Mode
        </button>
      )}
      {isClaude && onChangeModel && (
        <div className={s.modelWrapper}>
          <button
            type="button"
            onClick={() => setShowModelMenu(!showModelMenu)}
            disabled={disabled}
            className={s.modelButton}
            title="モデルを選択"
          >
            Model
          </button>
          {showModelMenu && (
            <div className={s.modelMenu}>
              {selectableModels.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChangeModel(opt.value);
                    setShowModelMenu(false);
                  }}
                  className={s.modelMenuItem}
                  title={opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onSendInterrupt && (
        <button
          type="button"
          onClick={onSendInterrupt}
          disabled={disabled}
          className={s.grayButton}
          title="プロセスを中断 (Ctrl+C)"
        >
          Ctrl+C
        </button>
      )}
    </>
  );

  // セッションコマンド群（Clear / Commit）: PC・モバイル共通で常時表示
  const coreCommandButtons = (
    <>
      {onClearAi && (
        <button
          type="button"
          onClick={onClearAi}
          disabled={disabled}
          className={s.clearButton}
          title={providerInfo?.clearTitle || 'クリア'}
        >
          Clear
        </button>
      )}
      {isClaude && onSendCommit && (
        <div className={s.splitButton}>
          <button
            type="button"
            onClick={onSendCommit}
            disabled={disabled}
            className={onQueueCommand ? `${s.commitButton} ${s.splitMain}` : s.commitButton}
            title="コミット (/commit)"
          >
            Commit
          </button>
          {onQueueCommand && (
            <button
              type="button"
              onClick={() => onQueueCommand(COMMIT_COMMAND)}
              disabled={disabled}
              className={`${s.queueAddButton} ${s.queueAddGreen}`}
              title={`キューに追加: ${COMMIT_COMMAND}`}
              aria-label="Commit をキューに追加"
            >
              ＋
            </button>
          )}
        </div>
      )}
    </>
  );

  // 補助コマンド群（Alt+T / Resume / Usage / Preview）
  const extraCommandButtons = (
    <>
      {isClaude && onSendAltT && (
        <button
          type="button"
          onClick={onSendAltT}
          disabled={disabled}
          className={s.grayButton}
          title="Alt+Tキーを送信"
        >
          Alt+T
        </button>
      )}
      {isClaude && onSendResume && (
        <button
          type="button"
          onClick={onSendResume}
          disabled={disabled}
          className={s.grayButton}
          title="セッションを再開 (/resume)"
        >
          Resume
        </button>
      )}
      {isClaude && onSendUsage && (
        <button
          type="button"
          onClick={onSendUsage}
          disabled={disabled}
          className={s.grayButton}
          title="使用状況を表示 (/usage)"
        >
          Usage
        </button>
      )}
      {isClaude && onSendPreview && (
        <div className={s.splitButton}>
          <button
            type="button"
            onClick={onSendPreview}
            disabled={disabled}
            className={onQueueCommand ? `${s.grayButton} ${s.splitMain}` : s.grayButton}
            title="プレビュースキルを送信 (/dokodemo-claude-tools:dokodemo-preview)"
          >
            Preview
          </button>
          {onQueueCommand && (
            <button
              type="button"
              onClick={() => onQueueCommand(PREVIEW_COMMAND)}
              disabled={disabled}
              className={`${s.queueAddButton} ${s.queueAddGray}`}
              title={`キューに追加: ${PREVIEW_COMMAND}`}
              aria-label="Preview をキューに追加"
            >
              ＋
            </button>
          )}
        </div>
      )}
    </>
  );

  // カスタム送信ボタン群（＋追加ボタン込み）
  const customButtonRow = (
    <div className={s.row}>
      {customButtons.map((btn) => {
        const scopeLabel = btn.scope === 'global' ? '共通' : 'プロジェクト固有';
        return (
          <div key={btn.id} className={s.splitButton}>
            <button
              type="button"
              onClick={() => onExecuteCustomButton(btn.command)}
              onContextMenu={(e) => {
                e.preventDefault();
                setDialogState({ mode: 'edit', button: btn });
              }}
              disabled={disabled}
              className={onQueueCommand ? `${s.customButton} ${s.splitMain}` : s.customButton}
              title={`${btn.command}\n[${scopeLabel}]（右クリックで編集）`}
            >
              {btn.name}
            </button>
            {onQueueCommand && (
              <button
                type="button"
                onClick={() => onQueueCommand(btn.command)}
                disabled={disabled}
                className={`${s.queueAddButton} ${s.queueAddCyan}`}
                title={`キューに追加: ${btn.command}`}
                aria-label={`${btn.name} をキューに追加`}
              >
                ＋
              </button>
            )}
          </div>
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
  );

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
      {isDesktop ? (
        /* PC: 物理キーは省き、コマンド系を主役にしたコマンドバー */
        <div className={s.commandBar}>
          {opCommandButtons}
          {coreCommandButtons}
          {customButtonRow}
        </div>
      ) : (
        /* モバイル/タブレット: 左=矢印キー+Enter、右=セッションコマンド */
        <div className={s.mainRow}>
          <div className={s.arrowGroup}>
            {(onSendEscape || onSendSpace) && (
              <div className={s.escColumn}>
                {onSendEscape && (
                  <button type="button" onClick={onSendEscape} disabled={disabled} className={s.escButton} title="エスケープキー (ESC)">
                    ESC
                  </button>
                )}
                {onSendSpace && (
                  <button type="button" onClick={onSendSpace} disabled={disabled} className={s.spaceButton} title="スペース送信">
                    Space
                  </button>
                )}
              </div>
            )}
            {onSendArrowKey && (
              <div className={s.arrowGrid}>
                <div></div>
                <button type="button" onClick={() => onSendArrowKey('up')} disabled={disabled} className={s.arrowKey} title="上キー">↑</button>
                <div></div>
                <button type="button" onClick={() => onSendArrowKey('left')} disabled={disabled} className={s.arrowKey} title="左キー">←</button>
                <button type="button" onClick={() => onSendArrowKey('down')} disabled={disabled} className={s.arrowKey} title="下キー">↓</button>
                <button type="button" onClick={() => onSendArrowKey('right')} disabled={disabled} className={s.arrowKey} title="右キー">→</button>
              </div>
            )}
            <button type="button" onClick={onSendEnter} disabled={disabled} className={s.enterButton}>
              Enter
            </button>
          </div>

          <div className={s.divider}></div>

          <div className={s.commandGroup}>{coreCommandButtons}</div>
        </div>
      )}

      {/* 補助系行（折りたたみ）。PC は補助コマンドのみ、モバイルは操作コマンド + 補助 + カスタム */}
      {showMoreToggle && (
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
            <div className={s.auxContent}>
              {/* モバイルは操作コマンドもここに（PC はコマンドバーに出済み） */}
              {!isDesktop && hasOpCommands && (
                <div className={s.row}>{opCommandButtons}</div>
              )}
              {hasExtraCommands && <div className={s.row}>{extraCommandButtons}</div>}
              {/* カスタム行: モバイルのみ（PC はコマンドバーに出済み） */}
              {!isDesktop && (
                <div className={s.customSection}>
                  <div className={s.customHeader}>カスタム</div>
                  {customButtonRow}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
