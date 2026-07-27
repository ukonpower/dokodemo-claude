import { useEffect, useRef } from 'react';

export interface UseAppHotkeysOptions {
  onToggleProjectSwitcher: () => void; // Ctrl/Cmd+P
  onToggleCommandPalette: () => void; // Ctrl/Cmd+Shift+P
  onSwitchAiInstance: (direction: 1 | -1) => void; // Ctrl+Shift+←→
  onOpenActiveTabMenu: () => void; // Ctrl+Shift+↓
}

/**
 * アプリ全体のキーボードショートカット（Ctrl+P / Cmd+P でプロジェクト切り替え、
 * Ctrl+Shift+P / Cmd+Shift+P でコマンドパレット、
 * Ctrl+Shift+←→ でAIインスタンスタブ切り替え、
 * Ctrl+Shift+↓ で選択中タブのメニューを開く）を管理するカスタムフック
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

      // Ctrl+Shift+←→: AIインスタンスタブ切り替え（右端でさらに右なら新規追加）
      // Ctrl+Shift+↓: 選択中タブのメニューを開く
      // Cmd は使わない（macOS の Cmd+Shift+←→ はテキストの行頭/行末選択と衝突するため）。
      // Ctrl+Shift+矢印は編集の標準操作にも OS 予約にも当たらないので、
      // テキスト入力中・xterm フォーカス中でも常に横取りしてよい
      if (
        e.ctrlKey &&
        e.shiftKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowDown')
      ) {
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
