import { X, Inbox } from 'lucide-react';
import IconButton from '@/shared/components/IconButton';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useNavigationContext } from '@/app/providers/NavigationProvider';
import { useReviewContext } from '@/features/review/providers/ReviewProvider';
import { ReviewInbox } from '@/features/review/components/ReviewInbox';
import s from './ReviewInboxView.module.scss';

/**
 * 評価リクエストの受信箱ビュー。
 * AI が発行した評価リクエストを一覧し、選択・一言・そもそも相談で応答する。
 */
export function ReviewInboxView() {
  const { repository } = useRepositoryContext();
  const { closeReviewInbox } = useNavigationContext();
  const { pendingCount } = useReviewContext();

  const repoName = repository.currentRepo.split('/').pop() ?? '';

  return (
    <div className={s.root}>
      <header className={s.header}>
        <Inbox size={16} aria-hidden />
        <h1 className={s.headerTitle}>評価リクエスト</h1>
        <span className={s.headerSubject}>{repoName}</span>
        {pendingCount > 0 && (
          <span className={s.pendingBadge}>{pendingCount}</span>
        )}
        <IconButton
          className={s.headerClose}
          label="受信箱を閉じる"
          onClick={closeReviewInbox}
        >
          <X />
        </IconButton>
      </header>

      <div className={s.body}>
        <div className={s.content}>
          <ReviewInbox />
        </div>
      </div>
    </div>
  );
}
