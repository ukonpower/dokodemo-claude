/**
 * AI タブの指示内容要約サービス
 *
 * UserPromptSubmit hook 経由で届いたユーザープロンプトをインスタンスごとに
 * 蓄積し、「そのセッションが何に取り組んでいるか」の短い日本語要約を
 * Agent SDK（haiku）で生成する。生成した要約は 'summary' イベントで通知し、
 * server.ts が Socket.IO でクライアントへ配信する。
 *
 * - 生成はクールダウン制: セッション最初のプロンプトは即時生成し、以降は
 *   クールダウン中はプロンプトを蓄積するだけにして、クールダウン明けに
 *   蓄積分をまとめて再生成する（毎プロンプトでは生成しない）
 * - 設定（enabled）で生成の on/off を切り替えられる（persistence に保存）
 *
 * 認証は loop-judge-service と同じく Claude Code CLI のログイン
 * （サブスクリプション）を使うため、API キー系の env は明示的に除外する。
 */

import { EventEmitter } from 'events';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanChildEnv } from '../utils/clean-env.js';
import type { PersistenceService } from './persistence-service.js';
import type { AiProvider } from '../types/index.js';

export interface AiActivitySummaryEvent {
  instanceId: string;
  repositoryPath: string;
  provider: AiProvider;
  summary: string;
  timestamp: number;
}

interface AiActivitySummarySettings {
  enabled: boolean;
}

// 設定の保存先ファイル名（persistence ディレクトリ配下）
const SETTINGS_FILE = 'ai-activity-summary-settings.json';
// 前回生成からこの時間が経つまでは再生成しない（蓄積のみ）
const COOLDOWN_MS = 5 * 60 * 1000;
// 要約の入力に使う直近プロンプトの最大件数
const MAX_PROMPTS = 5;
// SDK へ渡す 1 プロンプトあたりの最大長（指示の核は冒頭にあることが多い）
const PROMPT_MAX_CHARS = 1500;
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
  // このセッションで受け取った指示（直近 MAX_PROMPTS 件）
  prompts: string[];
  // 前回生成後に新しい指示が届いたか
  dirty: boolean;
  // 最後に生成を開始した時刻（0 = 未生成）
  lastGeneratedAt: number;
  lastSummary: string;
  inFlight: boolean;
  abort: AbortController | null;
  // クールダウン明けの再生成予約
  cooldownTimer: NodeJS.Timeout | null;
}

function buildSummaryPrompt(
  provider: AiProvider,
  prompts: string[],
  previousSummary: string
): string {
  const providerName = provider === 'claude' ? 'Claude Code' : 'Codex';
  const lines = [
    `以下はユーザーが ${providerName} CLI（AI コーディングエージェント）にこのセッションで送った指示です（古い順）。`,
    'このセッションが何に取り組んでいるかが一目で分かるよう、文ではなく一言（体言止めの短いフレーズ）でまとめてください。',
    '',
    '例:「型エラー修正」「README整備」「ログイン画面の実装」',
    '',
    '- 句点・引用符・絵文字は付けない',
    '- 最新の指示を重視しつつ、単発の脇道ではなくセッション全体の取り組みでまとめる',
    '- 前置きや説明のテキストは書かず、直ちに StructuredOutput ツールだけを呼んで回答する',
  ];
  if (previousSummary) {
    lines.push(
      `- 前回の要約は「${previousSummary}」。取り組みが変わっていなければ同じ要約を返してよい`
    );
  }
  lines.push('');
  prompts.forEach((prompt, index) => {
    lines.push(`## 指示${index + 1}`, '```', prompt, '```', '');
  });
  return lines.join('\n');
}

export class AiActivitySummaryService extends EventEmitter {
  private states = new Map<string, InstanceSummaryState>();
  private persistence: PersistenceService | null = null;
  private enabled = true;

  /**
   * 起動時の初期化。保存済み設定（enabled）を読み込む。
   */
  async init(persistence: PersistenceService): Promise<void> {
    this.persistence = persistence;
    const result =
      await persistence.load<AiActivitySummarySettings>(SETTINGS_FILE);
    if (result.ok && result.value) {
      this.enabled = result.value.enabled !== false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 要約生成の on/off を切り替えて永続化する。
   * off にした時点で実行中の生成・予約済みの再生成は中断する。
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) {
      for (const state of this.states.values()) {
        state.abort?.abort();
        if (state.cooldownTimer) {
          clearTimeout(state.cooldownTimer);
          state.cooldownTimer = null;
        }
        state.dirty = false;
      }
    }
    if (this.persistence) {
      await this.persistence.save<AiActivitySummarySettings>(SETTINGS_FILE, {
        enabled,
      });
    }
  }

  /**
   * AI へプロンプトが送信された通知。
   * UserPromptSubmit hook（server.ts の handleAiHookEvent）から呼ばれる。
   */
  notifyPrompt(data: {
    instanceId: string;
    repositoryPath: string;
    provider: AiProvider;
    prompt: string;
  }): void {
    if (!this.enabled) return;
    const prompt = data.prompt.trim();
    if (!prompt) return;

    let state = this.states.get(data.instanceId);
    if (!state) {
      state = {
        repositoryPath: data.repositoryPath,
        provider: data.provider,
        prompts: [],
        dirty: false,
        lastGeneratedAt: 0,
        lastSummary: '',
        inFlight: false,
        abort: null,
        cooldownTimer: null,
      };
      this.states.set(data.instanceId, state);
    }
    state.repositoryPath = data.repositoryPath;
    state.provider = data.provider;
    state.prompts.push(prompt.slice(0, PROMPT_MAX_CHARS));
    if (state.prompts.length > MAX_PROMPTS) {
      state.prompts.splice(0, state.prompts.length - MAX_PROMPTS);
    }
    state.dirty = true;
    this.maybeGenerate(data.instanceId, state);
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
    if (state.cooldownTimer) {
      clearTimeout(state.cooldownTimer);
    }
    this.states.delete(instanceId);
  }

  /**
   * 生成条件が揃っていれば要約生成を開始する。
   * クールダウン中なら明けたタイミングに再生成を予約する。
   */
  private maybeGenerate(instanceId: string, state: InstanceSummaryState): void {
    if (!this.enabled || state.inFlight || !state.dirty) return;

    const wait = state.lastGeneratedAt + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      if (!state.cooldownTimer) {
        state.cooldownTimer = setTimeout(() => {
          state.cooldownTimer = null;
          this.maybeGenerate(instanceId, state);
        }, wait);
      }
      return;
    }

    if (state.cooldownTimer) {
      clearTimeout(state.cooldownTimer);
      state.cooldownTimer = null;
    }
    state.dirty = false;
    state.lastGeneratedAt = Date.now();
    void this.runSummary(instanceId, state, [...state.prompts]);
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
    prompts: string[]
  ): Promise<void> {
    state.inFlight = true;
    state.abort = new AbortController();

    try {
      const summary = await this.generateSummary(
        state.repositoryPath,
        state.provider,
        prompts,
        state.lastSummary,
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
      // 生成中に届いた指示があればクールダウン明けに再生成する
      if (this.states.get(instanceId) === state) {
        this.maybeGenerate(instanceId, state);
      }
    }
  }

  private async generateSummary(
    repositoryPath: string,
    provider: AiProvider,
    prompts: string[],
    previousSummary: string,
    abort: AbortController
  ): Promise<string | null> {
    const prompt = buildSummaryPrompt(provider, prompts, previousSummary);
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
      // モデルはテキスト回答→Stop hook催促→ツール呼び出しで2〜3ターン消費が常態のため余裕を持たせる
      maxTurns: 8,
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
