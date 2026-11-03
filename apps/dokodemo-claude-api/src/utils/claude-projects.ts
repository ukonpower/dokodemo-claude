import * as os from 'os';
import * as path from 'path';

/**
 * cwd に対応する Claude Code の transcript 置き場（`~/.claude/projects/<encoded>`）を返す。
 *
 * Claude Code はセッション開始時の cwd の `/` と `.` を `-` に置換した名前で
 * ディレクトリを切る。`/` だけ置換すると `.dokodemo-worktrees` のように `.` を含む
 * worktree のパスで別ディレクトリを指してしまうため、両方を置換する。
 */
export function getClaudeProjectDir(cwd: string): string {
  const encoded = cwd.replace(/[/.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}
