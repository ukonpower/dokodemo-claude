/**
 * ワークツリーメモの要約サービス
 *
 * ワークツリーに付けられたメモ（自由記述）から「そのワークツリーが何の作業か」の
 * 短い日本語要約を Agent SDK（haiku）で生成する。生成した要約は 'summary'
 * イベントで通知し、server.ts が worktrees-list の再配信でクライアントへ届ける。
 *
 * - 要約はメモ本文とセットで永続化し、メモが変わっていなければ再生成しない
 *   （サーバー再起動のたびに生成し直さない）
 * - 生成は直列キューで 1 件ずつ行う（起動時の一括生成でも同時 spawn しない）
 * - on/off は AI タブの指示内容要約と同じ設定（ai-activity-summary）を共用する
 *
 * 認証は ai-activity-summary-service と同じく Claude Code CLI のログイン
 * （サブスクリプション）を使うため、API キー系の env は明示的に除外する。
 */

import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanChildEnv } from '../utils/clean-env.js';
import type { PersistenceService } from './persistence-service.js';

export interface WorktreeMemoSummaryEvent {
  worktreePath: string;
  summary: string;
}

// 要約の保存先ファイル名（persistence ディレクトリ配下）
const FILE = 'worktree-memo-summaries.json';
// SDK へ渡すメモ本文の最大長
const MEMO_MAX_CHARS = 2000;
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

// 生成元メモとセットで保存し、メモが変わったときだけ再生成する
interface StoredSummary {
  memo: string;
  summary: string;
}

interface WorktreeMemoSummaryDeps {
  // AI タブの指示内容要約と同じ on/off 設定を参照する
  isEnabled: () => boolean;
  // 現在の全メモ（起動時・設定 on 時の突き合わせ用）
  getMemos: () => ReadonlyMap<string, string>;
}

function buildSummaryPrompt(memo: string): string {
  return [
    '以下は git ワークツリー（作業ブランチ）に付けられたメモです。',
    'このワークツリーが何の作業かが一目で分かるよう、文ではなく一言（体言止めの短いフレーズ）でまとめてください。',
    '',
    '例:「型エラー修正」「README整備」「ログイン画面の実装」',
    '',
    '- 句点・引用符・絵文字は付けない',
    '- URL やチェックリストなどの細部は無視し、作業の目的でまとめる',
    '',
    '## メモ',
    '```',
    memo,
    '```',
  ].join('\n');
}

export class WorktreeMemoSummaryService extends EventEmitter {
  private persistence: PersistenceService | null = null;
  private deps: WorktreeMemoSummaryDeps | null = null;
  // key: worktreePath (絶対パス)
  private summaries = new Map<string, StoredSummary>();
  // 生成待ちのメモ（同一パスは最新のメモで上書き）
  private pending = new Map<string, string>();
  private processing = false;

  /**
   * 起動時の初期化。保存済み要約を読み込み、現在のメモと突き合わせる。
   */
  async init(
    persistence: PersistenceService,
    deps: WorktreeMemoSummaryDeps
  ): Promise<void> {
    this.persistence = persistence;
    this.deps = deps;
    const result = await persistence.load<Record<string, StoredSummary>>(FILE);
    if (result.ok && result.value) {
      for (const [worktreePath, stored] of Object.entries(result.value)) {
        if (
          stored &&
          typeof stored.memo === 'string' &&
          typeof stored.summary === 'string' &&
          stored.summary !== ''
        ) {
          this.summaries.set(worktreePath, stored);
        }
      }
    }
    await this.reconcile();
  }

  /**
   * 直近の要約を返す（worktrees-list payload への同梱用）
   */
  getSummary(worktreePath: string): string | undefined {
    return this.summaries.get(worktreePath)?.summary;
  }

  /**
   * 全メモと突き合わせて、消えたメモの要約を掃除し、
   * 未生成・メモ変更分の生成を予約する（起動時・設定 on 時に呼ぶ）。
   */
  async reconcile(): Promise<void> {
    if (!this.deps) return;
    const memos = this.deps.getMemos();
    let removed = false;
    for (const worktreePath of [...this.summaries.keys()]) {
      if (!memos.has(worktreePath)) {
        this.summaries.delete(worktreePath);
        removed = true;
      }
    }
    if (removed) {
      await this.persist();
    }
    if (!this.deps.isEnabled()) return;
    for (const [worktreePath, memo] of memos) {
      if (this.summaries.get(worktreePath)?.memo !== memo) {
        this.enqueue(worktreePath, memo);
      }
    }
  }

  /**
   * メモの保存・削除の通知（WorktreeMemoManager の onChange から呼ばれる）。
   * 空メモは削除として扱い、要約も掃除する。
   */
  notifyMemoChanged(worktreePath: string, memo: string): void {
    if (memo === '') {
      this.pending.delete(worktreePath);
      if (this.summaries.delete(worktreePath)) {
        void this.persist();
      }
      return;
    }
    if (!this.deps?.isEnabled()) return;
    if (this.summaries.get(worktreePath)?.memo === memo) return;
    this.enqueue(worktreePath, memo);
  }

  private enqueue(worktreePath: string, memo: string): void {
    this.pending.set(worktreePath, memo);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.size > 0) {
        const next = this.pending.entries().next().value;
        if (!next) break;
        const [worktreePath, memo] = next;
        this.pending.delete(worktreePath);
        // 生成中に設定 off になったら残りは捨てる（on に戻すと reconcile で再予約される）
        if (!this.deps?.isEnabled()) continue;
        try {
          const summary = await this.generateSummary(worktreePath, memo);
          if (!summary) continue;
          // 生成中にメモが更新/削除されていたら古い結果は捨てる
          if (this.pending.has(worktreePath)) continue;
          if (this.deps.getMemos().get(worktreePath) !== memo) continue;
          this.summaries.set(worktreePath, { memo, summary });
          await this.persist();
          const event: WorktreeMemoSummaryEvent = { worktreePath, summary };
          this.emit('summary', event);
        } catch (error) {
          // 要約は補助表示なので失敗しても本体機能には影響させない
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[worktree-memo-summary] 要約生成に失敗: ${reason}`);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async generateSummary(
    worktreePath: string,
    memo: string
  ): Promise<string | null> {
    // ワークツリーが既に消えている場合は spawn せず諦める
    if (!existsSync(worktreePath)) return null;

    const prompt = buildSummaryPrompt(memo.slice(0, MEMO_MAX_CHARS));
    // API キー系を除外して、spawn される Claude Code CLI に
    // ログイン認証（サブスクリプション）を使わせる
    const env = cleanChildEnv({
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      cwd: worktreePath,
      model: SUMMARY_MODEL,
      // ツール不要の構造化出力でも内部で複数ターン消費することがあるため 2 以上
      maxTurns: 4,
      allowedTools: [],
      permissionMode: 'dontAsk',
      env,
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

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    const data: Record<string, StoredSummary> = {};
    for (const [worktreePath, stored] of this.summaries.entries()) {
      data[worktreePath] = stored;
    }
    const result = await this.persistence.save(FILE, data);
    if (!result.ok) {
      console.warn(
        `[worktree-memo-summary] 保存に失敗: ${result.error.message}`
      );
    }
  }
}

export const worktreeMemoSummaryService = new WorktreeMemoSummaryService();
