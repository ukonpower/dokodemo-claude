#!/usr/bin/env node
// dokodemo-claude バックエンド API を MCP ツールとして公開するゼロ依存 stdio サーバ。
//
// - 依存パッケージなし。Node 18+ の組み込み fetch / URLSearchParams のみ使用。
// - JSON-RPC 2.0 over stdio（改行区切り）を自前で処理する。
// - 状態（worktree / terminal など）は起動中の dokodemo-claude-api が保持しているため、
//   このサーバはその HTTP API を薄くプロキシするだけ。curl を一切使わないので
//   権限（auto モードの classifier / Bash ルール）に一切触れない。
// - ベース URL は環境変数 DOKODEMO_API_BASE_URL（dokodemo が Claude 起動時に注入）。
//   自己署名 HTTPS のため、起動側で NODE_TLS_REJECT_UNAUTHORIZED=0 を渡す（.mcp.json）。

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const SERVER_NAME = 'dokodemo-claude';
const SERVER_VERSION = '1.4.0';
const DEFAULT_PROTOCOL = '2025-06-18';

// ---------------------------------------------------------------------------
// HTTP ヘルパー
// ---------------------------------------------------------------------------

// 未展開のプレースホルダ（"${FOO}"）や空文字を「未設定」として扱う
function cleanEnv(v) {
  if (!v) return '';
  const t = v.trim();
  if (!t || t.includes('${')) return '';
  return t;
}

function baseUrl() {
  const u = cleanEnv(process.env.DOKODEMO_API_BASE_URL);
  if (u) return u.replace(/\/$/, '');
  // フォールバック: dokodemo-claude-api の getDokodemoApiBaseUrl() と同じ組み立て
  const port = cleanEnv(process.env.DC_API_PORT) || '8001';
  const proto = cleanEnv(process.env.DC_USE_HTTPS) !== 'false' ? 'https' : 'http';
  return `${proto}://localhost:${port}`;
}

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;

async function api(method, pathname, opts = {}) {
  const url = baseUrl() + pathname;
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.raw !== undefined) {
    body = opts.raw;
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    throw new Error(
      `バックエンドへの接続に失敗しました (${method} ${pathname}): ${e.message}. ` +
        `dokodemo-claude-api が起動しているか、DOKODEMO_API_BASE_URL を確認してください。`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${method} ${pathname} が HTTP ${res.status} を返しました: ${text}`);
  }
  return text;
}

// MIME 推定（preview アップロードで Content-Type 未指定のとき用）
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
};

// ---------------------------------------------------------------------------
// ツール定義
// ---------------------------------------------------------------------------

const TOOLS = [
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
    handler: (a) => api('GET', `/api/repository-id${qs({ path: a.path })}`),
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
    handler: (a) => api('GET', `/api/worktrees/${enc(a.rid)}`),
  },
  {
    name: 'worktree_create',
    description:
      'git ワークツリーを作成する（Web UI のタブにも自動反映）。応答の worktree.wtid を控え、' +
      'メモ設定・削除・プロンプト送信に使い回す。複数タスクを分離環境で進める場合はタスクごとに1つ作る。',
    inputSchema: {
      type: 'object',
      properties: {
        rid: { type: 'string', description: '親 or 任意 worktree の rid（親へ正規化される）' },
        branchName: { type: 'string', description: '作成するブランチ名（= ワークツリー名）' },
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
    handler: (a) =>
      api('POST', `/api/worktree/${enc(a.rid)}`, {
        json: {
          branchName: a.branchName,
          ...(a.baseBranch !== undefined ? { baseBranch: a.baseBranch } : {}),
          ...(a.useExistingBranch !== undefined
            ? { useExistingBranch: a.useExistingBranch }
            : {}),
          ...(a.syncEntries !== undefined ? { syncEntries: a.syncEntries } : {}),
        },
      }),
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
    handler: (a) =>
      api('DELETE', `/api/worktree/${enc(a.wtid)}`, {
        json: { deleteBranch: a.deleteBranch ?? false },
      }),
  },
  {
    name: 'worktree_get_memo',
    description: 'ワークツリーのメモ（= Web UI のタブに表示される説明）を取得する。',
    inputSchema: {
      type: 'object',
      properties: { wtid: { type: 'string', description: '対象ワークツリーの wtid' } },
      required: ['wtid'],
    },
    handler: (a) => api('GET', `/api/worktree/${enc(a.wtid)}/memo`),
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
    handler: (a) => api('PUT', `/api/worktree/${enc(a.wtid)}/memo`, { json: { memo: a.memo } }),
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
        isAutoCommit: { type: 'boolean', description: '自動コミットを行う場合 true' },
        model: { type: 'string', description: '使用モデルの指定（任意）' },
      },
      required: ['rid', 'provider', 'prompt'],
    },
    handler: (a) =>
      api('POST', '/api/prompt/broadcast', {
        json: {
          rid: a.rid,
          provider: a.provider,
          prompt: a.prompt,
          ...(a.targets !== undefined ? { targets: a.targets } : {}),
          ...(a.includeMain !== undefined ? { includeMain: a.includeMain } : {}),
          ...(a.sendClearBefore !== undefined ? { sendClearBefore: a.sendClearBefore } : {}),
          ...(a.isAutoCommit !== undefined ? { isAutoCommit: a.isAutoCommit } : {}),
          ...(a.model !== undefined ? { model: a.model } : {}),
        },
      }),
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
    handler: (a) => api('GET', `/api/terminals/${enc(a.rid)}`),
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
    handler: (a) =>
      api('POST', `/api/terminals/${enc(a.rid)}`, {
        json: {
          ...(a.name !== undefined ? { name: a.name } : {}),
          ...(a.cols !== undefined ? { cols: a.cols } : {}),
          ...(a.rows !== undefined ? { rows: a.rows } : {}),
        },
      }),
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
    handler: (a) =>
      api('POST', `/api/terminals/${enc(a.terminalId)}/input`, {
        json: { input: a.input, ...(a.enter !== undefined ? { enter: a.enter } : {}) },
      }),
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
    handler: (a) =>
      api('GET', `/api/terminals/${enc(a.terminalId)}/output${qs({ strip: a.strip ?? true })}`),
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
    handler: (a) =>
      api('POST', `/api/terminals/${enc(a.terminalId)}/signal`, { json: { signal: a.signal } }),
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
    handler: (a) =>
      api('POST', `/api/terminals/${enc(a.terminalId)}/resize`, {
        json: { cols: a.cols, rows: a.rows },
      }),
  },
  {
    name: 'terminal_close',
    description: 'ターミナルを終了する（Web UI のタブも閉じる）。',
    inputSchema: {
      type: 'object',
      properties: { terminalId: { type: 'string', description: '対象 terminal.id' } },
      required: ['terminalId'],
    },
    handler: (a) => api('POST', `/api/terminals/${enc(a.terminalId)}/close`),
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
    handler: async (a) => {
      const data = await readFile(a.filePath);
      const fname = a.filename || a.filePath.split('/').pop() || 'upload.bin';
      const ext = extname(fname).toLowerCase();
      const ct = a.contentType || MIME[ext] || 'application/octet-stream';
      const query = qs({
        filename: fname,
        source: a.source ?? 'claude',
        title: a.title,
        description: a.description,
      });
      return api('POST', `/api/preview/${enc(a.rid)}${query}`, {
        raw: data,
        headers: { 'Content-Type': ct },
      });
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params && typeof params.protocolVersion === 'string'
        ? params.protocolVersion
        : DEFAULT_PROTOCOL;
      sendResult(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // 通知: 応答しない
    case 'ping':
      if (!isNotification) sendResult(id, {});
      return;
    case 'tools/list': {
      const tools = TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      sendResult(id, { tools });
      return;
    }
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const tool = TOOL_MAP.get(name);
      if (!tool) {
        sendError(id, -32602, `未知のツール: ${name}`);
        return;
      }
      try {
        const text = await tool.handler(args);
        sendResult(id, { content: [{ type: 'text', text: String(text) }] });
      } catch (e) {
        // ツール内エラーは isError 付き結果として返す（プロトコルエラーにはしない）
        sendResult(id, {
          content: [{ type: 'text', text: e && e.message ? e.message : String(e) }],
          isError: true,
        });
      }
      return;
    }
    default:
      if (!isNotification) sendError(id, -32601, `未対応のメソッド: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // 不正な行は無視
    }
    handleMessage(msg).catch((e) => {
      process.stderr.write(`handleMessage error: ${e && e.stack ? e.stack : e}\n`);
    });
  }
});

process.stdin.on('end', () => process.exit(0));
