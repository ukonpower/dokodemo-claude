/**
 * フォントサイズプリセット
 */
export type FontSizePreset = 'small' | 'medium' | 'large';

/**
 * パーミッションモード
 */
export type PermissionMode = 'disabled' | 'auto' | 'dangerous';

/**
 * アプリケーション設定
 */
export interface AppSettings {
  fontSizePreset: FontSizePreset;
  permissionMode?: PermissionMode;
}

/**
 * デフォルト設定
 */
export const DEFAULT_SETTINGS: AppSettings = {
  fontSizePreset: 'medium',
};

/**
 * フォントサイズプリセットに対応するピクセル値を取得
 */
export function getFontSizeFromPreset(
  preset: FontSizePreset,
  isLargeScreen: boolean
): number {
  const sizes = {
    small: { large: 9, small: 8 },
    medium: { large: 11, small: 9 },
    large: { large: 14, small: 12 },
  };
  return isLargeScreen ? sizes[preset].large : sizes[preset].small;
}
