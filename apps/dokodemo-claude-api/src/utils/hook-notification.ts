/**
 * AI の hook イベントから Web Push 通知の文面（タイトル・本文）を組み立てる
 *
 * iPhone のバナーは「タイトル 1 行＋本文 1〜2 行」しか見えないため、
 * タイトルはリポジトリ名だけ、本文は読み手が知りたいことの 1 文だけにする。
 * 質問・許可待ちは何を求められているかを即時に本文にする。Stop の本文は
 * stop-notification-service が文脈から生成して差し替え、ここで作る本文は
 * 生成しないとき・失敗したときの代替になる。
 * イベント種別の絵文字やラベルは付けない（短さを優先するというユーザーの判断）。
 */

import { promises as fs } from 'fs';
import path from 'path';

export type HookNotificationEvent =
  | 'Stop'
  | 'AskUserQuestion'
  | 'PlanApprovalWaiting'
  | 'PermissionRequest';

interface ToolUseInfo {
  name: string;
  input: Record<string, unknown>;
}

/** transcript から読み取った直近ターンの情報 */
export interface TranscriptTurn {
  lastUserPrompt?: string;
  lastAssistantText?: string;
  lastToolUse?: ToolUseInfo;
}

export interface HookNotificationInput {
  event: HookNotificationEvent;
  // タイトルに出すリポジトリ名（タブ名を含む）
  repositoryLabel: string;
  // ai-activity-summary-service が生成した「何に取り組んでいるか」の一言
  activitySummary?: string;
  turn: TranscriptTurn;
  // hook の stdin から転送された値。hooks 設定が古いと届かないため transcript で補う
  hookToolInput?: unknown;
  hookMessage?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface TranscriptEntry {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { content?: string | ContentBlock[] };
}

const NOTIFICATION_EVENTS: HookNotificationEvent[] = [
  'Stop',
  'AskUserQuestion',
  'PlanApprovalWaiting',
  'PermissionRequest',
];

// 本文の最大文字数。iPhone のバナーで本文 1 行が全角 20 字ほど（実機スクショで確認）なので 2 行分
const BODY_MAX = 40;

// ユーザー発言として記録されるが、人が打った指示ではないもの。
// スラッシュコマンド（<command-name>）は人の指示なのでここには含めない
const INTERNAL_PROMPT_PREFIXES = [
  '[Request interrupted',
  '<local-command-',
  '<task-notification',
  '<system-reminder',
  '<artifact-content',
  '<bash-input',
  '<bash-stdout',
  '<bash-stderr',
];

/** 通知対象のイベントかどうか */
export function isHookNotificationEvent(
  event: string
): event is HookNotificationEvent {
  return (NOTIFICATION_EVENTS as string[]).includes(event);
}

/** transcript（JSONL）を読み、直近ターンの応答・ツール呼び出しを取り出す */
export async function extractTurnFromTranscript(
  transcriptPath: string
): Promise<TranscriptTurn> {
  const content = await readTranscript(transcriptPath);
  const turn: TranscriptTurn = {};
  if (!content) return turn;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;

    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    // サブエージェント内の会話や、Claude Code が差し込む補足（スキル本文・画像注記等）は対象外
    if (entry.isSidechain || entry.isMeta) continue;

    const blocks = entry.message?.content;
    if (entry.type === 'user') {
      if (isUserPrompt(blocks)) {
        turn.lastUserPrompt = joinTextBlocks(blocks);
        // 新しい指示より前の応答を、今回の結果として表示しないようにする
        turn.lastAssistantText = undefined;
        turn.lastToolUse = undefined;
      }
    } else if (entry.type === 'assistant') {
      const text = joinTextBlocks(blocks);
      if (text) {
        turn.lastAssistantText = text;
      }
      const toolUse = findLastToolUse(blocks);
      if (toolUse) {
        turn.lastToolUse = toolUse;
      }
    }
  }

  return turn;
}

/** 通知のタイトル（リポジトリ名）と本文を組み立てる */
export function buildHookNotification(input: HookNotificationInput): {
  title: string;
  body: string;
} {
  let body: string | undefined;
  if (input.event === 'AskUserQuestion') {
    body = describeQuestion(input);
  } else if (input.event === 'PermissionRequest') {
    body = describePermission(input);
  }

  // 取り組みの要約は作業名だけで結果が分からないため、応答の 1 文目を優先する
  if (!body && input.turn.lastAssistantText) {
    body = firstSentence(toPlainText(input.turn.lastAssistantText, BODY_MAX));
  }
  if (!body && input.activitySummary) {
    body = input.activitySummary;
  }

  return { title: input.repositoryLabel, body: body ?? '' };
}

/** 最初の「。」までを返す（無ければそのまま） */
function firstSentence(text: string): string {
  const end = text.indexOf('。');
  if (end === -1) {
    return text;
  }
  return text.slice(0, end + 1);
}

/**
 * Markdown の最初の段落を、通知向けの 1 行のプレーンテキストにして maxChars で切る。
 * 応答は結論を最初の段落に書くことが多く、続く表や箇条書きまで詰めると断片が混ざって読みにくいため
 */
export function toPlainText(markdown: string, maxChars: number): string {
  const parts: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    // コードはロック画面の数行では読めないので省く
    if (inCodeBlock) continue;
    if (!line) {
      if (parts.length > 0) break;
      continue;
    }
    // 見出しは本文の要約にならないので省く
    if (line.startsWith('#')) continue;
    // 表の区切り行（|---|---|）
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) continue;

    parts.push(stripInlineMarkdown(line));
  }

  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function stripInlineMarkdown(line: string): string {
  let text = line;
  // 引用・箇条書き・番号付きリストの記号
  text = text.replace(/^>\s*/, '');
  text = text.replace(/^[-*+]\s+/, '');
  text = text.replace(/^\d+\.\s+/, '');
  // 表の行は「セル / セル」の形にする
  if (text.startsWith('|')) {
    const cells: string[] = [];
    for (const cell of text.split('|')) {
      const trimmed = cell.trim();
      if (trimmed) {
        cells.push(trimmed);
      }
    }
    text = cells.join(' / ');
  }
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/`([^`]+)`/g, '$1');
  return text;
}

async function readTranscript(transcriptPath: string): Promise<string | null> {
  try {
    return await fs.readFile(transcriptPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('transcriptファイルの読み込みに失敗:', error);
      return null;
    }
  }

  // フック発火時点で transcript 書き込みがまだ完了していないケースがあるため、短い待機後に一度だけリトライ
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    return await fs.readFile(transcriptPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('transcriptファイルの読み込みに失敗:', error);
    }
    return null;
  }
}

/** user エントリが人の打った指示かどうか（ツール結果・内部記録は false） */
function isUserPrompt(content: string | ContentBlock[] | undefined): boolean {
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_result') return false;
    }
  }

  const text = joinTextBlocks(content);
  if (!text) return false;

  for (const prefix of INTERNAL_PROMPT_PREFIXES) {
    if (text.startsWith(prefix)) return false;
  }
  return true;
}

/** transcript の message.content（文字列 or ブロック配列）からテキストだけを連結する */
function joinTextBlocks(
  content: string | ContentBlock[] | undefined
): string | undefined {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed) {
      return trimmed;
    }
    return undefined;
  }
  if (!Array.isArray(content)) return undefined;

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      texts.push(block.text);
    }
  }
  const joined = texts.join('\n').trim();
  if (joined) {
    return joined;
  }
  return undefined;
}

function findLastToolUse(
  content: string | ContentBlock[] | undefined
): ToolUseInfo | undefined {
  if (!Array.isArray(content)) return undefined;

  let found: ToolUseInfo | undefined;
  for (const block of content) {
    if (block.type === 'tool_use' && block.name) {
      found = { name: block.name, input: asRecord(block.input) };
    }
  }
  return found;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** AskUserQuestion の 1 問目の質問文を返す（選択肢は長くなるので出さない） */
function describeQuestion(input: HookNotificationInput): string | undefined {
  let toolInput = asRecord(input.hookToolInput);
  if (!Array.isArray(toolInput.questions)) {
    const toolUse = input.turn.lastToolUse;
    if (!toolUse || toolUse.name !== 'AskUserQuestion') return undefined;
    toolInput = toolUse.input;
  }

  const questions = toolInput.questions;
  if (!Array.isArray(questions) || questions.length === 0) return undefined;

  const first = asRecord(questions[0]);
  if (typeof first.question !== 'string') return undefined;
  return toPlainText(first.question, BODY_MAX);
}

/** 許可を求められているツールと対象（コマンド・ファイル等）を 1 行で表す */
function describePermission(input: HookNotificationInput): string | undefined {
  const toolUse = input.turn.lastToolUse;
  if (!toolUse) {
    // Notification hook の message（例: "Claude needs your permission to use Bash"）しか無い場合
    return input.hookMessage;
  }

  const toolName = formatToolName(toolUse.name);
  const target = describeToolTarget(toolUse.input);
  if (!target) {
    return toolName;
  }
  return toPlainText(`${toolName}: ${target}`, BODY_MAX);
}

/** MCP ツール名（mcp__server__tool）は末尾のツール名だけにする */
function formatToolName(name: string): string {
  if (!name.startsWith('mcp__')) {
    return name;
  }
  const segments = name.split('__');
  return segments[segments.length - 1];
}

// 許可対象として見せる入力項目（先にあるものを優先）。Bash は description があればそれを使う
const TOOL_TARGET_KEYS = [
  'description',
  'command',
  'file_path',
  'notebook_path',
  'url',
  'query',
  'pattern',
  'path',
];

function describeToolTarget(
  toolInput: Record<string, unknown>
): string | undefined {
  for (const key of TOOL_TARGET_KEYS) {
    const value = toolInput[key];
    if (typeof value !== 'string' || !value.trim()) continue;

    // パスは 40 字で切ると肝心のファイル名が落ちるので、ファイル名だけにする
    if (path.isAbsolute(value)) {
      return path.basename(value);
    }
    return value;
  }
  return undefined;
}
