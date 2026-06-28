import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { GitRepository, RepoProcessStatus } from '../types';
import ProjectAiStatusBadge from './ProjectAiStatusBadge';
import s from './ProjectSwitcherModal.module.scss';

interface ProjectSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  // repositories はサーバー側で「最近開いた順」にソート済み
  repositories: GitRepository[];
  currentRepo: string;
  repoProcessStatuses?: RepoProcessStatus[];
  onSwitchRepository: (path: string) => void;
}

function getDisplayName(repo: GitRepository): string {
  if (repo.isWorktree && repo.parentRepoName && repo.worktreeBranch) {
    return `${repo.parentRepoName} / ${repo.worktreeBranch}`;
  }
  return repo.name;
}

function ProjectSwitcherModal({
  isOpen,
  onClose,
  repositories,
  currentRepo,
  repoProcessStatuses = [],
  onSwitchRepository,
}: ProjectSwitcherModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((repo) => {
      const display = getDisplayName(repo).toLowerCase();
      const path = repo.path.toLowerCase();
      const name = repo.name.toLowerCase();
      return display.includes(q) || path.includes(q) || name.includes(q);
    });
  }, [repositories, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, selectedIndex, filtered.length]);

  if (!isOpen) return null;

  const statusByPath = new Map(
    repoProcessStatuses.map((status) => [status.repositoryPath, status])
  );

  const submit = (path: string) => {
    onSwitchRepository(path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) =>
        filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1)
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[selectedIndex];
      if (target) submit(target.path);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className={s.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.modal}>
        <div className={s.inputRow}>
          <Search size={16} aria-hidden className={s.inputIcon} />
          <input
            ref={inputRef}
            type="text"
            className={s.input}
            placeholder="プロジェクトを検索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className={s.hint}>↑↓ 選択 / Enter 切替 / Esc 閉じる</span>
        </div>
        <ul ref={listRef} className={s.list}>
          {filtered.length === 0 && (
            <li className={s.empty}>該当するプロジェクトがありません</li>
          )}
          {filtered.map((repo, i) => {
            const isCurrent = currentRepo === repo.path;
            const isSelected = i === selectedIndex;
            const status = statusByPath.get(repo.path);
            const classes = [s.item];
            if (isSelected) classes.push(s.itemSelected);
            if (isCurrent) classes.push(s.itemCurrent);
            return (
              <li
                key={repo.path}
                data-index={i}
                className={classes.join(' ')}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => submit(repo.path)}
                title={repo.path}
              >
                <span className={s.itemName}>{getDisplayName(repo)}</span>
                {isCurrent && <span className={s.itemCurrentTag}>現在</span>}
                <span className={s.itemBadge}>
                  <ProjectAiStatusBadge
                    displayProvider={status?.displayProvider ?? 'claude'}
                    displayAiStatus={status?.displayAiStatus ?? 'ready'}
                    selectedProvider={status?.selectedProvider ?? 'claude'}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default ProjectSwitcherModal;
