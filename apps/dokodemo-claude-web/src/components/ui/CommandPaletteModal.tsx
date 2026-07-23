import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { fuzzyMatch } from '../../utils/fuzzy-match';
import type { CommandPaletteCommand } from '../../commands/types';
import { useOverlayClose } from '../../hooks/useOverlayClose';
import s from './CommandPaletteModal.module.scss';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandPaletteCommand[];
}

interface ScoredCommand {
  cmd: CommandPaletteCommand;
  matches: number[];
}

function renderHighlighted(text: string, matches: number[]) {
  if (matches.length === 0) return text;
  const set = new Set(matches);
  const nodes: React.ReactNode[] = [];
  let buf = '';
  let bufHit = false;
  const flush = (i: number) => {
    if (!buf) return;
    nodes.push(
      bufHit ? (
        <mark key={`m-${i}-${buf}`} className={s.itemMatch}>
          {buf}
        </mark>
      ) : (
        <Fragment key={`t-${i}-${buf}`}>{buf}</Fragment>
      )
    );
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (i === 0) {
      buf = text[i];
      bufHit = hit;
      continue;
    }
    if (hit === bufHit) {
      buf += text[i];
    } else {
      flush(i);
      buf = text[i];
      bufHit = hit;
    }
  }
  flush(text.length);
  return nodes;
}

function CommandPaletteModal({ isOpen, onClose, commands }: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // サブメニューへ降りた親コマンドのスタック（末尾が現在の階層）
  const [stack, setStack] = useState<CommandPaletteCommand[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 現在表示中のコマンド一覧（ルート or サブメニュー）
  const currentCommands =
    stack.length > 0 ? stack[stack.length - 1].children ?? [] : commands;

  const filtered = useMemo<ScoredCommand[]>(() => {
    const q = query.trim();
    if (!q) return currentCommands.map((cmd) => ({ cmd, matches: [] }));
    const scored: { cmd: CommandPaletteCommand; score: number; matches: number[]; order: number }[] = [];
    currentCommands.forEach((cmd, order) => {
      const m = fuzzyMatch(q, cmd.label);
      if (m) {
        scored.push({ cmd, score: m.score, matches: m.matches, order });
        return;
      }
      if (cmd.description) {
        const dm = fuzzyMatch(q, cmd.description);
        if (dm) scored.push({ cmd, score: dm.score - 20, matches: [], order });
      }
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.map(({ cmd, matches }) => ({ cmd, matches }));
  }, [currentCommands, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setStack([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, selectedIndex, filtered.length]);

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen) return null;

  const popStack = () => {
    setStack((prev) => prev.slice(0, -1));
    setQuery('');
    setSelectedIndex(0);
  };

  const submit = (cmd: CommandPaletteCommand) => {
    if (cmd.disabled) return;
    if (cmd.children && cmd.children.length > 0) {
      // サブメニューへ降りる（実行はしない）
      setStack((prev) => [...prev, cmd]);
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    onClose();
    // 閉じるアニメ影響を避けるため次フレームで実行
    requestAnimationFrame(() => cmd.run?.());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) =>
        filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1)
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[selectedIndex];
      if (target) submit(target.cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // サブメニュー中は 1 階層戻る、ルートなら閉じる
      if (stack.length > 0) popStack();
      else onClose();
    } else if (e.key === 'Backspace' && query === '' && stack.length > 0) {
      // 入力が空の状態で Backspace → 1 階層戻る
      e.preventDefault();
      popStack();
    }
  };

  return (
    <div className={s.overlay} {...overlayProps}>
      <div className={s.modal}>
        <div className={s.inputRow}>
          <Search size={16} aria-hidden className={s.inputIcon} />
          {stack.length > 0 && (
            <span className={s.breadcrumb}>
              {stack.map((c) => c.label).join(' / ')}
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            className={s.input}
            placeholder={
              stack.length > 0 ? '選択...' : 'コマンドを検索...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className={s.hint}>
            {stack.length > 0
              ? '↑↓ 選択 / Enter 実行 / Esc 戻る'
              : '↑↓ 選択 / Enter 実行 / Esc 閉じる'}
          </span>
        </div>
        <ul ref={listRef} className={s.list}>
          {filtered.length === 0 && (
            <li className={s.empty}>該当するコマンドがありません</li>
          )}
          {filtered.map(({ cmd, matches }, i) => {
            const isSelected = i === selectedIndex;
            const classes = [s.item];
            if (isSelected) classes.push(s.itemSelected);
            return (
              <li
                key={cmd.id}
                data-index={i}
                className={classes.join(' ')}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => submit(cmd)}
                title={cmd.description || cmd.label}
                aria-disabled={cmd.disabled || undefined}
                style={cmd.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              >
                {cmd.icon && <span className={s.itemIcon}>{cmd.icon}</span>}
                <span className={s.itemBody}>
                  <span className={s.itemLabel}>
                    {renderHighlighted(cmd.label, matches)}
                  </span>
                  {cmd.description && (
                    <span className={s.itemDescription}>{cmd.description}</span>
                  )}
                </span>
                {cmd.category && (
                  <span className={s.itemCategory}>{cmd.category}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default CommandPaletteModal;
