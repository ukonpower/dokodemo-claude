import React, { useState } from 'react';
import { X, GitBranch, FolderPlus } from 'lucide-react';
import s from './AddRepositoryModal.module.scss';

interface AddRepositoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCloneRepository: (url: string, name: string) => void;
  onCreateRepository: (name: string) => void;
  isConnected: boolean;
}

const AddRepositoryModal: React.FC<AddRepositoryModalProps> = ({
  isOpen,
  onClose,
  onCloneRepository,
  onCreateRepository,
  isConnected,
}) => {
  const [createMode, setCreateMode] = useState<'clone' | 'new'>('clone');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [isCloning, setIsCloning] = useState(false);

  const extractRepoName = (url: string): string => {
    try {
      if (url.includes('@') && url.includes(':')) {
        const match = url.match(/:([^/]+\/)?([^/]+?)(?:\.git)?$/);
        return match ? match[2] : '';
      }
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

  const resetForm = () => {
    setRepoUrl('');
    setRepoName('');
    setIsCloning(false);
  };

  const handleClose = () => {
    if (!isCloning) {
      resetForm();
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (createMode === 'new') {
      if (!repoName.trim()) return;
      setIsCloning(true);
      onCreateRepository(repoName);
      setTimeout(() => {
        setIsCloning(false);
        setRepoName('');
        handleClose();
      }, 3000);
    } else {
      if (!repoUrl.trim() || !repoName.trim()) return;
      setIsCloning(true);
      onCloneRepository(repoUrl, repoName);
      setTimeout(() => {
        setIsCloning(false);
        setRepoUrl('');
        setRepoName('');
        handleClose();
      }, 3000);
    }
  };

  if (!isOpen) return null;

  const modes = [
    { key: 'clone' as const, label: 'クローン', icon: GitBranch },
    { key: 'new' as const, label: '新規作成', icon: FolderPlus },
  ];

  return (
    <div
      className={s.overlay}
      onClick={handleClose}
    >
      <div
        className={s.modal}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className={s.header}>
          <h2 className={s.headerTitle}>
            リポジトリを追加
          </h2>
          <button
            onClick={handleClose}
            disabled={isCloning}
            className={s.closeButton}
          >
            <X className={s.closeIcon} />
          </button>
        </div>

        {/* モード切り替え */}
        <div className={s.modeSelector}>
          <div className={s.modeTabs}>
            {modes.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCreateMode(key)}
                className={`${s.modeTab} ${
                  createMode === key
                    ? s.modeTabActive
                    : s.modeTabInactive
                }`}
              >
                <Icon className={s.modeTabIcon} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className={s.form}>
          {/* クローンモード */}
          {createMode === 'clone' && (
            <>
              <div className={s.fieldGroup}>
                <label
                  htmlFor="modal-repo-url"
                  className={s.fieldLabel}
                >
                  GitリポジトリURL
                </label>
                <input
                  id="modal-repo-url"
                  type="text"
                  value={repoUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className={s.textInput}
                  disabled={!isConnected || isCloning}
                  autoFocus
                />
              </div>
              <div className={s.fieldGroup}>
                <label
                  htmlFor="modal-repo-name"
                  className={s.fieldLabel}
                >
                  プロジェクト名
                </label>
                <input
                  id="modal-repo-name"
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="プロジェクト名"
                  className={s.textInput}
                  disabled={!isConnected || isCloning}
                />
              </div>
            </>
          )}

          {/* 新規作成モード */}
          {createMode === 'new' && (
            <div className={s.fieldGroup}>
              <label
                htmlFor="modal-new-repo-name"
                className={s.fieldLabel}
              >
                プロジェクト名
              </label>
              <input
                id="modal-new-repo-name"
                type="text"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="プロジェクト名"
                className={s.textInput}
                disabled={!isConnected || isCloning}
                autoFocus
              />
            </div>
          )}

          {/* 送信ボタン */}
          <button
            type="submit"
            disabled={
              !isConnected ||
              isCloning ||
              (createMode === 'clone'
                ? !repoUrl.trim() || !repoName.trim()
                : !repoName.trim())
            }
            className={s.submitButton}
          >
            {isCloning ? (
              <>
                <svg
                  className={s.submitSpinner}
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className={s.spinnerCircle}
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className={s.spinnerPath}
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                {createMode === 'clone' ? 'クローン中...' : '作成中...'}
              </>
            ) : createMode === 'clone' ? (
              'クローン'
            ) : (
              '作成'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AddRepositoryModal;
