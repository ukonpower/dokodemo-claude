import React, { useState } from 'react';
import { Loader } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { PromptQueueItem } from '../types';
import SortableQueueItem from './SortableQueueItem';
import s from './PromptQueue.module.scss';

interface PromptQueueProps {
  queue: PromptQueueItem[];
  isProcessing: boolean;
  isPaused: boolean;
  onRemove?: (itemId: string) => void;
  onUpdate?: (
    itemId: string,
    prompt: string,
    sendClearBefore: boolean,
    isAutoCommit: boolean,
    model?: string
  ) => void;
  onReorder?: (reorderedQueue: PromptQueueItem[]) => void;
  onPause?: () => void;
  onResume?: () => void;
  onForceSend?: (itemId: string) => void;
  onRequeue?: (itemId: string) => void;
  onReset?: () => void;
  onCancelCurrentItem?: () => void;
}

const PromptQueue: React.FC<PromptQueueProps> = ({
  queue,
  isProcessing,
  isPaused,
  onRemove,
  onUpdate,
  onReorder,
  onPause,
  onResume,
  onReset,
  onCancelCurrentItem,
  onForceSend,
  onRequeue,
}) => {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editSendClearBefore, setEditSendClearBefore] = useState(false);
  const [editIsAutoCommit, setEditIsAutoCommit] = useState(false);
  const [editModel, setEditModel] = useState('');
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const startEdit = (item: PromptQueueItem) => {
    setEditingItemId(item.id);
    setEditPrompt(item.prompt);
    setEditSendClearBefore(item.sendClearBefore ?? false);
    setEditIsAutoCommit(item.isAutoCommit ?? false);
    setEditModel(item.model ?? '');
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditPrompt('');
    setEditSendClearBefore(false);
    setEditIsAutoCommit(false);
    setEditModel('');
  };

  const saveEdit = (itemId: string) => {
    if (onUpdate && editPrompt.trim()) {
      onUpdate(itemId, editPrompt, editSendClearBefore, editIsAutoCommit, editModel);
      cancelEdit();
    }
  };

  const startView = (item: PromptQueueItem) => {
    setViewingItemId(item.id);
  };

  const closeView = () => {
    setViewingItemId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = queue.findIndex((item) => item.id === active.id);
      const newIndex = queue.findIndex((item) => item.id === over.id);
      const reorderedQueue = arrayMove(queue, oldIndex, newIndex);
      if (onReorder) onReorder(reorderedQueue);
    }
  };

  // 空状態
  if (queue.length === 0 && !isProcessing) {
    return (
      <div className={s.emptyState}>
        <span className={s.emptyText}>
          キューは空です
        </span>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {/* キューアイテム一覧 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={queue.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className={s.queueList}>
            {queue.map((item, index) => {
              const canRemove = !!onRemove;
              const canEdit = item.status === 'pending' && !!onUpdate;
              const canView = item.status === 'completed' || item.status === 'processing';
              const canForceSend = item.status === 'pending' && !!onForceSend && !isProcessing;
              const canRequeue =
                (item.status === 'completed' || item.status === 'failed') && !!onRequeue;
              const isEditing = editingItemId === item.id;
              const isViewing = viewingItemId === item.id;

              return (
                <SortableQueueItem
                  key={item.id}
                  item={item}
                  index={index}
                  isEditing={isEditing}
                  isViewing={isViewing}
                  editPrompt={editPrompt}
                  editSendClearBefore={editSendClearBefore}
                  editIsAutoCommit={editIsAutoCommit}
                  editModel={editModel}
                  canRemove={canRemove}
                  canEdit={canEdit}
                  canView={canView}
                  canForceSend={canForceSend}
                  canRequeue={canRequeue}
                  onStartEdit={startEdit}
                  onStartView={startView}
                  onCancelEdit={cancelEdit}
                  onCloseView={closeView}
                  onSaveEdit={saveEdit}
                  onRemove={onRemove!}
                  onForceSend={onForceSend!}
                  onRequeue={onRequeue!}
                  setEditPrompt={setEditPrompt}
                  setEditSendClearBefore={setEditSendClearBefore}
                  setEditIsAutoCommit={setEditIsAutoCommit}
                  setEditModel={setEditModel}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* フッター: 処理状態 + 操作ボタン */}
      {(isProcessing || isPaused || (queue.length > 0 && onReset)) && (
        <div className={s.footer}>
          <div className={s.footerLeft}>
            {isProcessing && (
              <>
                <Loader
                  size={10}
                  className={s.spinIcon}
                />
                <span className={s.processingText}>
                  実行中... 完了後、次のキューを自動実行
                </span>
              </>
            )}
            {isPaused && !isProcessing && (
              <span className={s.pausedText}>
                一時停止中
              </span>
            )}
          </div>
          <div className={s.footerRight}>
            {isProcessing && onCancelCurrentItem && (
              <button
                onClick={onCancelCurrentItem}
                className={s.cancelButton}
                title="処理中のアイテムを停止"
              >
                停止
              </button>
            )}
            {!isPaused && onPause && queue.length > 0 && (
              <button
                onClick={onPause}
                className={s.pauseButton}
                title="一時停止"
              >
                ⏸
              </button>
            )}
            {isPaused && onResume && (
              <button
                onClick={onResume}
                className={s.resumeButton}
                title="再開"
              >
                ▶
              </button>
            )}
            {onReset && queue.length > 0 && (
              <button
                onClick={onReset}
                className={s.resetButton}
                title="リセット"
              >
                ↺
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptQueue;
