import { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import type { AiProvider, ServerToClientEvents, ClientToServerEvents } from '@/types';
import type { AppSettings } from '@/app/utils/app-settings';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { pruneStaleLastWorktreeRefs } from '@/shared/utils/last-tab-storage';

/**
 * useSocketBootstrap フックのオプション
 */
export interface UseSocketBootstrapOptions {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  isConnected: boolean;
  currentRepo: string;
  primaryProvider: AiProvider | undefined;
  aiTerminalSize: { cols: number; rows: number } | null;
  permissionMode: AppSettings['permissionMode'];
  switchRepository: (path: string, opts?: { skipPushState?: boolean }) => void;
}

/**
 * Socket接続時の初期化処理・追加イベントリスナーをまとめて管理するカスタムフック
 * （副作用専用フック。戻り値なし）
 */
export function useSocketBootstrap(options: UseSocketBootstrapOptions): void {
  const {
    socket,
    isConnected,
    currentRepo,
    primaryProvider,
    aiTerminalSize,
    permissionMode,
  } = options;

  // currentRepoの参照
  const currentRepoRef = useRef(currentRepo);
  const primaryProviderRef = useRef(primaryProvider);
  // useEffect 依存に repository 全体を入れると毎レンダリングで effect が
  // 再発火するため、最新の switchRepository だけを ref 経由で参照する。
  const switchRepositoryRef = useRef(options.switchRepository);

  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);
  useEffect(() => {
    primaryProviderRef.current = primaryProvider;
  }, [primaryProvider]);
  useEffect(() => {
    switchRepositoryRef.current = options.switchRepository;
  }, [options.switchRepository]);

  // Socket接続時の初期化処理
  useEffect(() => {
    if (!socket || !isConnected) return;

    // リポジトリ一覧を取得
    socket.emit('list-repos');
    // 利用可能なエディタリストを取得
    socket.emit('get-available-editors');

    // リポジトリが選択されている場合は各種情報を取得
    const currentPath = currentRepoRef.current;
    if (!currentPath) return;

    // URL の `?repo=<path>` 経由で復元された path は、ユーザがその worktree を
    // ブラウザに開いたまま削除した結果として実体が消えている可能性がある。
    // そのまま `switch-repo` を投げると node-pty が cwd 不存在で失敗し、
    // UI が「何もできない」状態のまま残ってしまうため、事前に存在確認する。
    // - 存在する → 通常どおり switch-repo
    // - 存在しない & 親リポを推測できる → 親リポへフォールバック
    // - それ以外 → URL を消してホームへ戻す
    const switchOptions = {
      initialSize: aiTerminalSize || undefined,
      permissionMode,
    } as const;

    const handler = (
      data: Parameters<ServerToClientEvents['repo-path-checked']>[0]
    ) => {
      if (data.path !== currentPath) return;
      socket.off('repo-path-checked', handler);

      if (data.exists) {
        socket.emit('switch-repo', { path: currentPath, ...switchOptions });
        return;
      }

      // 削除済み worktree への参照を localStorage からも掃除する
      // （`last-worktree-for-parent` の親→最終 worktree マップが
      // この path を指したままだと、後でホーム経由で開き直しても再び
      // 同じ broken state に飛んでしまう）
      pruneStaleLastWorktreeRefs(currentPath);

      if (data.fallbackParentPath && data.fallbackParentExists) {
        switchRepositoryRef.current(data.fallbackParentPath);
      } else {
        // 親も推測できない/存在しない場合はホームへ戻す
        switchRepositoryRef.current('');
      }
    };
    socket.on('repo-path-checked', handler);
    socket.emit('check-repo-path', { path: currentPath });

    return () => {
      socket.off('repo-path-checked', handler);
    };
  }, [socket, isConnected, aiTerminalSize, permissionMode]);

  // Socket追加イベントリスナー
  useEffect(() => {
    if (!socket) return;

    // IDマッピング受信時の処理
    const handleIdMapping = (
      data: Parameters<ServerToClientEvents['id-mapping']>[0]
    ) => {
      repositoryIdMap.update(data);

      const currentPath = currentRepoRef.current;
      if (currentPath) {
        const rid = repositoryIdMap.getRid(currentPath);
        if (rid) {
          socket.emit('list-ai-instances', { rid });
          socket.emit('list-worktrees', { rid });
          socket.emit('list-terminals', { rid });
          socket.emit('list-shortcuts', { rid });
          socket.emit('list-branches', { rid });
          socket.emit('get-npm-scripts', { rid });
          const provider = primaryProviderRef.current;
          if (provider) {
            socket.emit('get-prompt-queue', { rid, provider });
          }
          socket.emit('get-files', { rid });
        }
      }
    };

    const handleIdMappingUpdated = (
      data: Parameters<ServerToClientEvents['id-mapping-updated']>[0]
    ) => {
      repositoryIdMap.update(data);
      const currentPath = currentRepoRef.current;
      if (currentPath) {
        const rid = repositoryIdMap.getRid(currentPath);
        if (rid) {
          socket.emit('list-worktrees', { rid });
        }
      }
    };

    // Self pulled
    const handleSelfPulled = (
      data: Parameters<ServerToClientEvents['self-pulled']>[0]
    ) => {
      if (data.success) {
        alert(`✅ ${data.message}\n\n${data.output}`);
      } else {
        alert(`❌ ${data.message}\n\n${data.output}`);
      }
    };

    // リポジトリ切り替え完了時に追加データを取得
    const handleRepoSwitched = (
      data: Parameters<ServerToClientEvents['repo-switched']>[0]
    ) => {
      if (data.success && data.rid) {
        socket.emit('list-ai-instances', { rid: data.rid });
        if (data.primaryProvider) {
          socket.emit('get-prompt-queue', {
            rid: data.rid,
            provider: data.primaryProvider,
          });
        }
        socket.emit('list-worktrees', { rid: data.rid });
        socket.emit('list-terminals', { rid: data.rid });
        socket.emit('list-shortcuts', { rid: data.rid });
        socket.emit('list-branches', { rid: data.rid });
        socket.emit('get-npm-scripts', { rid: data.rid });
        socket.emit('get-files', { rid: data.rid });
        socket.emit('get-git-diff-summary', { rid: data.rid });
        socket.emit('get-repos-process-status');
        socket.emit('get-remote-url', { rid: data.rid });
      }
    };

    socket.on('id-mapping', handleIdMapping);
    socket.on('id-mapping-updated', handleIdMappingUpdated);
    socket.on('self-pulled', handleSelfPulled);
    socket.on('repo-switched', handleRepoSwitched);

    return () => {
      socket.off('id-mapping', handleIdMapping);
      socket.off('id-mapping-updated', handleIdMappingUpdated);
      socket.off('self-pulled', handleSelfPulled);
      socket.off('repo-switched', handleRepoSwitched);
    };
  }, [socket]);
}
