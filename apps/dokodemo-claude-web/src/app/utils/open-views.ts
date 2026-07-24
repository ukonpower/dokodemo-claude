/**
 * 統合コード/git ブラウザ（?view=files）を別タブで開くヘルパー群。
 * 現在の URL（repo 等のクエリ）を引き継いだ上で view 系パラメータだけを付け替える。
 */

/** 統合コード/git ブラウザを別タブで開く */
export function openFileViewerTab(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'files');
  window.open(url.toString(), '_blank');
}

/** 統合コード/git ブラウザを変更モードで別タブに開き、該当ファイルの差分を右ペインに表示 */
export function openDiffFileTab(filename: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'files');
  url.searchParams.set('mode', 'changes');
  url.searchParams.set('file', filename);
  url.searchParams.delete('fullscreen');
  window.open(url.toString(), '_blank');
}

/** 指定ファイル（ワークフローファイル等）を全画面表示で別タブに開く */
export function openWorkflowFileTab(path: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'files');
  url.searchParams.set('file', path);
  url.searchParams.set('fullscreen', '1');
  window.open(url.toString(), '_blank');
}
