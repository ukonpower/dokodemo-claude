import { useEffect, useState } from 'react';
import { Inbox, ImageOff } from 'lucide-react';
import ModalShell from '@/shared/components/ModalShell';
import { BACKEND_URL } from '@/shared/utils/backend-url';
import { useReviewContext } from '@/features/review/providers/ReviewProvider';
import { ReviewRequestCard } from '@/features/review/components/ReviewRequestCard';
import type { ReviewRequest } from '@/types';
import s from './ReviewInbox.module.scss';

/** プレビューに出す未回答リクエストの最大数（縦に伸びすぎないよう抑える） */
const PREVIEW_LIMIT = 3;

/** 「2分前」「3時間前」「7/28」のような相対表記。1 日以上前は日付で出す */
function formatRelative(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 添付の相対 URL（/api/review-media/...）をバックエンド絶対 URL に解決する */
function resolveAttachmentUrl(url: string): string {
  return url.startsWith('/') ? `${BACKEND_URL}${url}` : url;
}

function firstImageUrl(request: ReviewRequest): string | null {
  const image = request.attachments.find((a) => a.type === 'image');
  return image ? resolveAttachmentUrl(image.url) : null;
}

/**
 * レビューリクエストの受信箱。ループ設定パネルの下に置くパネルで、
 * 未回答リクエストの見出し・サムネ・経過時間をその場に数件出す。
 * 行を押すとモーダル（未回答 / 回答済みの 2 セクション）が開き、その件へスクロールする。
 * リクエストが 1 件も無ければ何も描画しない。
 */
export function ReviewInbox() {
  const { requests, respond, deleteRequest } = useReviewContext();
  const [isOpen, setIsOpen] = useState(false);
  // モーダルを開いた直後にスクロールで合わせる対象（プレビュー行から開いたとき）
  const [focusId, setFocusId] = useState<string | null>(null);

  const pending = requests.filter((r) => r.status === 'pending');
  const answered = requests.filter((r) => r.status === 'answered');

  useEffect(() => {
    if (!isOpen || !focusId) return;
    document
      .getElementById(`review-card-${focusId}`)
      ?.scrollIntoView({ block: 'start' });
  }, [isOpen, focusId]);

  if (requests.length === 0) return null;

  const openModal = (requestId?: string) => {
    setFocusId(requestId ?? null);
    setIsOpen(true);
  };

  const previews = pending.slice(0, PREVIEW_LIMIT);

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <Inbox size={14} className={s.headerIcon} />
        <span className={s.headerTitle}>レビュー</span>
        {pending.length > 0 && (
          <span className={s.pendingBadge}>未回答 {pending.length}</span>
        )}
        <button
          type="button"
          onClick={() => openModal()}
          className={s.openAllButton}
        >
          すべて開く
        </button>
      </div>

      {pending.length > 0 ? (
        <div className={s.previewList}>
          {previews.map((request) => {
            const thumbUrl = firstImageUrl(request);
            return (
              <button
                key={request.id}
                type="button"
                onClick={() => openModal(request.id)}
                className={s.previewItem}
                title="このリクエストに回答する"
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt=""
                    loading="lazy"
                    className={s.thumb}
                  />
                ) : (
                  <span className={s.thumbPlaceholder}>
                    <ImageOff size={14} aria-hidden />
                  </span>
                )}
                <span className={s.previewMain}>
                  <span className={s.previewQuestion}>{request.question}</span>
                  <span className={s.previewMeta}>
                    {request.aim}
                    <span className={s.previewTime}>
                      {formatRelative(request.createdAt)}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          {pending.length > previews.length && (
            <button
              type="button"
              onClick={() => openModal()}
              className={s.moreButton}
            >
              ほか {pending.length - previews.length} 件
            </button>
          )}
        </div>
      ) : (
        <p className={s.emptyText}>未回答のレビューはありません</p>
      )}

      <div className={s.footer}>回答済み {answered.length} 件</div>

      {isOpen && (
        <ModalShell
          title="レビューリクエスト"
          onClose={() => setIsOpen(false)}
          size="wide"
        >
          <div className={s.modalBody}>
            <div className={s.section}>
              <h3 className={s.sectionTitle}>未回答（{pending.length}）</h3>
              {pending.length > 0 ? (
                pending.map((request) => (
                  <div key={request.id} id={`review-card-${request.id}`}>
                    <ReviewRequestCard
                      request={request}
                      onRespond={(kind, payload) =>
                        respond(request.id, kind, payload)
                      }
                      onDelete={() => deleteRequest(request.id)}
                    />
                  </div>
                ))
              ) : (
                <p className={s.emptyText}>未回答のリクエストはありません</p>
              )}
            </div>

            <div className={s.section}>
              <h3 className={s.sectionTitle}>回答済み（{answered.length}）</h3>
              {answered.length > 0 ? (
                answered.map((request) => (
                  <div key={request.id} id={`review-card-${request.id}`}>
                    <ReviewRequestCard
                      request={request}
                      onRespond={(kind, payload) =>
                        respond(request.id, kind, payload)
                      }
                      onDelete={() => deleteRequest(request.id)}
                    />
                  </div>
                ))
              ) : (
                <p className={s.emptyText}>回答済みのリクエストはありません</p>
              )}
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
