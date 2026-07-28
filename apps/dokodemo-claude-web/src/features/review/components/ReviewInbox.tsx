import { Inbox } from 'lucide-react';
import EmptyState from '@/shared/components/EmptyState';
import { useReviewContext } from '@/features/review/providers/ReviewProvider';
import { ReviewRequestCard } from '@/features/review/components/ReviewRequestCard';
import s from './ReviewInbox.module.scss';

/**
 * 評価リクエストの一覧。未応答を上に、応答済みをその下に表示する。
 */
export function ReviewInbox() {
  const { requests, respond, deleteRequest } = useReviewContext();

  const pending = requests.filter((r) => r.status === 'pending');
  const answered = requests.filter((r) => r.status === 'answered');

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<Inbox />}
        message="評価リクエストはありません"
        hint="AI が review_request ツールで発行すると、ここに評価待ちが届きます"
      />
    );
  }

  return (
    <div className={s.root}>
      {pending.length > 0 && (
        <div className={s.section}>
          {pending.map((request) => (
            <ReviewRequestCard
              key={request.id}
              request={request}
              onRespond={(kind, payload) => respond(request.id, kind, payload)}
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
              onRespond={(kind, payload) => respond(request.id, kind, payload)}
              onDelete={() => deleteRequest(request.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
