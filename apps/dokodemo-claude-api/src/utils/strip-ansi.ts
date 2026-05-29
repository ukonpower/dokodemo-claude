/**
 * ANSIエスケープシーケンスを除去する
 */
export function stripAnsi(text: string): string {
  // ANSI制御文字のパターン (ESC [ ... m などの形式)
  const ansiPattern = /\[[0-9;]*[a-zA-Z]/g;
  return text.replace(ansiPattern, '');
}
