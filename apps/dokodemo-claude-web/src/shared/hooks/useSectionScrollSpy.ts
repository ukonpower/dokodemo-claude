import { useEffect, useState, type RefObject } from 'react';

/**
 * 設定系ビューのカテゴリナビ用スクロールスパイ。
 *
 * スクロールコンテナ内の `[data-section-id]` を走査して、判定線を最後に
 * 越えたセクションをアクティブとして返す。最終セクションが短く判定線に
 * 届かないケースがあるため、最下部到達時は最終セクションを優先する。
 *
 * @param bodyRef スクロールコンテナの ref
 * @param idPrefix セクション要素の DOM id 接頭辞（`<prefix><sectionId>`）
 */
export function useSectionScrollSpy<T extends string>(
  bodyRef: RefObject<HTMLElement | null>,
  idPrefix: string
): { activeSection: T | undefined; scrollToSection: (id: T) => void } {
  const [activeSection, setActiveSection] = useState<T | undefined>(undefined);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const handleScroll = () => {
      const sections = Array.from(
        body.querySelectorAll<HTMLElement>('[data-section-id]')
      );
      const line = body.getBoundingClientRect().top + 120;
      let current: string | undefined = sections[0]?.dataset.sectionId;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) {
          current = section.dataset.sectionId;
        }
      }
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
        current = sections[sections.length - 1]?.dataset.sectionId ?? current;
      }
      if (current) setActiveSection(current as T);
    };

    body.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => body.removeEventListener('scroll', handleScroll);
  }, [bodyRef]);

  const scrollToSection = (id: T) => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    document.getElementById(`${idPrefix}${id}`)?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return { activeSection, scrollToSection };
}
