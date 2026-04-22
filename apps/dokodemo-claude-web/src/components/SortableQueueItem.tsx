import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PromptQueueItem } from '../types';
import s from './SortableQueueItem.module.scss';

// モデルの表示名マッピング
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  default: 'Default',
  '': 'Default',
  Opus: 'Opus',
  Sonnet: 'Sonnet',
  OpusPlan: 'OpusPlan',
};

// 編集モードコンポーネントのProps
interface EditModeContentProps {
  item: PromptQueueItem;
  index: number;
  statusStyle: {
    bgColor: string;
    textColor: string;
    badgeBg: string;
    badgeText: string;
    label: string;
  };
  editPrompt: string;
  editSendClearBefore: boolean;
  editIsAutoCommit: boolean;
  editModel: string;
  setEditPrompt: (prompt: string) => void;
  setEditSendClearBefore: (value: boolean) => void;
  setEditIsAutoCommit: (value: boolean) => void;
  setEditModel: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (itemId: string) => void;
}

/**
 * 編集モードのコンテンツコンポーネント
 * オプションはドロップダウンメニューで表示
 */
const EditModeContent: React.FC<EditModeContentProps> = ({
  item,
  index,
  statusStyle,
  editPrompt,
  editSendClearBefore,
  editIsAutoCommit,
  editModel,
  setEditPrompt,
  setEditSendClearBefore,
  setEditIsAutoCommit,
  setEditModel,
  onCancelEdit,
  onSaveEdit,
}) => {
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);

  // オプションメニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        optionsRef.current &&
        !optionsRef.current.contains(event.target as Node)
      ) {
        setIsOptionsOpen(false);
      }
    };
    if (isOptionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOptionsOpen]);

  // 有効なオプションの数をカウント
  const activeOptionsCount =
    (editSendClearBefore ? 1 : 0) +
    (editIsAutoCommit ? 1 : 0) +
    (editModel && editModel !== 'default' ? 1 : 0);

  return (
    <>
      {/* ヘッダー: 番号・ステータス */}
      <div className={s.editHeader}>
        <div className={s.editHeaderLeft}>
          <div className={s.editIndex}>
            {index + 1}
          </div>
          <span
            style={{
              backgroundColor: statusStyle.badgeBg,
              color: statusStyle.badgeText,
              fontSize: 9,
              fontWeight: 600,
              borderRadius: 3,
              padding: '2px 6px',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {statusStyle.label}
          </span>
        </div>
      </div>

      {/* プロンプト編集エリア */}
      <textarea
        value={editPrompt}
        onChange={(e) => setEditPrompt(e.target.value)}
        className={s.editTextarea}
        placeholder="プロンプトを入力..."
        autoFocus
      />

      {/* ボタンエリア */}
      <div className={s.editFooter}>
        {/* 左側: オプションボタン */}
        <div className={s.optionsWrapper} ref={optionsRef}>
          <button
            type="button"
            onClick={() => setIsOptionsOpen(!isOptionsOpen)}
            className={`${s.optionsButton} ${
              activeOptionsCount > 0
                ? s.optionsButtonActive
                : s.optionsButtonInactive
            }`}
          >
            <svg
              className={s.optionsIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            <span>オプション</span>
            {activeOptionsCount > 0 && (
              <span className={s.optionsBadge}>
                {activeOptionsCount}
              </span>
            )}
            <svg
              className={`${s.optionsChevron} ${isOptionsOpen ? s.optionsChevronOpen : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {/* オプションドロップダウン */}
          {isOptionsOpen && (
            <div className={s.optionsDropdown}>
              <div className={s.optionsDropdownInner}>
                {/* /clear オプション */}
                <button
                  type="button"
                  onClick={() => setEditSendClearBefore(!editSendClearBefore)}
                  className={s.optionItem}
                >
                  <div
                    className={`${s.checkbox} ${
                      editSendClearBefore
                        ? s.checkboxCheckedBlue
                        : s.checkboxUnchecked
                    }`}
                  >
                    {editSendClearBefore && (
                      <svg
                        className={s.checkIcon}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <div className={s.optionText}>
                    <div className={s.optionLabel}>
                      /clear
                    </div>
                    <div className={s.optionDescription}>
                      送信前にクリア
                    </div>
                  </div>
                </button>

                {/* /commit オプション */}
                <button
                  type="button"
                  onClick={() => setEditIsAutoCommit(!editIsAutoCommit)}
                  className={s.optionItem}
                >
                  <div
                    className={`${s.checkbox} ${
                      editIsAutoCommit
                        ? s.checkboxCheckedGreen
                        : s.checkboxUnchecked
                    }`}
                  >
                    {editIsAutoCommit && (
                      <svg
                        className={s.checkIcon}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <div className={s.optionText}>
                    <div className={s.optionLabel}>
                      /commit
                    </div>
                    <div className={s.optionDescription}>
                      完了後に自動コミット
                    </div>
                  </div>
                </button>

                {/* セパレーター */}
                <div className={s.optionsSeparator} />

                {/* モデル選択 */}
                <div className={s.modelSection}>
                  <div className={s.modelLabel}>
                    モデル
                  </div>
                  <div className={s.modelGrid}>
                    {['default', 'Opus', 'Sonnet', 'OpusPlan'].map(
                      (modelOption) => (
                        <button
                          key={modelOption}
                          type="button"
                          onClick={() => setEditModel(modelOption)}
                          className={`${s.modelButton} ${
                            editModel === modelOption ||
                            (modelOption === 'default' &&
                              (!editModel || editModel === ''))
                              ? s.modelButtonActive
                              : s.modelButtonInactive
                          }`}
                        >
                          {MODEL_DISPLAY_NAMES[modelOption]}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右側: 保存・キャンセルボタン */}
        <div className={s.editActions}>
          <button
            onClick={onCancelEdit}
            className={s.cancelEditButton}
          >
            キャンセル
          </button>
          <button
            onClick={() => onSaveEdit(item.id)}
            disabled={!editPrompt.trim()}
            className={s.saveEditButton}
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
};

interface SortableQueueItemProps {
  item: PromptQueueItem;
  index: number;
  isEditing: boolean;
  isViewing: boolean;
  editPrompt: string;
  editSendClearBefore: boolean;
  editIsAutoCommit: boolean;
  editModel: string;
  canRemove: boolean;
  canEdit: boolean;
  canView: boolean;
  canForceSend: boolean;
  canRequeue: boolean;
  onStartEdit: (item: PromptQueueItem) => void;
  onStartView: (item: PromptQueueItem) => void;
  onCancelEdit: () => void;
  onCloseView: () => void;
  onSaveEdit: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onForceSend: (itemId: string) => void;
  onRequeue: (itemId: string) => void;
  setEditPrompt: (prompt: string) => void;
  setEditSendClearBefore: (value: boolean) => void;
  setEditIsAutoCommit: (value: boolean) => void;
  setEditModel: (value: string) => void;
}

/**
 * ドラッグ&ドロップ可能なキューアイテムコンポーネント
 */
const SortableQueueItem: React.FC<SortableQueueItemProps> = ({
  item,
  index,
  isEditing,
  isViewing,
  editPrompt,
  editSendClearBefore,
  editIsAutoCommit,
  editModel,
  canRemove,
  canEdit,
  canView,
  canRequeue,
  onStartEdit,
  onStartView,
  onCancelEdit,
  onCloseView,
  onSaveEdit,
  onRemove,
  onRequeue,
  setEditPrompt,
  setEditSendClearBefore,
  setEditIsAutoCommit,
  setEditModel,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // ステータスに応じたスタイルを取得（Pencilデザイン準拠）
  const getStatusStyle = (status: PromptQueueItem['status']) => {
    switch (status) {
      case 'processing':
        return {
          bgColor: '#172032',
          textColor: '#d1d5db',
          badgeBg: '#1e3a5f',
          badgeText: '#60a5fa',
          label: '処理中',
        };
      case 'completed':
        return {
          bgColor: '#14261a',
          textColor: '#9ca3af',
          badgeBg: '#14532d',
          badgeText: '#4ade80',
          label: '完了',
        };
      case 'failed':
        return {
          bgColor: '#2a1215',
          textColor: '#9ca3af',
          badgeBg: '#7f1d1d',
          badgeText: '#f87171',
          label: '失敗',
        };
      default: // pending
        return {
          bgColor: 'transparent',
          textColor: '#9ca3af',
          badgeBg: '#374151',
          badgeText: '#9ca3af',
          label: '待機中',
        };
    }
  };

  // プロンプトを短縮表示（最大100文字）
  const truncatePrompt = (prompt: string, maxLength = 100) => {
    if (prompt.length <= maxLength) return prompt;
    return prompt.substring(0, maxLength) + '...';
  };

  const statusStyle = getStatusStyle(item.status);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: statusStyle.bgColor,
        borderRadius: 4,
        padding: '6px 8px',
      }}
      {...(!isEditing && !isViewing ? attributes : {})}
      {...(!isEditing && !isViewing ? listeners : {})}
      className={`${s.itemRoot} ${!isEditing && !isViewing ? s.grabCursor : ''}`}
    >
      {isViewing ? (
        <>
          <div className={s.viewHeader}>
            <div className={s.viewHeaderLeft}>
              <span className={s.indexNumber}>
                {index + 1}
              </span>
              <span
                style={{
                  backgroundColor: statusStyle.badgeBg,
                  color: statusStyle.badgeText,
                  fontSize: 9,
                  fontWeight: 600,
                  borderRadius: 3,
                  padding: '2px 6px',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {statusStyle.label}
              </span>
            </div>
          </div>
          <div className={s.viewBody}>
            <div className={s.viewPromptBox}>
              {item.prompt}
            </div>
            <div className={s.viewFooter}>
              <div className={s.viewTags}>
                {item.sendClearBefore && (
                  <span className={s.viewTag}>
                    /clear
                  </span>
                )}
                {item.isAutoCommit && (
                  <span className={s.viewTag}>
                    /commit
                  </span>
                )}
              </div>
              <div className={s.viewActions}>
                {canRequeue && (
                  <button
                    onClick={() => { onRequeue(item.id); onCloseView(); }}
                    className={s.requeueButton}
                  >
                    再実行
                  </button>
                )}
                <button
                  onClick={onCloseView}
                  className={s.closeButton}
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </>
      ) : isEditing ? (
        <EditModeContent
          item={item}
          index={index}
          statusStyle={statusStyle}
          editPrompt={editPrompt}
          editSendClearBefore={editSendClearBefore}
          editIsAutoCommit={editIsAutoCommit}
          editModel={editModel}
          setEditPrompt={setEditPrompt}
          setEditSendClearBefore={setEditSendClearBefore}
          setEditIsAutoCommit={setEditIsAutoCommit}
          setEditModel={setEditModel}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
        />
      ) : (
        // 通常表示モード（Pencilデザイン準拠）
        <div className={s.normalRow}>
          {/* 番号 */}
          <span className={s.indexNumber}>
            {index + 1}
          </span>

          {/* プロンプト内容 */}
          <div
            className={`${s.promptContent} ${canEdit || canView ? s.clickable : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (canEdit) onStartEdit(item);
              else if (canView) onStartView(item);
            }}
            title={canEdit ? 'クリックして編集' : canView ? 'クリックして詳細を表示' : ''}
          >
            <p
              className={s.promptText}
              style={{
                color: statusStyle.textColor,
              }}
            >
              {truncatePrompt(item.prompt)}
            </p>
          </div>

          {/* ステータスバッジ */}
          <span
            className={s.statusBadge}
            style={{
              backgroundColor: statusStyle.badgeBg,
              color: statusStyle.badgeText,
            }}
          >
            {statusStyle.label}
          </span>

          {/* 削除ボタン */}
          {canRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
              className={s.removeButton}
              title="キューから削除"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SortableQueueItem;
