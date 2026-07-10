/**
 * AISessionManager - AI CLI セッションのマルチインスタンス管理
 *
 * 1 リポジトリに対し複数の AiInstance（タブ）を保持し、各 instance に
 * provider ごとの ActiveAiSession (PTY) を結びつける。
 *
 * - プライマリ : リポジトリオープン時に自動生成、閉じられない。provider 切替時は
 *   既存 PTY を kill せず「表示する provider」を切り替えるだけ（instance.provider が
 *   表示中 provider を指す）。切替先が未起動の場合のみ spawn する。
 *   再起動・クローズ時は全 provider の PTY をまとめて kill する。
 * - サブ       : ユーザ操作で作成、閉じられる、provider 固定（セッションは常に 1 つ）
 */

import * as pty from 'node-pty';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import {
  AiProvider,
  AiOutputLine,
  AiInstance,
  PermissionMode,
} from '../types/index.js';
import { RingBuffer } from '../utils/ring-buffer.js';
import {
  cleanChildEnv,
  getDokodemoApiBaseUrl,
  getDokodemoMcpUrl,
  resolveCommandPath,
} from '../utils/clean-env.js';
import { diagnoseSpawnHelper } from '../utils/node-pty-repair.js';
import { ProcessRegistry } from './process-registry.js';

/**
 * アクティブな AI セッション（PTY 接続）
 */
export interface ActiveAiSession {
  id: string; // sessionId
  instanceId: string;
  repositoryPath: string;
  repositoryName: string;
  pid: number;
  isActive: boolean;
  isPty: boolean;
  process: pty.IPty;
  provider: AiProvider;
  createdAt: number;
  lastAccessedAt: number;
  outputHistory: AiOutputLine[];
  // spawn 時に背景で開始する起動完了待ち。waitForSessionReady() はこの
  // promise を await するだけ。複数の経路から ensureSession しても 1 回だけ
  // 待機すれば済み、2 回目以降は即時 resolve となる。
  readyPromise: Promise<void>;
}

export interface CreateInstanceOptions {
  repositoryPath: string;
  repositoryName: string;
  provider: AiProvider;
  isPrimary: boolean;
  displayName?: string;
  initialSize?: { cols: number; rows: number };
  permissionMode?: PermissionMode;
}

export interface AISessionManagerConfig {
  maxOutputLines: number;
  gracefulTerminationTimeoutMs: number;
}

const DEFAULT_CONFIG: AISessionManagerConfig = {
  // 出力履歴の保持件数。リロード／再接続／タブ・プロバイダ切替で履歴を
  // 取り直す際にここまで遡れる。Claude Code は TUI 再描画フレームを多く
  // 吐くため、500 では直近しか残らず履歴を遡れない。xterm の scrollback
  // (10000 行) と釣り合う 5000 チャンクを保持する。
  maxOutputLines: 5000,
  gracefulTerminationTimeoutMs: 2000,
};

// コールドスタート（claude/codex CLI を新規 spawn した直後）の起動完了待ち
// パラメータ。CLI の TUI 入力ハンドラが起動しきる前にプロンプト＋Enter を
// 送ると Enter が取りこぼされて送信されない。PTY 出力が一定時間途切れた
// （＝初期描画が落ち着いた）ことを検知してから送信を始めることで取りこぼしを防ぐ。
// CLI が初期出力を始めるまでの最低待機時間。これ未満では「落ち着いた」と判定しない。
const SESSION_READY_MIN_WAIT_MS = 1500;
// PTY 出力がこの時間途切れたら初期描画が完了したとみなす。
const SESSION_READY_QUIET_PERIOD_MS = 600;
// 環境差で出力が止まらない場合に待機を打ち切る上限。
const SESSION_READY_MAX_WAIT_MS = 10000;
// 出力静止判定のポーリング間隔。
const SESSION_READY_POLL_INTERVAL_MS = 100;

export class AISessionManager extends EventEmitter {
  private readonly registry: ProcessRegistry;
  private readonly config: AISessionManagerConfig;

  // instanceId → AiInstance
  private instances = new Map<string, AiInstance>();
  // sessionKey(instanceId, provider) → ActiveAiSession
  // プライマリは provider ごとにセッションを保持できる（サブは常に 1 つ）
  private activeSessions = new Map<string, ActiveAiSession>();
  // sessionId → sessionKey
  private sessionIdIndex = new Map<string, string>();
  // sessionKey(instanceId, provider) → RingBuffer
  // 出力履歴も provider ごとに保持し、切替で行き来しても会話履歴に戻れる
  private outputBuffers = new Map<string, RingBuffer<AiOutputLine>>();

  private sessionCounter = 0;
  private instanceCounter = 0;

  constructor(
    registry: ProcessRegistry,
    config: Partial<AISessionManagerConfig> = {}
  ) {
    super();
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getProviderCommand(
    provider: AiProvider,
    permissionMode?: PermissionMode,
    // claude の会話を継続/固定するための指定。
    // 'new'    : --session-id でこの UUID を新規セッションとして開始する
    // 'resume' : --resume でこの UUID の会話を復元して継続する
    claudeSession?: { mode: 'new' | 'resume'; sessionId: string },
    // codex の会話を継続するための指定。
    // 'resume' のみサポート（'new' は指定なし＝通常起動と等価）
    codexSession?: { mode: 'resume'; sessionId: string }
  ): {
    command: string;
    args: string[];
  } {
    switch (provider) {
      case 'claude': {
        const claudeCommand = process.env.CLAUDE_CLI_COMMAND || 'claude';
        const args: string[] = [];
        // permissionMode が未設定 (undefined) もしくは 'disabled' の場合は CLI に何も
        // 追加引数を渡さず、Claude CLI 既定の権限確認モードで起動させる。
        // ユーザが明示的に 'auto' / 'dangerous' を選んだときだけ対応する引数を付ける。
        if (permissionMode === 'dangerous') {
          args.push('--dangerously-skip-permissions');
        } else if (permissionMode === 'auto') {
          args.push('--permission-mode', 'auto');
        }
        // 再起動しても同じ会話を開けるよう、セッションIDを固定して起動する。
        // 初回は --session-id で ID を発行、以降は --resume で同じ ID を継続。
        // --fork-session を付けないため resume 後も session ID は変わらず、
        // 再起動を繰り返しても常に最新状態へ追従する。
        if (claudeSession) {
          if (claudeSession.mode === 'resume') {
            args.push('--resume', claudeSession.sessionId);
          } else {
            args.push('--session-id', claudeSession.sessionId);
          }
        }
        return { command: claudeCommand, args };
      }
      case 'codex': {
        const codexCommand = process.env.CODEX_CLI_COMMAND || 'codex';
        const args: string[] = [];
        if (codexSession) {
          // `codex resume <id>` は subcommand なので位置を先頭にする
          args.push('resume', codexSession.sessionId);
        }
        args.push('--dangerously-bypass-approvals-and-sandbox');
        return { command: codexCommand, args };
      }
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  /**
   * Claude CLI のセッションjsonl（トランスクリプト）が存在するか。
   * Claude Code は cwd を `/`→`-` で変換したディレクトリ名の下に
   * `<sessionId>.jsonl` を書き出す。初回プロンプトが送信されるまで
   * ファイルは作られない。
   */
  private hasClaudeTranscript(cwd: string, sessionId: string): boolean {
    // Claude Code の projects ディレクトリ名は cwd の `/` と `.` を `-` に
    // 置換した文字列。`/` だけ置換すると worktree の `.dokodemo-worktrees`
    // など `.` を含むパスで jsonl 存在検知が外れ、再起動時に mode='new' で
    // 同じ --session-id を渡してしまい "Session ID ... is already in use" になる。
    const encoded = cwd.replace(/[/.]/g, '-');
    const jsonlPath = path.join(
      os.homedir(),
      '.claude',
      'projects',
      encoded,
      `${sessionId}.jsonl`
    );
    try {
      const stat = fs.statSync(jsonlPath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  private fileExistsWithContent(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * codex CLI が spawn 後に書き出す rollout jsonl を検知して、instance に
   * session id と file path を保存する。
   * ファイル名は `rollout-<timestamp>-<uuid>.jsonl` で、
   * `~/.codex/sessions/YYYY/MM/DD/` 配下に置かれる。
   * 検知に失敗しても致命ではない（次回はフレッシュ起動になるだけ）。
   */
  private watchCodexSessionFile(
    instance: AiInstance,
    session: ActiveAiSession,
    spawnStartedAt: number
  ): void {
    const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
    const targetCwd = instance.repositoryPath;
    const deadline = spawnStartedAt + 30_000;
    const pollIntervalMs = 500;

    const tick = (): void => {
      if (!session.isActive) return;
      if (Date.now() > deadline) return;

      const found = this.findLatestCodexSessionFile(
        sessionsRoot,
        targetCwd,
        spawnStartedAt
      );
      if (found) {
        instance.codexSessionId = found.sessionId;
        instance.codexSessionFile = found.filePath;
        this.emit('ai-instance-updated', {
          instanceId: instance.instanceId,
          instance: { ...instance },
        });
        return;
      }
      setTimeout(tick, pollIntervalMs);
    };
    setTimeout(tick, pollIntervalMs);
  }

  /**
   * spawn 開始時刻より後に作成された rollout jsonl のうち、cwd が
   * 一致するものを探して session id / file path を返す。
   */
  private findLatestCodexSessionFile(
    sessionsRoot: string,
    targetCwd: string,
    spawnStartedAt: number
  ): { sessionId: string; filePath: string } | null {
    try {
      const files: { file: string; mtime: number }[] = [];
      const walk = (dir: string, depth: number): void => {
        // sessionsRoot/YYYY/MM/DD なので深さ 3 まで潜れば十分
        if (depth > 3) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full, depth + 1);
          } else if (
            entry.isFile() &&
            entry.name.startsWith('rollout-') &&
            entry.name.endsWith('.jsonl')
          ) {
            try {
              const stat = fs.statSync(full);
              if (stat.mtimeMs >= spawnStartedAt - 1_000) {
                files.push({ file: full, mtime: stat.mtimeMs });
              }
            } catch {
              // ignore
            }
          }
        }
      };
      walk(sessionsRoot, 0);
      files.sort((a, b) => b.mtime - a.mtime);
      for (const { file } of files) {
        const meta = this.readCodexSessionMeta(file);
        if (meta && meta.cwd === targetCwd) {
          return { sessionId: meta.id, filePath: file };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * rollout jsonl の 1 行目 `session_meta` から id と cwd を読み出す。
   */
  private readCodexSessionMeta(
    filePath: string
  ): { id: string; cwd: string } | null {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
        const head = buf.slice(0, bytesRead).toString('utf8');
        const firstLine = head.split('\n', 1)[0];
        if (!firstLine) return null;
        const parsed = JSON.parse(firstLine) as {
          type?: string;
          payload?: { id?: string; cwd?: string };
        };
        if (
          parsed.type === 'session_meta' &&
          parsed.payload?.id &&
          parsed.payload?.cwd
        ) {
          return { id: parsed.payload.id, cwd: parsed.payload.cwd };
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // ignore
    }
    return null;
  }

  private generateSessionId(provider: AiProvider): string {
    return `${provider}-${++this.sessionCounter}-${Date.now()}`;
  }

  /**
   * activeSessions / outputBuffers のキー。instance × provider ごとに
   * セッションと出力履歴を分離して保持する。
   */
  private sessionKey(instanceId: string, provider: AiProvider): string {
    return `${instanceId}:${provider}`;
  }

  /**
   * instance の「表示中 provider」のセッションを返す
   */
  private getDisplayedSession(
    instanceId: string
  ): ActiveAiSession | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;
    return this.activeSessions.get(
      this.sessionKey(instanceId, instance.provider)
    );
  }

  /**
   * このセッションが instance の表示中 provider かどうか。
   * 非表示（バックグラウンド）のセッションは出力をバッファに貯めるだけで
   * クライアントへの emit は行わない。
   */
  private isDisplayedSession(session: ActiveAiSession): boolean {
    const instance = this.instances.get(session.instanceId);
    return !instance || instance.provider === session.provider;
  }

  private generateInstanceId(isPrimary: boolean): string {
    const prefix = isPrimary ? 'primary' : 'sub';
    return `${prefix}-${++this.instanceCounter}-${Date.now()}`;
  }

  /**
   * 内部用: PTY を起動して ActiveAiSession を作る
   */
  private spawnSession(
    instance: AiInstance,
    repositoryName: string,
    options: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): ActiveAiSession {
    // claude は再起動しても同じ会話を開けるよう、instance ごとに固定の
    // セッションID（UUID）を持たせる。未発行なら新規発行して --session-id で
    // 起動、既にあれば --resume で継続する。
    let claudeSession: { mode: 'new' | 'resume'; sessionId: string } | undefined;
    let codexSession: { mode: 'resume'; sessionId: string } | undefined;
    if (instance.provider === 'codex') {
      // 前回起動時に検知した rollout jsonl がまだ残っていれば `codex resume <id>` で継続。
      // 取れなかった（未初期化 or ファイル消失）ら黙ってフレッシュ起動する。
      if (
        instance.codexSessionId &&
        instance.codexSessionFile &&
        this.fileExistsWithContent(instance.codexSessionFile)
      ) {
        codexSession = { mode: 'resume', sessionId: instance.codexSessionId };
      } else {
        // 古い ID/パスは掴んだままだと次回検知で邪魔なのでクリアしておく
        instance.codexSessionId = undefined;
        instance.codexSessionFile = undefined;
      }
    }
    if (instance.provider === 'claude') {
      if (instance.claudeSessionId) {
        // 前回起動時に --session-id で ID を発行しても、ユーザが Web / xterm から
        // 一度もプロンプトを送っていないと Claude CLI はトランスクリプト
        // (~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl) を作らない。
        // その状態で --resume すると "No conversation found" で即終了するため、
        // jsonl の存在（かつサイズ>0）を実ファイルで確認して mode を分岐する。
        // 入力経路（Web / xterm 直接入力）に依らずファイル存在で判定できる。
        const hasTranscript = this.hasClaudeTranscript(
          instance.repositoryPath,
          instance.claudeSessionId
        );
        claudeSession = {
          mode: hasTranscript ? 'resume' : 'new',
          sessionId: instance.claudeSessionId,
        };
      } else {
        const newId = randomUUID();
        instance.claudeSessionId = newId;
        claudeSession = { mode: 'new', sessionId: newId };
      }
    }

    const { command, args } = this.getProviderCommand(
      instance.provider,
      options.permissionMode,
      claudeSession,
      codexSession
    );
    const spawnStartedAt = Date.now();
    const sessionId = this.generateSessionId(instance.provider);

    // cwd（リポジトリパス）が存在しない場合は node-pty が "posix_spawnp failed"
    // という原因の判別不能な汎用エラーを投げてしまうため、事前に検証して
    // 具体的なメッセージを返す。
    if (!fs.existsSync(instance.repositoryPath)) {
      throw new Error(
        `リポジトリパスが存在しません: ${instance.repositoryPath}`
      );
    }

    const childEnv = cleanChildEnv({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      CLAUDECODE: undefined,
      DOKODEMO_API_BASE_URL: getDokodemoApiBaseUrl(),
      DOKODEMO_MCP_URL: getDokodemoMcpUrl(),
    });

    // コマンドが PATH から解決できなければ "posix_spawnp failed" になるので
    // 事前に絶対パス解決して、解決失敗時は明確なエラーを投げる。
    const resolvedCommand = resolveCommandPath(command, childEnv);
    if (!resolvedCommand) {
      throw new Error(
        `${instance.provider} CLI が見つかりません: "${command}" は PATH 上で実行可能ファイルとして解決できませんでした。` +
          ` ~/.local/bin など CLI のインストール先が PATH に含まれているかご確認ください。` +
          ` (PATH="${childEnv.PATH ?? ''}")`
      );
    }

    let aiProcess: pty.IPty;
    try {
      aiProcess = pty.spawn(resolvedCommand, args, {
        name: 'xterm-color',
        cols: options.initialSize?.cols ?? 120,
        rows: options.initialSize?.rows ?? 30,
        cwd: instance.repositoryPath,
        env: childEnv,
      });
    } catch (error) {
      // node-pty の元エラーには cwd / command が含まれていないため、
      // 原因特定できるように情報を付与し直す。
      // posix_spawnp failed の場合は spawn-helper のモード診断を付加する。
      const reason = error instanceof Error ? error.message : String(error);
      const helperHint =
        reason.includes('posix_spawnp') ? diagnoseSpawnHelper() : null;
      throw new Error(
        `${instance.provider} CLI の起動に失敗しました: ${reason} ` +
          `(command="${resolvedCommand}", cwd="${instance.repositoryPath}")` +
          (helperHint ? ` ${helperHint}` : '')
      );
    }

    const session: ActiveAiSession = {
      id: sessionId,
      instanceId: instance.instanceId,
      repositoryPath: instance.repositoryPath,
      repositoryName,
      pid: aiProcess.pid,
      isActive: true,
      isPty: true,
      process: aiProcess,
      provider: instance.provider,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      outputHistory: [],
      // 直後に startSessionReadyWatcher(session) で上書きする。readyPromise を
      // ActiveAiSession に同梱しておくと、ensure-primary-instance 経由で作られた
      // 直後の primary に対してキュー側が ensureSession→coldStart=false で待機を
      // スキップし、CLI 起動中に prompt を打ち込んで取りこぼす race を防げる。
      readyPromise: Promise.resolve(),
    };
    session.readyPromise = this.startSessionReadyWatcher(session);

    let pendingOutput = '';
    let flushScheduled = false;

    aiProcess.onData((data: string) => {
      session.lastAccessedAt = Date.now();
      pendingOutput += data;

      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(() => {
          const bufferedData = pendingOutput;
          pendingOutput = '';
          flushScheduled = false;

          const outputLine = this.addToOutputHistory(
            session,
            bufferedData,
            'stdout'
          );

          // バックグラウンド（非表示 provider）のセッションはバッファ蓄積のみ。
          // emit すると表示中 provider の画面に混ざってしまう。
          if (this.isDisplayedSession(session)) {
            this.emit('ai-output', {
              instanceId: session.instanceId,
              sessionId: session.id,
              repositoryPath: session.repositoryPath,
              provider: session.provider,
              outputLine,
            });
          }
        });
      }
    });

    aiProcess.onExit(({ exitCode, signal }) => {
      session.isActive = false;

      if (this.isDisplayedSession(session)) {
        this.emit('ai-exit', {
          instanceId: session.instanceId,
          sessionId: session.id,
          repositoryPath: session.repositoryPath,
          exitCode,
          signal,
          provider: session.provider,
        });
      }

      // セッションだけクリーンアップ。instance レコードは残す（再起動可能性あり）
      // 同キーで新セッションが spawn 済みの可能性があるので同一性を確認してから消す
      const key = this.sessionKey(session.instanceId, session.provider);
      if (this.activeSessions.get(key) === session) {
        this.activeSessions.delete(key);
      }
      this.sessionIdIndex.delete(session.id);
      this.registry.removeAiSession(session.id);

      const inst = this.instances.get(session.instanceId);
      if (inst && inst.provider === session.provider) {
        if (inst.sessionId === session.id) {
          inst.sessionId = undefined;
        }
        this.emit('ai-instance-updated', {
          instanceId: inst.instanceId,
          instance: { ...inst },
        });
      }
    });

    this.activeSessions.set(
      this.sessionKey(instance.instanceId, instance.provider),
      session
    );
    this.sessionIdIndex.set(
      session.id,
      this.sessionKey(instance.instanceId, instance.provider)
    );

    this.registry.registerAiSession({
      sessionId: session.id,
      repositoryPath: session.repositoryPath,
      provider: session.provider,
      pid: session.pid,
      status: 'running',
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
    });

    // codex は spawn 側から ID を渡せないので、起動後に書き出される
    // ~/.codex/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl を検知して控える。
    // 検知した ID/パスは instance に保存し、次回再起動時に resume に使う。
    // resume 起動時は既存 ID を維持するので検知は不要。
    if (instance.provider === 'codex' && !codexSession) {
      this.watchCodexSessionFile(instance, session, spawnStartedAt);
    }

    return session;
  }

  /**
   * 新規インスタンスを作成（PTY も起動）
   */
  async createInstance(
    options: CreateInstanceOptions
  ): Promise<{ instance: AiInstance; session: ActiveAiSession }> {
    const instanceId = this.generateInstanceId(options.isPrimary);
    const order = this.getNextOrder(options.repositoryPath, options.isPrimary);

    const instance: AiInstance = {
      instanceId,
      repositoryPath: options.repositoryPath,
      provider: options.provider,
      isPrimary: options.isPrimary,
      displayName: options.displayName,
      order,
      createdAt: Date.now(),
      sessionId: undefined,
    };

    this.instances.set(instanceId, instance);

    const session = this.spawnSession(instance, options.repositoryName, {
      initialSize: options.initialSize,
      permissionMode: options.permissionMode,
    });

    instance.sessionId = session.id;

    this.emit('ai-instance-created', {
      instanceId,
      instance: { ...instance },
    });
    this.emit('ai-session-created', {
      instanceId,
      sessionId: session.id,
      repositoryPath: instance.repositoryPath,
      provider: instance.provider,
    });

    return { instance, session };
  }

  /**
   * プライマリインスタンスを確保（無ければ作成）
   * provider が異なる場合は switchPrimaryProvider と組み合わせて呼び出し側で対応
   */
  async ensurePrimaryInstance(
    repositoryPath: string,
    repositoryName: string,
    provider: AiProvider,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{
    instance: AiInstance;
    session: ActiveAiSession;
    coldStart: boolean;
  }> {
    const primary = this.getPrimaryInstance(repositoryPath);
    if (primary) {
      // セッションが死んでいれば spawn し直す
      let session = this.getDisplayedSession(primary.instanceId);
      if (!session || !session.isActive) {
        session = this.spawnSession(primary, repositoryName, options ?? {});
        primary.sessionId = session.id;
        this.emit('ai-instance-updated', {
          instanceId: primary.instanceId,
          instance: { ...primary },
        });
        // 新規に PTY を spawn したのでコールドスタート
        return { instance: primary, session, coldStart: true };
      } else if (options?.initialSize) {
        try {
          session.process.resize(
            options.initialSize.cols,
            options.initialSize.rows
          );
        } catch {
          // ignore
        }
      }

      // provider 切替が必要な場合は呼び出し側で switchPrimaryProvider を呼ぶ
      // 既存セッションを再利用したのでコールドスタートではない
      return { instance: primary, session, coldStart: false };
    }

    const created = await this.createInstance({
      repositoryPath,
      repositoryName,
      provider,
      isPrimary: true,
      initialSize: options?.initialSize,
      permissionMode: options?.permissionMode,
    });
    // プライマリが無く新規作成したのでコールドスタート
    return { ...created, coldStart: true };
  }

  /**
   * プライマリの provider を切り替える
   * 既存セッションは kill せず「表示する provider」を差し替えるだけ。
   * 切替先 provider のセッションが生きていればそのまま再利用し、
   * 未起動（または死んでいる）場合のみ spawn する（この場合だけ coldStart）。
   */
  async switchPrimaryProvider(
    repositoryPath: string,
    newProvider: AiProvider,
    repositoryName: string,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{
    instance: AiInstance;
    session: ActiveAiSession;
    coldStart: boolean;
  }> {
    const primary = this.getPrimaryInstance(repositoryPath);
    if (!primary) {
      return await this.ensurePrimaryInstance(
        repositoryPath,
        repositoryName,
        newProvider,
        options
      );
    }

    const providerChanged = primary.provider !== newProvider;
    primary.provider = newProvider;

    const existing = this.activeSessions.get(
      this.sessionKey(primary.instanceId, newProvider)
    );

    let session: ActiveAiSession;
    let coldStart: boolean;
    if (existing && existing.isActive) {
      session = existing;
      coldStart = false;
      if (options?.initialSize) {
        try {
          session.process.resize(
            options.initialSize.cols,
            options.initialSize.rows
          );
        } catch {
          // ignore
        }
      }
    } else {
      session = this.spawnSession(primary, repositoryName, options ?? {});
      coldStart = true;
    }
    primary.sessionId = session.id;

    if (providerChanged || coldStart) {
      this.emit('ai-instance-updated', {
        instanceId: primary.instanceId,
        instance: { ...primary },
      });
    }

    if (providerChanged) {
      // 表示 provider が変わったので、切替先の出力履歴でクライアント表示を
      // 置き換えさせる（server 経由で ai-output-history として broadcast される）
      this.emit('ai-history-replaced', {
        instanceId: primary.instanceId,
        repositoryPath: primary.repositoryPath,
        provider: newProvider,
        history: this.getOutputHistory(primary.instanceId),
      });
    }

    return { instance: primary, session, coldStart };
  }

  /**
   * インスタンスの再起動（同一 instanceId、PTY だけ作り直す）
   * プライマリの場合はバックグラウンドで保持している別 provider の PTY も
   * まとめて kill し、表示中 provider だけを spawn し直す。
   */
  async restartInstance(
    instanceId: string,
    repositoryName: string,
    options?: {
      initialSize?: { cols: number; rows: number };
      permissionMode?: PermissionMode;
    }
  ): Promise<{ instance: AiInstance; session: ActiveAiSession } | null> {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    await this.terminateAllSessions(instanceId);
    this.deleteOutputBuffers(instanceId);

    const session = this.spawnSession(instance, repositoryName, options ?? {});
    instance.sessionId = session.id;

    this.emit('ai-instance-updated', {
      instanceId: instance.instanceId,
      instance: { ...instance },
    });

    return { instance, session };
  }

  /**
   * インスタンスを閉じる（プライマリは閉じられない）
   */
  async closeInstance(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    if (instance.isPrimary) {
      throw new Error('プライマリインスタンスは閉じられません');
    }

    await this.terminateAllSessions(instanceId);

    this.instances.delete(instanceId);
    this.deleteOutputBuffers(instanceId);

    this.emit('ai-instance-closed', {
      instanceId,
      repositoryPath: instance.repositoryPath,
    });

    return true;
  }

  /**
   * 表示名を更新
   */
  renameInstance(instanceId: string, displayName: string): AiInstance | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;

    instance.displayName = displayName;

    this.emit('ai-instance-updated', {
      instanceId,
      instance: { ...instance },
    });

    return instance;
  }

  /**
   * PTY を kill するヘルパー（instances Map には触らない）
   */
  private async terminateSession(session: ActiveAiSession): Promise<boolean> {
    const key = this.sessionKey(session.instanceId, session.provider);

    try {
      const exitPromise = new Promise<void>((resolve) => {
        session.process.onExit(() => resolve());
      });

      session.process.kill('SIGTERM');

      const killTimeout = setTimeout(() => {
        if (this.activeSessions.get(key) === session) {
          try {
            session.process.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, this.config.gracefulTerminationTimeoutMs);

      await Promise.race([
        exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);

      clearTimeout(killTimeout);

      if (this.activeSessions.get(key) === session) {
        this.activeSessions.delete(key);
      }
      this.sessionIdIndex.delete(session.id);
      this.registry.removeAiSession(session.id);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * instance が持つ全 provider のセッションを kill する
   * （再起動・クローズ・リポジトリ終了時に使用。プロセスリーク防止）
   */
  private async terminateAllSessions(instanceId: string): Promise<void> {
    const sessions = Array.from(this.activeSessions.values()).filter(
      (s) => s.instanceId === instanceId
    );
    await Promise.all(sessions.map((s) => this.terminateSession(s)));
  }

  /**
   * instance の全 provider の出力バッファを破棄する
   */
  private deleteOutputBuffers(instanceId: string): void {
    for (const key of this.outputBuffers.keys()) {
      if (key.startsWith(`${instanceId}:`)) {
        this.outputBuffers.delete(key);
      }
    }
  }

  private writeToSession(
    session: ActiveAiSession | undefined,
    input: string
  ): boolean {
    if (!session || !session.isActive || !session.process) return false;

    try {
      session.process.write(input);
      session.lastAccessedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 入力送信（instanceId 経由 — 表示中 provider のセッションへ）
   */
  sendInput(instanceId: string, input: string): boolean {
    return this.writeToSession(this.getDisplayedSession(instanceId), input);
  }

  /**
   * 入力送信（sessionId 経由 — キュー Adapter 用）
   * sessionId で直接セッションを特定するので、表示中 provider に関わらず
   * 対象 provider のセッションへ確実に届く。
   */
  sendInputBySessionId(sessionId: string, input: string): boolean {
    return this.writeToSession(this.getSessionById(sessionId), input);
  }

  /**
   * spawn 直後のセッションに対して PTY 出力の静止を監視し、起動完了と
   * 判定したら resolve する promise を生成する。
   * 1 セッションにつき 1 度だけ呼び出し、結果を session.readyPromise として
   * キャッシュする。waitForSessionReady() はこれを await するだけ。
   */
  private startSessionReadyWatcher(session: ActiveAiSession): Promise<void> {
    const start = Date.now();
    return new Promise<void>((resolve) => {
      const check = () => {
        const elapsed = Date.now() - start;
        // lastAccessedAt は PTY 出力受信のたびに更新される
        const quietFor = Date.now() - session.lastAccessedAt;

        if (elapsed >= SESSION_READY_MAX_WAIT_MS) {
          resolve();
          return;
        }
        if (
          elapsed >= SESSION_READY_MIN_WAIT_MS &&
          quietFor >= SESSION_READY_QUIET_PERIOD_MS
        ) {
          resolve();
          return;
        }
        setTimeout(check, SESSION_READY_POLL_INTERVAL_MS);
      };
      setTimeout(check, SESSION_READY_POLL_INTERVAL_MS);
    });
  }

  /**
   * セッションが入力受付可能になるまで待つ。spawn 時に開始した監視 promise を
   * await するだけ。既に ready なら即座に resolve する。
   */
  async waitForSessionReady(sessionId: string): Promise<void> {
    const session = this.getSessionById(sessionId);
    if (!session) return;
    await session.readyPromise;
  }

  /**
   * シグナル送信
   */
  sendSignal(instanceId: string, signal: string): boolean {
    return this.sendInput(instanceId, signal);
  }

  /**
   * リサイズ（表示中 provider のセッション）
   */
  resizeInstance(instanceId: string, cols: number, rows: number): boolean {
    const session = this.getDisplayedSession(instanceId);
    if (!session || !session.isActive || !session.process?.resize) return false;

    try {
      session.process.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  // ====================
  // 出力履歴管理
  // ====================

  private addToOutputHistory(
    session: ActiveAiSession,
    content: string,
    type: 'stdout' | 'stderr' | 'system'
  ): AiOutputLine {
    const outputLine: AiOutputLine = {
      id: `${session.id}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      content,
      timestamp: Date.now(),
      type,
      provider: session.provider,
    };

    const key = this.sessionKey(session.instanceId, session.provider);
    let buffer = this.outputBuffers.get(key);
    if (!buffer) {
      buffer = new RingBuffer<AiOutputLine>(this.config.maxOutputLines);
      this.outputBuffers.set(key, buffer);
    }
    buffer.push(outputLine);
    session.outputHistory = buffer.toArray();

    return outputLine;
  }

  /**
   * 出力履歴を取得。provider 省略時は表示中 provider のものを返す。
   */
  getOutputHistory(instanceId: string, provider?: AiProvider): AiOutputLine[] {
    const targetProvider = provider ?? this.instances.get(instanceId)?.provider;
    if (!targetProvider) return [];
    const buffer = this.outputBuffers.get(
      this.sessionKey(instanceId, targetProvider)
    );
    if (buffer) return buffer.toArray();
    return [];
  }

  clearOutputHistory(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    const buffer = this.outputBuffers.get(
      this.sessionKey(instanceId, instance.provider)
    );
    if (buffer) {
      buffer.clear();
    }
    const session = this.getDisplayedSession(instanceId);
    if (session) {
      session.outputHistory = [];
    }
    return true;
  }

  // ====================
  // インスタンス取得
  // ====================

  getInstance(instanceId: string): AiInstance | undefined {
    const instance = this.instances.get(instanceId);
    return instance ? { ...instance } : undefined;
  }

  getInstancesByRepo(repositoryPath: string): AiInstance[] {
    return Array.from(this.instances.values())
      .filter((i) => i.repositoryPath === repositoryPath)
      .sort((a, b) => a.order - b.order)
      .map((i) => ({ ...i }));
  }

  getPrimaryInstance(repositoryPath: string): AiInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.repositoryPath === repositoryPath && instance.isPrimary) {
        return instance;
      }
    }
    return undefined;
  }

  getSession(instanceId: string): ActiveAiSession | undefined {
    return this.getDisplayedSession(instanceId);
  }

  getSessionById(sessionId: string): ActiveAiSession | undefined {
    const key = this.sessionIdIndex.get(sessionId);
    if (!key) return undefined;
    return this.activeSessions.get(key);
  }

  getInstanceBySessionId(sessionId: string): AiInstance | undefined {
    const session = this.getSessionById(sessionId);
    if (session) {
      return this.getInstance(session.instanceId);
    }
    // hook が渡す session_id は claude 自身のセッションID。dokodemo が
    // --session-id で固定発行した claudeSessionId と一致するため、それで
    // instance を正確に特定できる（cwd フォールバックより precise。sub
    // インスタンスの hook も正しい instance に紐づく）。UUID と dokodemo
    // 内部 ID（claude-N-timestamp）は形式が衝突しないので誤マッチしない。
    for (const instance of this.instances.values()) {
      if (instance.claudeSessionId === sessionId) {
        return instance;
      }
    }
    return undefined;
  }

  isValidSessionId(sessionId: string): boolean {
    return this.sessionIdIndex.has(sessionId);
  }

  // ====================
  // ユーティリティ
  // ====================

  private getNextOrder(repositoryPath: string, isPrimary: boolean): number {
    if (isPrimary) return 0; // プライマリは常に先頭
    const subs = Array.from(this.instances.values()).filter(
      (i) => i.repositoryPath === repositoryPath && !i.isPrimary
    );
    return subs.length === 0
      ? 1
      : Math.max(...subs.map((i) => i.order)) + 1;
  }

  /**
   * リポジトリ全インスタンスを終了
   */
  async closeAllInstancesByRepo(repositoryPath: string): Promise<number> {
    const targets = this.getInstancesByRepo(repositoryPath);
    let closed = 0;

    for (const inst of targets) {
      await this.terminateAllSessions(inst.instanceId);
      this.instances.delete(inst.instanceId);
      this.deleteOutputBuffers(inst.instanceId);
      this.emit('ai-instance-closed', {
        instanceId: inst.instanceId,
        repositoryPath: inst.repositoryPath,
      });
      closed++;
    }

    return closed;
  }

  /**
   * シャットダウン: 全 PTY を kill
   */
  async shutdown(): Promise<void> {
    const tasks: Promise<unknown>[] = [];
    for (const session of this.activeSessions.values()) {
      tasks.push(this.terminateSession(session));
    }
    await Promise.all(tasks);
    this.instances.clear();
    this.outputBuffers.clear();
  }
}
