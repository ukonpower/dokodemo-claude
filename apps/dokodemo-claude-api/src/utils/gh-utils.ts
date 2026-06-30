import { spawn } from 'child_process';
import { cleanChildEnv } from './clean-env.js';
import type { GitWorktreePrInfo } from '../types/index.js';

interface GhPrJson {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  title: string;
  headRefName: string;
  isDraft: boolean;
  mergedAt: string | null;
  url: string;
}

/**
 * `gh pr list` を実行し、ブランチ名 → PR 情報の Map を返す。
 *
 * - gh CLI が無い / GitHub 以外のリモート / 認証エラー等の場合は空 Map を返す（失敗を握りつぶす）
 * - 同一ブランチに複数 PR がある場合は、優先度 OPEN > MERGED(新しい順) > CLOSED の順で 1 件採用
 */
export async function getWorktreePrsByBranch(
  repoPath: string
): Promise<Map<string, GitWorktreePrInfo>> {
  return new Promise((resolve) => {
    const args = [
      'pr',
      'list',
      '--json',
      'number,state,title,headRefName,isDraft,mergedAt,url',
      '--state',
      'all',
      '--limit',
      '200',
    ];
    const proc = spawn('gh', args, {
      cwd: repoPath,
      env: cleanChildEnv(),
    });
    let stdout = '';
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', () => {
      // 失敗時の詳細は無視
    });
    proc.on('error', () => {
      resolve(new Map());
    });
    proc.on('exit', (code) => {
      if (code !== 0) {
        resolve(new Map());
        return;
      }
      try {
        const list: GhPrJson[] = JSON.parse(stdout);
        const map = new Map<string, GitWorktreePrInfo>();
        for (const pr of list) {
          const info: GitWorktreePrInfo = {
            number: pr.number,
            state: pr.state,
            isDraft: pr.isDraft,
            title: pr.title,
            url: pr.url,
            mergedAt: pr.mergedAt,
          };
          const existing = map.get(pr.headRefName);
          if (!existing) {
            map.set(pr.headRefName, info);
            continue;
          }
          if (shouldReplacePr(existing, info)) {
            map.set(pr.headRefName, info);
          }
        }
        resolve(map);
      } catch {
        resolve(new Map());
      }
    });
  });
}

function shouldReplacePr(
  current: GitWorktreePrInfo,
  candidate: GitWorktreePrInfo
): boolean {
  const rank = (p: GitWorktreePrInfo): number => {
    if (p.state === 'OPEN') return 3;
    if (p.state === 'MERGED') return 2;
    return 1; // CLOSED
  };
  const cr = rank(current);
  const nr = rank(candidate);
  if (nr !== cr) return nr > cr;
  // 同 state なら number が大きい方（新しい方）を採用
  return candidate.number > current.number;
}
