import { useMemo, useState, useRef, useEffect } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';
import type { AiInstance, AiProvider } from '../types';
import { getProviderShortName } from '../utils/ai-provider-info';
import s from './AiInstanceTabs.module.scss';

interface AiInstanceTabsProps {
  instances: AiInstance[];
  activeInstanceId: string;
  isConnected: boolean;
  onActivate: (instanceId: string) => void;
  onCreate: (provider: AiProvider) => void;
  onClose: (instanceId: string) => void;
}

/**
 * インスタンスの表示名を決定
 * displayName が無ければ provider 名 + 連番（プライマリは省略）
 */
function getDisplayName(
  instance: AiInstance,
  sameProviderSubs: AiInstance[]
): string {
  if (instance.displayName) return instance.displayName;
  const providerLabel = getProviderShortName(instance.provider);
  if (instance.isPrimary) return providerLabel;

  const index = sameProviderSubs.findIndex(
    (i) => i.instanceId === instance.instanceId
  );
  return `${providerLabel} #${index + 2}`;
}

/**
 * AI インスタンスのタブ列
 */
function AiInstanceTabs({
  instances,
  activeInstanceId,
  isConnected,
  onActivate,
  onCreate,
  onClose,
}: AiInstanceTabsProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => [...instances].sort((a, b) => a.order - b.order),
    [instances]
  );

  // 同 provider のサブを並び順で並べる（番号表示用）
  const subsByProvider = useMemo(() => {
    const map = new Map<AiProvider, AiInstance[]>();
    for (const inst of sorted) {
      if (inst.isPrimary) continue;
      const arr = map.get(inst.provider) ?? [];
      arr.push(inst);
      map.set(inst.provider, arr);
    }
    return map;
  }, [sorted]);

  useEffect(() => {
    if (!showAddMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        addButtonRef.current &&
        !addButtonRef.current.contains(target)
      ) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddMenu]);

  const handleSelectProvider = (provider: AiProvider) => {
    setShowAddMenu(false);
    onCreate(provider);
  };

  return (
    <div className={s.root}>
      <Swiper
        modules={[FreeMode]}
        freeMode
        slidesPerView="auto"
        spaceBetween={0}
        className={s.swiper}
      >
        {sorted.map((inst) => {
          const isActive = inst.instanceId === activeInstanceId;
          const subs = subsByProvider.get(inst.provider) ?? [];
          const label = getDisplayName(inst, subs);
          const providerClass = inst.provider === 'claude' ? s.claude : s.codex;
          return (
            <SwiperSlide key={inst.instanceId} className={s.slideAuto}>
              <button
                onClick={() => onActivate(inst.instanceId)}
                className={`${s.tab} ${isActive ? s.active : ''} ${providerClass}`}
                title={`${getProviderShortName(inst.provider)}${inst.isPrimary ? ' (プライマリ)' : ''}`}
              >
                <span className={s.providerDot} />
                <span className={s.label}>{label}</span>
                {!inst.isPrimary && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(inst.instanceId);
                    }}
                    disabled={!isConnected}
                    className={s.closeBtn}
                    title="このインスタンスを閉じる"
                  >
                    <svg viewBox="0 0 16 16" fill="none">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </button>
            </SwiperSlide>
          );
        })}

        <SwiperSlide className={s.slideAuto}>
          <div className={s.addWrapper}>
            <button
              ref={addButtonRef}
              type="button"
              onClick={() => setShowAddMenu((v) => !v)}
              disabled={!isConnected}
              className={s.addBtn}
              title="新しい AI インスタンスを追加"
            >
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {showAddMenu && (
              <div ref={menuRef} className={s.addMenu}>
                <button
                  onClick={() => handleSelectProvider('claude')}
                  className={`${s.addMenuItem} ${s.claude}`}
                >
                  <span className={s.providerDot} />
                  Claude
                </button>
                <button
                  onClick={() => handleSelectProvider('codex')}
                  className={`${s.addMenuItem} ${s.codex}`}
                >
                  <span className={s.providerDot} />
                  Codex
                </button>
              </div>
            )}
          </div>
        </SwiperSlide>
      </Swiper>
    </div>
  );
}

export default AiInstanceTabs;
