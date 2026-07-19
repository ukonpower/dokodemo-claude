/**
 * AI タブの指示内容要約サービス
 *
 * AI へ送信されたユーザーのプロンプト（キュー経由・ターミナルへの直接入力
 * の両方）を受け取り、「そのタブの AI に何を頼んだか」の短い日本語要約を
 * Agent SDK（haiku）で生成する。生成した要約は 'summary' イベントで通知し、
 * server.ts が Socket.IO でクライアントへ配信する。
 *
 * - 短い 1 行プロンプトは要約せずそのまま使う（SDK 呼び出し不要）
 * - 生成中に新しいプロンプトが届いたら最新の 1 件だけを保持し、
 *   完了後に続けて処理する（常に最後に送った指示の要約へ収束する）
 *
 * 認証は loop-judge-service と同じく Claude Code CLI のログイン
 * （サブスクリプション）を使うため、API キー系の env は明示的に除外する。
 */

import { EventEmitter } from 'events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanChildEnv } from '../utils/clean-env.js';
import type { AiProvider } from '../types/index.js';

export interface AiActivitySummaryEvent {
  instanceId: string;
  repositoryPath: string;
  provider: AiProvider;
  summary: string;
  timestamp: number;
}

// この長さ以下の 1 行プロンプトは要約せずそのまま表示する
const SHORT_PROMPT_MAX_CHARS = 24;
// SDK へ渡すプロンプト先頭の最大長（指示の核は冒頭にあることが多い）
const PROMPT_MAX_CHARS = 4000;
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
  // 生成中に届いた最新プロンプト（完了後に処理する）
  pendingPrompt: string | null;
  // 最後に受け付けたプロンプト（キュー経路と hook 経路の二重要約を防ぐ）
  lastPrompt: string;
  lastSummary: string;
  inFlight: boolean;
  abort: AbortController | null;
}

function buildSummaryPrompt(provider: AiProvider, userPrompt: string): string {
  const providerName = provider === 'claude' ? 'Claude Code' : 'Codex';
  return [
    `以下はユーザーが ${providerName} CLI（AI コーディングエージェント）に送った指示です。`,
    '何を頼んだかが一目で分かるよう、日本語 1 行で簡潔に要約してください。',
    '',
    '例:「型エラーの修正」「READMEの整備」「ログイン画面の実装」',
    '',
    '- 体言止めで簡潔に。句点・引用符・絵文字は付けない',
    '- 手順が羅列されている場合は目的レベルでまとめる',
    '',
    '## ユーザーの指示',
    '```',
    userPrompt,
    '```',
  ].join('\n');
}

export class AiActivitySummaryService extends EventEmitter {
  private states = new Map<string, InstanceSummaryState>();

  /**
   * AI へプロンプトが送信された通知。
   * server.ts の 'prompt-queue-item-sent' ハンドラ（キュー経由）と
   * UserPromptSubmit hook（直接入力を含む全プロンプト）の両方から呼ばれる。
   */
  notifyPrompt(data: {
    instanceId: string;
    repositoryPath: string;
    provider: AiProvider;
    prompt: string;
  }): void {
    const prompt = data.prompt.trim();
    if (!prompt) return;

    let state = this.states.get(data.instanceId);
    if (!state) {
      state = {
        repositoryPath: data.repositoryPath,
        provider: data.provider,
        pendingPrompt: null,
        lastPrompt: '',
        lastSummary: '',
        inFlight: false,
        abort: null,
      };
      this.states.set(data.instanceId, state);
    }
    // 同じプロンプトが複数経路から届いたら 1 回だけ要約する
    // （キュー送信分は 'prompt-queue-item-sent' と UserPromptSubmit hook の両方で届く）
    if (prompt === state.lastPrompt) return;
    state.lastPrompt = prompt;
    state.repositoryPath = data.repositoryPath;
    state.provider = data.provider;
    state.pendingPrompt = prompt;
    this.processNext(data.instanceId, state);
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
    state.abort?.abort();
    this.states.delete(instanceId);
  }

  /**
   * 保持中の最新プロンプトを 1 件処理する。
   * 実行中なら何もしない（完了時に再度呼ばれる）。
   */
  private processNext(instanceId: string, state: InstanceSummaryState): void {
    if (state.inFlight) return;
    const prompt = state.pendingPrompt;
    if (!prompt) return;
    state.pendingPrompt = null;

    // 短い 1 行プロンプトはそのまま表示する
    if (prompt.length <= SHORT_PROMPT_MAX_CHARS && !prompt.includes('\n')) {
      this.emitSummary(instanceId, state, prompt);
      return;
    }

    void this.runSummary(instanceId, state, prompt);
  }

  private emitSummary(
    instanceId: string,
    state: InstanceSummaryState,
    summary: string
  ): void {
    if (summary === state.lastSummary) return;
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

  private async runSummary(
    instanceId: string,
    state: InstanceSummaryState,
    prompt: string
  ): Promise<void> {
    state.inFlight = true;
    state.abort = new AbortController();

    try {
      const summary = await this.generateSummary(
        state.repositoryPath,
        state.provider,
        prompt,
        state.abort
      );
      // 破棄済み（clearInstance 後）なら通知しない
      if (this.states.get(instanceId) !== state) return;
      if (summary) {
        this.emitSummary(instanceId, state, summary);
      }
    } catch (error) {
      // 要約は補助表示なので失敗しても本体機能には影響させない
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[ai-activity-summary] 要約生成に失敗: ${reason}`);
    } finally {
      state.inFlight = false;
      state.abort = null;
      // 生成中に届いた最新プロンプトがあれば続けて処理する
      if (this.states.get(instanceId) === state) {
        this.processNext(instanceId, state);
      }
    }
  }

  private async generateSummary(
    repositoryPath: string,
    provider: AiProvider,
    userPrompt: string,
    abort: AbortController
  ): Promise<string | null> {
    const prompt = buildSummaryPrompt(
      provider,
      userPrompt.slice(0, PROMPT_MAX_CHARS)
    );
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
