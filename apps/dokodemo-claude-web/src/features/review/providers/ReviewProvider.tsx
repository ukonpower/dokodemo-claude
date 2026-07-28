import { createContext, useContext, type ReactNode } from 'react';
import {
  useReviewInbox,
  type UseReviewInboxReturn,
} from '@/features/review/hooks/useReviewInbox';
import { useSocketContext } from '@/app/providers/SocketProvider';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';

const ReviewContext = createContext<UseReviewInboxReturn | null>(null);

/**
 * 評価リクエスト受信箱（useReviewInbox）を提供する Provider。
 */
export function ReviewProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocketContext();
  const { repository } = useRepositoryContext();

  const reviewInbox = useReviewInbox(socket, repository.currentRepo);

  return (
    <ReviewContext.Provider value={reviewInbox}>
      {children}
    </ReviewContext.Provider>
  );
}

export function useReviewContext(): UseReviewInboxReturn {
  const ctx = useContext(ReviewContext);
  if (!ctx) {
    throw new Error('useReviewContext must be used within ReviewProvider');
  }
  return ctx;
}
