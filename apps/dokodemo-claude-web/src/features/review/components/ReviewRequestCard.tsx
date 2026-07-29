import { useState } from 'react';
import { ExternalLink, Trash2, MessageCircleQuestion } from 'lucide-react';
import Button from '@/shared/components/Button';
import IconButton from '@/shared/components/IconButton';
import { BACKEND_URL } from '@/shared/utils/backend-url';
import type { ReviewRequest } from '@/types';
import s from './ReviewRequestCard.module.scss';

interface ReviewRequestCardProps {
  request: ReviewRequest;
  onRespond: (
    kind: 'choice' | 'comment' | 'fundamental',
    payload: { choice?: string; comment?: string }
  ) => void;
  onDelete: () => void;
}

function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 添付の相対 URL（/api/review-media/...）をバックエンド絶対 URL に解決する */
function resolveAttachmentUrl(url: string): string {
  return url.startsWith('/') ? `${BACKEND_URL}${url}` : url;
}

/**
 * レビューリクエスト 1 件のカード。
 * 狙い → 提示物（画像 / URL）→ 応答（選択肢・一言・そもそも）を縦に並べ、
 * スマホでも最小の操作で返せることを優先する。
 */
export function ReviewRequestCard({
  request,
  onRespond,
  onDelete,
}: ReviewRequestCardProps) {
  const [comment, setComment] = useState('');
  const isPending = request.status === 'pending';

  const images = request.attachments.filter((a) => a.type === 'image');
  const urls = request.attachments.filter((a) => a.type === 'url');

  const handleChoice = (choice: string) => {
    onRespond('choice', { choice, comment: comment.trim() || undefined });
  };

  const handleComment = () => {
    if (!comment.trim()) return;
    onRespond('comment', { comment: comment.trim() });
  };

  const handleFundamental = () => {
    if (!comment.trim()) return;
    onRespond('fundamental', { comment: comment.trim() });
  };

  return (
    <div className={`${s.card} ${isPending ? '' : s.cardAnswered}`}>
      <div className={s.cardHeader}>
        <span className={s.requestId}>#{request.id}</span>
        <span className={s.aim}>{request.aim}</span>
        {request.blocking && isPending && (
          <span
            className={s.blockingBadge}
            title="このリクエストに応答するまで発行元のキュー・ループは停止しています"
          >
            ループ停止中
          </span>
        )}
        <span className={s.meta}>{formatDateTime(request.createdAt)}</span>
        <IconButton size="xs" label="このリクエストを削除" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      </div>

      {images.length > 0 && (
        <div className={s.imageGrid}>
          {images.map((img, i) => (
            <a
              key={i}
              href={resolveAttachmentUrl(img.url)}
              target="_blank"
              rel="noreferrer"
              className={s.imageItem}
            >
              <img
                src={resolveAttachmentUrl(img.url)}
                alt={img.label ?? `提示物 ${i + 1}`}
                loading="lazy"
              />
              {img.label && <span className={s.imageLabel}>{img.label}</span>}
            </a>
          ))}
        </div>
      )}

      {urls.length > 0 && (
        <div className={s.urlList}>
          {urls.map((u, i) => (
            <a
              key={i}
              href={u.url}
              target="_blank"
              rel="noreferrer"
              className={s.urlItem}
            >
              <ExternalLink size={12} aria-hidden />
              {u.label ?? u.url}
            </a>
          ))}
        </div>
      )}

      <p className={s.question}>{request.question}</p>

      {isPending ? (
        <div className={s.responseArea}>
          {request.choices.length > 0 && (
            <div className={s.choices}>
              {request.choices.map((choice) => (
                <Button
                  key={choice}
                  size="sm"
                  variant="primary"
                  onClick={() => handleChoice(choice)}
                >
                  {choice}
                </Button>
              ))}
            </div>
          )}
          <textarea
            className={s.commentInput}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              request.choices.length > 0
                ? '一言（選択に添える／単体で送る）'
                : '一言でレビューを返す'
            }
            rows={2}
          />
          <div className={s.commentActions}>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleComment}
              disabled={!comment.trim()}
            >
              一言だけ送る
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleFundamental}
              disabled={!comment.trim()}
              title="提示物へのレビューではなく、方向性レベルの相談として送る"
            >
              <MessageCircleQuestion size={14} aria-hidden />
              そもそも相談
            </Button>
          </div>
        </div>
      ) : (
        request.response && (
          <div className={s.answered}>
            <span className={s.answeredKind}>
              {request.response.kind === 'choice'
                ? `選択: ${request.response.choice}`
                : request.response.kind === 'fundamental'
                  ? 'そもそも相談'
                  : '一言'}
            </span>
            {request.response.comment && (
              <span className={s.answeredComment}>
                {request.response.comment}
              </span>
            )}
            <span className={s.meta}>
              {formatDateTime(request.response.respondedAt)}
            </span>
          </div>
        )
      )}
    </div>
  );
}
