/** クリップボードから画像を読み出した結果 */
export type ClipboardImageResult =
  | { status: 'ok'; file: File }
  // navigator.clipboard.read はセキュアコンテキスト（https / localhost）でしか生えない
  | { status: 'unsupported' }
  | { status: 'empty' }
  // 権限拒否など、API はあるが読み出しに失敗した
  | { status: 'error' };

/**
 * クリップボードにある最初の画像を File として読み出す。
 * ユーザー操作（クリック）のハンドラ内から同期的に呼ぶこと（Safari は await を挟むと権限ジェスチャーが切れる）。
 */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.read !== 'function') {
    return { status: 'unsupported' };
  }

  let items: ClipboardItems;
  try {
    items = await clipboard.read();
  } catch {
    return { status: 'error' };
  }

  for (const item of items) {
    let imageType: string | null = null;
    for (const type of item.types) {
      if (type.startsWith('image/')) {
        imageType = type;
        break;
      }
    }
    if (!imageType) continue;

    try {
      const blob = await item.getType(imageType);
      const file = new File([blob], 'clipboard-image', { type: imageType });
      return { status: 'ok', file };
    } catch {
      return { status: 'error' };
    }
  }

  return { status: 'empty' };
}

/** paste イベントの clipboardData から最初の画像ファイルを取り出す。無ければ null */
export function findImageFileInClipboardData(
  data: DataTransfer | null
): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}
