import { useEffect, useRef } from 'react';

export interface UseAppHotkeysOptions {
  onToggleProjectSwitcher: () => void; // Ctrl/Cmd+P
  onToggleCommandPalette: () => void; // Ctrl/Cmd+Shift+P
  onSwitchAiInstance: (direction: 1 | -1) => void; // Shift+←→
  onOpenActiveTabMenu: () => void; // Shift+↓
}

/**
 * アプリ全体のキーボードショートカット（Ctrl+P / Cmd+P でプロジェクト切り替え、
 * Ctrl+Shift+P / Cmd+Shift+P でコマンドパレット、
 * Shift+←→ でAIインスタンスタブ切り替え、
 * Shift+↓ で選択中タブのメニューを開く）を管理するカスタムフック
 * 副作用専用フック（戻り値なし）
 */
export function useAppHotkeys(options: UseAppHotkeysOptions): void {
  // コールバックは ref 経由で保持し、effect はマウント時1回だけ登録する
  const onToggleProjectSwitcherRef = useRef(options.onToggleProjectSwitcher);
  const onToggleCommandPaletteRef = useRef(options.onToggleCommandPalette);
  const onSwitchAiInstanceRef = useRef(options.onSwitchAiInstance);
  const onOpenActiveTabMenuRef = useRef(options.onOpenActiveTabMenu);

  useEffect(() => {
    onToggleProjectSwitcherRef.current = options.onToggleProjectSwitcher;
  }, [options.onToggleProjectSwitcher]);
  useEffect(() => {
    onToggleCommandPaletteRef.current = options.onToggleCommandPalette;
  }, [options.onToggleCommandPalette]);
  useEffect(() => {
    onSwitchAiInstanceRef.current = options.onSwitchAiInstance;
  }, [options.onSwitchAiInstance]);
  useEffect(() => {
    onOpenActiveTabMenuRef.current = options.onOpenActiveTabMenu;
  }, [options.onOpenActiveTabMenu]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.altKey) return;

      // Shift+←→: AIインスタンスタブ切り替え（右端でさらに右なら新規追加）
      // Shift+↓: 選択中タブのメニューを開く
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowDown')
      ) {
        // テキスト編集中は行頭/行末選択のブラウザ既定動作を優先する。
        // ただし xterm の入力プロキシ textarea は編集ではないので対象にする
        const t = e.target as HTMLElement | null;
        const isEditable =
          t instanceof HTMLInputElement ||
          (t instanceof HTMLTextAreaElement &&
            !t.classList.contains('xterm-helper-textarea')) ||
          t?.isContentEditable;
        if (isEditable) return;
        e.preventDefault();
        if (e.key === 'ArrowDown') {
          onOpenActiveTabMenuRef.current();
        } else {
          onSwitchAiInstanceRef.current(e.key === 'ArrowRight' ? 1 : -1);
        }
        return;
      }

      // Ctrl/Cmd+P / Ctrl/Cmd+Shift+P
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() !== 'p') return;
      e.preventDefault();
      if (e.shiftKey) {
        onToggleCommandPaletteRef.current();
      } else {
        onToggleProjectSwitcherRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
}
