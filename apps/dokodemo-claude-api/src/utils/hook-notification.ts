/**
 * AI の hook イベントから Web Push 通知の文面（タイトル・本文）を組み立てる
 *
 * 通知はロック画面などで数行しか見えないため、Markdown 記法や Claude Code が
 * transcript に差し込む内部向けの記録（スキル本文の展開・割り込み記録等）を除き、
 * 「何が起きたか / 何を求められているか」が本文の先頭に来るように整える。
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
  repositoryPath: string;
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

const EVENT_LABELS: Record<HookNotificationEvent, string> = {
  Stop: '✅ 完了',
  AskUserQuestion: '❓ 質問',
  PlanApprovalWaiting: '📋 計画の承認待ち',
  PermissionRequest: '🔐 許可待ち',
};

// 本文の主行（結果・質問・許可対象）の最大文字数。iOS のロック画面で 3〜4 行に収まる目安
const MAIN_TEXT_MAX = 120;
// 本文の補足行（元の指示）の最大文字数
const PROMPT_TEXT_MAX = 60;

// ユーザー発言として記録されるが、人が打った指示ではないもの。
// スラッシュコマンド（<command-name>）は別途コマンド名に整形するのでここには含めない
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
  return event in EVENT_LABELS;
}

/** transcript（JSONL）を読み、直近ターンの指示・応答・ツール呼び出しを取り出す */
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
      const prompt = extractUserPrompt(blocks);
      if (prompt) {
        turn.lastUserPrompt = prompt;
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

/** イベント種別ごとに通知のタイトルと本文を組み立てる */
export function buildHookNotification(input: HookNotificationInput): {
  title: string;
  body: string;
} {
  let title = `${EVENT_LABELS[input.event]}｜${input.repositoryLabel}`;
  if (input.activitySummary) {
    title += ` · ${input.activitySummary}`;
  }

  let mainText: string | undefined;
  if (input.event === 'AskUserQuestion') {
    mainText = describeQuestion(input);
  } else if (input.event === 'PermissionRequest') {
    mainText = describePermission(input);
  }
  // 質問・許可対象が取れなかった場合も、直前の発言を出して状況が分かるようにする
  if (!mainText && input.turn.lastAssistantText) {
    mainText = `💬 ${toPlainText(input.turn.lastAssistantText, MAIN_TEXT_MAX)}`;
  }

  const lines: string[] = [];
  if (mainText) {
    lines.push(mainText);
  }
  if (input.turn.lastUserPrompt) {
    lines.push(`🔧 ${toPlainText(input.turn.lastUserPrompt, PROMPT_TEXT_MAX)}`);
  }

  return { title, body: lines.join('\n') };
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

/** user エントリから、人が打った指示だけを取り出す（ツール結果・内部記録は undefined） */
function extractUserPrompt(
  content: string | ContentBlock[] | undefined
): string | undefined {
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_result') return undefined;
    }
  }

  const text = joinTextBlocks(content);
  if (!text) return undefined;

  // スラッシュコマンドは展開後の本文ではなく「/コマンド名 引数」として見せる
  const commandName = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (commandName) {
    const commandArgs = text.match(/<command-args>([^<]*)<\/command-args>/);
    let command = commandName[1].trim();
    if (commandArgs && commandArgs[1].trim()) {
      command += ` ${commandArgs[1].trim()}`;
    }
    return command;
  }

  for (const prefix of INTERNAL_PROMPT_PREFIXES) {
    if (text.startsWith(prefix)) return undefined;
  }
  return text;
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

/** AskUserQuestion の質問文と選択肢を「質問\n選択肢: A / B」の形にする */
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

  // イベント種別の絵文字はタイトルに付くので、本文には付けない
  let questionLine = toPlainText(first.question, MAIN_TEXT_MAX);
  if (questions.length > 1) {
    questionLine += `（ほか${questions.length - 1}問）`;
  }

  const labels: string[] = [];
  if (Array.isArray(first.options)) {
    for (const option of first.options) {
      const label = asRecord(option).label;
      if (typeof label === 'string') {
        labels.push(label);
      }
    }
  }
  if (labels.length === 0) {
    return questionLine;
  }
  return `${questionLine}\n選択肢: ${labels.join(' / ')}`;
}

/** 許可を求められているツールと対象（コマンド・ファイル等）を 1 行で表す */
function describePermission(input: HookNotificationInput): string | undefined {
  const toolUse = input.turn.lastToolUse;
  if (!toolUse) {
    // Notification hook の message（例: "Claude needs your permission to use Bash"）しか無い場合
    return input.hookMessage;
  }

  const toolName = formatToolName(toolUse.name);
  const target = describeToolTarget(toolUse.input, input.repositoryPath);
  if (!target) {
    return toolName;
  }
  return `${toolName}: ${toPlainText(target, MAIN_TEXT_MAX)}`;
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
  toolInput: Record<string, unknown>,
  repositoryPath: string
): string | undefined {
  for (const key of TOOL_TARGET_KEYS) {
    const value = toolInput[key];
    if (typeof value !== 'string' || !value.trim()) continue;

    // ファイルパスはリポジトリ内なら相対にして短くする
    if (path.isAbsolute(value) && value.startsWith(repositoryPath + path.sep)) {
      return path.relative(repositoryPath, value);
    }
    return value;
  }
  return undefined;
}
