/**
 * Result型 - Rust風のエラーハンドリングパターン
 * 成功/失敗を型安全に表現する
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * 成功結果を作成
 */
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/**
 * 失敗結果を作成
 */
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Resultから値を取り出す。失敗時はデフォルト値を返す
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Resultの値を変換する
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return result.ok ? Ok(fn(result.value)) : result;
}

/**
 * Resultのエラーを変換する
 */
export function mapError<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  return result.ok ? result : Err(fn(result.error));
}

/**
 * 非同期関数をResult型でラップする
 */
export async function tryAsync<T>(
  fn: () => Promise<T>,
  errorMapper?: (e: unknown) => Error
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return Ok(value);
  } catch (e) {
    const error = errorMapper
      ? errorMapper(e)
      : e instanceof Error
        ? e
        : new Error(String(e));
    return Err(error);
  }
}

/**
 * 同期関数をResult型でラップする
 */
export function trySync<T>(
  fn: () => T,
  errorMapper?: (e: unknown) => Error
): Result<T, Error> {
  try {
    const value = fn();
    return Ok(value);
  } catch (e) {
    const error = errorMapper
      ? errorMapper(e)
      : e instanceof Error
        ? e
        : new Error(String(e));
    return Err(error);
  }
}

/**
 * 複数のResultを結合する。全て成功なら成功、一つでも失敗なら失敗
 */
export function combineResults<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return Ok(values);
}

/**
 * Resultが成功かどうかを型ガードとして判定
 */
export function isOk<T, E>(
  result: Result<T, E>
): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Resultが失敗かどうかを型ガードとして判定
 */
export function isErr<T, E>(
  result: Result<T, E>
): result is { ok: false; error: E } {
  return !result.ok;
}
