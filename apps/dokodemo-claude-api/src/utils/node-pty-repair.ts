import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * node-pty@1.1.x が同梱する prebuild バイナリ
 * `prebuilds/<platform>-<arch>/spawn-helper` は実行ビットなし (0644) で配布されている。
 *
 * このまま使うと node-pty が `posix_spawnp failed.` を投げ、claude / codex CLI が
 * 一切起動できなくなる。upstream (microsoft/node-pty#850) 未修正なので自前で 0755 に
 * 揃える必要がある。postinstall でも当てるが、別の Node バージョンで再 install した
 * 場合や CI 等で postinstall がスキップされた場合に備え、サーバ起動時にも実行する。
 */

const HELPER_ARCHES = ['darwin-arm64', 'darwin-x64'] as const;

function getNodePtyDir(): string | null {
  try {
    return path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return null;
  }
}

function getSpawnHelperPath(arch: string): string | null {
  const nodePtyDir = getNodePtyDir();
  if (!nodePtyDir) return null;
  return path.join(nodePtyDir, 'prebuilds', arch, 'spawn-helper');
}

/**
 * node-pty の spawn-helper に実行ビットが無ければ 0755 を当てる。
 * 戻り値: chmod を実際に当てたパスの一覧。
 */
export function ensureSpawnHelperExecutable(): string[] {
  const fixed: string[] = [];
  for (const arch of HELPER_ARCHES) {
    const helper = getSpawnHelperPath(arch);
    if (!helper) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(helper);
    } catch {
      continue;
    }
    if ((stat.mode & 0o111) !== 0) continue;
    try {
      fs.chmodSync(helper, 0o755);
      fixed.push(helper);
    } catch {
      // best-effort
    }
  }
  return fixed;
}

/**
 * 現在の OS / アーキに対応する spawn-helper の状態を診断する。
 * `posix_spawnp failed.` が起きたときに原因の絞り込みに使う。
 */
export function diagnoseSpawnHelper(): string | null {
  if (process.platform !== 'darwin') return null;
  const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  const helper = getSpawnHelperPath(arch);
  if (!helper) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(helper);
  } catch {
    return `node-pty の spawn-helper が見つかりません: ${helper}`;
  }
  if ((stat.mode & 0o111) === 0) {
    return (
      `node-pty の spawn-helper に実行ビットが無く起動できません: ${helper} ` +
      `(現在 mode=${(stat.mode & 0o777).toString(8)})。` +
      `chmod 0755 で復旧できます。`
    );
  }
  return null;
}
