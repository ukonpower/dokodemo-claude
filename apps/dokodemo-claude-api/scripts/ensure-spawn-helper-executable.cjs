/**
 * node-pty@1.1.x の prebuild 同梱バイナリ `prebuilds/<platform>-<arch>/spawn-helper` が
 * 実行ビット (x) 不在の 0644 で配布されている問題への対策。
 *
 * spawn-helper が実行不可だと node-pty が `posix_spawnp failed.` を投げ、
 * claude / codex CLI が一切起動できなくなる。upstream
 * (https://github.com/microsoft/node-pty/issues/850) が直るまでの自前対応として
 * postinstall でモードを 0755 に揃える。
 *
 * macOS 以外では spawn-helper が存在しないため何もしない。
 */

const fs = require('fs');
const path = require('path');

function ensureExecutable(helperPath) {
  let stat;
  try {
    stat = fs.statSync(helperPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
  if ((stat.mode & 0o111) !== 0) return false;
  fs.chmodSync(helperPath, 0o755);
  return true;
}

function main() {
  let nodePtyDir;
  try {
    nodePtyDir = path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return;
  }
  for (const arch of ['darwin-arm64', 'darwin-x64']) {
    const helper = path.join(nodePtyDir, 'prebuilds', arch, 'spawn-helper');
    if (ensureExecutable(helper)) {
      console.log(`[node-pty] chmod 0755 ${helper}`);
    }
  }
}

main();
