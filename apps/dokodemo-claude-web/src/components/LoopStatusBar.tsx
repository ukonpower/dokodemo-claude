import React, { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import type { PromptQueueItem } from '../types';
import s from './LoopStatusBar.module.scss';

interface LoopStatusBarProps {
  loopItem: PromptQueueItem;
  isJudging: boolean;
  onForceSend?: (itemId: string) => void;
  onStopLoop?: (itemId: string) => void;
  onApprove?: (itemId: string, approved: boolean) => void;
}

/**
 * プロンプトループの状態を表示するバー
 *
 * 表示状態は優先順に:
 * 1. 確認待ち（警告色 + 継続/終了ボタン）
 * 2. AI 判断中（🔍 + スピナー）
 * 3. 待機中（カウントダウン + 今すぐ/停止）
 * 4. 実行中（周回数 + 停止）
 */
const LoopStatusBar: React.FC<LoopStatusBarProps> = ({
  loopItem,
  isJudging,
  onForceSend,
  onStopLoop,
  onApprove,
}) => {
  const loop = loopItem.loop;
  const nextSendAt = loop?.nextSendAt;
  const [now, setNow] = useState<number>(() => 0);

  // カウントダウン更新: nextSendAt がセットされている間だけ 1 秒おきに now を更新
  useEffect(() => {
    if (!nextSendAt) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [nextSendAt]);

  if (!loop) return null;

  const remainingSec = nextSendAt
    ? Math.max(0, Math.ceil((nextSendAt - now) / 1000))
    : 0;
  const remainingText =
    remainingSec > 60
      ? `${Math.floor(remainingSec / 60)}分${remainingSec % 60}秒`
      : `${remainingSec}秒`;

  // 状態判定（優先順）
  const isAwaitingApproval = !!loop.awaitingUserApproval;
  const isCountingDown =
    !isAwaitingApproval && !isJudging && remainingSec > 0;
  // isRunning は上記いずれでもない場合

  return (
    <div
      className={`${s.root} ${
        isAwaitingApproval
          ? s.warning
          : isJudging
            ? s.info
            : s.normal
      }`}
    >
      <div className={s.mainRow}>
        <div className={s.leftGroup}>
          <span className={s.icon}>🔁</span>
          {isAwaitingApproval ? (
            <span className={s.text}>
              {loop.iteration - 1}周完了。継続しますか？
            </span>
          ) : isJudging ? (
            <>
              <Loader size={12} className={s.spinIcon} />
              <span className={s.text}>
                🔍 AI 判断中 ({loop.iteration - 1}周目完了後)
              </span>
            </>
          ) : isCountingDown ? (
            <span className={s.text}>
              {loop.iteration}周目 · 次回送信まで {remainingText}
            </span>
          ) : (
            <span className={s.text}>
              {loop.iteration}周目 実行中
            </span>
          )}
        </div>

        <div className={s.actions}>
          {isAwaitingApproval && onApprove && (
            <>
              <button
                type="button"
                onClick={() => onApprove(loopItem.id, true)}
                className={s.continueButton}
              >
                継続
              </button>
              <button
                type="button"
                onClick={() => onApprove(loopItem.id, false)}
                className={s.endButton}
              >
                終了
              </button>
            </>
          )}
          {isCountingDown && onForceSend && (
            <button
              type="button"
              onClick={() => onForceSend(loopItem.id)}
              className={s.actionButton}
            >
              今すぐ
            </button>
          )}
          {!isAwaitingApproval && onStopLoop && (
            <button
              type="button"
              onClick={() => onStopLoop(loopItem.id)}
              className={s.stopButton}
            >
              停止
            </button>
          )}
        </div>
      </div>

      {loop.lastJudgeReason && (
        <div className={s.reason} title={loop.lastJudgeReason}>
          {loop.lastJudgeReason}
        </div>
      )}
    </div>
  );
};

export default LoopStatusBar;
