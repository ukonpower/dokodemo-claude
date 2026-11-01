import React, { useState } from 'react';
import { GitBranch, FolderPlus, Loader2 } from 'lucide-react';
import ModalShell from '@/shared/components/ModalShell';
import Button from '@/shared/components/Button';
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

  const submitDisabled =
    !isConnected ||
    isCloning ||
    (createMode === 'clone'
      ? !repoUrl.trim() || !repoName.trim()
      : !repoName.trim());

  return (
    <ModalShell title="リポジトリを追加" onClose={handleClose}>
      {/* モード切り替え */}
      <div className={s.modeSelector}>
        <div className={s.modeTabs}>
          {modes.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setCreateMode(key)}
              className={`${s.modeTab} ${
                createMode === key ? s.modeTabActive : s.modeTabInactive
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
              <label htmlFor="modal-repo-url" className={s.fieldLabel}>
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
              <label htmlFor="modal-repo-name" className={s.fieldLabel}>
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
            <label htmlFor="modal-new-repo-name" className={s.fieldLabel}>
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
        <Button
          type="submit"
          variant="primary"
          disabled={submitDisabled}
          className={s.submitButton}
        >
          {isCloning ? (
            <>
              <Loader2 size={16} className={s.submitSpinner} />
              {createMode === 'clone' ? 'クローン中...' : '作成中...'}
            </>
          ) : createMode === 'clone' ? (
            'クローン'
          ) : (
            '作成'
          )}
        </Button>
      </form>
    </ModalShell>
  );
};

export default AddRepositoryModal;
