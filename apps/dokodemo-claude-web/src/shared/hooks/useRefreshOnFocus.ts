import { useEffect, useRef } from 'react';

/** 連続発火抑制の既定間隔 */
const DEFAULT_MIN_INTERVAL_MS = 5000;

/**
 * タブ/ウィンドウがアクティブに戻ったときに再取得コールバックを呼ぶ共通フック。
 *
 * PR 状況・push/pull コミット数・preview/md 受信ファイルなど、外部要因で
 * 変わる情報は socket の push 通知だけでは取り逃すことがある（バックグラウンド
 * タブのフリーズ等）。復帰タイミングで能動的に再取得して画面を追随させる。
 *
 * - `focus` と `visibilitychange` は同時に発火しうるため、直近実行からの
 *   経過時間（minIntervalMs）で抑制する
 * - コールバックは ref 経由で最新を参照するので、呼び出し側で useCallback に
 *   包まなくても再購読は起きない
 */
export function useRefreshOnFocus(
  refresh: () => void,
  minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS
): void {
  const refreshRef = useRef(refresh);
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const handleFocusRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRunAtRef.current < minIntervalMs) return;
      lastRunAtRef.current = Date.now();
      refreshRef.current();
    };
    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleFocusRefresh);
    return () => {
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleFocusRefresh);
    };
  }, [minIntervalMs]);
}
