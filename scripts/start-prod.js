#!/usr/bin/env node
// 本番モード (npm run start) の supervisor。
// api (tsx watch) + web (vite build --watch) を concurrently で起動しつつ、
// 更新ボタン (pull-self) が書き込む .dc-restart-request を監視する。
// フラグを検知したら「子プロセス停止 → npm install (root/api/web) → 再起動」を行い、
// 依存関係の変更を含む更新でもボタン一つで反映できるようにする。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const flagPath = path.join(projectRoot, '.dc-restart-request');

let child = null;
let restarting = false;
let shuttingDown = false;

function log(message) {
  console.log(`[supervisor] ${message}`);
}

function startChildren() {
  child = spawn(
    'npx',
    [
      'concurrently',
      '-n',
      'api,web',
      '-c',
      'yellow,cyan',
      'npx tsx watch apps/dokodemo-claude-api/src/server.ts',
      'cd apps/dokodemo-claude-web && npx vite build --watch',
    ],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      // 再起動時にプロセスグループごと止められるよう独立グループにする
      detached: true,
    }
  );

  child.on('exit', (code) => {
    if (shuttingDown) process.exit(code ?? 0);
    if (restarting) return; // stopChildren() 側で待っている
    // 想定外の終了は supervisor ごと終わる（従来の npm run start と同じ挙動）
    process.exit(code ?? 0);
  });
}

function stopChildren() {
  const target = child;
  child = null;
  if (!target || target.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        process.kill(-target.pid, 'SIGKILL');
      } catch {
        // 既に終了していれば無視
      }
    }, 10000);

    target.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });

    try {
      process.kill(-target.pid, 'SIGTERM');
    } catch {
      target.kill('SIGTERM');
    }
  });
}

function runInstall() {
  const targets = [
    ['root', ['install']],
    ['api', ['install', '--prefix', 'apps/dokodemo-claude-api']],
    ['web', ['install', '--prefix', 'apps/dokodemo-claude-web']],
  ];
  for (const [label, args] of targets) {
    log(`npm install (${label}) を実行中...`);
    const result = spawnSync('npm', args, {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      log(`npm install (${label}) が exit ${result.status} で失敗しました（続行します）`);
    }
  }
}

async function handleRestartRequest() {
  restarting = true;
  fs.rmSync(flagPath, { force: true });
  log('更新後の再起動要求を検知しました。サーバーを停止します。');
  await stopChildren();
  runInstall();
  log('再起動します。');
  restarting = false;
  startChildren();
}

function shutdown(signal) {
  shuttingDown = true;
  if (child) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // 既に終了していれば無視
    }
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 前回の残骸フラグは無視する
fs.rmSync(flagPath, { force: true });

setInterval(() => {
  if (restarting || shuttingDown) return;
  if (!fs.existsSync(flagPath)) return;
  handleRestartRequest();
}, 1000);

startChildren();
