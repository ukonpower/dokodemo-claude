import {
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, RotateCcw, X, Plus } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';
import type { AiInstance, AiProvider } from '../types';
import { getProviderShortName } from '../utils/ai-provider-info';
import { useOutsideClose } from '../hooks';
import s from './AiInstanceTabs.module.scss';

interface AiInstanceTabsProps {
  instances: AiInstance[];
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
  activeInstanceId,
  isConnected,
  onActivate,
  onCreate,
  onClose,
  onChangePrimaryProvider,
  onRestart,
}: AiInstanceTabsProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 各タブの操作メニュー（プロバイダー切替 / 再起動 / 閉じる）。
  // どのタブのメニューが開いているかを instanceId で保持する
  const [openMenuInstanceId, setOpenMenuInstanceId] = useState<string | null>(
    null
  );
  const [tabMenuPosition, setTabMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const tabMenuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const tabMenuRef = useRef<HTMLDivElement | null>(null);

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
    setMenuPosition(null);
  }, []);

  const openMenu = useCallback(() => {
    const rect = addButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPosition({ top: rect.bottom + 4, left: rect.left });
    setShowAddMenu(true);
  }, []);

  const toggleMenu = useCallback(() => {
    if (showAddMenu) closeMenu();
    else openMenu();
  }, [showAddMenu, closeMenu, openMenu]);

  useOutsideClose(showAddMenu, closeMenu, {
    ignore: [addButtonRef, menuRef],
  });

  const handleSelectProvider = (provider: AiProvider) => {
    closeMenu();
    onCreate(provider);
  };

  const closeTabMenu = useCallback(() => {
    setOpenMenuInstanceId(null);
    setTabMenuPosition(null);
  }, []);

  const openTabMenu = useCallback((instanceId: string) => {
    const rect = tabMenuButtonRefs.current
      .get(instanceId)
      ?.getBoundingClientRect();
    if (!rect) return;
    // 既定はメニュー右端を⋮ボタンの右端に合わせる（右詰め）。
    // 実幅は開いた後に useLayoutEffect で測って左端をクランプするので、
    // ここでは仮幅で初期位置だけ決めておく。
    const MENU_MARGIN = 8;
    const ESTIMATED_WIDTH = 160;
    let left = rect.right - ESTIMATED_WIDTH;
    left = Math.min(left, window.innerWidth - ESTIMATED_WIDTH - MENU_MARGIN);
    left = Math.max(left, MENU_MARGIN);
    setTabMenuPosition({ top: rect.bottom + 4, left });
    setOpenMenuInstanceId(instanceId);
  }, []);

  const toggleTabMenu = useCallback(
    (instanceId: string) => {
      if (openMenuInstanceId === instanceId) closeTabMenu();
      else openTabMenu(instanceId);
    },
    [openMenuInstanceId, closeTabMenu, openTabMenu]
  );

  useOutsideClose(!!openMenuInstanceId, closeTabMenu, {
    ignore: [
      tabMenuRef,
      () =>
        openMenuInstanceId
          ? (tabMenuButtonRefs.current.get(openMenuInstanceId) ?? null)
          : null,
    ],
  });

  // 開いたメニューの実幅を測り、画面外へはみ出さないよう left をクランプする。
  // 一番左のタブでは右詰めのままだと左へはみ出すため、実測して左寄せに切り替える。
  useLayoutEffect(() => {
    if (!openMenuInstanceId) return;
    const menu = tabMenuRef.current;
    const btn = tabMenuButtonRefs.current.get(openMenuInstanceId);
    if (!menu || !btn) return;
    const btnRect = btn.getBoundingClientRect();
    const width = menu.offsetWidth;
    const MENU_MARGIN = 8;
    // 既定は右詰め（メニュー右端を⋮ボタン右端に合わせる）
    let left = btnRect.right - width;
    left = Math.min(left, window.innerWidth - width - MENU_MARGIN);
    left = Math.max(left, MENU_MARGIN);
    setTabMenuPosition((prev) =>
      prev && Math.abs(prev.left - left) > 0.5 ? { ...prev, left } : prev
    );
  }, [openMenuInstanceId]);

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
                title={`${getProviderShortName(inst.provider)}${inst.isPrimary ? ' (プライマリ)' : ''}`}
              >
                <span className={s.label}>{label}</span>
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

      {showAddMenu &&
        menuPosition &&
        createPortal(
          <div
            ref={menuRef}
            className={s.addMenu}
            style={{
              position: 'fixed',
              top: menuPosition.top,
              left: menuPosition.left,
            }}
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
          </div>,
          document.body
        )}

      {openMenuInstanceId &&
        tabMenuPosition &&
        (() => {
          const inst = sorted.find(
            (i) => i.instanceId === openMenuInstanceId
          );
          if (!inst) return null;
          return createPortal(
            <div
              ref={tabMenuRef}
              className={s.addMenu}
              style={{
                position: 'fixed',
                top: tabMenuPosition.top,
                left: tabMenuPosition.left,
              }}
            >
              {inst.isPrimary ? (
                <>
                  <button
                    onClick={() => {
                      closeTabMenu();
                      onChangePrimaryProvider('claude');
                    }}
                    className={`${s.addMenuItem} ${s.claude}`}
                  >
                    Claude に切替
                  </button>
                  <button
                    onClick={() => {
                      closeTabMenu();
                      onChangePrimaryProvider('codex');
                    }}
                    className={`${s.addMenuItem} ${s.codex}`}
                  >
                    Codex に切替
                  </button>
                  {/* 再起動は Claude のタブのみ */}
                  {inst.provider === 'claude' && (
                    <>
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
                  )}
                </>
              ) : (
                <>
                  {/* 再起動は Claude のタブのみ */}
                  {inst.provider === 'claude' && (
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
                  )}
                  <button
                    onClick={() => {
                      closeTabMenu();
                      onClose(inst.instanceId);
                    }}
                    className={s.addMenuItem}
                  >
                    <X size={14} />
                    <span>タブを閉じる</span>
                  </button>
                </>
              )}
            </div>,
            document.body
          );
        })()}
    </div>
  );
}

export default AiInstanceTabs;
