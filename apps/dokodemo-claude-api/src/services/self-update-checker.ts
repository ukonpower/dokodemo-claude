import { spawn } from 'child_process';
import { cleanChildEnv } from '../utils/clean-env.js';

/**
 * dokodemo-claude 自身のリモート更新（新リリース）を定期検知するサービス。
 *
 * 定期的に git fetch → `git rev-list --count HEAD..@{upstream}` で
 * リモートに未取り込みのコミットがあるかを判定し、状態が変化したときだけ
 * コールバック（Socket.IO broadcast）へ通知する。
 *
 * upstream が無い・git が失敗する・オフライン等の環境では常に「更新なし」に
 * 倒し、UI にバッジを出さない（dev worktree などでも安全に動く）。
 */

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10分間隔

let repoRoot = '';
let updateAvailable = false;
let notifyChange: ((updateAvailable: boolean) => void) | null = null;
let checking = false;

function runGit(
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, {
      cwd: repoRoot,
      env: cleanChildEnv(),
    });
    let stdout = '';
    let settled = false;

    const settle = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };

    const timer = setTimeout(() => {
      gitProcess.kill('SIGTERM');
      settle(null);
    }, timeoutMs);

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    gitProcess.on('error', () => settle(null));
    gitProcess.on('exit', (code) => settle(code));
  });
}

/**
 * 現在の更新有無（キャッシュ済みの最新チェック結果）
 */
export function getSelfUpdateAvailable(): boolean {
  return updateAvailable;
}

/**
 * リモート更新の有無を即時チェックし、状態が変化していれば通知する
 */
export async function checkSelfUpdate(): Promise<void> {
  if (!repoRoot || checking) return;
  checking = true;
  try {
    // fetch 失敗（オフライン等）は無視し、手元の remote-tracking ref で比較する
    await runGit(['fetch', '--quiet'], 30000);
    const result = await runGit(
      ['rev-list', '--count', 'HEAD..@{upstream}'],
      10000
    );
    const count =
      result.code === 0 ? parseInt(result.stdout.trim(), 10) : NaN;
    const next = Number.isFinite(count) && count > 0;
    if (next !== updateAvailable) {
      updateAvailable = next;
      notifyChange?.(updateAvailable);
    }
  } finally {
    checking = false;
  }
}

/**
 * 定期チェックを開始する（サーバー起動時に1回呼ぶ）
 */
export function initSelfUpdateChecker(
  projectRoot: string,
  onChange: (updateAvailable: boolean) => void
): void {
  repoRoot = projectRoot;
  notifyChange = onChange;
  void checkSelfUpdate();
  const timer = setInterval(() => {
    void checkSelfUpdate();
  }, CHECK_INTERVAL_MS);
  timer.unref();
}
