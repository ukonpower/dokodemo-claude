import { useState, useEffect, useCallback, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type {
  ReviewRequest,
  ReviewResponseKind,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@/types';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';

export interface UseReviewInboxReturn {
  /** 受信箱のレビューリクエスト（新しい順） */
  requests: ReviewRequest[];
  /** 未応答の件数（入口ボタンのバッジ表示用） */
  pendingCount: number;
  /** 応答を送る（応答内容は発行元の AI キューへ注入される） */
  respond: (
    requestId: string,
    kind: ReviewResponseKind,
    payload: { choice?: string; comment?: string }
  ) => void;
  deleteRequest: (requestId: string) => void;
  refresh: () => void;
}

/**
 * レビューリクエスト受信箱の状態管理。
 * 受信箱は親リポジトリ単位のため、worktree 表示中でも購読は現在の rid で行い、
 * サーバが返す inboxRid（親の rid）で以後のイベントをフィルタする。
 */
export function useReviewInbox(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepo: string
): UseReviewInboxReturn {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);

  const currentRepoRef = useRef(currentRepo);
  // 現在購読中の受信箱 rid（review-requests-list の応答で確定する）
  const inboxRidRef = useRef<string | null>(null);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  const emitGetRequests = useCallback(() => {
    if (!socket || !socket.connected) return;
    const rid = repositoryIdMap.getRid(currentRepoRef.current);
    if (!rid) return;
    socket.emit('review-get-requests', { rid });
  }, [socket]);

  // バックグラウンドタブでは push を取り逃すことがあるため、復帰時に取り直す
  useRefreshOnFocus(emitGetRequests);

  useEffect(() => {
    if (!socket) return;

    const handleList = (
      data: Parameters<ServerToClientEvents['review-requests-list']>[0]
    ) => {
      const currentRid = repositoryIdMap.getRid(currentRepoRef.current);
      if (data.rid !== currentRid) return;
      inboxRidRef.current = data.inboxRid;
      setRequests(data.requests);
    };

    const handleCreated = (
      data: Parameters<ServerToClientEvents['review-request-created']>[0]
    ) => {
      if (data.rid !== inboxRidRef.current) return;
      setRequests((prev) => {
        if (prev.some((r) => r.id === data.request.id)) return prev;
        return [data.request, ...prev];
      });
    };

    const handleUpdated = (
      data: Parameters<ServerToClientEvents['review-request-updated']>[0]
    ) => {
      if (data.rid !== inboxRidRef.current) return;
      setRequests((prev) =>
        prev.map((r) => (r.id === data.request.id ? data.request : r))
      );
    };

    const handleDeleted = (
      data: Parameters<ServerToClientEvents['review-request-deleted']>[0]
    ) => {
      if (data.rid !== inboxRidRef.current) return;
      setRequests((prev) => prev.filter((r) => r.id !== data.requestId));
    };

    socket.on('review-requests-list', handleList);
    socket.on('review-request-created', handleCreated);
    socket.on('review-request-updated', handleUpdated);
    socket.on('review-request-deleted', handleDeleted);

    return () => {
      socket.off('review-requests-list', handleList);
      socket.off('review-request-created', handleCreated);
      socket.off('review-request-updated', handleUpdated);
      socket.off('review-request-deleted', handleDeleted);
    };
  }, [socket]);

  // リポジトリ切り替え・接続確立時に一覧を取得する
  useEffect(() => {
    inboxRidRef.current = null;
    setRequests([]);
    if (!socket || !currentRepo) return;

    emitGetRequests();

    // 初回マウント時など未接続の場合は接続確立後に取得する。
    // また、接続直後は id-mapping（パス→rid の対応表）が届くまで rid を引けず
    // 取得できないため、id-mapping の到着・更新時にも取り直す
    const handleConnect = () => emitGetRequests();
    socket.on('connect', handleConnect);
    socket.on('id-mapping', handleConnect);
    socket.on('id-mapping-updated', handleConnect);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('id-mapping', handleConnect);
      socket.off('id-mapping-updated', handleConnect);
    };
  }, [socket, currentRepo, emitGetRequests]);

  const respond = useCallback(
    (
      requestId: string,
      kind: ReviewResponseKind,
      payload: { choice?: string; comment?: string }
    ) => {
      const rid = inboxRidRef.current;
      if (!socket || !rid) return;
      socket.emit('review-respond', {
        rid,
        requestId,
        kind,
        choice: payload.choice,
        comment: payload.comment,
      });
    },
    [socket]
  );

  const deleteRequest = useCallback(
    (requestId: string) => {
      const rid = inboxRidRef.current;
      if (!socket || !rid) return;
      socket.emit('review-delete-request', { rid, requestId });
    },
    [socket]
  );

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return {
    requests,
    pendingCount,
    respond,
    deleteRequest,
    refresh: emitGetRequests,
  };
}
