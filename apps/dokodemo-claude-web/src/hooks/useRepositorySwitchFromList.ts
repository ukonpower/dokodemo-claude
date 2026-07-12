import { useCallback } from 'react';
import { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types';
import {
  getLastWorktreeForParent,
  setLastWorktreeForParent,
} from '../utils/last-tab-storage';

/**
 * リポジトリ一覧（HomeView / RepositorySwitcher）からのクリック時に、
 * 親リポに紐づく「最後に選んだ worktree」が保存されていれば差し替える。
 * 自動 restore は本ハンドラ呼び出し時にのみ発火（描画時の useEffect では
 * やらない）。これにより「topに戻る」ボタンを押してもホームに留まれる。
 * 保存された worktree が削除済みだった場合は親リポへフォールバックし、
 * 保存値をクリアして次回以降の無効参照を防ぐ。
 */
export function useRepositorySwitchFromList(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  switchRepository: (path: string) => void
): (path: string) => void {
  return useCallback(
    (path: string) => {
      if (!path) {
        switchRepository(path);
        return;
      }
      const lastPath = getLastWorktreeForParent(path);
      if (!lastPath || lastPath === path || !socket) {
        switchRepository(path);
        return;
      }
      // サーバに存在確認 → 結果次第で worktree か親リポへ切り替える
      const handler = (data: { path: string; exists: boolean }) => {
        if (data.path !== lastPath) return;
        socket.off('repo-path-checked', handler);
        if (data.exists) {
          switchRepository(lastPath);
        } else {
          // 削除されていた worktree への参照を捨てて親リポへ戻す
          setLastWorktreeForParent(path, path);
          switchRepository(path);
        }
      };
      socket.on('repo-path-checked', handler);
      socket.emit('check-repo-path', { path: lastPath });
    },
    [socket, switchRepository]
  );
}
