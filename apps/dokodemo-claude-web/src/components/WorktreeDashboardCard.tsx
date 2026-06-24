import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ArrowUpRight, Diff, ListTodo, Send } from 'lucide-react';
import TerminalOut from './TerminalOut';
import type {
  AiOutputLine,
  AiProvider,
  GitDiffSummary,
  GitWorktree,
  RepoDisplayAiStatus,
} from '../types';
import s from './WorktreeDashboardCard.module.scss';

/**
 * ターミナル制御シーケンスの応答をフィルタリング
 * AiOutput.tsx と同じ仕様（一覧表示用に簡略化したコピー）
 */
function filterTerminalResponses(content: string): string {
  const ESC = '';
  const BEL = '';
  return content
    .replace(new RegExp(`${ESC}\\[\\?[\\d;]*c`, 'g'), '')
    .replace(new RegExp(`${ESC}\\[[\\d;]*R`, 'g'), '')
    .replace(
      new RegExp(`${ESC}\\](?!8;)[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'),
      ''
    );
}

interface WorktreeDashboardCardProps {
  worktree: GitWorktree;
  rid: string;
  isCurrent: boolean;
  selected: boolean;
  primaryProvider?: AiProvider;
  aiDisplayStatus?: RepoDisplayAiStatus;
  hasPrimaryInstance: boolean;
  queuePending: number;
  diffSummary?: GitDiffSummary;
  messages: AiOutputLine[];
  canSend: boolean;
  onToggleSelected: (rid: string) => void;
  onOpenInNormalView: (path: string) => void;
  onSendPrompt: (
    rid: string,
    prompt: string,
    options: { addToQueue: boolean }
  ) => void;
  /** 自カードの xterm サイズに合わせて PTY をリサイズ */
  onResizeInstance: (rid: string, cols: number, rows: number) => void;
}

interface BadgeInfo {
  className: string;
  label: string;
}

/**
 * AI 状態のバッジを決定する。primary インスタンスが無ければ「未起動」(灰)、
 * displayAiStatus が running なら黄、done なら緑、それ以外は緑(待機)。
 * permission のような赤状態はバックエンドの displayAiStatus に含まれない
 * ため、暫定的に running を「作業中」として黄表示する。
 */
function resolveStatusBadge(
  hasPrimary: boolean,
  status: RepoDisplayAiStatus | undefined
): BadgeInfo {
  if (!hasPrimary) {
    return { className: s.statusNone, label: '未起動' };
  }
  if (status === 'running') {
    return { className: s.statusRunning, label: '作業中' };
  }
  if (status === 'done') {
    return { className: s.statusDone, label: '完了' };
  }
  return { className: s.statusReady, label: '待機' };
}

function WorktreeDashboardCard({
  worktree,
  rid,
  isCurrent,
  selected,
  primaryProvider,
  aiDisplayStatus,
  hasPrimaryInstance,
  queuePending,
  diffSummary,
  messages,
  canSend,
  onToggleSelected,
  onOpenInNormalView,
  onSendPrompt,
  onResizeInstance,
}: WorktreeDashboardCardProps) {
  // xterm.js インスタンス
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenIdsRef = useRef<Set<string>>(new Set());
  const writtenContentRef = useRef<Map<string, string>>(new Map());

  // 現在の xterm サイズ。primary instance が後から ready になっても
  // 改めて PTY をリサイズできるように state で保持する
  const [terminalSize, setTerminalSize] = useState<{
    cols: number;
    rows: number;
  } | null>(null);
  // 直前に PTY へ送ったサイズ。同サイズの連続送信を抑止
  const lastSentSizeRef = useRef<string>('');

  // 入力欄
  const [draft, setDraft] = useState('');
  const [addToQueue, setAddToQueue] = useState(true);

  // IntersectionObserver で初回表示まで xterm をマウントしない
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [terminalMounted, setTerminalMounted] = useState(false);

  useEffect(() => {
    if (terminalMounted) return;
    const el = cardRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setTerminalMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setTerminalMounted(true);
            observer.disconnect();
            return;
          }
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [terminalMounted]);

  const handleTerminalReady = useCallback(
    (
      terminal: Terminal,
      fitAddon: FitAddon,
      initialSize?: { cols: number; rows: number }
    ) => {
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      writtenIdsRef.current = new Set();
      writtenContentRef.current = new Map();
      // xterm サイズを state に記録し、後続の useEffect から PTY リサイズを発火
      if (initialSize) {
        setTerminalSize(initialSize);
      }
      // 既存メッセージを一気に流し込む
      for (const msg of messages) {
        terminal.write(filterTerminalResponses(msg.content));
        writtenIdsRef.current.add(msg.id);
        writtenContentRef.current.set(msg.id, msg.content);
      }
    },
    [messages]
  );

  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    setTerminalSize({ cols, rows });
  }, []);

  // hasPrimaryInstance が true になったタイミング、または xterm サイズが
  // 変わったタイミングで PTY に ai-resize を送る。
  // handleTerminalReady の中で送るだけだと、まだ primaryInstances に該当 rid が
  // セットされていないカード（先にマウントされたカードたち）の resize が
  // 空振りし、結果として最後の 1 個だけ再描画されるという挙動になる。
  useEffect(() => {
    if (!hasPrimaryInstance || !terminalSize) return;
    const key = `${terminalSize.cols}x${terminalSize.rows}`;
    if (lastSentSizeRef.current === key) return;
    lastSentSizeRef.current = key;
    onResizeInstance(rid, terminalSize.cols, terminalSize.rows);
  }, [hasPrimaryInstance, terminalSize, onResizeInstance, rid]);

  // primary instance がなくなったら次回 ready 時に再送できるようリセット
  useEffect(() => {
    if (!hasPrimaryInstance) {
      lastSentSizeRef.current = '';
    }
  }, [hasPrimaryInstance]);

  // 新規メッセージを書き込み
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    let didWrite = false;
    for (const msg of messages) {
      const prev = writtenContentRef.current.get(msg.id);
      if (prev === msg.content) continue;
      if (prev === undefined) {
        terminal.write(filterTerminalResponses(msg.content));
      } else {
        // 更新（差分のみ書く: 共通プレフィックスを除いた残り）
        const diff = msg.content.startsWith(prev)
          ? msg.content.slice(prev.length)
          : msg.content;
        terminal.write(filterTerminalResponses(diff));
      }
      writtenContentRef.current.set(msg.id, msg.content);
      writtenIdsRef.current.add(msg.id);
      didWrite = true;
    }
    if (didWrite) {
      requestAnimationFrame(() => {
        const buffer = terminal.buffer.active;
        terminal.scrollToLine(buffer.baseY + buffer.length);
      });
    }
  }, [messages]);

  const statusBadge = useMemo(
    () => resolveStatusBadge(hasPrimaryInstance, aiDisplayStatus),
    [hasPrimaryInstance, aiDisplayStatus]
  );

  const diffCount = diffSummary
    ? diffSummary.totalAdditions + diffSummary.totalDeletions
    : 0;

  const handleSubmit = useCallback(() => {
    if (!canSend) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendPrompt(rid, trimmed, { addToQueue });
    setDraft('');
  }, [canSend, draft, addToQueue, onSendPrompt, rid]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const providerLabel = primaryProvider
    ? primaryProvider === 'codex'
      ? 'Codex'
      : 'Claude'
    : 'AI';

  return (
    <div
      ref={cardRef}
      className={`${s.card} ${isCurrent ? s.current : ''} ${selected ? s.selected : ''}`}
    >
      <header className={s.header}>
        <label className={s.checkboxLabel} title="一斉送信の対象">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(rid)}
            className={s.checkbox}
          />
        </label>
        <h3 className={s.branchName} title={worktree.branch}>
          {worktree.branch}
          {worktree.isMain && <span className={s.mainTag}>main</span>}
        </h3>
        <span className={`${s.statusBadge} ${statusBadge.className}`}>
          <span className={s.statusDot} />
          <span className={s.statusLabel}>
            {providerLabel}: {statusBadge.label}
          </span>
        </span>
        <span className={s.metric} title="キュー件数">
          <ListTodo size={12} aria-hidden />
          {queuePending}
        </span>
        <span className={s.metric} title="差分行数 (+追加 -削除)">
          <Diff size={12} aria-hidden />
          {diffCount}
        </span>
        <button
          type="button"
          onClick={() => onOpenInNormalView(worktree.path)}
          className={s.openButton}
          title="通常表示でこのワークツリーを開く"
        >
          <ArrowUpRight size={14} />
        </button>
      </header>

      <div className={s.terminalArea}>
        {terminalMounted ? (
          <TerminalOut
            onTerminalReady={handleTerminalReady}
            onResize={handleTerminalResize}
            disableStdin
            cursorBlink={false}
            fontSize={10}
          />
        ) : (
          <div className={s.terminalPlaceholder}>
            {hasPrimaryInstance ? '読み込み待ち...' : 'AIセッション未起動'}
          </div>
        )}
      </div>

      <div className={s.inputArea}>
        <div className={s.inputRow}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              canSend ? 'プロンプトを入力 (Ctrl+Enter で送信)' : '送信不可'
            }
            disabled={!canSend}
            className={s.textarea}
            rows={2}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSend || !draft.trim()}
            className={s.sendButton}
            title={addToQueue ? 'キューに追加' : '直接送信'}
          >
            <Send size={14} />
          </button>
        </div>
        <div className={s.inputOptions}>
          <label className={s.queueToggle}>
            <input
              type="checkbox"
              checked={addToQueue}
              onChange={(e) => setAddToQueue(e.target.checked)}
              disabled={!canSend}
            />
            <span>キューに追加</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default WorktreeDashboardCard;
