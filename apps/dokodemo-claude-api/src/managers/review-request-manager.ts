/**
 * 評価リクエストマネージャー
 * 親リポジトリ rid → 評価リクエスト一覧 を永続化する。
 * docs/feedback-loop.md の「3. 評価リクエスト」の保存層。
 *
 * 応答時のキュー注入先（発行元パス・プロバイダ）はサーバ内部でのみ使うため、
 * StoredReviewRequest として保持し、クライアントへは toPublicReviewRequest() で
 * 落としてから配信する。
 */

import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { PersistenceError } from '../utils/errors.js';
import type {
  AiProvider,
  ReviewAttachment,
  ReviewRequest,
  ReviewResponse,
} from '../types/index.js';

const FILE = 'review-requests.json';

export interface StoredReviewRequest extends ReviewRequest {
  /** 発行元リポジトリ（worktree の場合あり）の絶対パス。応答プロンプトの注入先 */
  sourcePath: string;
  /** 応答プロンプトを積むキューのプロバイダ */
  provider: AiProvider;
}

interface ReviewRequestsFile {
  /** rid ごとの通し番号カウンタ（削除後も番号を使い回さない） */
  counters: Record<string, number>;
  requests: Record<string, StoredReviewRequest[]>;
}

export function toPublicReviewRequest(
  stored: StoredReviewRequest
): ReviewRequest {
  return {
    id: stored.id,
    rid: stored.rid,
    aim: stored.aim,
    question: stored.question,
    attachments: stored.attachments,
    choices: stored.choices,
    status: stored.status,
    createdAt: stored.createdAt,
    response: stored.response,
    blocking: stored.blocking,
    reflected: stored.reflected,
  };
}

export class ReviewRequestManager {
  private counters = new Map<string, number>();
  // key: 親リポジトリの rid
  private requests = new Map<string, StoredReviewRequest[]>();

  constructor(private readonly persistenceService: PersistenceService) {}

  async initialize(): Promise<void> {
    const result =
      await this.persistenceService.load<ReviewRequestsFile>(FILE);
    if (!result.ok) {
      console.error('[ReviewRequestManager] 復元に失敗:', result.error.message);
      return;
    }
    if (result.value === null) return;

    this.counters.clear();
    this.requests.clear();
    for (const [rid, count] of Object.entries(result.value.counters ?? {})) {
      if (typeof count === 'number') this.counters.set(rid, count);
    }
    for (const [rid, list] of Object.entries(result.value.requests ?? {})) {
      if (Array.isArray(list)) this.requests.set(rid, list);
    }
  }

  /** 新しい順で返す */
  list(rid: string): ReviewRequest[] {
    return (this.requests.get(rid) ?? [])
      .map(toPublicReviewRequest)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(rid: string, requestId: string): StoredReviewRequest | undefined {
    return (this.requests.get(rid) ?? []).find((r) => r.id === requestId);
  }

  /**
   * 応答済みだが反映ターン未配達のリクエストを全 rid 横断で返す。
   * 配達先（発行元パス × プロバイダ）への絞り込みは呼び出し側で行う。
   */
  listUnreflected(): StoredReviewRequest[] {
    const result: StoredReviewRequest[] = [];
    for (const list of this.requests.values()) {
      for (const r of list) {
        if (r.status === 'answered' && !r.reflected) result.push(r);
      }
    }
    return result.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 反映ターンとして配達済みのリクエストに reflected を立てる。
   * 更新できたリクエストを返す（呼び出し側でクライアントへ配信するため）。
   */
  async markReflected(
    refs: { rid: string; requestId: string }[]
  ): Promise<StoredReviewRequest[]> {
    const updated: StoredReviewRequest[] = [];
    for (const ref of refs) {
      const request = this.get(ref.rid, ref.requestId);
      if (request && request.status === 'answered' && !request.reflected) {
        request.reflected = true;
        updated.push(request);
      }
    }
    if (updated.length > 0) {
      await this.persist();
    }
    return updated;
  }

  /**
   * 同じ発行元（sourcePath × provider）に未回答のブロッキング発行が残っているか。
   * ブロッキング発行の応答・削除時、キュー再開の可否判定に使う。
   */
  hasPendingBlocking(sourcePath: string, provider: AiProvider): boolean {
    for (const list of this.requests.values()) {
      if (
        list.some(
          (r) =>
            r.status === 'pending' &&
            r.blocking === true &&
            r.sourcePath === sourcePath &&
            r.provider === provider
        )
      ) {
        return true;
      }
    }
    return false;
  }

  async create(
    rid: string,
    input: {
      aim: string;
      question: string;
      attachments: ReviewAttachment[];
      choices: string[];
      sourcePath: string;
      provider: AiProvider;
      blocking?: boolean;
    }
  ): Promise<Result<StoredReviewRequest, PersistenceError>> {
    const seq = (this.counters.get(rid) ?? 0) + 1;
    this.counters.set(rid, seq);

    const request: StoredReviewRequest = {
      id: String(seq),
      rid,
      aim: input.aim,
      question: input.question,
      attachments: input.attachments,
      choices: input.choices,
      status: 'pending',
      createdAt: Date.now(),
      sourcePath: input.sourcePath,
      provider: input.provider,
      blocking: input.blocking || undefined,
    };

    const list = this.requests.get(rid) ?? [];
    list.push(request);
    this.requests.set(rid, list);

    const persistResult = await this.persist();
    if (!persistResult.ok) return Err(persistResult.error);
    return Ok(request);
  }

  /**
   * 応答を反映して answered にする。未存在・応答済みはエラー文字列を返す。
   */
  async respond(
    rid: string,
    requestId: string,
    response: ReviewResponse
  ): Promise<Result<StoredReviewRequest, PersistenceError | Error>> {
    const request = this.get(rid, requestId);
    if (!request) {
      return Err(new Error(`評価リクエスト #${requestId} が見つかりません`));
    }
    if (request.status === 'answered') {
      return Err(new Error(`評価リクエスト #${requestId} は応答済みです`));
    }

    request.status = 'answered';
    request.response = response;

    const persistResult = await this.persist();
    if (!persistResult.ok) return Err(persistResult.error);
    return Ok(request);
  }

  /** 削除したリクエストを返す（添付画像の後始末を呼び出し側で行うため） */
  async delete(
    rid: string,
    requestId: string
  ): Promise<StoredReviewRequest | undefined> {
    const list = this.requests.get(rid) ?? [];
    const index = list.findIndex((r) => r.id === requestId);
    if (index === -1) return undefined;

    const [removed] = list.splice(index, 1);
    if (list.length === 0) {
      this.requests.delete(rid);
    }
    await this.persist();
    return removed;
  }

  /** リポジトリ削除時の後始末 */
  async removeRepository(rid: string): Promise<void> {
    const hadRequests = this.requests.delete(rid);
    const hadCounter = this.counters.delete(rid);
    if (hadRequests || hadCounter) {
      await this.persist();
    }
  }

  private async persist(): Promise<Result<void, PersistenceError>> {
    const data: ReviewRequestsFile = { counters: {}, requests: {} };
    for (const [rid, count] of this.counters.entries()) {
      data.counters[rid] = count;
    }
    for (const [rid, list] of this.requests.entries()) {
      data.requests[rid] = list;
    }
    return this.persistenceService.save(FILE, data);
  }
}
