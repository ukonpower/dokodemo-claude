import path from 'path';
import type { Express } from 'express';
import type { HandlerContext } from './types.js';
import type { ProcessManager } from '../process-manager.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import { stripAnsi } from '../utils/strip-ansi.js';

/**
 * ターミナル操作の REST API ルートを登録する。
 * UI 反映は processManager の EventEmitter 配線（terminal-created/output/exit）が
 * 自動で行うため、REST 側でブロードキャストは書かない。
 */
export function registerTerminalRoutes(
  app: Express,
  processManager: ProcessManager
): void {
  // ターミナル一覧（:rid のリポジトリに属するターミナル）
  app.get('/api/terminals/:rid', (req, res) => {
    const cwd = repositoryIdManager.getPath(req.params.rid);
    if (!cwd) {
      res.status(404).json({ success: false, message: 'リポジトリが見つかりません' });
      return;
    }
    const terminals = processManager.getTerminalsByRepository(cwd);
    res.json({
      success: true,
      terminals: terminals.map((t) => ({
        id: t.id,
        name: t.name,
        cwd: t.repositoryPath,
        rid: repositoryIdManager.tryGetId(t.repositoryPath),
        status: t.status,
        pid: t.pid,
        createdAt: t.createdAt,
      })),
    });
  });

  // ターミナル作成
  app.post('/api/terminals/:rid', async (req, res) => {
    try {
      const cwd = repositoryIdManager.getPath(req.params.rid);
      if (!cwd) {
        res.status(404).json({ success: false, message: 'リポジトリが見つかりません' });
        return;
      }
      const { name, cols, rows } = req.body ?? {};
      const terminal = await processManager.createTerminal(
        cwd,
        path.basename(cwd),
        name,
        cols && rows ? { cols, rows } : undefined
      );
      res.status(201).json({
        success: true,
        terminal: {
          id: terminal.id,
          name: terminal.name,
          cwd: terminal.repositoryPath,
          rid: repositoryIdManager.tryGetId(terminal.repositoryPath),
          status: terminal.status,
          pid: terminal.pid,
          createdAt: terminal.createdAt,
        },
      });
    } catch (error) {
      console.error('[REST API] ターミナル作成エラー:', error);
      res.status(500).json({ success: false, message: String(error) });
    }
  });

  // ターミナルへの入力送信（enter:true で末尾に改行を付与してコマンド実行）
  app.post('/api/terminals/:terminalId/input', (req, res) => {
    const { input, enter } = req.body ?? {};
    if (typeof input !== 'string') {
      res.status(400).json({ success: false, message: 'input は必須です' });
      return;
    }
    const ok = processManager.sendToTerminal(
      req.params.terminalId,
      enter ? input + '\r' : input
    );
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ターミナルへのシグナル送信
  app.post('/api/terminals/:terminalId/signal', (req, res) => {
    const { signal } = req.body ?? {};
    if (typeof signal !== 'string') {
      res.status(400).json({ success: false, message: 'signal は必須です' });
      return;
    }
    const ok = processManager.sendSignalToTerminal(req.params.terminalId, signal);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ターミナルのリサイズ
  app.post('/api/terminals/:terminalId/resize', (req, res) => {
    const { cols, rows } = req.body ?? {};
    if (typeof cols !== 'number' || typeof rows !== 'number') {
      res.status(400).json({ success: false, message: 'cols, rows（数値）は必須です' });
      return;
    }
    const ok = processManager.resizeTerminal(req.params.terminalId, cols, rows);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ターミナルの終了
  app.post('/api/terminals/:terminalId/close', async (req, res) => {
    const ok = await processManager.closeTerminal(req.params.terminalId);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ターミナル出力履歴の取得（?strip=true で ANSI 除去）
  app.get('/api/terminals/:terminalId/output', (req, res) => {
    const history = processManager.getTerminalOutputHistory(req.params.terminalId);
    const text = history.map((h) => h.content).join('');
    res.json({
      success: true,
      output: req.query.strip === 'true' ? stripAnsi(text) : text,
    });
  });
}

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
