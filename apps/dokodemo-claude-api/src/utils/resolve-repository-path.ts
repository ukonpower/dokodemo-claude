import { repositoryIdManager } from '../services/repository-id-manager.js';

/**
 * クライアントからの送信データからリポジトリパスを解決する
 * ridが指定されていればIDからパスを解決し、
 * なければrepositoryPathをそのまま返す
 *
 * @param data クライアントからのイベントデータ
 * @returns 解決されたリポジトリパス、解決できなければundefined
 */
export function resolveRepositoryPath(data: {
  rid?: string;
  repositoryPath?: string;
}): string | undefined {
  // ridが指定されている場合はIDからパスを解決
  if (data.rid) {
    return repositoryIdManager.getPath(data.rid);
  }

  // repositoryPathが指定されていればそれを返す
  return data.repositoryPath;
}
