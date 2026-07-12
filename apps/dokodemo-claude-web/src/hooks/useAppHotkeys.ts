import { useEffect, useRef } from 'react';

export interface UseAppHotkeysOptions {
  onToggleProjectSwitcher: () => void; // Ctrl/Cmd+P
  onToggleCommandPalette: () => void; // Ctrl/Cmd+Shift+P
  onSwitchAiInstance: (direction: 1 | -1) => void; // Ctrl/Cmd+Shift+←→
}

/**
 * アプリ全体のキーボードショートカット（Ctrl+P / Cmd+P でプロジェクト切り替え、
 * Ctrl+Shift+P / Cmd+Shift+P でコマンドパレット、
 * Ctrl+Shift+←→ / Cmd+Shift+←→ でAIインスタンスタブ切り替え）を管理するカスタムフック
 * 副作用専用フック（戻り値なし）
 */
export function useAppHotkeys(options: UseAppHotkeysOptions): void {
  // コールバックは ref 経由で保持し、effect はマウント時1回だけ登録する
  const onToggleProjectSwitcherRef = useRef(options.onToggleProjectSwitcher);
  const onToggleCommandPaletteRef = useRef(options.onToggleCommandPalette);
  const onSwitchAiInstanceRef = useRef(options.onSwitchAiInstance);

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
    const handleKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

      // Ctrl/Cmd+Shift+←→: AIインスタンスタブ切り替え
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
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
        onSwitchAiInstanceRef.current(e.key === 'ArrowRight' ? 1 : -1);
        return;
      }

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
