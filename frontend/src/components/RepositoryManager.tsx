import React, { useState } from 'react';
import type { GitRepository, ProjectTemplate } from '../types';

interface RepositoryManagerProps {
  repositories: GitRepository[];
  currentRepo: string;
  templates: ProjectTemplate[];
  onCloneRepository: (url: string, name: string) => void;
  onCreateRepository: (name: string) => void;
  onCreateFromTemplate: (
    templateUrl: string,
    projectName: string,
    createInitialCommit: boolean,
    updatePackageJson: boolean
  ) => void;
  onSaveTemplate: (name: string, url: string, description?: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onSwitchRepository: (path: string) => void;
  isConnected: boolean;
}

const RepositoryManager: React.FC<RepositoryManagerProps> = ({
  repositories,
  currentRepo,
  templates,
  onCloneRepository,
  onCreateRepository,
  onCreateFromTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  onSwitchRepository,
  isConnected,
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [createMode, setCreateMode] = useState<'clone' | 'new' | 'template'>(
    'clone'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // テンプレート作成用のstate
  const [templateUrl, setTemplateUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [createInitialCommit, setCreateInitialCommit] = useState(true);
  const [updatePackageJson, setUpdatePackageJson] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [showTemplateManager, setShowTemplateManager] = useState(false);

  // テンプレート登録用のstate
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateUrl, setNewTemplateUrl] = useState('');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (createMode === 'template') {
      if (!templateUrl.trim() || !projectName.trim()) return;
      setIsCloning(true);
      onCreateFromTemplate(
        templateUrl.trim(),
        projectName.trim(),
        createInitialCommit,
        updatePackageJson
      );
      // テンプレート作成完了後、プロジェクト名のみリセット
      setTimeout(() => {
        setIsCloning(false);
        setProjectName('');
      }, 3000);
    } else if (createMode === 'new') {
      if (!repoName.trim()) return;
      setIsCloning(true);
      onCreateRepository(repoName);
      setTimeout(() => {
        setIsCloning(false);
        setRepoName('');
      }, 3000);
    } else {
      if (!repoUrl.trim() || !repoName.trim()) return;
      setIsCloning(true);
      onCloneRepository(repoUrl, repoName);
      setTimeout(() => {
        setIsCloning(false);
        setRepoUrl('');
        setRepoName('');
      }, 3000);
    }
  };

  const extractRepoName = (url: string): string => {
    try {
      // SSH形式 (git@github.com:user/repo.git) の場合
      if (url.includes('@') && url.includes(':')) {
        const match = url.match(/:([^/]+\/)?([^/]+?)(?:\.git)?$/);
        return match ? match[2] : '';
      }
      // HTTPS形式の場合
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  };

  const handleUrlChange = (url: string) => {
    setRepoUrl(url);
    if (url && !repoName) {
      setRepoName(extractRepoName(url));
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const selected = templates.find((t) => t.id === templateId);
    if (selected) {
      setSelectedTemplateId(templateId);
      setTemplateUrl(selected.url);
    }
  };

  const handleSaveTemplate = () => {
    if (!newTemplateName.trim() || !newTemplateUrl.trim()) return;

    onSaveTemplate(
      newTemplateName.trim(),
      newTemplateUrl.trim(),
      newTemplateDescription.trim() || undefined
    );

    // フォームをリセット
    setNewTemplateName('');
    setNewTemplateUrl('');
    setNewTemplateDescription('');
    setShowTemplateManager(false);
  };

  const getStatusText = (status: GitRepository['status']) => {
    switch (status) {
      case 'ready':
        return '準備完了';
      case 'cloning':
        return 'クローン中...';
      case 'creating':
        return '作成中...';
      case 'error':
        return 'エラー';
      default:
        return '不明';
    }
  };

  // 検索クエリに基づいてリポジトリをフィルタリングし、最終アクセス順にソート
  const filteredRepositories = repositories
    .filter((repo) => {
      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      const name = repo.name.toLowerCase();
      const path = repo.path.toLowerCase();
      const url = repo.url?.toLowerCase() || '';

      return (
        name.includes(query) || path.includes(query) || url.includes(query)
      );
    })
    .sort((a, b) => {
      // localStorageから最終アクセス時刻を取得
      const lastAccessTimes = JSON.parse(
        localStorage.getItem('repo-last-access') || '{}'
      );
      const timeA = lastAccessTimes[a.path] || 0;
      const timeB = lastAccessTimes[b.path] || 0;

      // 最終アクセス時刻の降順でソート（最近アクセスしたものが上）
      return timeB - timeA;
    });

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* 既存プロジェクト一覧 */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-bold text-white">Projects</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* 検索入力 */}
            {repositories.length > 0 && (
            <div className="relative flex-1 sm:max-w-md">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="プロジェクトを検索..."
                className="w-full px-4 py-2 pl-10 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-sm focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
              />
              <svg
                className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              {/* クリアボタン */}
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  title="検索をクリア"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}
          </div>
        </div>
        {repositories.length === 0 ? (
          <div className="text-center py-8 sm:py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="m8 10 4 4 4-4"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-white">
              プロジェクトがありません
            </h3>
            <p className="mt-1 text-sm text-gray-300">
              下のフォームから新しいリポジトリをクローンしてください
            </p>
          </div>
        ) : filteredRepositories.length === 0 ? (
          <div className="text-center py-8 sm:py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-white">
              検索結果なし
            </h3>
            <p className="mt-1 text-sm text-gray-300">
              「{searchQuery}」に一致するプロジェクトが見つかりませんでした
            </p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-dark-bg-tertiary border border-dark-border-light rounded-md hover:bg-dark-bg-hover hover:border-dark-border-focus focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-focus transition-all duration-150"
            >
              検索をクリア
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filteredRepositories.map((repo) => (
              <div
                key={repo.path}
                className={`relative group cursor-pointer bg-dark-bg-secondary border rounded-lg p-4 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 overflow-hidden ${
                  currentRepo === repo.path
                    ? 'border-dark-border-focus bg-dark-bg-tertiary shadow-lg'
                    : 'border-dark-border-light hover:border-dark-border-focus'
                }`}
                onClick={() => onSwitchRepository(repo.path)}
              >
                <div className="flex flex-col space-y-2">
                  <div className="flex items-center space-x-2">
                    <svg
                      className="h-4 w-4 text-gray-400 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="m8 10 4 4 4-4"
                      />
                    </svg>
                    <h3 className="text-base font-medium text-white truncate">
                      {repo.name}
                    </h3>
                  </div>
                  <div className="space-y-1">
                    {repo.url && (
                      <p className="text-xs text-gray-400 truncate">
                        {repo.url}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 truncate">
                      {repo.path}
                    </p>
                  </div>
                </div>

                {/* ステータスラベル（右上貼り付け） */}
                <span
                  className={`absolute top-0 right-0 inline-block px-1.5 py-0.5 text-xs font-light rounded-bl ${
                    repo.status === 'ready'
                      ? 'bg-green-900 text-green-300'
                      : repo.status === 'cloning' || repo.status === 'creating'
                        ? 'bg-yellow-900 text-yellow-300'
                        : 'bg-red-900 text-red-300'
                  }`}
                >
                  {getStatusText(repo.status)}
                </span>

                {/* 選択インジケーター */}
                {currentRepo === repo.path && (
                  <div className="absolute top-1.5 left-1.5">
                    <div className="h-2 w-2 bg-dark-accent-green rounded-full"></div>
                  </div>
                )}

                {/* ホバー時のオーバーレイ */}
                <div className="absolute inset-0 bg-dark-bg-hover bg-opacity-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* リポジトリ追加セクション */}
      <div className="border-t border-dark-border-DEFAULT pt-6 sm:pt-8">
        <div className="bg-dark-bg-secondary rounded-xl p-6 sm:p-8 border border-dark-border-light shadow-xl">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <svg
              className="h-5 w-5 mr-2 text-dark-accent-green"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              />
            </svg>
            新しいリポジトリを追加
          </h3>

          {/* モード切り替えタブ */}
          <div className="flex mb-6 bg-dark-bg-primary rounded-lg p-1 border border-dark-border-light">
            <button
              type="button"
              onClick={() => setCreateMode('clone')}
              className={`flex-1 py-2 px-4 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 ${
                createMode === 'clone'
                  ? 'bg-dark-bg-tertiary text-white shadow-md border border-dark-border-light'
                  : 'text-dark-text-secondary hover:text-white hover:bg-dark-bg-hover'
              }`}
            >
              クローン
            </button>
            <button
              type="button"
              onClick={() => setCreateMode('template')}
              className={`flex-1 py-2 px-4 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 ${
                createMode === 'template'
                  ? 'bg-dark-bg-tertiary text-white shadow-md border border-dark-border-light'
                  : 'text-dark-text-secondary hover:text-white hover:bg-dark-bg-hover'
              }`}
            >
              テンプレート
            </button>
            <button
              type="button"
              onClick={() => setCreateMode('new')}
              className={`flex-1 py-2 px-4 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 ${
                createMode === 'new'
                  ? 'bg-dark-bg-tertiary text-white shadow-md border border-dark-border-light'
                  : 'text-dark-text-secondary hover:text-white hover:bg-dark-bg-hover'
              }`}
            >
              新規作成
            </button>
          </div>

          <p className="text-sm text-gray-300 mb-6">
            {createMode === 'clone'
              ? 'GitHubやその他のGitリポジトリをクローンして新しいプロジェクトを開始します'
              : createMode === 'template'
                ? 'テンプレートリポジトリから新しいプロジェクトを作成します'
                : '新しいGitリポジトリを作成して、プロジェクトを開始します'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              {/* クローンモード */}
              {createMode === 'clone' && (
                <>
                  <div>
                    <label
                      htmlFor="repo-url"
                      className="block text-sm font-medium text-gray-200 mb-2"
                    >
                      GitリポジトリURL
                    </label>
                    <input
                      id="repo-url"
                      type="text"
                      value={repoUrl}
                      onChange={(e) => handleUrlChange(e.target.value)}
                      placeholder="https://github.com/user/repo.git または git@github.com:user/repo.git"
                      className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                      disabled={!isConnected || isCloning}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="repo-name"
                      className="block text-sm font-medium text-gray-200 mb-2"
                    >
                      プロジェクト名
                    </label>
                    <input
                      id="repo-name"
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="プロジェクト名"
                      className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                      disabled={!isConnected || isCloning}
                    />
                  </div>
                </>
              )}

              {/* テンプレートモード */}
              {createMode === 'template' && (
                <>
                  {/* 登録済みテンプレート選択 */}
                  {templates.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-200">
                          登録済みテンプレート
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setShowTemplateManager(!showTemplateManager)
                          }
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          {showTemplateManager ? '閉じる' : '管理'}
                        </button>
                      </div>
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => handleTemplateSelect(e.target.value)}
                        className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150"
                        disabled={!isConnected || isCloning}
                      >
                        <option value="">選択してください</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                            {template.description &&
                              ` - ${template.description}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* テンプレート管理UI */}
                  {showTemplateManager && (
                    <div className="bg-dark-bg-primary p-4 rounded-lg border border-dark-border-light space-y-3">
                      <h4 className="text-sm font-medium text-gray-200">
                        新しいテンプレートを登録
                      </h4>
                      <input
                        type="text"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        placeholder="テンプレート名"
                        className="w-full px-3 py-2 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-dark-accent-blue"
                      />
                      <input
                        type="text"
                        value={newTemplateUrl}
                        onChange={(e) => setNewTemplateUrl(e.target.value)}
                        placeholder="git@github.com:user/repo.git"
                        className="w-full px-3 py-2 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-dark-accent-blue"
                      />
                      <input
                        type="text"
                        value={newTemplateDescription}
                        onChange={(e) =>
                          setNewTemplateDescription(e.target.value)
                        }
                        placeholder="説明（任意）"
                        className="w-full px-3 py-2 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-dark-accent-blue"
                      />
                      <button
                        type="button"
                        onClick={handleSaveTemplate}
                        disabled={
                          !newTemplateName.trim() || !newTemplateUrl.trim()
                        }
                        className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                      >
                        登録
                      </button>

                      {/* 登録済みテンプレート一覧 */}
                      {templates.length > 0 && (
                        <div className="pt-3 border-t border-dark-border-light">
                          <h5 className="text-xs font-medium text-gray-300 mb-2">
                            登録済みテンプレート
                          </h5>
                          <div className="space-y-2">
                            {templates.map((template) => (
                              <div
                                key={template.id}
                                className="flex items-center justify-between bg-dark-bg-tertiary p-2 rounded text-xs"
                              >
                                <div className="flex-1">
                                  <div className="font-medium text-white">
                                    {template.name}
                                  </div>
                                  {template.description && (
                                    <div className="text-gray-400">
                                      {template.description}
                                    </div>
                                  )}
                                  <div className="text-gray-500 truncate">
                                    {template.url}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteTemplate(template.id)
                                  }
                                  className="ml-2 text-red-400 hover:text-red-300"
                                >
                                  削除
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="template-url"
                      className="block text-sm font-medium text-gray-200 mb-2"
                    >
                      テンプレートURL
                    </label>
                    <input
                      id="template-url"
                      type="text"
                      value={templateUrl}
                      onChange={(e) => setTemplateUrl(e.target.value)}
                      placeholder="git@github.com:user/repo.git または上から選択"
                      className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                      disabled={!isConnected || isCloning}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="project-name"
                      className="block text-sm font-medium text-gray-200 mb-2"
                    >
                      プロジェクト名
                    </label>
                    <input
                      id="project-name"
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="my-new-project"
                      className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                      disabled={!isConnected || isCloning}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createInitialCommit}
                        onChange={(e) => setCreateInitialCommit(e.target.checked)}
                        className="mr-2"
                        disabled={!isConnected || isCloning}
                      />
                      初期コミットを作成
                    </label>
                    <label className="flex items-center text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={updatePackageJson}
                        onChange={(e) => setUpdatePackageJson(e.target.checked)}
                        className="mr-2"
                        disabled={!isConnected || isCloning}
                      />
                      package.json を更新（Node.jsプロジェクトの場合）
                    </label>
                  </div>
                </>
              )}

              {/* 新規作成モード */}
              {createMode === 'new' && (
                <div>
                  <label
                    htmlFor="new-repo-name"
                    className="block text-sm font-medium text-gray-200 mb-2"
                  >
                    プロジェクト名
                  </label>
                  <input
                    id="new-repo-name"
                    type="text"
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="プロジェクト名"
                    className="w-full px-4 py-3 border border-dark-border-light bg-dark-bg-tertiary text-white rounded-lg shadow-md focus:outline-none focus:ring-1 focus:ring-dark-accent-blue focus:border-dark-accent-blue hover:border-dark-border-focus text-sm transition-all duration-150 placeholder-dark-text-muted"
                    disabled={!isConnected || isCloning}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={
                  !isConnected ||
                  isCloning ||
                  (createMode === 'clone'
                    ? !repoUrl.trim() || !repoName.trim()
                    : createMode === 'template'
                      ? !templateUrl.trim() || !projectName.trim()
                      : !repoName.trim())
                }
                className="w-full bg-dark-accent-green text-white py-3 px-6 rounded-lg hover:bg-dark-accent-green-hover focus:outline-none focus:ring-1 focus:ring-dark-accent-green focus:ring-offset-2 focus:ring-offset-dark-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-all duration-150 flex items-center justify-center shadow-md"
              >
                {isCloning ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-3 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {createMode === 'clone'
                      ? 'クローン中...'
                      : createMode === 'template'
                        ? 'テンプレートから作成中...'
                        : '作成中...'}
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                    {createMode === 'clone'
                      ? 'リポジトリをクローン'
                      : createMode === 'template'
                        ? 'テンプレートから作成'
                        : 'リポジトリを作成'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 現在のプロジェクト表示 */}
      {currentRepo && (
        <div className="pt-4 border-t border-dark-border-DEFAULT">
          <p className="text-xs text-dark-text-secondary mb-1">
            現在のプロジェクト:
          </p>
          <p className="text-sm font-medium text-white truncate">
            {currentRepo.split('/').pop()}
          </p>
        </div>
      )}
    </div>
  );
};

export default RepositoryManager;
