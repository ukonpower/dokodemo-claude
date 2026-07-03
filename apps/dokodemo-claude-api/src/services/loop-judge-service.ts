/**
 * プロンプトループの AI 判断サービス
 *
 * ループ元のプロンプト（目標）と、直近のセッション出力・開始時コミットからの diff
 * を Agent SDK の query() に流し、continue: boolean を判定させる。
 *
 * ANTHROPIC_API_KEY が必須（Claude Code CLI のログイン認証は使えない）。
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { cleanChildEnv } from '../utils/clean-env.js';

export interface LoopJudgeVerdict {
  continue: boolean;
  reason: string;
}

export interface LoopJudgeInput {
  cwd: string;
  loopPrompt: string;
  iteration: number;
  startedAtCommit?: string;
  outputTail: string;
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    continue: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['continue', 'reason'],
  additionalProperties: false,
} as const;

function buildJudgePrompt(input: LoopJudgeInput): string {
  const diffHint = input.startedAtCommit
    ? `ループ開始時の HEAD は ${input.startedAtCommit} です。必要なら \`git diff ${input.startedAtCommit}..HEAD\` を実行して進捗を確認してください。`
    : '';
  return [
    'あなたは自律ループを監視する判定者です。以下のループプロンプトが目標を達成したかを判断し、',
    'ループを継続すべきか終了すべきかを JSON で返してください。',
    '',
    '## ループプロンプト（目標）',
    input.loopPrompt,
    '',
    `## 完了周回数: ${input.iteration}`,
    diffHint,
    '',
    '## 直近のセッション出力（末尾抜粋）',
    '```',
    input.outputTail || '(出力なし)',
    '```',
    '',
    '## 判定基準',
    '- 目標達成済み → continue: false',
    '- 直近周で進捗なしの空回り（同じ失敗を繰り返している等） → continue: false',
    '- 成果見込みなし（明確に不可能・環境不備） → continue: false',
    '- それ以外（進捗中・目標未達） → continue: true',
    '',
    'reason は 100 文字程度の日本語で、判断根拠を簡潔に書いてください。',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * ループ判定を実行。abortController を渡すとキャンセル可能。
 * 失敗時は throw する。
 */
export async function judgeLoop(
  input: LoopJudgeInput,
  abortController: AbortController
): Promise<LoopJudgeVerdict> {
  const prompt = buildJudgePrompt(input);
  const env = cleanChildEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY が設定されていません');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any = {
    cwd: input.cwd,
    model: 'sonnet',
    maxTurns: 30,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    permissionMode: 'dontAsk',
    env,
    abortController,
    outputFormat: {
      type: 'json_schema',
      schema: VERDICT_SCHEMA,
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const message of query({ prompt, options }) as AsyncIterable<any>) {
    if (message?.type === 'result') {
      if (message.subtype === 'success' && message.structured_output) {
        return message.structured_output as LoopJudgeVerdict;
      }
      throw new Error(`判定失敗: ${message.subtype || 'unknown'}`);
    }
  }

  throw new Error('判定結果が返りませんでした');
}
