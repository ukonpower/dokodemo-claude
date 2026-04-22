import path from 'path';
import type { HandlerContext } from './types.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';

/**
 * ターミナル関連のSocket.IOイベントハンドラーを登録
 */
export function registerTerminalHandlers(ctx: HandlerContext): void {
  const { socket, processManager } = ctx;

  // ターミナル一覧の送信
  socket.on('list-terminals', async (data) => {
    const { rid: inputRid, repositoryPath: rawPath } = data || {};
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    let terminals;

    if (repositoryPath) {
      terminals = processManager.getTerminalsByRepository(repositoryPath);
    } else {
      terminals = processManager.getAllTerminals();
    }

    const rid = repositoryPath
      ? repositoryIdManager.tryGetId(repositoryPath)
      : undefined;
    socket.emit('terminals-list', {
      terminals: terminals.map((terminal) => ({
        id: terminal.id,
        name: terminal.name,
        cwd: terminal.repositoryPath,
        rid: repositoryIdManager.tryGetId(terminal.repositoryPath),
        status: terminal.status,
        pid: terminal.pid,
        createdAt: terminal.createdAt,
      })),
      rid,
    });

    // 各ターミナルの出力履歴を送信
    for (const terminal of terminals) {
      try {
        const history = await processManager.getTerminalOutputHistory(
          terminal.id
        );
        socket.emit('terminal-output-history', {
          terminalId: terminal.id,
          history,
        });
      } catch {
        socket.emit('terminal-output-history', {
          terminalId: terminal.id,
          history: [],
        });
      }
    }
  });

  // 新しいターミナルの作成
  socket.on('create-terminal', async (data) => {
    const { rid: inputRid, cwd: rawCwd, name, initialSize } = data;
    const cwd = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawCwd,
    });
    if (!cwd) return;
    try {
      const repoName = path.basename(cwd);
      const terminal = await processManager.createTerminal(
        cwd,
        repoName,
        name,
        initialSize
      );

      socket.emit('terminal-output-history', {
        terminalId: terminal.id,
        history: [],
      });
    } catch {
      socket.emit('terminal-output', {
        terminalId: 'system',
        type: 'stderr',
        data: `ターミナル作成エラー\n`,
        timestamp: Date.now(),
      });
    }
  });

  // ターミナルへの入力送信
  socket.on('terminal-input', (data) => {
    const { terminalId, input } = data;

    const success = processManager.sendToTerminal(terminalId, input);

    if (!success) {
      socket.emit('terminal-output', {
        terminalId,
        type: 'stderr',
        data: `ターミナル入力エラー: ターミナル ${terminalId} が見つからないか、既に終了しています\n`,
        timestamp: Date.now(),
      });
    }
  });

  // ターミナルのリサイズ
  socket.on('terminal-resize', (data) => {
    const { terminalId, cols, rows } = data;
    processManager.resizeTerminal(terminalId, cols, rows);
  });

  // ターミナルへのシグナル送信
  socket.on('terminal-signal', (data) => {
    const { terminalId, signal } = data;
    const success = processManager.sendSignalToTerminal(terminalId, signal);
    socket.emit('terminal-signal-sent', { terminalId, signal, success });
  });

  // ターミナルの終了
  socket.on('close-terminal', async (data) => {
    const { terminalId } = data;
    await processManager.closeTerminal(terminalId);
  });

  // コマンドショートカット一覧の送信
  socket.on('list-shortcuts', (data) => {
    const { rid: inputRid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const shortcuts = processManager.getShortcutsByRepository(repositoryPath);
    socket.emit('shortcuts-list', { shortcuts });
  });

  // 新しいコマンドショートカットの作成
  socket.on('create-shortcut', async (data) => {
    const { name, command, rid: inputRid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      const shortcut = await processManager.createShortcut(
        name,
        command,
        repositoryPath
      );
      const displayName = shortcut.name || shortcut.command;
      socket.emit('shortcut-created', {
        success: true,
        message: `コマンドショートカット「${displayName}」を作成しました`,
        shortcut,
      });

      const shortcuts = processManager.getShortcutsByRepository(repositoryPath);
      socket.emit('shortcuts-list', { shortcuts });
    } catch {
      socket.emit('shortcut-created', {
        success: false,
        message: `コマンドショートカット作成エラー`,
      });
    }
  });

  // コマンドショートカットの削除
  socket.on('delete-shortcut', async (data) => {
    const { shortcutId } = data;

    try {
      const success = await processManager.deleteShortcut(shortcutId);
      if (success) {
        socket.emit('shortcut-deleted', {
          success: true,
          message: 'コマンドショートカットを削除しました',
          shortcutId,
        });
      } else {
        socket.emit('shortcut-deleted', {
          success: false,
          message: 'コマンドショートカットが見つかりません',
          shortcutId,
        });
      }
    } catch {
      socket.emit('shortcut-deleted', {
        success: false,
        message: `コマンドショートカット削除エラー`,
        shortcutId,
      });
    }
  });

  // コマンドショートカットの実行
  socket.on('execute-shortcut', (data) => {
    const { shortcutId, terminalId } = data;

    const success = processManager.executeShortcut(shortcutId, terminalId);
    socket.emit('shortcut-executed', {
      success,
      message: success
        ? 'コマンドショートカットを実行しました'
        : 'コマンドショートカットの実行に失敗しました',
      shortcutId,
    });
  });

  // npmスクリプト一覧の取得
  socket.on('get-npm-scripts', async (data) => {
    const { rid: inputRid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const rid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      const { getNpmScripts } = await import('../utils/git-utils.js');
      const scripts = await getNpmScripts(repositoryPath);
      socket.emit('npm-scripts-list', { scripts, rid });
    } catch {
      socket.emit('npm-scripts-list', { scripts: {}, rid });
    }
  });

  // npmスクリプトの実行
  socket.on('execute-npm-script', async (data) => {
    const {
      rid: inputRid,
      repositoryPath: rawPath,
      scriptName,
      terminalId,
    } = data;
    const repositoryPath = resolveRepositoryPath({
      rid: inputRid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;

    try {
      if (terminalId) {
        const command = `npm run ${scriptName}\r`;
        const success = processManager.sendToTerminal(terminalId, command);

        socket.emit('npm-script-executed', {
          success,
          message: success
            ? `npmスクリプト「${scriptName}」を実行しました`
            : 'ターミナルが見つかりませんでした',
          scriptName,
          terminalId,
        });
      } else {
        const repoName = path.basename(repositoryPath);
        const terminal = await processManager.createTerminal(
          repositoryPath,
          repoName,
          `npm run ${scriptName}`
        );

        setTimeout(() => {
          processManager.sendToTerminal(terminal.id, `npm run ${scriptName}\r`);
        }, 500);

        socket.emit('npm-script-executed', {
          success: true,
          message: `npmスクリプト「${scriptName}」を新しいターミナルで実行しました`,
          scriptName,
          terminalId: terminal.id,
        });
      }
    } catch {
      socket.emit('npm-script-executed', {
        success: false,
        message: `npmスクリプト実行エラー`,
        scriptName,
        terminalId,
      });
    }
  });
}
