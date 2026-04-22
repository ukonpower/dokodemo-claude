import { spawn } from 'child_process';
import type { HandlerContext } from './types.js';
import { getRemoteUrl } from '../utils/git-utils.js';
import * as CodeServerManager from '../code-server.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { cleanChildEnv } from '../utils/clean-env.js';

// エディタの型定義
type EditorType = 'vscode' | 'cursor';

interface EditorInfo {
  id: EditorType;
  name: string;
  command: string;
  available: boolean;
}

const EDITORS: Omit<EditorInfo, 'available'>[] = [
  { id: 'vscode', name: 'VSCode', command: 'code' },
  { id: 'cursor', name: 'Cursor', command: 'cursor' },
];

/**
 * コマンドが利用可能かチェック
 */
async function checkCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const whichProcess = spawn('which', [command], {
      env: cleanChildEnv(),
    });

    whichProcess.on('close', (code) => {
      resolve(code === 0);
    });

    whichProcess.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * 利用可能なエディタリストを取得
 */
async function getAvailableEditors(): Promise<EditorInfo[]> {
  const results = await Promise.all(
    EDITORS.map(async (editor) => {
      const available = await checkCommandAvailable(editor.command);
      return { ...editor, available };
    })
  );
  return results;
}

/**
 * その他の機能のSocket.IOイベントハンドラーを登録
 */
export function registerMiscHandlers(
  ctx: HandlerContext,
  projectRoot: string
): void {
  const { socket } = ctx;

  // 利用可能なエディタリストの取得
  socket.on('get-available-editors', async () => {
    const editors = await getAvailableEditors();
    socket.emit('available-editors', { editors });
  });

  // エディタ起動
  socket.on('open-in-editor', (data) => {
    const { rid, repositoryPath: rawPath, editor } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const resolvedRid = repositoryIdManager.tryGetId(repositoryPath);

    const editorCommand = editor === 'vscode' ? 'code' : 'cursor';
    const editorName = editor === 'vscode' ? 'VSCode' : 'Cursor';

    try {
      const editorProcess = spawn(editorCommand, [repositoryPath], {
        detached: true,
        stdio: 'ignore',
        env: cleanChildEnv(),
      });

      editorProcess.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          socket.emit('editor-opened', {
            success: false,
            message: `${editorName}が見つかりません。${editorCommand}コマンドがインストールされているか確認してください。`,
            editor,
            rid: resolvedRid,
          });
        } else {
          socket.emit('editor-opened', {
            success: false,
            message: `${editorName}の起動に失敗しました: ${error.message}`,
            editor,
            rid: resolvedRid,
          });
        }
      });

      editorProcess.unref();

      socket.emit('editor-opened', {
        success: true,
        message: `${editorName}でリポジトリを開きました`,
        editor,
        rid: resolvedRid,
      });
    } catch (error) {
      socket.emit('editor-opened', {
        success: false,
        message: `${editorName}の起動に失敗しました: ${error}`,
        editor,
        rid: resolvedRid,
      });
    }
  });

  // リポジトリのリモートURL取得
  socket.on('get-remote-url', async (data) => {
    const { rid, repositoryPath: rawPath } = data;
    const repositoryPath = resolveRepositoryPath({
      rid,
      repositoryPath: rawPath,
    });
    if (!repositoryPath) return;
    const resolvedRid = repositoryIdManager.tryGetId(repositoryPath);

    try {
      const remoteUrl = await getRemoteUrl(repositoryPath);
      socket.emit('remote-url', {
        success: !!remoteUrl,
        remoteUrl: remoteUrl || null,
        rid: resolvedRid,
      });
    } catch (error) {
      socket.emit('remote-url', {
        success: false,
        remoteUrl: null,
        rid: resolvedRid,
        message: `リモートURL取得エラー: ${error}`,
      });
    }
  });

  // code-server起動
  socket.on('start-code-server', async () => {
    try {
      const server = await CodeServerManager.startCodeServer();
      socket.emit('code-server-started', {
        success: true,
        message: `code-serverを起動しました: ${server.url}`,
        server,
      });
    } catch (error) {
      socket.emit('code-server-started', {
        success: false,
        message: `code-serverの起動に失敗しました: ${error}`,
      });
    }
  });

  // code-server停止
  socket.on('stop-code-server', async () => {
    try {
      await CodeServerManager.stopCodeServer();
      socket.emit('code-server-stopped', {
        success: true,
        message: 'code-serverを停止しました',
      });
    } catch (error) {
      socket.emit('code-server-stopped', {
        success: false,
        message: `code-serverの停止に失敗しました: ${error}`,
      });
    }
  });

  // code-server情報の取得
  socket.on('get-code-server', () => {
    const server = CodeServerManager.getCodeServer();
    socket.emit('code-server-info', { server });
  });

  // 特定のリポジトリを開くURLの取得
  socket.on(
    'get-code-server-url',
    (data: { rid?: string; repositoryPath?: string }) => {
      const repositoryPath = resolveRepositoryPath({
        rid: data.rid,
        repositoryPath: data.repositoryPath,
      });
      if (!repositoryPath) return;
      const resolvedRid = repositoryIdManager.tryGetId(repositoryPath);

      try {
        let url =
          CodeServerManager.getCodeServerUrlForRepository(repositoryPath);

        const host = socket.handshake.headers.host;
        if (host) {
          const hostname = host.split(':')[0];
          if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
            url = url.replace('localhost', hostname);
          }
        }

        socket.emit('code-server-url', {
          success: true,
          url,
          rid: resolvedRid,
        });
      } catch (error) {
        socket.emit('code-server-url', {
          success: false,
          message: `URLの取得に失敗しました: ${error}`,
          rid: resolvedRid,
        });
      }
    }
  );

  // dokodemo-claude自身のgit pull
  socket.on('pull-self', async () => {
    try {
      const selfRepoPath = projectRoot;

      const gitPullProcess = spawn('git', ['pull'], {
        cwd: selfRepoPath,
        env: cleanChildEnv(),
      });
      let output = '';
      let errorOutput = '';

      gitPullProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      gitPullProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      const pullTimeout = setTimeout(() => {
        gitPullProcess.kill('SIGTERM');
        socket.emit('self-pulled', {
          success: false,
          message: 'git pullがタイムアウトしました',
          output: output,
        });
      }, 60000);

      gitPullProcess.on('exit', (code) => {
        clearTimeout(pullTimeout);

        if (code === 0) {
          socket.emit('self-pulled', {
            success: true,
            message: 'dokodemo-claudeを最新版に更新しました',
            output: output || errorOutput,
          });
        } else {
          socket.emit('self-pulled', {
            success: false,
            message: 'git pullに失敗しました',
            output: errorOutput || output,
          });
        }
      });
    } catch (error) {
      socket.emit('self-pulled', {
        success: false,
        message: `git pullエラー: ${error}`,
        output: '',
      });
    }
  });

}
