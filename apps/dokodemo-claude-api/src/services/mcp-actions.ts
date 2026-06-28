// MCP ツールと REST が共有するアクション層。
// ビジネスロジック（worktree 操作・prompt 一斉送信・terminal 操作・preview 保存）の実体をここへ集約し、
// REST ハンドラと MCP ハンドラの双方から同一プロセス内で直接呼ぶ。HTTP 往復や fetch は挟まない。

import { extname, basename } from 'path';
import { readFile } from 'fs/promises';
import type { ProcessManager } from '../process-manager.js';
import type { ActiveTerminal } from '../managers/terminal-manager.js';
import type { TypedServer } from '../handlers/types.js';
import type {
  AiProvider,
  FileSource,
  GitRepository,
  WorktreeSyncEntry,
} from '../types/index.js';
import { repositoryIdManager } from './repository-id-manager.js';
import {
  getMainRepoPath,
  getWorktrees,
  createWorktree,
  deleteWorktree,
} from '../utils/git-utils.js';
import { addWorktreeIds } from '../handlers/branch-handlers.js';
import { emitIdMappingUpdated } from '../handlers/id-mapping-helpers.js';
import { stripAnsi } from '../utils/strip-ansi.js';
import { savePreviewFile } from '../handlers/file-upload-handlers.js';

/**
 * アクションが失敗したときに投げる共通エラー。
 * REST 側は status を HTTP ステータスへ、MCP 側は isError 付き結果へ変換する。
 */
export class ActionError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

/**
 * アクションが必要とする依存。registerMcpRoutes / REST 登録時に注入する。
 * repositories は再代入されるため getter で受け、呼び出し時点の最新を参照する。
 */
export interface ActionDeps {
  processManager: ProcessManager;
  io: TypedServer;
  getRepositories: () => GitRepository[];
}

// 拡張子からの MIME 推定（preview アップロードで Content-Type 未指定のとき用）
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

// Markdown 1 件あたりの最大サイズ（テキストなので 1MB あれば十分）
const MAX_MARKDOWN_BYTES = 1 * 1024 * 1024;

/**
 * rid(wtid) → 実在する worktree の絶対パス。実在しなければ null。
 * repositoryIdManager.getPath は文字列を機械的に resolve するだけで存在検証しないため、
 * ここで git worktree 一覧に含まれるかを確認する（誤った wtid のサイレント成功を防ぐ）。
 */
async function resolveExistingWorktreePath(rid: string): Promise<string | null> {
  const candidate = repositoryIdManager.getPath(rid);
  if (!candidate) return null;
  const parentRepoPath = getMainRepoPath(candidate);
  const worktrees = await getWorktrees(parentRepoPath);
  return worktrees.some((w) => w.path === candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// repository
// ---------------------------------------------------------------------------

export function getRepositoryId(path: string): { path: string; rid: string } {
  const rid = repositoryIdManager.tryGetId(path);
  if (!rid) throw new ActionError(404, `リポジトリが見つかりません: ${path}`);
  return { path, rid };
}

// ---------------------------------------------------------------------------
// worktree
// ---------------------------------------------------------------------------

export async function listWorktrees(rid: string): Promise<object> {
  const resolved = repositoryIdManager.getPath(rid);
  if (!resolved) throw new ActionError(404, 'リポジトリが見つかりません');
  const parentRepoPath = getMainRepoPath(resolved);
  const worktrees = await getWorktrees(parentRepoPath);
  return {
    success: true,
    parentRepoPath,
    prid: repositoryIdManager.tryGetId(parentRepoPath),
    worktrees: worktrees.map((w) => ({
      path: w.path,
      branch: w.branch,
      isMain: w.isMain,
      rid: repositoryIdManager.tryGetId(w.path),
    })),
  };
}

export interface CreateWorktreeInput {
  branchName: string;
  baseBranch?: string;
  useExistingBranch?: boolean;
  syncEntries?: WorktreeSyncEntry[];
  /**
   * ワークツリーの説明（= メモ）。Web UI のタブに表示される。
   * 作成と同時に worktreeMemoManager へ保存する。空/未指定なら何もしない。
   */
  description?: string;
}

export async function createWorktreeAction(
  rid: string,
  input: CreateWorktreeInput,
  deps: ActionDeps
): Promise<object> {
  const { processManager, io } = deps;
  const resolved = repositoryIdManager.getPath(rid);
  if (!resolved) {
    throw new ActionError(404, `rid「${rid}」に対応するリポジトリが見つかりません`);
  }
  const parentRepoPath = getMainRepoPath(resolved);

  const { branchName, baseBranch, useExistingBranch, syncEntries, description } =
    input;
  if (!branchName || typeof branchName !== 'string') {
    throw new ActionError(400, 'branchName は必須です');
  }

  // syncEntries 未指定時は親リポジトリの既定設定（GUI で保存したもの）を使う
  const effectiveSyncEntries =
    syncEntries ?? processManager.worktreeSyncManager.get(parentRepoPath);

  const result = await createWorktree({
    parentRepoPath,
    branchName,
    baseBranch,
    useExistingBranch,
    syncEntries: effectiveSyncEntries,
  });

  if (!result.success) {
    throw new ActionError(400, result.message);
  }

  const wtid = result.worktree
    ? repositoryIdManager.getId(result.worktree.path)
    : undefined;

  // 説明（メモ）が指定されていれば、作成直後・worktrees-list emit 前に保存しておく。
  // こうすることで直後の emit に memo が乗り、Web UI のタブへ即座に説明が表示される。
  let savedMemo: string | undefined;
  if (result.worktree && typeof description === 'string' && description.trim() !== '') {
    const memoResult = await processManager.worktreeMemoManager.save(
      result.worktree.path,
      description
    );
    if (!memoResult.ok) {
      throw new ActionError(500, memoResult.error.message);
    }
    savedMemo = memoResult.value;
  }

  const prid = repositoryIdManager.tryGetId(parentRepoPath);
  await emitIdMappingUpdated(io, deps.getRepositories());
  const worktrees = await getWorktrees(parentRepoPath);
  io.emit('worktrees-list', {
    worktrees: addWorktreeIds(worktrees, parentRepoPath),
    prid,
    parentRepoPath,
  });

  return {
    ...result,
    worktree: result.worktree
      ? { ...result.worktree, wtid, memo: savedMemo }
      : undefined,
  };
}

export async function deleteWorktreeAction(
  wtid: string,
  options: { deleteBranch?: boolean },
  deps: ActionDeps
): Promise<object> {
  const { processManager, io } = deps;
  const worktreePath = await resolveExistingWorktreePath(wtid);
  if (!worktreePath) {
    throw new ActionError(404, `wtid「${wtid}」に対応するワークツリーが見つかりません`);
  }
  const parentRepoPath = getMainRepoPath(worktreePath);
  if (parentRepoPath === worktreePath) {
    throw new ActionError(400, 'main リポジトリは削除できません');
  }

  // 削除対象の branch 名を取得（deleteBranch 時に使う）
  const before = await getWorktrees(parentRepoPath);
  const target = before.find((w) => w.path === worktreePath);

  await processManager.cleanupRepositoryProcesses(worktreePath);
  const result = await deleteWorktree(worktreePath, parentRepoPath, {
    deleteBranch: options.deleteBranch === true,
    branchName: target?.branch,
  });
  if (!result.success) {
    throw new ActionError(400, result.message);
  }

  // 削除したワークツリーのメモも掃除する
  await processManager.worktreeMemoManager.remove(worktreePath);

  const prid = repositoryIdManager.tryGetId(parentRepoPath);
  await emitIdMappingUpdated(io, deps.getRepositories());
  const worktrees = (await getWorktrees(parentRepoPath)).filter(
    (w) => w.path !== worktreePath
  );
  io.emit('worktrees-list', {
    worktrees: addWorktreeIds(worktrees, parentRepoPath),
    prid,
    parentRepoPath,
  });

  return result;
}

export async function getWorktreeMemo(
  wtid: string,
  deps: ActionDeps
): Promise<object> {
  const worktreePath = await resolveExistingWorktreePath(wtid);
  if (!worktreePath) {
    throw new ActionError(404, `wtid「${wtid}」に対応するワークツリーが見つかりません`);
  }
  return {
    success: true,
    rid: wtid,
    memo: deps.processManager.worktreeMemoManager.get(worktreePath) ?? '',
  };
}

export async function setWorktreeMemo(
  wtid: string,
  memo: string,
  deps: ActionDeps
): Promise<object> {
  const { processManager, io } = deps;
  const worktreePath = await resolveExistingWorktreePath(wtid);
  if (!worktreePath) {
    throw new ActionError(404, `wtid「${wtid}」に対応するワークツリーが見つかりません`);
  }
  if (typeof memo !== 'string') {
    throw new ActionError(400, 'memo は文字列で指定してください');
  }

  const result = await processManager.worktreeMemoManager.save(worktreePath, memo);
  if (!result.ok) {
    throw new ActionError(500, result.error.message);
  }

  const parentRepoPath = getMainRepoPath(worktreePath);
  const prid = repositoryIdManager.tryGetId(parentRepoPath);
  const worktrees = await getWorktrees(parentRepoPath);
  io.emit('worktrees-list', {
    worktrees: addWorktreeIds(worktrees, parentRepoPath),
    prid,
    parentRepoPath,
  });

  return { success: true, rid: wtid, memo: result.value };
}

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

export interface BroadcastPromptInput {
  rid: string;
  provider: AiProvider;
  prompt: string;
  targets?: string[];
  includeMain?: boolean;
  sendClearBefore?: boolean;
  isAutoCommit?: boolean;
  model?: string;
}

export async function broadcastPrompt(
  input: BroadcastPromptInput,
  deps: ActionDeps
): Promise<object> {
  const { processManager } = deps;
  const { rid, provider, prompt, targets, includeMain, sendClearBefore, isAutoCommit, model } =
    input;
  if (!rid || !provider || !prompt) {
    throw new ActionError(400, 'rid, provider, prompt は必須です');
  }
  const resolved = repositoryIdManager.getPath(rid);
  if (!resolved) throw new ActionError(404, 'リポジトリが見つかりません');
  const parentRepoPath = getMainRepoPath(resolved);
  const worktrees = await getWorktrees(parentRepoPath);

  // 送信先 path を決定
  let targetPaths = worktrees
    .filter((w) => includeMain || !w.isMain)
    .map((w) => w.path);
  // 指定された targets のうち、どの送信先にも一致しなかったもの（誤った wtid 等）。
  let unmatchedTargets: string[] = [];
  if (Array.isArray(targets) && targets.length > 0) {
    const allowed = new Set(targetPaths);
    unmatchedTargets = targets.filter(
      (t) => !allowed.has(repositoryIdManager.getPath(t))
    );
    const wanted = new Set(targets.map((t) => repositoryIdManager.getPath(t)));
    targetPaths = targetPaths.filter((p) => wanted.has(p));
  }

  const results = [];
  for (const p of targetPaths) {
    try {
      const item = await processManager.addToPromptQueue(
        p,
        provider,
        prompt,
        sendClearBefore,
        isAutoCommit,
        model
      );
      results.push({
        path: p,
        rid: repositoryIdManager.tryGetId(p),
        success: true,
        itemId: item.id,
      });
    } catch (e) {
      results.push({
        path: p,
        rid: repositoryIdManager.tryGetId(p),
        success: false,
        message: String(e),
      });
    }
  }
  const sent = results.filter((r) => r.success).length;
  const warning =
    unmatchedTargets.length > 0
      ? `指定した targets のうち ${unmatchedTargets.length} 件がどのワークツリーにも一致しませんでした（wtid を確認してください）`
      : sent === 0
        ? '送信先が 0 件でした（ワークツリーが存在しないか targets が一致していません）'
        : undefined;
  return {
    success: true,
    sent,
    results,
    unmatchedTargets,
    ...(warning ? { warning } : {}),
  };
}

// ---------------------------------------------------------------------------
// terminal（processManager のメソッドを直接利用する薄いラッパ）
// ---------------------------------------------------------------------------

function terminalView(t: ActiveTerminal): object {
  return {
    id: t.id,
    name: t.name,
    cwd: t.repositoryPath,
    rid: repositoryIdManager.tryGetId(t.repositoryPath),
    status: t.status,
    pid: t.pid,
    createdAt: t.createdAt,
  };
}

export function listTerminals(rid: string, deps: ActionDeps): object {
  const cwd = repositoryIdManager.getPath(rid);
  if (!cwd) throw new ActionError(404, 'リポジトリが見つかりません');
  const terminals = deps.processManager.getTerminalsByRepository(cwd);
  return { success: true, terminals: terminals.map(terminalView) };
}

export async function createTerminalAction(
  rid: string,
  input: { name?: string; cols?: number; rows?: number },
  deps: ActionDeps
): Promise<object> {
  const cwd = repositoryIdManager.getPath(rid);
  if (!cwd) throw new ActionError(404, 'リポジトリが見つかりません');
  const { name, cols, rows } = input;
  const terminal = await deps.processManager.createTerminal(
    cwd,
    basename(cwd),
    name,
    cols && rows ? { cols, rows } : undefined
  );
  return { success: true, terminal: terminalView(terminal) };
}

export function sendTerminalInput(
  terminalId: string,
  inputStr: string,
  enter: boolean | undefined,
  deps: ActionDeps
): object {
  if (typeof inputStr !== 'string') throw new ActionError(400, 'input は必須です');
  const ok = deps.processManager.sendToTerminal(
    terminalId,
    enter ? inputStr + '\r' : inputStr
  );
  if (!ok) throw new ActionError(404, 'ターミナルが見つかりません');
  return { success: true };
}

export function getTerminalOutput(
  terminalId: string,
  strip: boolean,
  deps: ActionDeps
): object {
  const history = deps.processManager.getTerminalOutputHistory(terminalId);
  const text = history.map((h) => h.content).join('');
  return { success: true, output: strip ? stripAnsi(text) : text };
}

export function signalTerminal(
  terminalId: string,
  signal: string,
  deps: ActionDeps
): object {
  if (typeof signal !== 'string') throw new ActionError(400, 'signal は必須です');
  const ok = deps.processManager.sendSignalToTerminal(terminalId, signal);
  if (!ok) throw new ActionError(404, 'ターミナルが見つかりません');
  return { success: true };
}

export function resizeTerminalAction(
  terminalId: string,
  cols: number,
  rows: number,
  deps: ActionDeps
): object {
  if (typeof cols !== 'number' || typeof rows !== 'number') {
    throw new ActionError(400, 'cols, rows（数値）は必須です');
  }
  const ok = deps.processManager.resizeTerminal(terminalId, cols, rows);
  if (!ok) throw new ActionError(404, 'ターミナルが見つかりません');
  return { success: true };
}

export async function closeTerminalAction(
  terminalId: string,
  deps: ActionDeps
): Promise<object> {
  const ok = await deps.processManager.closeTerminal(terminalId);
  if (!ok) throw new ActionError(404, 'ターミナルが見つかりません');
  return { success: true };
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

export interface UploadPreviewInput {
  filePath: string;
  filename?: string;
  contentType?: string;
  source?: FileSource;
  title?: string;
  description?: string;
}

export async function uploadPreview(
  rid: string,
  input: UploadPreviewInput,
  deps: ActionDeps
): Promise<object> {
  if (!rid) throw new ActionError(400, 'rid が必要です');
  let body: Buffer;
  try {
    body = await readFile(input.filePath);
  } catch (e) {
    throw new ActionError(400, `ファイルを読み込めませんでした: ${String(e)}`);
  }
  const originalname =
    input.filename || input.filePath.split('/').pop() || 'upload.bin';
  const ext = extname(originalname).toLowerCase();
  const mimetype = input.contentType || MIME[ext] || 'application/octet-stream';
  const source: FileSource = input.source === 'user' ? 'user' : 'claude';

  const result = await savePreviewFile(deps.io, rid, body, {
    originalname,
    mimetype,
    source,
    title: input.title,
    description: input.description,
  });
  if (!result.success) throw new ActionError(400, result.message);
  return { success: true, message: result.message, file: result.file };
}

// ---------------------------------------------------------------------------
// markdown
// ---------------------------------------------------------------------------

export interface SendMarkdownInput {
  /** Markdown 本文（必須） */
  content: string;
  /** UI 表示用の元ファイル名（省略時は title から生成、なければ markdown.md） */
  filename?: string;
  /** UI に出すタイトル */
  title?: string;
  /** 補足説明 */
  description?: string;
  /** 由来。既定 'claude' */
  source?: FileSource;
}

function slugifyForFilename(input: string): string {
  return (
    input
      .normalize('NFKD')
      // 半角英数・ハイフン・アンダースコア・日本語以外をハイフンに置換
      .replace(/[^A-Za-z0-9_\-぀-ゟ゠-ヿ一-龯]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'markdown'
  );
}

export async function sendMarkdown(
  rid: string,
  input: SendMarkdownInput,
  deps: ActionDeps
): Promise<object> {
  if (!rid) throw new ActionError(400, 'rid が必要です');
  if (typeof input.content !== 'string' || input.content.length === 0) {
    throw new ActionError(400, 'content（markdown 本文）は必須です');
  }
  const body = Buffer.from(input.content, 'utf-8');
  if (body.length > MAX_MARKDOWN_BYTES) {
    throw new ActionError(
      400,
      `markdown が大きすぎます。最大 ${MAX_MARKDOWN_BYTES / 1024 / 1024}MB`
    );
  }

  const baseName =
    input.filename && input.filename.trim() !== ''
      ? input.filename
      : input.title && input.title.trim() !== ''
        ? `${slugifyForFilename(input.title)}.md`
        : 'markdown.md';
  const originalname = /\.(md|markdown)$/i.test(baseName)
    ? baseName
    : `${baseName}.md`;

  const source: FileSource = input.source === 'user' ? 'user' : 'claude';

  const result = await savePreviewFile(deps.io, rid, body, {
    originalname,
    mimetype: 'text/markdown',
    source,
    title: input.title,
    description: input.description,
  });
  if (!result.success) throw new ActionError(400, result.message);
  return { success: true, message: result.message, file: result.file };
}
