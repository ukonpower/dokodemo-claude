import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  StickyNote,
} from 'lucide-react';
import TerminalOut from '../terminal/TerminalOut';
import TextInput from '../ai/CommandInput';
import MarkdownViewer from '../files/MarkdownViewer';
import type {
  AiOutputLine,
  AiProvider,
  GitWorktree,
} from '../../types';
import { useScopedSendSettings } from '../../hooks/useScopedSendSettings';
import s from './WorktreeDashboardCard.module.scss';

function getInputExpandedStorageKey(worktreePath: string): string {
  return `dashboard-input-expanded-${encodeURIComponent(worktreePath)}`;
}

function readInputExpanded(worktreePath: string): boolean {
  try {
    const saved = localStorage.getItem(getInputExpandedStorageKey(worktreePath));
    if (saved === 'false') return false;
    if (saved === 'true') return true;
  } catch {
    /* noop */
  }
  return true;
}

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
  selected: boolean;
  hasPrimaryInstance: boolean;
  messages: AiOutputLine[];
  canSend: boolean;
  provider: AiProvider;
  onPasteFile?: (file: File) => Promise<string | undefined>;
  isUploadingFile: boolean;
  uploadProgress?: number | null;
  onCancelUpload?: () => void;
  onToggleSelected: (rid: string) => void;
  onOpenInNormalView: (path: string) => void;
  /** 個別カードからの即時送信 */
  onSendCommand: (rid: string, command: string) => void;
  /** 個別カードからのキュー追加 */
  onAddToQueue: (
    rid: string,
    command: string,
    sendClearBefore: boolean,
    sendCommitAfter: boolean,
    model?: string
  ) => void;
  /** 自カードの xterm サイズに合わせて PTY をリサイズ */
  onResizeInstance: (rid: string, cols: number, rows: number) => void;
  /** xterm から PTY への raw 入力（直接タイピング） */
  onSendKeyInput: (rid: string, data: string) => void;
}

function WorktreeDashboardCard({
  worktree,
  rid,
  selected,
  hasPrimaryInstance,
  messages,
  canSend,
  provider,
  onPasteFile,
  isUploadingFile,
  uploadProgress,
  onCancelUpload,
  onToggleSelected,
  onOpenInNormalView,
  onSendCommand,
  onAddToQueue,
  onResizeInstance,
  onSendKeyInput,
}: WorktreeDashboardCardProps) {
  // worktree 単位で独立した送信設定（キュー on/off, /clear, /commit, model 等）
  const [sendSettings, setSendSettings] = useScopedSendSettings(worktree.path);
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

  // メモ折りたたみ
  const [memoExpanded, setMemoExpanded] = useState(false);
  const memoText = worktree.memo?.trim() ?? '';
  const hasMemo = memoText.length > 0;

  // 入力欄折りたたみ（worktree 単位で localStorage に保存）
  const [inputExpanded, setInputExpanded] = useState<boolean>(() =>
    readInputExpanded(worktree.path)
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        getInputExpandedStorageKey(worktree.path),
        String(inputExpanded)
      );
    } catch {
      /* noop */
    }
  }, [inputExpanded, worktree.path]);

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
    // 履歴の全置換を検知（プライマリの provider 切替で別 provider の履歴が
    // 届いた場合など、既描画メッセージと 1 件も重ならない）: 画面を
    // リセットして全メッセージを描き直す
    if (
      messages.length > 0 &&
      writtenIdsRef.current.size > 0 &&
      !messages.some((m) => writtenIdsRef.current.has(m.id))
    ) {
      terminal.reset();
      writtenIdsRef.current.clear();
      writtenContentRef.current.clear();
    }
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

  const handleSendCommand = useCallback(
    (command: string) => {
      onSendCommand(rid, command);
    },
    [onSendCommand, rid]
  );

  const handleAddToQueue = useCallback(
    (
      command: string,
      sendClearBefore: boolean,
      sendCommitAfter: boolean,
      model?: string
    ) => {
      onAddToQueue(rid, command, sendClearBefore, sendCommitAfter, model);
    },
    [onAddToQueue, rid]
  );

  const handleKeyInput = useCallback(
    (data: string) => {
      onSendKeyInput(rid, data);
    },
    [onSendKeyInput, rid]
  );

  return (
    <div ref={cardRef} className={s.card}>
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
        {hasMemo && (
          <button
            type="button"
            onClick={() => setMemoExpanded((v) => !v)}
            className={`${s.memoToggle} ${memoExpanded ? s.memoToggleOpen : ''}`}
            title={memoExpanded ? 'メモを閉じる' : 'メモを開く'}
            aria-expanded={memoExpanded}
          >
            <StickyNote size={12} aria-hidden />
            <ChevronDown size={10} aria-hidden className={s.memoChevron} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenInNormalView(worktree.path)}
          className={s.openButton}
          title="通常表示でこのワークツリーを開く"
        >
          <ArrowUpRight size={14} />
        </button>
      </header>

      {hasMemo && memoExpanded && (
        <div className={s.memoBlock}>
          <MarkdownViewer content={memoText} stopLinkPropagation />
        </div>
      )}

      <div className={s.terminalArea}>
        {terminalMounted ? (
          <TerminalOut
            onTerminalReady={handleTerminalReady}
            onResize={handleTerminalResize}
            onKeyInput={handleKeyInput}
            disableStdin={!canSend}
            cursorBlink={false}
            fontSize={10}
          />
        ) : (
          <div className={s.terminalPlaceholder}>
            {hasPrimaryInstance ? '読み込み待ち...' : 'AIセッション未起動'}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setInputExpanded((v) => !v)}
        className={s.inputToggleBar}
        title={inputExpanded ? 'Hide input' : 'Show input'}
        aria-expanded={inputExpanded}
      >
        <MessageSquare size={12} aria-hidden />
        <span>{inputExpanded ? 'Hide input' : 'Show input'}</span>
        {inputExpanded ? (
          <ChevronDown size={12} aria-hidden />
        ) : (
          <ChevronUp size={12} aria-hidden />
        )}
      </button>
      {inputExpanded && (
        <div className={s.inputArea}>
          <TextInput
            onSendCommand={handleSendCommand}
            onAddToQueue={handleAddToQueue}
            currentProvider={provider}
            currentRepository={worktree.path}
            isPrimary={hasPrimaryInstance}
            disabled={!canSend}
            inputDisabled={!canSend}
            autoFocus={false}
            sendSettings={sendSettings}
            onSendSettingsChange={setSendSettings}
            onPasteFile={onPasteFile}
            isUploadingFile={isUploadingFile}
            uploadProgress={uploadProgress}
            onCancelUpload={onCancelUpload}
            hideWorkflowControls
          />
        </div>
      )}
    </div>
  );
}

export default WorktreeDashboardCard;
