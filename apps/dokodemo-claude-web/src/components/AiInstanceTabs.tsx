import { useMemo, useState, useRef, useCallback } from 'react';
import { MoreVertical, RotateCcw, Power, Plus } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';
import type { AiInstance, AiProvider } from '../types';
import { getProviderShortName } from '../utils/ai-provider-info';
import { PopupMenu } from './PopupMenu';
import s from './AiInstanceTabs.module.scss';

interface AiInstanceTabsProps {
  instances: AiInstance[];
  /** instanceId → 指示内容の要約（タブのサブテキスト表示用） */
  activitySummaries: Record<string, string>;
  activeInstanceId: string;
  isConnected: boolean;
  onActivate: (instanceId: string) => void;
  onCreate: (provider: AiProvider) => void;
  onClose: (instanceId: string) => void;
  /** プライマリインスタンスのプロバイダー切替 */
  onChangePrimaryProvider: (provider: AiProvider) => void;
  /** インスタンスの AI CLI セッションを再起動 */
  onRestart: (instanceId: string) => void;
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
  activitySummaries,
  activeInstanceId,
  isConnected,
  onActivate,
  onCreate,
  onClose,
  onChangePrimaryProvider,
  onRestart,
}: AiInstanceTabsProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  // 各タブの操作メニュー（プロバイダー切替 / 再起動 / 閉じる）。
  // どのタブのメニューが開いているかを instanceId で保持する
  const [openMenuInstanceId, setOpenMenuInstanceId] = useState<string | null>(
    null
  );
  const tabMenuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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

  const closeMenu = useCallback(() => {
    setShowAddMenu(false);
  }, []);

  const toggleMenu = useCallback(() => {
    setShowAddMenu((prev) => !prev);
  }, []);

  const handleSelectProvider = (provider: AiProvider) => {
    closeMenu();
    onCreate(provider);
  };

  const closeTabMenu = useCallback(() => {
    setOpenMenuInstanceId(null);
  }, []);

  const toggleTabMenu = useCallback((instanceId: string) => {
    setOpenMenuInstanceId((prev) => (prev === instanceId ? null : instanceId));
  }, []);

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
          const summary = activitySummaries[inst.instanceId];
          return (
            <SwiperSlide key={inst.instanceId} className={s.slideAuto}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onActivate(inst.instanceId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onActivate(inst.instanceId);
                  }
                }}
                className={`${s.tab} ${isActive ? s.active : ''} ${providerClass}`}
                title={`${getProviderShortName(inst.provider)}${inst.isPrimary ? ' (プライマリ)' : ''}${summary ? ` — ${summary}` : ''}`}
              >
                <span className={s.tabTexts}>
                  <span className={s.label}>{label}</span>
                  {summary && <span className={s.summary}>{summary}</span>}
                </span>
                <button
                  ref={(el) => {
                    if (el) {
                      tabMenuButtonRefs.current.set(inst.instanceId, el);
                    } else {
                      tabMenuButtonRefs.current.delete(inst.instanceId);
                    }
                  }}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTabMenu(inst.instanceId);
                  }}
                  disabled={!isConnected}
                  className={s.menuBtn}
                  title="タブメニュー"
                >
                  <MoreVertical size={14} />
                </button>
              </div>
            </SwiperSlide>
          );
        })}

        <SwiperSlide className={s.slideAuto}>
          <div className={s.addWrapper}>
            <button
              ref={addButtonRef}
              type="button"
              onClick={toggleMenu}
              disabled={!isConnected}
              className={s.addBtn}
              title="新しい AI インスタンスを追加"
            >
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </div>
        </SwiperSlide>
      </Swiper>

      <PopupMenu
        open={showAddMenu}
        anchorEl={addButtonRef.current}
        onClose={closeMenu}
      >
        <button
          onClick={() => handleSelectProvider('claude')}
          className={`${s.addMenuItem} ${s.claude}`}
        >
          Claude
        </button>
        <button
          onClick={() => handleSelectProvider('codex')}
          className={`${s.addMenuItem} ${s.codex}`}
        >
          Codex
        </button>
      </PopupMenu>

      {(() => {
        const inst = openMenuInstanceId
          ? sorted.find((i) => i.instanceId === openMenuInstanceId)
          : null;
        return (
          <PopupMenu
            open={!!inst}
            anchorEl={
              openMenuInstanceId
                ? (tabMenuButtonRefs.current.get(openMenuInstanceId) ?? null)
                : null
            }
            onClose={closeTabMenu}
          >
            {inst ? (
              inst.isPrimary ? (
                <>
                  {/* provider 切替はセグメントコントロールで現在選択中を明示 */}
                  <div
                    className={s.providerSegment}
                    role="group"
                    aria-label="AI provider"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        closeTabMenu();
                        if (inst.provider !== 'claude') {
                          onChangePrimaryProvider('claude');
                        }
                      }}
                      className={`${s.providerSegmentItem} ${s.claude} ${
                        inst.provider === 'claude' ? s.active : ''
                      }`}
                      aria-pressed={inst.provider === 'claude'}
                    >
                      Claude
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeTabMenu();
                        if (inst.provider !== 'codex') {
                          onChangePrimaryProvider('codex');
                        }
                      }}
                      className={`${s.providerSegmentItem} ${s.codex} ${
                        inst.provider === 'codex' ? s.active : ''
                      }`}
                      aria-pressed={inst.provider === 'codex'}
                    >
                      Codex
                    </button>
                  </div>
                  <div className={s.menuDivider} />
                  <button
                    onClick={() => {
                      closeTabMenu();
                      onRestart(inst.instanceId);
                    }}
                    className={s.addMenuItem}
                  >
                    <RotateCcw size={14} />
                    <span>再起動</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      closeTabMenu();
                      onRestart(inst.instanceId);
                    }}
                    className={s.addMenuItem}
                  >
                    <RotateCcw size={14} />
                    <span>再起動</span>
                  </button>
                  <button
                    onClick={() => {
                      closeTabMenu();
                      onClose(inst.instanceId);
                    }}
                    className={s.addMenuItem}
                  >
                    <Power size={14} />
                    <span>シャットダウン</span>
                  </button>
                </>
              )
            ) : null}
          </PopupMenu>
        );
      })()}
    </div>
  );
}

export default AiInstanceTabs;
