import { useEffect, useState } from 'react';

/**
 * CSS メディアクエリのマッチ状態を購読するフック。
 * ブレークポイント値は libs/design-tokens の $breakpoint-* と揃えること。
 *
 * @example
 *   const isDesktop = useMediaQuery('(min-width: 860px)'); // lg 以上
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent): void => setMatches(e.matches);
    // マウント時点の値に同期（query 変更や SSR 初期値ずれに備える）
    setMatches(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
