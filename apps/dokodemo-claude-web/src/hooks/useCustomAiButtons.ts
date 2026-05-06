import { useState, useEffect, useCallback, useMemo } from 'react';
import { Socket } from 'socket.io-client';
import type {
  CustomAiButton,
  CustomAiButtonScope,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';

export interface UseCustomAiButtonsReturn {
  // 全ボタン（グローバル + 全リポジトリ固有）
  allButtons: CustomAiButton[];
  // 現在のリポジトリで表示すべきボタン（グローバル + 現在リポジトリ固有）
  buttons: CustomAiButton[];
  createButton: (
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  updateButton: (
    id: string,
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ) => void;
  deleteButton: (id: string) => void;
  reorderButtons: (orderedIds: string[]) => void;
}

export function useCustomAiButtons(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null,
  currentRepositoryPath?: string
): UseCustomAiButtonsReturn {
  const [allButtons, setAllButtons] = useState<CustomAiButton[]>([]);

  useEffect(() => {
    if (!socket) return;

    const handleList = (data: { buttons: CustomAiButton[] }) => {
      setAllButtons(data.buttons);
    };

    socket.on('custom-ai-buttons-list', handleList);
    socket.emit('list-custom-ai-buttons');

    return () => {
      socket.off('custom-ai-buttons-list', handleList);
    };
  }, [socket]);

  const buttons = useMemo(
    () =>
      allButtons.filter(
        (btn) =>
          btn.scope === 'global' ||
          (btn.scope === 'repository' &&
            btn.repositoryPath === currentRepositoryPath)
      ),
    [allButtons, currentRepositoryPath]
  );

  const createButton = useCallback(
    (
      name: string,
      command: string,
      scope: CustomAiButtonScope,
      repositoryPath?: string
    ) => {
      socket?.emit('create-custom-ai-button', {
        name,
        command,
        scope,
        repositoryPath,
      });
    },
    [socket]
  );

  const updateButton = useCallback(
    (
      id: string,
      name: string,
      command: string,
      scope: CustomAiButtonScope,
      repositoryPath?: string
    ) => {
      socket?.emit('update-custom-ai-button', {
        id,
        name,
        command,
        scope,
        repositoryPath,
      });
    },
    [socket]
  );

  const deleteButton = useCallback(
    (id: string) => {
      socket?.emit('delete-custom-ai-button', { id });
    },
    [socket]
  );

  const reorderButtons = useCallback(
    (orderedIds: string[]) => {
      socket?.emit('reorder-custom-ai-buttons', { orderedIds });
    },
    [socket]
  );

  return {
    allButtons,
    buttons,
    createButton,
    updateButton,
    deleteButton,
    reorderButtons,
  };
}
