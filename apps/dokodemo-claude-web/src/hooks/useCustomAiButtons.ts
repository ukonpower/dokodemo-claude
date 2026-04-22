import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import type {
  CustomAiButton,
  ServerToClientEvents,
  ClientToServerEvents,
} from '../types';

export interface UseCustomAiButtonsReturn {
  buttons: CustomAiButton[];
  createButton: (name: string, command: string) => void;
  updateButton: (id: string, name: string, command: string) => void;
  deleteButton: (id: string) => void;
  reorderButtons: (orderedIds: string[]) => void;
}

export function useCustomAiButtons(
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null
): UseCustomAiButtonsReturn {
  const [buttons, setButtons] = useState<CustomAiButton[]>([]);

  useEffect(() => {
    if (!socket) return;

    const handleList = (data: { buttons: CustomAiButton[] }) => {
      setButtons(data.buttons);
    };

    socket.on('custom-ai-buttons-list', handleList);
    socket.emit('list-custom-ai-buttons');

    return () => {
      socket.off('custom-ai-buttons-list', handleList);
    };
  }, [socket]);

  const createButton = useCallback(
    (name: string, command: string) => {
      socket?.emit('create-custom-ai-button', { name, command });
    },
    [socket]
  );

  const updateButton = useCallback(
    (id: string, name: string, command: string) => {
      socket?.emit('update-custom-ai-button', { id, name, command });
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
    buttons,
    createButton,
    updateButton,
    deleteButton,
    reorderButtons,
  };
}
