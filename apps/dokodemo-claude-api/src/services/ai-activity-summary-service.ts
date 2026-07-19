/**
 * AI タブの実行内容要約サービス
 *
 * 各 AI インスタンス（タブ）のターミナル出力を受け取り、「そのタブの AI が
 * 今何をしているか」の短い日本語要約を Agent SDK（haiku）で生成する。
 * 生成した要約は 'summary' イベントで通知し、server.ts が Socket.IO で
 * クライアントへ配信する。
 *
 * SDK 呼び出しは高頻度にならないよう間引く:
 * - 前回要約以降に一定量の新規出力がなければ呼ばない
 * - 出力が静止した（作業の区切り）か、大量に出力が溜まった時のみ呼ぶ
 * - インスタンスごとに最小呼び出し間隔を設ける
 *
 * 認証は loop-judge-service と同じく Claude Code CLI のログイン
 * （サブスクリプション）を使うため、API キー系の env は明示的に除外する。
 */

import { EventEmitter } from 'events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanChildEnv } from '../utils/clean-env.js';
import { stripAnsi } from '../utils/strip-ansi.js';
import type { AiProvider } from '../types/index.js';

export interface AiActivitySummaryEvent {
  instanceId: string;
  repositoryPath: string;
  provider: AiProvider;
  summary: string;
  timestamp: number;
}

// 出力がこの時間途切れたら「作業の区切り」とみなして要約する
const QUIET_PERIOD_MS = 3000;
// 前回要約以降の新規出力（ANSI 除去後）がこれ未満なら要約しない
const MIN_NEW_OUTPUT_CHARS = 200;
// 出力が静止しなくても、これだけ溜まったら要約する（長時間作業中の追従用）
const FORCE_OUTPUT_CHARS = 2000;
// SDK 呼び出しの最小間隔（インスタンスごと）
const MIN_INTERVAL_MS = 30_000;
// プロンプトへ渡す出力末尾の最大長
const TAIL_MAX_CHARS = 3000;
// トリガー条件の確認ポーリング間隔
const CHECK_INTERVAL_MS = 1000;
// 要約の生成モデル（コスト配慮で安価なモデルを既定にする）
const SUMMARY_MODEL = 'haiku';

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

interface InstanceSummaryState {
  repositoryPath: string;
  provider: AiProvider;
  // ANSI 除去済み出力の末尾（要約プロンプト用）
  tail: string;
  // 前回要約の開始以降に届いた出力の文字数
  pendingChars: number;
  lastOutputAt: number;
  lastSummaryStartedAt: number;
  lastSummary: string;
  inFlight: boolean;
  timer: NodeJS.Timeout | null;
  abort: AbortController | null;
}

/**
 * PTY 出力チャンクを要約プロンプト向けのプレーンテキストへ整形する。
 * stripAnsi は CSI 本体（"[...m" 等）だけを消すため、残った ESC と
 * その他の制御文字もここで除去する。
 */
function cleanOutputChunk(chunk: string): string {
  return stripAnsi(chunk).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function buildSummaryPrompt(provider: AiProvider, tail: string): string {
  const providerName = provider === 'claude' ? 'Claude Code' : 'Codex';
  return [
    `以下は ${providerName} CLI（AI コーディングエージェント）のターミナル出力の末尾です。`,
    'このエージェントが「今何をしているか」を日本語 20 文字以内の 1 行で要約してください。',
    '',
    '例:「型エラーの修正中」「テストを実行中」「実装方針を検討中」「ユーザーの入力待ち」',
    '',
    '- 体言止めで簡潔に。句点・引用符・絵文字は付けない',
    '- TUI の枠線やスピナー等の描画ノイズは無視する',
    '- 何をしているか判別できない場合は「待機中」とする',
    '',
    '## ターミナル出力（末尾）',
    '```',
    tail,
    '```',
  ].join('\n');
}

export class AiActivitySummaryService extends EventEmitter {
  private states = new Map<string, InstanceSummaryState>();

  /**
   * PTY 出力の到着通知。server.ts の 'ai-output' ハンドラから呼ばれる。
   */
  notifyOutput(data: {
    instanceId: string;
    repositoryPath: string;
    provider: AiProvider;
    content: string;
  }): void {
    let state = this.states.get(data.instanceId);
    if (!state || state.provider !== data.provider) {
      // 新規 or プライマリの provider 切替: 出力の蓄積をリセットする
      if (state?.timer) clearTimeout(state.timer);
      state = {
        repositoryPath: data.repositoryPath,
        provider: data.provider,
        tail: '',
        pendingChars: 0,
        lastOutputAt: 0,
        lastSummaryStartedAt: 0,
        lastSummary: '',
        inFlight: false,
        timer: null,
        abort: null,
      };
      this.states.set(data.instanceId, state);
    }

    const cleaned = cleanOutputChunk(data.content);
    state.lastOutputAt = Date.now();
    if (cleaned.trim().length > 0) {
      state.tail = (state.tail + cleaned).slice(-TAIL_MAX_CHARS);
      state.pendingChars += cleaned.length;
    }
    this.scheduleCheck(data.instanceId, state);
  }

  /**
   * 直近の要約を返す（新規クライアント接続時の初期表示用）
   */
  getSummary(instanceId: string): string | undefined {
    const summary = this.states.get(instanceId)?.lastSummary;
    return summary || undefined;
  }

  /**
   * インスタンス破棄時の後片付け（クローズ・リポジトリ終了時）
   */
  clearInstance(instanceId: string): void {
    const state = this.states.get(instanceId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.abort?.abort();
    this.states.delete(instanceId);
  }

  private scheduleCheck(
    instanceId: string,
    state: InstanceSummaryState
  ): void {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      this.maybeSummarize(instanceId, state);
    }, CHECK_INTERVAL_MS);
  }

  private maybeSummarize(
    instanceId: string,
    state: InstanceSummaryState
  ): void {
    // 実行中なら完了時に再チェックされるのでここでは何もしない
    if (state.inFlight) return;
    if (state.pendingChars < MIN_NEW_OUTPUT_CHARS) return;

    const now = Date.now();
    const sinceLast = now - state.lastSummaryStartedAt;
    if (sinceLast < MIN_INTERVAL_MS) {
      // 最小間隔が明けたタイミングで再チェック
      state.timer = setTimeout(() => {
        state.timer = null;
        this.maybeSummarize(instanceId, state);
      }, MIN_INTERVAL_MS - sinceLast + 100);
      return;
    }

    const quietFor = now - state.lastOutputAt;
    if (quietFor < QUIET_PERIOD_MS && state.pendingChars < FORCE_OUTPUT_CHARS) {
      // まだ出力が流れていて量も少ない: 静止を待つ
      this.scheduleCheck(instanceId, state);
      return;
    }

    void this.runSummary(instanceId, state);
  }

  private async runSummary(
    instanceId: string,
    state: InstanceSummaryState
  ): Promise<void> {
    state.inFlight = true;
    state.lastSummaryStartedAt = Date.now();
    state.pendingChars = 0;
    state.abort = new AbortController();

    try {
      const summary = await this.generateSummary(
        state.repositoryPath,
        state.provider,
        state.tail,
        state.abort
      );
      // 破棄済み（clearInstance 後）なら通知しない
      if (this.states.get(instanceId) !== state) return;
      if (summary && summary !== state.lastSummary) {
        state.lastSummary = summary;
        const event: AiActivitySummaryEvent = {
          instanceId,
          repositoryPath: state.repositoryPath,
          provider: state.provider,
          summary,
          timestamp: Date.now(),
        };
        this.emit('summary', event);
      }
    } catch (error) {
      // 要約は補助表示なので失敗しても本体機能には影響させない
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[ai-activity-summary] 要約生成に失敗: ${reason}`);
    } finally {
      state.inFlight = false;
      state.abort = null;
      // 実行中に新規出力が溜まっていれば次のサイクルを予約
      if (
        this.states.get(instanceId) === state &&
        state.pendingChars >= MIN_NEW_OUTPUT_CHARS
      ) {
        this.scheduleCheck(instanceId, state);
      }
    }
  }

  private async generateSummary(
    repositoryPath: string,
    provider: AiProvider,
    tail: string,
    abort: AbortController
  ): Promise<string | null> {
    const prompt = buildSummaryPrompt(provider, tail);
    // API キー系を除外して、spawn される Claude Code CLI に
    // ログイン認証（サブスクリプション）を使わせる
    const env = cleanChildEnv({
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      cwd: repositoryPath,
      model: SUMMARY_MODEL,
      // ツール不要の構造化出力でも内部で複数ターン消費することがあるため 2 以上
      maxTurns: 4,
      allowedTools: [],
      permissionMode: 'dontAsk',
      env,
      abortController: abort,
      outputFormat: {
        type: 'json_schema',
        schema: SUMMARY_SCHEMA,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const message of query({ prompt, options }) as AsyncIterable<any>) {
      if (message?.type === 'result') {
        if (message.subtype === 'success' && message.structured_output) {
          const summary = (
            message.structured_output as { summary: string }
          ).summary
            .trim()
            .replace(/\n[\s\S]*$/, ''); // 念のため 1 行目だけ使う
          return summary || null;
        }
        throw new Error(`要約失敗: ${message.subtype || 'unknown'}`);
      }
    }
    return null;
  }
}

export const aiActivitySummaryService = new AiActivitySummaryService();
