import { useState } from 'react';
import { Inbox } from 'lucide-react';
import ModalShell from '@/shared/components/ModalShell';
import { useReviewContext } from '@/features/review/providers/ReviewProvider';
import { ReviewRequestCard } from '@/features/review/components/ReviewRequestCard';
import s from './ReviewInbox.module.scss';

/**
 * 評価リクエストの受信箱。キュー・ループセクション直上の 1 行トリガーと、
 * そこから開くモーダル（未応答 + 応答済み一覧）で構成する。
 * 評価に応答すると発行元キューへ注入されるため、トリガーはキューの直上に置く。
 * リクエストが 1 件も無ければ何も描画しない。
 */
export function ReviewInbox() {
  const { requests, respond, deleteRequest } = useReviewContext();
  const [isOpen, setIsOpen] = useState(false);

  const pending = requests.filter((r) => r.status === 'pending');
  const answered = requests.filter((r) => r.status === 'answered');

  if (requests.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={s.trigger}
      >
        <Inbox size={14} className={s.triggerIcon} />
        <span className={s.triggerTitle}>評価リクエスト</span>
        {pending.length > 0 ? (
          <span className={s.pendingBadge}>{pending.length}</span>
        ) : (
          <span className={s.answeredCount}>応答済み {answered.length}件</span>
        )}
      </button>

      {isOpen && (
        <ModalShell title="評価リクエスト" onClose={() => setIsOpen(false)}>
          <div className={s.modalBody}>
            {pending.length > 0 && (
              <div className={s.section}>
                {pending.map((request) => (
                  <ReviewRequestCard
                    key={request.id}
                    request={request}
                    onRespond={(kind, payload) =>
                      respond(request.id, kind, payload)
                    }
                    onDelete={() => deleteRequest(request.id)}
                  />
                ))}
              </div>
            )}

            {answered.length > 0 && (
              <div className={s.section}>
                <h3 className={s.sectionTitle}>応答済み</h3>
                {answered.map((request) => (
                  <ReviewRequestCard
                    key={request.id}
                    request={request}
                    onRespond={(kind, payload) =>
                      respond(request.id, kind, payload)
                    }
                    onDelete={() => deleteRequest(request.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );
}
