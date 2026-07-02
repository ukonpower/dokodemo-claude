import { useEffect, useState } from 'react';
import { BACKEND_URL } from '../utils/backend-url';

// Anthropic API から取得したモデル。バックエンドの薄いプロキシ経由で取得する
// （API キーはサーバ側の ANTHROPIC_API_KEY を使い、フロントには露出しない）。
export interface AnthropicModel {
  id: string;
  display_name: string;
}

// loading: 取得中 / ready: 取得成功 / unconfigured: API キー未設定 / error: 取得失敗
export type AnthropicModelsStatus =
  | 'loading'
  | 'ready'
  | 'unconfigured'
  | 'error';

export interface AnthropicModelsResult {
  models: AnthropicModel[];
  status: AnthropicModelsStatus;
}

// 起動時に一度だけ叩くため、結果 Promise をモジュールレベルでキャッシュする。
let cachedPromise: Promise<AnthropicModelsResult> | null = null;

function fetchModels(): Promise<AnthropicModelsResult> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async (): Promise<AnthropicModelsResult> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/models/anthropic`);
      // 501: API キー未設定（フロントは「未設定」と表示するだけで壊れない）
      if (res.status === 501) {
        return { models: [], status: 'unconfigured' };
      }
      if (!res.ok) {
        return { models: [], status: 'error' };
      }
      const data = (await res.json()) as { models?: AnthropicModel[] };
      const models = Array.isArray(data.models) ? data.models : [];
      return { models, status: 'ready' };
    } catch {
      return { models: [], status: 'error' };
    }
  })();
  return cachedPromise;
}

/**
 * Anthropic のモデル一覧を取得するフック。
 * 起動時に一度だけプロキシを叩き、結果を全コンポーネントで共有する。
 * 取得失敗・未設定時は空配列を返し、呼び出し側は組み込みモデルへフォールバックする。
 */
export function useAnthropicModels(): AnthropicModelsResult {
  const [result, setResult] = useState<AnthropicModelsResult>({
    models: [],
    status: 'loading',
  });

  useEffect(() => {
    let active = true;
    fetchModels().then((r) => {
      if (active) setResult(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return result;
}
