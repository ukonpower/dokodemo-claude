import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { HandlerContext } from './types.js';
import { getRemoteUrl } from '../utils/git-utils.js';
import * as CodeServerManager from '../code-server.js';
import { resolveRepositoryPath } from '../utils/resolve-repository-path.js';
import { repositoryIdManager } from '../services/repository-id-manager.js';
import { cleanChildEnv } from '../utils/clean-env.js';
import { checkSelfUpdate } from '../services/self-update-checker.js';
import { getSelfBranches, updateSelf } from '../services/self-repo.js';

// エディタの型定義
type EditorType = 'vscode' | 'cursor' | 'code-server';

interface EditorInfo {
  id: EditorType;
  name: string;
  command: string;
  available: boolean;
}

const EDITORS: Omit<EditorInfo, 'available'>[] = [
  { id: 'vscode', name: 'VSCode', command: 'code' },
  { id: 'cursor', name: 'Cursor', command: 'cursor' },
  { id: 'code-server', name: 'code-server', command: 'code-server' },
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
    (data: {
      rid?: string;
      repositoryPath?: string;
      clientHost?: string;
    }) => {
      const repositoryPath = resolveRepositoryPath({
        rid: data.rid,
        repositoryPath: data.repositoryPath,
      });
      if (!repositoryPath) return;
      const resolvedRid = repositoryIdManager.tryGetId(repositoryPath);

      try {
        let url =
          CodeServerManager.getCodeServerUrlForRepository(repositoryPath);

        // dev モードでは Vite proxy により Host ヘッダーが書き換わるため、
        // クライアント側で見えているホスト（window.location.host）を最優先で使う
        const hostCandidates = [
          data.clientHost,
          socket.handshake.headers.host,
        ];
        for (const host of hostCandidates) {
          if (!host) continue;
          const hostname = host.split(':')[0];
          if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
            url = url.replace('localhost', hostname);
            break;
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

  // dokodemo-claude自身の更新先ブランチ一覧
  socket.on('get-self-branches', async () => {
    try {
      const result = await getSelfBranches(projectRoot);
      socket.emit('self-branches', result);
    } catch (error) {
      socket.emit('self-branches', {
        success: false,
        current: '',
        branches: [],
        message: `ブランチ一覧の取得に失敗しました: ${error}`,
      });
    }
  });

  // dokodemo-claude自身の更新（ブランチ指定可）
  socket.on('pull-self', async (data) => {
    try {
      const result = await updateSelf(projectRoot, data?.branch);

      if (!result.success) {
        socket.emit('self-pulled', {
          success: false,
          message: result.message,
          output: result.output,
          branch: result.branch,
        });
        return;
      }

      const branchLabel = result.branchChanged
        ? `${result.branch} に切り替えて更新しました`
        : `${result.branch} を最新版に更新しました`;
      let message = `dokodemo-claudeを${branchLabel}。数十秒後に自動的に切り替わります。`;

      // prod (npm run start) では supervisor (scripts/start-prod.js) が
      // このフラグを検知して npm install → 全プロセス再起動を行う
      if (process.env.DC_MODE === 'prod') {
        try {
          fs.writeFileSync(
            path.join(projectRoot, '.dc-restart-request'),
            `${new Date().toISOString()}\n`
          );
          message = `dokodemo-claudeを${branchLabel}。依存関係の更新とサーバー再起動を行うため、1〜2分ほど待ってからページを再読み込みしてください。`;
        } catch {
          // フラグが書けない場合は従来どおり tsx watch の自動再起動に任せる
        }
      } else if (result.branchChanged) {
        // dev では supervisor が居ないため、依存の入れ直しは手動になる
        message = `dokodemo-claudeを${branchLabel}。依存関係が変わっている場合は npm install を実行してください。`;
      }

      socket.emit('self-pulled', {
        success: true,
        message,
        output: result.output,
        branch: result.branch,
      });

      // 更新完了後に更新有無を再チェックし、バッジを消す
      void checkSelfUpdate();
    } catch (error) {
      socket.emit('self-pulled', {
        success: false,
        message: `更新に失敗しました: ${error}`,
        output: '',
      });
    }
  });

}
