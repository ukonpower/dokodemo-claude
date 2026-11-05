/**
 * AI が止まったときの Web Push 通知本文を Agent SDK（haiku）で生成するサービス
 *
 * Stop は「完了」とは限らない（委譲して作業が続いている、判断を求めている等）。
 * 応答を切り出すだけでは読み手が知りたいこと（どうなったか・自分の出番か）を
 * 1 文にできないため、指示と最後の応答を読ませて本文を書かせる。
 *
 * 認証は ai-activity-summary-service と同じく Claude Code CLI のログイン
 * （サブスクリプション）を使うため、API キー系の env は明示的に除外する。
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanChildEnv } from '../utils/clean-env.js';
import {
  deleteAgentSdkTranscript,
  getSummaryScratchCwd,
} from '../utils/agent-sdk-transcript.js';
import { toPlainText } from '../utils/hook-notification.js';

export interface StopNotificationContext {
  // ai-activity-summary-service の要約。指示が「1」「Aでお願い」だけのときの件名の手がかり
  activitySummary?: string;
  userPrompt?: string;
  assistantText: string;
}

// 生成の所要時間は実セッション 8 件で 3.2〜8.6 秒。これを超えたら待たずに本文の代替で送る
const GENERATE_TIMEOUT_MS = 15 * 1000;
const USER_PROMPT_MAX_CHARS = 800;
// 結論は冒頭に、ユーザーへの依頼は末尾に書かれやすいので、長い応答は両端を残す
const RESPONSE_HEAD_CHARS = 1500;
const RESPONSE_TAIL_CHARS = 500;
const NOTIFICATION_MODEL = 'haiku';
// 暴走した出力だけを止める上限。バナーに収める省略は表示幅を知っている OS に任せる
// （文字数で切ると半角が多い文は早く切れ、「始めました」等の肝心な末尾を失う。全文は通知を開けば読める）
const GENERATED_BODY_MAX = 80;

const NOTIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
  },
  required: ['body'],
  additionalProperties: false,
} as const;

function excerptResponse(text: string): string {
  if (text.length <= RESPONSE_HEAD_CHARS + RESPONSE_TAIL_CHARS) {
    return text;
  }
  const head = text.slice(0, RESPONSE_HEAD_CHARS);
  const tail = text.slice(-RESPONSE_TAIL_CHARS);
  return `${head}\n（中略）\n${tail}`;
}

function buildNotificationPrompt(context: StopNotificationContext): string {
  const lines = [
    'AI コーディングエージェントが動きを止めました。離席中のユーザーのスマホに届く通知の本文を 1 文で書いてください。',
    '読み手が知りたいのは「何がどうなったか」と「自分が何かする必要があるか」です。',
    '',
    'エージェントの最後の応答を読み、いちばん当てはまる形で書いてください。',
    '- 頼まれたことが終わった → 何が終わったかを書く（例: ログイン画面の実装が終わりました）',
    '- 質問に答えた → 答えの結論を書く（例: iOS では from 表示を消せません）',
    '- 別の場所で作業を始めて、まだ続いている → 何を始めたかを書く（例: リンク確認の削除をワークツリーで始めました）',
    '- ユーザーの確認・判断・操作が必要 → してほしいことをそのまま書く（例: PR を確認してマージしてください）',
    '- 失敗した、未解決のまま止まった → 何で詰まったかを書く（例: 型エラーが解消できず止まりました）',
    '',
    'ルール:',
    // iPhone のバナーは全角 40 字ほどで省略される。指定字数は超えることがあるので短めに指定する
    '- 30 字以内の 1 文。補足を足すより、結果だけを短く書く',
    '- 応答の主な結果を書く。末尾の補足や細かい残件を主役にしない',
    '- 応答に書かれていないこと（所要時間の見込み、次の予定など）を足さない',
    '- リポジトリ名は別に表示されるので書かない',
    '- ファイル名・行番号・関数名より、人が読んで分かる言葉を使う',
    '- 前置きや説明のテキストは書かず、直ちに StructuredOutput ツールだけを呼んで回答する',
    '',
  ];

  if (context.activitySummary) {
    lines.push('## このセッションの取り組み', context.activitySummary, '');
  }
  if (context.userPrompt) {
    const userPrompt = context.userPrompt.slice(0, USER_PROMPT_MAX_CHARS);
    lines.push('## ユーザーの指示', '```', userPrompt, '```', '');
  }
  lines.push(
    '## エージェントの最後の応答',
    '```',
    excerptResponse(context.assistantText),
    '```'
  );

  return lines.join('\n');
}

/**
 * 通知本文を生成する。通知そのものは止めたくないので、失敗時は例外にせず null を返す
 */
export async function generateStopNotificationBody(
  context: StopNotificationContext
): Promise<string | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), GENERATE_TIMEOUT_MS);

  // 通知用のセッションを /resume の履歴に混ぜないよう隔離 cwd で実行し、完了後に消す
  const scratchCwd = getSummaryScratchCwd();
  let sessionId: string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any = {
    cwd: scratchCwd,
    model: NOTIFICATION_MODEL,
    // モデルはテキスト回答→Stop hook催促→ツール呼び出しで2〜3ターン消費が常態のため余裕を持たせる
    maxTurns: 8,
    allowedTools: [],
    permissionMode: 'dontAsk',
    // API キーがあると従量課金が優先されるため、ログイン認証を使わせる
    env: cleanChildEnv({
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
    }),
    abortController: abort,
    outputFormat: {
      type: 'json_schema',
      schema: NOTIFICATION_SCHEMA,
    },
  };

  try {
    const prompt = buildNotificationPrompt(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const message of query({ prompt, options }) as AsyncIterable<any>) {
      if (typeof message?.session_id === 'string') {
        sessionId = message.session_id;
      }
      if (message?.type !== 'result') continue;

      if (message.subtype !== 'success' || !message.structured_output) {
        throw new Error(`生成失敗: ${message.subtype || 'unknown'}`);
      }
      const { body } = message.structured_output as { body: string };
      const plainBody = toPlainText(body, GENERATED_BODY_MAX);
      if (plainBody) {
        return plainBody;
      }
      return null;
    }
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[stop-notification] 通知本文の生成に失敗: ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
    void deleteAgentSdkTranscript(scratchCwd, sessionId);
  }
}
