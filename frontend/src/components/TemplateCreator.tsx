import React, { useState } from 'react';

interface TemplateCreatorProps {
  isConnected: boolean;
  onCreateFromTemplate: (
    templateUrl: string,
    projectName: string,
    createInitialCommit: boolean,
    updatePackageJson: boolean
  ) => void;
}

const TemplateCreator: React.FC<TemplateCreatorProps> = ({
  isConnected,
  onCreateFromTemplate,
}) => {
  const [templateUrl, setTemplateUrl] = useState('');
  const [projectName, setProjectName] = useState('');
  const [createInitialCommit, setCreateInitialCommit] = useState(true);
  const [updatePackageJson, setUpdatePackageJson] = useState(true);

  const handleCreate = () => {
    if (!templateUrl.trim() || !projectName.trim()) {
      return;
    }
    onCreateFromTemplate(
      templateUrl.trim(),
      projectName.trim(),
      createInitialCommit,
      updatePackageJson
    );

    // フォームをリセット（プロジェクト名のみ）
    setProjectName('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && templateUrl.trim() && projectName.trim()) {
      handleCreate();
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-dark-border-light">
      <div className="flex items-center mb-3">
        <svg
          className="w-5 h-5 mr-2 text-purple-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="text-sm font-medium text-gray-200">
          テンプレートから新規作成
        </h3>
      </div>

      <div className="space-y-3">
        {/* テンプレートURL */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            テンプレートURL
          </label>
          <input
            type="text"
            value={templateUrl}
            onChange={(e) => setTemplateUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="git@github.com:user/repo.git"
            className="w-full px-3 py-2 bg-gray-900 text-white border border-dark-border-light rounded-md focus:outline-none focus:border-dark-border-focus text-sm"
            disabled={!isConnected}
          />
        </div>

        {/* プロジェクト名 */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            プロジェクト名
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="my-new-project"
            className="w-full px-3 py-2 bg-gray-900 text-white border border-dark-border-light rounded-md focus:outline-none focus:border-dark-border-focus text-sm"
            disabled={!isConnected}
          />
        </div>

        {/* オプション */}
        <div className="space-y-2">
          <label className="flex items-center text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={createInitialCommit}
              onChange={(e) => setCreateInitialCommit(e.target.checked)}
              className="mr-2"
              disabled={!isConnected}
            />
            初期コミットを作成
          </label>

          <label className="flex items-center text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={updatePackageJson}
              onChange={(e) => setUpdatePackageJson(e.target.checked)}
              className="mr-2"
              disabled={!isConnected}
            />
            package.json を更新（Node.jsプロジェクトの場合）
          </label>
        </div>

        {/* 作成ボタン */}
        <button
          onClick={handleCreate}
          disabled={
            !isConnected || !templateUrl.trim() || !projectName.trim()
          }
          className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors duration-200 text-sm font-medium"
        >
          テンプレートから作成
        </button>

        {!isConnected && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-700/30 rounded-lg">
            <p className="text-xs text-red-300">
              サーバーに接続されていません
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateCreator;
