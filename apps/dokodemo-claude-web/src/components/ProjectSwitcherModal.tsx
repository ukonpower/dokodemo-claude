import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { GitRepository, RepoProcessStatus } from '../types';
import { fuzzyMatch } from '../utils/fuzzy-match';
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

interface ScoredRepo {
  repo: GitRepository;
  // display 上のマッチ位置（ハイライト用）。空ならハイライト無し。
  matches: number[];
}

function getDisplayName(repo: GitRepository): string {
  if (repo.isWorktree && repo.parentRepoName && repo.worktreeBranch) {
    return `${repo.parentRepoName} / ${repo.worktreeBranch}`;
  }
  return repo.name;
}

// display にマッチした index 集合からハイライト付き要素を組み立てる。
function renderHighlighted(text: string, matches: number[]) {
  if (matches.length === 0) return text;
  const set = new Set(matches);
  const nodes: React.ReactNode[] = [];
  let buf = '';
  let bufHit = false;
  const flush = (i: number) => {
    if (!buf) return;
    nodes.push(
      bufHit ? (
        <mark key={`m-${i}-${buf}`} className={s.itemMatch}>
          {buf}
        </mark>
      ) : (
        <Fragment key={`t-${i}-${buf}`}>{buf}</Fragment>
      )
    );
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (i === 0) {
      buf = text[i];
      bufHit = hit;
      continue;
    }
    if (hit === bufHit) {
      buf += text[i];
    } else {
      flush(i);
      buf = text[i];
      bufHit = hit;
    }
  }
  flush(text.length);
  return nodes;
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

  const filtered = useMemo<ScoredRepo[]>(() => {
    const q = query.trim();
    if (!q) return repositories.map((repo) => ({ repo, matches: [] }));

    const scored: { repo: GitRepository; score: number; matches: number[]; order: number }[] = [];
    repositories.forEach((repo, order) => {
      const display = getDisplayName(repo);
      const displayMatch = fuzzyMatch(q, display);
      // path はハイライトしないが、display で取れない場合の救済として併用する。
      // 表示上は display のマッチだけ強調するため、path 経由ヒット時は matches を空にする。
      const pathMatch = displayMatch ? null : fuzzyMatch(q, repo.path);
      if (displayMatch) {
        scored.push({ repo, score: displayMatch.score + 50, matches: displayMatch.matches, order });
      } else if (pathMatch) {
        scored.push({ repo, score: pathMatch.score, matches: [], order });
      }
    });

    // スコア降順、同点は元の「最近開いた順」を保持。
    scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));
    return scored.map(({ repo, matches }) => ({ repo, matches }));
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

  // 選択したプロジェクトを別タブ（新規タブ）で開く。
  // 現在のタブは今のプロジェクトのまま維持する。
  // URL はオリジンを含む現在の href を基点に `?repo=<path>` を組み立てる
  // （ポートはハードコードしない）。他リポジトリ固有のビュー状態はクリアする。
  const openInNewTab = (path: string) => {
    const url = new URL(window.location.href);
    if (path) {
      url.searchParams.set('repo', path);
    } else {
      url.searchParams.delete('repo');
    }
    url.searchParams.delete('view');
    url.searchParams.delete('file');
    url.searchParams.delete('fullscreen');
    window.open(url.toString(), '_blank', 'noopener');
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
      if (target) {
        // Cmd/Ctrl + Enter で別タブ（VSCode の「横で開く」やブラウザの
        // Cmd/Ctrl+クリック新規タブと同じ修飾キーに合わせる）
        if (e.metaKey || e.ctrlKey) {
          openInNewTab(target.repo.path);
        } else {
          submit(target.repo.path);
        }
      }
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
          <span className={s.hint}>↑↓ 選択 / Enter 切替 / ⌘/Ctrl+Enter 別タブ / Esc 閉じる</span>
        </div>
        <ul ref={listRef} className={s.list}>
          {filtered.length === 0 && (
            <li className={s.empty}>該当するプロジェクトがありません</li>
          )}
          {filtered.map(({ repo, matches }, i) => {
            const isCurrent = currentRepo === repo.path;
            const isSelected = i === selectedIndex;
            const status = statusByPath.get(repo.path);
            const classes = [s.item];
            if (isSelected) classes.push(s.itemSelected);
            if (isCurrent) classes.push(s.itemCurrent);
            const display = getDisplayName(repo);
            return (
              <li
                key={repo.path}
                data-index={i}
                className={classes.join(' ')}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={(e) => {
                  // Cmd/Ctrl + クリックで別タブ表示（ブラウザの新規タブ操作と同じ）
                  if (e.metaKey || e.ctrlKey) {
                    openInNewTab(repo.path);
                  } else {
                    submit(repo.path);
                  }
                }}
                title={repo.path}
              >
                <span className={s.itemName}>{renderHighlighted(display, matches)}</span>
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
