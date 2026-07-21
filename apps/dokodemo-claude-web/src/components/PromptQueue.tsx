import React, { useState } from 'react';
import { Loader, Pause, Play, Repeat, RotateCcw, X } from 'lucide-react';
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
import type { LoopEndInfo, LoopSettings } from '../hooks/usePromptQueue';
import SortableQueueItem from './SortableQueueItem';
import type { EditLoopSettings } from './SortableQueueItem';
import {
  DEFAULT_PLANNING_MODEL,
  DEFAULT_PLANNING_EVERY_N,
  DEFAULT_PLANNING_PROMPT,
} from './LoopSettingsFields';
import LoopStatusBar from './LoopStatusBar';
import s from './PromptQueue.module.scss';

interface PromptQueueProps {
  queue: PromptQueueItem[];
  isProcessing: boolean;
  isPaused: boolean;
  currentItemId?: string;
  onRemove?: (itemId: string) => void;
  onUpdate?: (
    itemId: string,
    prompt: string,
    sendClearBefore: boolean,
    isAutoCommit: boolean,
    model?: string,
    loop?: LoopSettings | null
  ) => void;
  onReorder?: (reorderedQueue: PromptQueueItem[]) => void;
  onPause?: () => void;
  onResume?: () => void;
  onForceSend?: (itemId: string) => void;
  onRequeue?: (itemId: string) => void;
  onReset?: () => void;
  onCancelCurrentItem?: () => void;
  onStopLoop?: (itemId: string) => void;
  onApproveLoop?: (itemId: string, approved: boolean) => void;
  loopEndInfo?: LoopEndInfo | null;
  onDismissLoopEnd?: () => void;
}

const PromptQueue: React.FC<PromptQueueProps> = ({
  queue,
  isProcessing,
  isPaused,
  currentItemId,
  onRemove,
  onUpdate,
  onReorder,
  onPause,
  onResume,
  onReset,
  onCancelCurrentItem,
  onForceSend,
  onRequeue,
  onStopLoop,
  onApproveLoop,
  loopEndInfo,
  onDismissLoopEnd,
}) => {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editSendClearBefore, setEditSendClearBefore] = useState(false);
  const [editIsAutoCommit, setEditIsAutoCommit] = useState(false);
  const [editModel, setEditModel] = useState('');
  const [editLoop, setEditLoop] = useState<EditLoopSettings | null>(null);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);

  // ループアイテムを検索（1キューに1つまで）
  const loopItem = queue.find((i) => i.loop);
  const isJudging = currentItemId === 'loop-judge';

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
    setEditLoop(
      item.loop
        ? {
            judge: item.loop.judge,
            judgeEveryN: item.loop.judgeEveryN,
            intervalSec: item.loop.intervalSec,
            judgeCriteria: item.loop.judgeCriteria ?? '',
            planningEnabled: !!item.loop.planning,
            planningEveryN:
              item.loop.planning?.everyN ?? DEFAULT_PLANNING_EVERY_N,
            planningModel:
              item.loop.planning?.model ?? DEFAULT_PLANNING_MODEL,
            planningPrompt: item.loop.planning?.prompt ?? '',
          }
        : null
    );
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditPrompt('');
    setEditSendClearBefore(false);
    setEditIsAutoCommit(false);
    setEditModel('');
    setEditLoop(null);
  };

  const saveEdit = (itemId: string) => {
    if (onUpdate && editPrompt.trim()) {
      // 編集対象アイテムの元 loop 状態を確認して差分を判定
      const original = queue.find((i) => i.id === itemId);
      const hadLoop = !!original?.loop;
      let loopUpdate: LoopSettings | null | undefined;
      if (editLoop) {
        // 編集用のフラットな値から送信用のループ設定へ変換
        loopUpdate = {
          judge: editLoop.judge,
          judgeEveryN: editLoop.judgeEveryN,
          intervalSec: editLoop.intervalSec,
          judgeCriteria: editLoop.judgeCriteria,
          planning: editLoop.planningEnabled
            ? {
                everyN: editLoop.planningEveryN,
                model: editLoop.planningModel,
                prompt:
                  editLoop.planningPrompt.trim() || DEFAULT_PLANNING_PROMPT,
              }
            : undefined,
        };
      } else if (hadLoop) {
        loopUpdate = null; // ループ解除
      } else {
        loopUpdate = undefined; // 変更なし
      }
      onUpdate(
        itemId,
        editPrompt,
        editSendClearBefore,
        editIsAutoCommit,
        editModel,
        loopUpdate
      );
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

  // ループ終了バナー（AI 判断の理由表示）。
  // 新しいループが動いている間は LoopStatusBar を優先して表示しない
  const loopEndBanner =
    loopEndInfo && !loopItem ? (
      <div className={s.loopEndBanner}>
        <div className={s.loopEndHeader}>
          <span className={s.loopEndTitle}>
            <Repeat size={12} />
            ループ終了
            {loopEndInfo.endedBy === 'ai-judge' ? '（AI 判断）' : ''}
          </span>
          {onDismissLoopEnd && (
            <button
              type="button"
              onClick={onDismissLoopEnd}
              className={s.loopEndClose}
              title="閉じる"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className={s.loopEndReason}>{loopEndInfo.reason}</div>
      </div>
    ) : null;

  // 空状態
  if (queue.length === 0 && !isProcessing) {
    return (
      <div>
        {loopEndBanner}
        <div className={s.emptyState}>
          <span className={s.emptyText}>
            キューは空です
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {loopEndBanner}

      {/* ループアイテムの状態バー（存在時のみ） */}
      {loopItem && (
        <LoopStatusBar
          loopItem={loopItem}
          isJudging={isJudging}
          onStopLoop={onStopLoop}
          onApprove={onApproveLoop}
          onForceSend={onForceSend}
        />
      )}

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
                  editLoop={editLoop}
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
                  setEditLoop={setEditLoop}
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
                <Pause size={12} />
              </button>
            )}
            {isPaused && onResume && (
              <button
                onClick={onResume}
                className={s.resumeButton}
                title="再開"
              >
                <Play size={12} />
              </button>
            )}
            {onReset && queue.length > 0 && (
              <button
                onClick={onReset}
                className={s.resetButton}
                title="リセット"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptQueue;
