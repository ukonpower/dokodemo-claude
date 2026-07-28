import React, { useCallback, useRef, useState } from 'react';
import { MessageSquarePlus, Paperclip, X } from 'lucide-react';
import { useQueueContext } from '@/features/ai/providers/QueueProvider';
import SketchButton from './SketchButton';
import s from './LoopInstructionPanel.module.scss';

interface LoopInstructionPanelProps {
  /** 画像・ファイルをアップロードしてパスを返す（プロンプト入力欄と同じ経路） */
  onPasteFile?: (file: File) => Promise<string | undefined>;
  /** アップロード中は入力・送信を止める */
  isUploadingFile?: boolean;
}

/**
 * ループへの指示パネル（ループ設定パネルの下に常時展開）。
 *
 * 入力欄と未反映の指示一覧をその場に出す。送った指示は次のサイクル間の
 * 「指示反映ターン」でまとめて計画・進め方に反映される。
 * ループが動いていないときは送り先が無いため何も描画しない。
 */
export const LoopInstructionPanel: React.FC<LoopInstructionPanelProps> = ({
  onPasteFile,
  isUploadingFile = false,
}) => {
  const { promptQueue, addLoopFeedback, removeLoopFeedback } =
    useQueueContext();

  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // アップロードしたファイルのパスをカーソル位置へ挿入する。
  // 前後のテキストと連結されるとパスとして読めなくなるため空白を挟む
  const insertPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setText((prev) => {
      const el = inputRef.current;
      const start = el?.selectionStart ?? prev.length;
      const end = el?.selectionEnd ?? prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      const prefix = before && !/\s$/.test(before) ? ' ' : '';
      const suffix = after && !/^\s/.test(after) ? ' ' : '';
      return before + prefix + paths.join(' ') + suffix + after;
    });
  }, []);

  // クリップボードから画像をペーストしたらアップロードしてパスを挿入する
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || !onPasteFile) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const path = await onPasteFile(file);
            if (path) insertPaths([path]);
          }
          return;
        }
      }
    },
    [onPasteFile, insertPaths]
  );

  // ファイルをアップロードして、返ってきたパスをまとめて挿入する
  const uploadAndInsert = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !onPasteFile) return;

      const paths: string[] = [];
      for (const file of files) {
        const p = await onPasteFile(file);
        if (p) paths.push(p);
      }
      insertPaths(paths);
    },
    [onPasteFile, insertPaths]
  );

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      void uploadAndInsert(files);
    },
    [uploadAndInsert]
  );

  // ループアイテムは 1 キューに 1 つまで
  const loopItem = promptQueue.find((item) => item.loop);
  const loop = loopItem?.loop;

  if (!loopItem || !loop) return null;

  const instructions = loop.feedback ?? [];
  const sentCount = loop.feedbackActive ?? 0;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addLoopFeedback(loopItem.id, trimmed);
    setText('');
  };

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <MessageSquarePlus size={14} />
        <span className={s.headerTitle}>ループへの指示</span>
        <span className={s.headerHint}>次のサイクル間で計画に反映</span>
        {instructions.length > 0 && (
          <span className={s.count}>{instructions.length}</span>
        )}
      </div>

      <div className={s.inputRow}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="ループへの指示（画像はペースト / 鉛筆・クリップで添付）"
          className={s.input}
          rows={2}
          disabled={isUploadingFile}
        />
        <div className={s.inputActions}>
          {onPasteFile && (
            <div className={s.iconRow}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelected}
                className={s.hiddenFileInput}
              />
              <SketchButton
                onComplete={(file) => void uploadAndInsert([file])}
                disabled={isUploadingFile}
                className={s.uploadButton}
                size="sm"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingFile}
                className={s.uploadButton}
                title="ファイルをアップロード（入力欄にパスを挿入）"
                aria-label="ファイルをアップロード"
              >
                <Paperclip size={14} />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || isUploadingFile}
            className={s.sendButton}
          >
            送信
          </button>
        </div>
      </div>

      {instructions.length > 0 ? (
        <div className={s.list}>
          {instructions.map((item, index) => {
            const isSent = index < sentCount;
            return (
              <div
                key={`${index}-${item}`}
                className={`${s.item} ${isSent ? s.itemSent : ''}`}
              >
                <span className={s.itemText}>{item}</span>
                {isSent ? (
                  <span className={s.itemStatus}>反映中</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => removeLoopFeedback(loopItem.id, index)}
                    className={s.itemRemove}
                    title="この指示を削除"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className={s.emptyText}>未反映の指示はありません</p>
      )}
    </div>
  );
};

export default LoopInstructionPanel;
