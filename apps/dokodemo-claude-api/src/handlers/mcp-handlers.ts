// dokodemo-claude-api が自プロセスで MCP（Streamable HTTP）を `/mcp` に提供する。
// 公式 SDK の低レベル Server + StreamableHTTPServerTransport（ステートレス）を使い、
// ツールの実体は services/mcp-actions.ts のアクション層を同一プロセス内で直接呼ぶ。

import type { Express, Request, Response, NextFunction } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { AiProvider, FileSource, WorktreeSyncEntry } from '../types/index.js';
import * as actions from '../services/mcp-actions.js';
import { ActionError } from '../services/mcp-actions.js';

const SERVER_NAME = 'dokodemo-claude';
const SERVER_VERSION = '1.5.0';

// ---------------------------------------------------------------------------
// ツール定義（name / description / inputSchema）
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  // --- repository ---
  {
    name: 'repository_id',
    description:
      'ファイルシステム上のパスから、そのリポジトリの rid（Repository ID）を取得する。' +
      'worktree/prompt 系ツールに渡す rid のもと。ワークツリー内のパスでも親リポジトリへ正規化される。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '対象リポジトリ内の絶対パス（通常は現在の作業ディレクトリ）',
        },
      },
      required: ['path'],
    },
  },

  // --- worktree ---
  {
    name: 'worktree_list',
    description:
      '親リポジトリ配下の main と全ワークツリーを一覧する。各要素は rid/wtid と isMain を持つ。' +
      'targets 指定やループ処理に使う wtid はこの結果から取得する。',
    inputSchema: {
      type: 'object',
      properties: { rid: { type: 'string', description: '親 or 任意 worktree の rid' } },
      required: ['rid'],
    },
  },
  {
    name: 'worktree_create',
    description:
      'git ワークツリーを作成する（Web UI のタブにも自動反映）。応答の worktree.wtid を控え、' +
      'メモ設定・削除・プロンプト送信に使い回す。複数タスクを分離環境で進める場合はタスクごとに1つ作る。' +
      'description（説明）は原則必ず指定すること（このワークツリーで何をするかを書く）。' +
      'description を渡せば作成と同時にメモが設定され、別途 worktree_set_memo を呼ぶ必要はない。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: { type: 'string', description: '親 or 任意 worktree の rid（親へ正規化される）' },
        branchName: { type: 'string', description: '作成するブランチ名（= ワークツリー名）' },
        description: {
          type: 'string',
          description:
            'ワークツリーの説明（= Web UI のタブに表示されるメモ）。Markdown 表記で、後から何のワークツリーか' +
            'すぐ思い出せる情報を書く（何をするかの要約に加え、関連 issue/PR/チケットの URL があれば必ず含める）。' +
            '作成と同時に保存されるので worktree_set_memo を別途呼ぶ必要はない。',
        },
        baseBranch: { type: 'string', description: '分岐元（省略時は現在の HEAD）' },
        useExistingBranch: {
          type: 'boolean',
          description: '既存ブランチをチェックアウトする場合 true',
        },
        syncEntries: {
          type: 'array',
          description:
            '親から取り込むファイル。例 [{"path":".env","mode":"copy"}]（mode は copy か link）。' +
            '未指定時は GUI 既定設定が適用される。明示的に同期なしにするなら空配列。',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              mode: { type: 'string', enum: ['copy', 'link'] },
            },
            required: ['path', 'mode'],
          },
        },
      },
      required: ['rid', 'branchName'],
    },
  },
  {
    name: 'worktree_delete',
    description: 'ワークツリーを削除する。wtid は worktree_create / worktree_list の値を使う。',
    inputSchema: {
      type: 'object',
      properties: {
        wtid: { type: 'string', description: '対象ワークツリーの wtid' },
        deleteBranch: {
          type: 'boolean',
          description: '紐づくブランチも削除する場合 true（既定 false）',
        },
      },
      required: ['wtid'],
    },
  },
  {
    name: 'worktree_get_memo',
    description: 'ワークツリーのメモ（= Web UI のタブに表示される説明）を取得する。',
    inputSchema: {
      type: 'object',
      properties: { wtid: { type: 'string', description: '対象ワークツリーの wtid' } },
      required: ['wtid'],
    },
  },
  {
    name: 'worktree_set_memo',
    description:
      'ワークツリーのメモ（= Web UI のタブに表示される説明）を設定する。' +
      '空文字を渡すとメモ削除。git の branch.description ではなく必ずこのツールを使う。',
    inputSchema: {
      type: 'object',
      properties: {
        wtid: { type: 'string', description: '対象ワークツリーの wtid' },
        memo: { type: 'string', description: '説明本文（自由記述。空文字で削除）' },
      },
      required: ['wtid', 'memo'],
    },
  },

  // --- prompt ---
  {
    name: 'prompt_broadcast',
    description:
      '親リポジトリ配下の全（または targets 指定）ワークツリーの AI キューへ同一プロンプトを一斉投入する。' +
      'キュー投入まで行う。応答の sent / unmatchedTargets / warning を必ず確認すること。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: { type: 'string', description: '親 or 任意 worktree の rid（親へ正規化される）' },
        provider: { type: 'string', enum: ['claude', 'codex'], description: 'AI プロバイダ' },
        prompt: { type: 'string', description: '送信するプロンプト文字列' },
        targets: {
          type: 'array',
          items: { type: 'string' },
          description:
            '送信先 wtid の配列。省略時は全ワークツリー。値は worktree_list の rid を逐語コピーする' +
            '（手で組むと unmatchedTargets に入り黙って外れる）。',
        },
        includeMain: {
          type: 'boolean',
          description: '親リポジトリ本体にも送る場合 true（既定 false）',
        },
        sendClearBefore: { type: 'boolean', description: '送信前に /clear を投入する場合 true' },
        isAutoCommit: { type: 'boolean', description: '自動コミットを行う場合 true（コミットのみ。push はしない）' },
        isAutoCommitPush: {
          type: 'boolean',
          description:
            '自動コミット時に push まで行う場合 true（既定 false）。無人ループでは push が公開行為になるため、明示的に指定したときだけ有効',
        },
        model: {
          type: 'string',
          description:
            '使用モデルの指定（任意）。省略時は呼び出し元セッション（rid のパス）で最後に適用されたモデルを自動継承する',
        },
      },
      required: ['rid', 'provider', 'prompt'],
    },
  },

  // --- terminal ---
  {
    name: 'terminal_list',
    description: 'rid（prid または wtid）配下のターミナル一覧を取得する。',
    inputSchema: {
      type: 'object',
      properties: { rid: { type: 'string', description: 'main の prid または worktree の wtid' } },
      required: ['rid'],
    },
  },
  {
    name: 'terminal_create',
    description:
      'インタラクティブターミナル（PTY）を作成する（Web UI にタブ追加）。応答の terminal.id を入力/出力/終了に使う。' +
      'rid に worktree の wtid を渡すと、そのワークツリーのディレクトリで開く。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: { type: 'string', description: 'main の prid または worktree の wtid' },
        name: { type: 'string', description: 'ターミナル名（任意）' },
        cols: { type: 'number', description: '初期列数（任意）' },
        rows: { type: 'number', description: '初期行数（任意）' },
      },
      required: ['rid'],
    },
  },
  {
    name: 'terminal_input',
    description:
      'ターミナルに入力を送る。enter:true で末尾に改行が付きコマンドが実行される。' +
      '出力は非同期なので、送信後に少し待ってから terminal_output で取得する。',
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: 'terminal_create / terminal_list の terminal.id' },
        input: { type: 'string', description: '送信する文字列（コマンド等）' },
        enter: { type: 'boolean', description: 'true で末尾に改行を付与して実行' },
      },
      required: ['terminalId', 'input'],
    },
  },
  {
    name: 'terminal_output',
    description:
      'ターミナルの出力を取得する。strip:true（既定）で ANSI エスケープを除去した読みやすい文字列を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: '対象 terminal.id' },
        strip: { type: 'boolean', description: 'ANSI 除去（既定 true）。生出力が欲しければ false' },
      },
      required: ['terminalId'],
    },
  },
  {
    name: 'terminal_signal',
    description: 'ターミナルにシグナルを送る（例: SIGINT で Ctrl-C 相当の中断）。',
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: '対象 terminal.id' },
        signal: { type: 'string', description: 'シグナル名（例: SIGINT, SIGTERM）' },
      },
      required: ['terminalId', 'signal'],
    },
  },
  {
    name: 'terminal_resize',
    description: 'ターミナルのサイズ（列数・行数）を変更する。',
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: '対象 terminal.id' },
        cols: { type: 'number', description: '列数' },
        rows: { type: 'number', description: '行数' },
      },
      required: ['terminalId', 'cols', 'rows'],
    },
  },
  {
    name: 'terminal_close',
    description: 'ターミナルを終了する（Web UI のタブも閉じる）。',
    inputSchema: {
      type: 'object',
      properties: { terminalId: { type: 'string', description: '対象 terminal.id' } },
      required: ['terminalId'],
    },
  },

  // --- markdown ---
  {
    name: 'markdown_send',
    description:
      'Markdown 本文を dokodemo-claude のファイル領域へ「受信」として送る。' +
      '送信即 Web UI の受信タブへ表示され、サムネをクリックすると整形済み Markdown ビューア + コピー ボタンで読める。' +
      'ターミナル出力では崩れがちな長文の手順書・要約・差分メモなどを共有する用途。最大 1MB。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: {
          type: 'string',
          description: '送信先リポジトリの rid（repository_id ツールで取得）',
        },
        content: {
          type: 'string',
          description:
            'Markdown 本文（必須）。コードブロック・テーブル・見出し等がそのまま整形表示される。',
        },
        title: {
          type: 'string',
          description: 'UI 表示タイトル（任意）。受信タブのカード上部・ビューア見出しに使われる',
        },
        description: {
          type: 'string',
          description: '補足説明（任意）。ビューア内にタイトル下で表示される',
        },
        filename: {
          type: 'string',
          description:
            'UI に表示する元ファイル名（任意）。省略時は title から生成。拡張子無しなら .md が補完される',
        },
        source: {
          type: 'string',
          enum: ['claude', 'user'],
          description: "由来（既定 'claude'）",
        },
      },
      required: ['rid', 'content'],
    },
  },

  // --- review ---
  {
    name: 'review_request',
    description:
      '実装結果へのユーザー評価を依頼する「評価リクエスト」を発行する。Web UI の受信箱に届き、' +
      'ユーザーが選択肢・コメントで応答すると、その内容が発行元リポジトリの AI キューへプロンプトとして注入される。' +
      '見た目・触り心地（UI/UX）に影響する変更を実装したサイクルの終わりに使う。評価を待ってブロックせず、発行したら次の作業へ進んでよい。' +
      '「どう思う？」の丸投げは禁止。選択肢で答えられる問いまで整形して発行すること。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: {
          type: 'string',
          description:
            '発行元リポジトリの rid（repository_id ツールで取得）。worktree の wtid でもよく、受信箱は親リポジトリ単位に集約され、応答は発行元のキューへ戻る',
        },
        aim: {
          type: 'string',
          description: '狙い: このサイクルで何を改善しようとしたか（1〜2行）',
        },
        question: {
          type: 'string',
          description: '問い: ユーザーに何を判断してほしいか',
        },
        choices: {
          type: 'array',
          items: { type: 'string' },
          description:
            '応答の選択肢（例: ["A案", "B案", "どちらも不採用"]）。ユーザーが最小コストで返せるよう可能な限り指定する',
        },
        images: {
          type: 'array',
          description:
            '提示物の画像（スクリーンショット等）。ローカルの絶対パスで指定。恒久領域へコピーされ、一括削除でも消えない',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '画像ファイルの絶対パス' },
              label: { type: 'string', description: '「案A」等のラベル（任意）' },
            },
            required: ['path'],
          },
        },
        urls: {
          type: 'array',
          description: '提示物の URL（触って確認できる実機 URL 等）',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              label: { type: 'string', description: 'リンクのラベル（任意）' },
            },
            required: ['url'],
          },
        },
        provider: {
          type: 'string',
          enum: ['claude', 'codex'],
          description: "応答プロンプトを積むキューのプロバイダ（既定 'claude'）",
        },
      },
      required: ['rid', 'aim', 'question'],
    },
  },

  // --- preview ---
  {
    name: 'preview_upload',
    description:
      'ローカルのファイル（画像/動画/PDF 等）を dokodemo-claude のプレビュー領域へアップロードする。' +
      'アップロード即 Web UI のファイルタブへ反映される。スクリーンショット共有等に使う。最大 50MB。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: { type: 'string', description: 'アップロード先リポジトリの rid' },
        filePath: { type: 'string', description: 'アップロードするファイルの絶対パス' },
        filename: {
          type: 'string',
          description: 'UI に表示する元ファイル名（省略時は filePath のファイル名）',
        },
        contentType: {
          type: 'string',
          description: 'MIME タイプ（省略時は拡張子から推定）。例: image/png',
        },
        source: {
          type: 'string',
          enum: ['claude', 'user'],
          description: "由来（既定 'claude'）",
        },
        title: { type: 'string', description: 'UI 表示タイトル（任意）' },
        description: { type: 'string', description: '補足説明（任意）' },
      },
      required: ['rid', 'filePath'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// ツール呼び出しのディスパッチ（アクション層へ）
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' ? v : undefined;

async function dispatch(
  name: string,
  args: Args,
  deps: actions.ActionDeps
): Promise<object> {
  switch (name) {
    case 'repository_id':
      return actions.getRepositoryId(str(args.path));
    case 'worktree_list':
      return actions.listWorktrees(str(args.rid));
    case 'worktree_create':
      return actions.createWorktreeAction(
        str(args.rid),
        {
          branchName: str(args.branchName),
          description:
            typeof args.description === 'string' ? args.description : undefined,
          baseBranch: typeof args.baseBranch === 'string' ? args.baseBranch : undefined,
          useExistingBranch: bool(args.useExistingBranch),
          syncEntries: Array.isArray(args.syncEntries)
            ? (args.syncEntries as WorktreeSyncEntry[])
            : undefined,
        },
        deps
      );
    case 'worktree_delete':
      return actions.deleteWorktreeAction(
        str(args.wtid),
        { deleteBranch: bool(args.deleteBranch) },
        deps
      );
    case 'worktree_get_memo':
      return actions.getWorktreeMemo(str(args.wtid), deps);
    case 'worktree_set_memo':
      return actions.setWorktreeMemo(str(args.wtid), str(args.memo), deps);
    case 'prompt_broadcast':
      return actions.broadcastPrompt(
        {
          rid: str(args.rid),
          provider: str(args.provider) as AiProvider,
          prompt: str(args.prompt),
          targets: Array.isArray(args.targets)
            ? (args.targets as string[])
            : undefined,
          includeMain: bool(args.includeMain),
          sendClearBefore: bool(args.sendClearBefore),
          isAutoCommit: bool(args.isAutoCommit),
          isAutoCommitPush: bool(args.isAutoCommitPush),
          model: typeof args.model === 'string' ? args.model : undefined,
        },
        deps
      );
    case 'terminal_list':
      return actions.listTerminals(str(args.rid), deps);
    case 'terminal_create':
      return actions.createTerminalAction(
        str(args.rid),
        {
          name: typeof args.name === 'string' ? args.name : undefined,
          cols: num(args.cols),
          rows: num(args.rows),
        },
        deps
      );
    case 'terminal_input':
      return actions.sendTerminalInput(
        str(args.terminalId),
        str(args.input),
        bool(args.enter),
        deps
      );
    case 'terminal_output':
      return actions.getTerminalOutput(
        str(args.terminalId),
        bool(args.strip) ?? true,
        deps
      );
    case 'terminal_signal':
      return actions.signalTerminal(str(args.terminalId), str(args.signal), deps);
    case 'terminal_resize':
      return actions.resizeTerminalAction(
        str(args.terminalId),
        num(args.cols) ?? NaN,
        num(args.rows) ?? NaN,
        deps
      );
    case 'terminal_close':
      return actions.closeTerminalAction(str(args.terminalId), deps);
    case 'markdown_send':
      return actions.sendMarkdown(
        str(args.rid),
        {
          content: str(args.content),
          filename: typeof args.filename === 'string' ? args.filename : undefined,
          title: typeof args.title === 'string' ? args.title : undefined,
          description:
            typeof args.description === 'string' ? args.description : undefined,
          source:
            args.source === 'user' || args.source === 'claude'
              ? (args.source as FileSource)
              : undefined,
        },
        deps
      );
    case 'review_request':
      return actions.createReviewRequest(
        str(args.rid),
        {
          aim: str(args.aim),
          question: str(args.question),
          choices: Array.isArray(args.choices)
            ? (args.choices as unknown[]).filter(
                (c): c is string => typeof c === 'string'
              )
            : undefined,
          images: Array.isArray(args.images)
            ? (args.images as { path: string; label?: string }[])
            : undefined,
          urls: Array.isArray(args.urls)
            ? (args.urls as { url: string; label?: string }[])
            : undefined,
          provider:
            args.provider === 'codex' || args.provider === 'claude'
              ? (args.provider as AiProvider)
              : undefined,
        },
        deps
      );
    case 'preview_upload':
      return actions.uploadPreview(
        str(args.rid),
        {
          filePath: str(args.filePath),
          filename: typeof args.filename === 'string' ? args.filename : undefined,
          contentType:
            typeof args.contentType === 'string' ? args.contentType : undefined,
          source:
            args.source === 'user' || args.source === 'claude'
              ? (args.source as FileSource)
              : undefined,
          title: typeof args.title === 'string' ? args.title : undefined,
          description:
            typeof args.description === 'string' ? args.description : undefined,
        },
        deps
      );
    default:
      throw new ActionError(400, `未知のツール: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// localhost 限定ミドルウェア
// ---------------------------------------------------------------------------

function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const ip = req.socket.remoteAddress ?? '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    next();
    return;
  }
  res.status(403).json({ error: 'MCP はローカルホストからのみ利用できます' });
}

// ---------------------------------------------------------------------------
// ルート登録
// ---------------------------------------------------------------------------

/**
 * Express アプリへ MCP の Streamable HTTP エンドポイント（`/mcp`）を登録する。
 * ステートレス運用: リクエストごとに Server + transport を生成・破棄する。
 */
export function registerMcpRoutes(app: Express, deps: actions.ActionDeps): void {
  app.post('/mcp', localhostOnly, async (req: Request, res: Response) => {
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      const args = (request.params.arguments ?? {}) as Args;
      try {
        const result = await dispatch(name, args, deps);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // ステートレス運用では GET(SSE)/DELETE は使わない
  app.get('/mcp', localhostOnly, (_req: Request, res: Response) => {
    res.status(405).end();
  });
  app.delete('/mcp', localhostOnly, (_req: Request, res: Response) => {
    res.status(405).end();
  });
}
