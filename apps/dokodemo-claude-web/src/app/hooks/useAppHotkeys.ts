import { useEffect, useRef } from 'react';

export interface UseAppHotkeysOptions {
  onToggleProjectSwitcher: () => void; // Ctrl/Cmd+P
  onToggleCommandPalette: () => void; // Ctrl/Cmd+Shift+P
}

/**
 * アプリ全体のキーボードショートカット（Ctrl+P / Cmd+P でプロジェクト切り替え、
 * Ctrl+Shift+P / Cmd+Shift+P でコマンドパレット）を管理するカスタムフック
 * 副作用専用フック（戻り値なし）
 */
export function useAppHotkeys(options: UseAppHotkeysOptions): void {
  // コールバックは ref 経由で保持し、effect はマウント時1回だけ登録する
  const onToggleProjectSwitcherRef = useRef(options.onToggleProjectSwitcher);
  const onToggleCommandPaletteRef = useRef(options.onToggleCommandPalette);

  useEffect(() => {
    onToggleProjectSwitcherRef.current = options.onToggleProjectSwitcher;
  }, [options.onToggleProjectSwitcher]);
  useEffect(() => {
    onToggleCommandPaletteRef.current = options.onToggleCommandPalette;
  }, [options.onToggleCommandPalette]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
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
