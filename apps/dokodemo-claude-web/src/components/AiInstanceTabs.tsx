import {
  useMemo,
  useState,
  useRef,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { ForwardedRef } from 'react';
import { MoreVertical, RotateCcw, Power, Plus } from 'lucide-react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';
import type { AiInstance, AiProvider } from '../types';
import { getProviderShortName } from '../utils/ai-provider-info';
import { PopupMenu } from './PopupMenu';
import s from './AiInstanceTabs.module.scss';

// 追加メニューの項目（矢印キーで選択）。'close' はメニューを閉じるだけ
const ADD_MENU_ITEMS: { key: AiProvider | 'close'; label: string }[] = [
  { key: 'claude', label: 'Claude' },
  { key: 'codex', label: 'Codex' },
  { key: 'close', label: '閉じる' },
];

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

/** 親からメニューを開くための命令的ハンドル（Shift+→ の右端追加 / Shift+↓ のタブメニュー） */
export interface AiInstanceTabsHandle {
  openAddMenu: () => void;
  openTabMenu: (instanceId: string) => void;
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
}: AiInstanceTabsProps, ref: ForwardedRef<AiInstanceTabsHandle>) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  // 追加メニューでハイライト中の項目（矢印キー操作用）
  const [addMenuIndex, setAddMenuIndex] = useState(0);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  // 各タブの操作メニュー（プロバイダー切替 / 再起動 / 閉じる）。
  // どのタブのメニューが開いているかを instanceId で保持する
  const [openMenuInstanceId, setOpenMenuInstanceId] = useState<string | null>(
    null
  );
  const tabMenuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // 追加メニューを開く（先頭 Claude をハイライト状態に）
  const openAddMenu = useCallback(() => {
    setOpenMenuInstanceId(null);
    setAddMenuIndex(0);
    setShowAddMenu(true);
  }, []);

  // 選択中タブのメニューを開く（Shift+↓ からの呼び出し用）
  const openTabMenu = useCallback((instanceId: string) => {
    setShowAddMenu(false);
    setOpenMenuInstanceId(instanceId);
  }, []);

  // 親（Shift+→ の右端追加 / Shift+↓ のタブメニュー）からメニューを開けるようにする
  useImperativeHandle(
    ref,
    () => ({ openAddMenu, openTabMenu }),
    [openAddMenu, openTabMenu]
  );

  // Enter 確定時に最新のハイライト位置を参照するための ref
  const addMenuIndexRef = useRef(0);
  addMenuIndexRef.current = addMenuIndex;

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
    setShowAddMenu((prev) => {
      if (!prev) setAddMenuIndex(0);
      return !prev;
    });
  }, []);

  // 追加メニューの項目を確定（Claude / Codex は生成、close は閉じるだけ）
  const confirmAddMenuItem = useCallback(
    (index: number) => {
      const item = ADD_MENU_ITEMS[index];
      setShowAddMenu(false);
      if (item && item.key !== 'close') {
        onCreate(item.key);
      }
    },
    [onCreate]
  );

  // 追加メニュー表示中はキーボード操作を横取りする。
  // capture フェーズで伝播を止め、グローバルの Shift+矢印ハンドラと競合させない。
  useEffect(() => {
    if (!showAddMenu) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (
        k !== 'ArrowUp' &&
        k !== 'ArrowDown' &&
        k !== 'ArrowLeft' &&
        k !== 'ArrowRight' &&
        k !== 'Enter' &&
        k !== ' '
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const n = ADD_MENU_ITEMS.length;
      if (k === 'ArrowLeft') {
        setShowAddMenu(false);
      } else if (k === 'ArrowUp') {
        setAddMenuIndex((i) => (i - 1 + n) % n);
      } else if (k === 'ArrowDown' || k === 'ArrowRight') {
        setAddMenuIndex((i) => (i + 1) % n);
      } else {
        confirmAddMenuItem(addMenuIndexRef.current);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showAddMenu, confirmAddMenuItem]);

  const closeTabMenu = useCallback(() => {
    setOpenMenuInstanceId(null);
  }, []);

  const toggleTabMenu = useCallback((instanceId: string) => {
    setOpenMenuInstanceId((prev) => (prev === instanceId ? null : instanceId));
  }, []);

  // タブメニュー表示中のキーボード操作（roving focus）。
  // ↑↓/→ でメニュー内ボタンのフォーカス移動、← で閉じる、Enter/Space は各ボタンが処理。
  useEffect(() => {
    if (!openMenuInstanceId) return;
    const getButtons = () => {
      const el = document.getElementsByClassName(s.kbdMenu)[0];
      return el
        ? Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
        : [];
    };
    // 開いたら先頭ボタンにフォーカス
    getButtons()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (
        k !== 'ArrowUp' &&
        k !== 'ArrowDown' &&
        k !== 'ArrowLeft' &&
        k !== 'ArrowRight'
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (k === 'ArrowLeft') {
        setOpenMenuInstanceId(null);
        return;
      }
      const btns = getButtons();
      if (btns.length === 0) return;
      const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (k === 'ArrowUp') {
        next = cur === -1 ? btns.length - 1 : (cur - 1 + btns.length) % btns.length;
      } else {
        next = cur === -1 ? 0 : (cur + 1) % btns.length;
      }
      btns[next]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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

      <PopupMenu
        open={showAddMenu}
        anchorEl={addButtonRef.current}
        onClose={closeMenu}
      >
        {ADD_MENU_ITEMS.map((item, index) => (
          <button
            key={item.key}
            onClick={() => confirmAddMenuItem(index)}
            onMouseEnter={() => setAddMenuIndex(index)}
            className={`${s.addMenuItem}${
              index === addMenuIndex ? ` ${s.highlight}` : ''
            }`}
            aria-selected={index === addMenuIndex}
          >
            {item.label}
          </button>
        ))}
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
            className={s.kbdMenu}
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

export default forwardRef(AiInstanceTabs);
