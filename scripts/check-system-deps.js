/**
 * システム依存ツールのチェック・自動インストールスクリプト
 *
 * dokodemo-claude の動作に必要なシステムツールが揃っているか確認し、
 * 未インストールの場合は自動インストールを試みる。
 *
 * npm run setup の一部として実行される
 */

import { spawnSync, execSync } from 'child_process';
import os from 'os';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

// ─── ユーティリティ ───

function commandExists(cmd) {
  const result = spawnSync('which', [cmd], { stdio: 'pipe' });
  return result.status === 0;
}

function run(cmd, options = {}) {
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function getPlatform() {
  const platform = os.platform();
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return 'linux';
  return 'unsupported';
}

// ─── jq インストール ───

function tryInstallJq() {
  const platform = getPlatform();

  if (platform === 'mac') {
    if (commandExists('brew')) {
      console.log('🔧 jq を Homebrew でインストール中...');
      try {
        run('brew install jq');
        return commandExists('jq');
      } catch {
        console.log('⚠️  Homebrew での jq インストールに失敗しました');
        return false;
      }
    }
    console.log('⚠️  Homebrew が見つかりません。jq を手動でインストールしてください');
    return false;
  }

  if (platform === 'linux') {
    if (tryInstallJqApt()) return true;
    if (tryInstallJqBinary()) return true;
    return false;
  }

  return false;
}

function tryInstallJqApt() {
  if (!commandExists('apt-get')) return false;
  console.log('🔧 jq を apt でインストール中...');
  try {
    run('sudo apt-get update -qq && sudo apt-get install -y -qq jq 2>/dev/null');
    return commandExists('jq');
  } catch {
    return false;
  }
}

function tryInstallJqBinary() {
  console.log('🔧 jq バイナリをダウンロード中...');
  try {
    const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
    const url = `https://github.com/jqlang/jq/releases/latest/download/jq-linux-${arch}`;
    const tmpPath = '/tmp/jq-download';

    run(`curl -sL -o "${tmpPath}" "${url}"`);
    run(`chmod +x "${tmpPath}"`);

    try {
      run(`sudo mv "${tmpPath}" /usr/local/bin/jq`);
    } catch {
      const localBin = join(os.homedir(), '.local', 'bin');
      mkdirSync(localBin, { recursive: true });
      run(`mv "${tmpPath}" "${localBin}/jq"`);
      process.env.PATH = `${localBin}:${process.env.PATH}`;
    }
    return commandExists('jq');
  } catch {
    console.log('⚠️  jq バイナリのダウンロードに失敗しました');
    return false;
  }
}

// ─── メイン ───

function main() {
  console.log('🔍 システム依存ツールをチェック中...');

  const deps = [
    {
      name: 'jq',
      reason: 'Claude Code hooks の JSON 処理に必要',
      install: tryInstallJq,
    },
  ];

  let allOk = true;

  for (const dep of deps) {
    if (commandExists(dep.name)) {
      console.log(`✅ ${dep.name} ... インストール済み`);
      continue;
    }

    console.log(`❌ ${dep.name} が見つかりません (${dep.reason})`);
    console.log(`   自動インストールを試みます...`);

    if (dep.install()) {
      console.log(`✅ ${dep.name} をインストールしました`);
    } else {
      console.log(`⚠️  ${dep.name} の自動インストールに失敗しました。手動でインストールしてください`);
      allOk = false;
    }
  }

  if (allOk) {
    console.log('✅ 全てのシステム依存ツールが揃っています');
  } else {
    console.log('⚠️  一部のツールがインストールできませんでした。上記のメッセージを確認してください');
  }
}

main();
