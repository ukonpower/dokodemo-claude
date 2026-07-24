/**
 * Claude Agent SDK（query()）が spawn する Claude Code CLI は、
 * cwd ごとに `~/.claude/projects/<encoded>/<sessionId>.jsonl` へ
 * トランスクリプトを書き出す。これは `claude` を対話起動したときの
 * /resume 一覧の実体でもあるため、要約・判定など「ユーザーが後から
 * resume したくないバックグラウンド用途」で使うと履歴に紛れてしまう。
 *
 * 対策として:
 * - 履歴に混ざっては困る用途は cwd を隔離用スクラッチに寄せる
 *   （ツール未使用の要約系はプロジェクト cwd を必要としないため可能）
 * - どの用途でも実行完了後に session_id 由来の jsonl を unlink する
 *
 * jsonl のパスは `cwd.replace(/[/.]/g, '-')` で決まる
 * （ai-session-manager と同じ規則）。
 */

import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const SUMMARY_SCRATCH_DIR = path.join(
  os.homedir(),
  '.dokodemo-claude',
  'summary-scratch'
);

let scratchEnsured = false;

/**
 * 要約系（ツール未使用・プロジェクト cwd 不要）で使う隔離 cwd を返す。
 * 初回呼び出し時にディレクトリを作る。
 */
export function getSummaryScratchCwd(): string {
  if (!scratchEnsured) {
    mkdirSync(SUMMARY_SCRATCH_DIR, { recursive: true });
    scratchEnsured = true;
  }
  return SUMMARY_SCRATCH_DIR;
}

function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

/**
 * Agent SDK 実行後に、spawn された CLI が書いたトランスクリプト jsonl を消す。
 * 失敗しても本体機能には影響させない（fire-and-forget 想定）。
 */
export async function deleteAgentSdkTranscript(
  cwd: string,
  sessionId: string | undefined | null
): Promise<void> {
  if (!sessionId) return;
  const jsonlPath = path.join(
    os.homedir(),
    '.claude',
    'projects',
    encodeProjectDir(cwd),
    `${sessionId}.jsonl`
  );
  try {
    await unlink(jsonlPath);
  } catch {
    // 既に無い / 権限違い等は無視
  }
}
