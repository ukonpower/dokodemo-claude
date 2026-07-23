import React from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode, Mousewheel } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/free-mode';
import type { GitRepository, RepoProcessStatus } from '@/types';
import ProjectAiStatusBadge from '@/components/ai/ProjectAiStatusBadge';
import s from './RepositorySwitcher.module.scss';

interface RepositorySwitcherProps {
  // repositories はサーバー側で「最近開いた順」にソート済み
  repositories: GitRepository[];
  currentRepo: string;
  repoProcessStatuses?: RepoProcessStatus[];
  onSwitchRepository: (path: string) => void;
}

/**
 * リポジトリの表示名を取得
 * ワークツリーの場合は「親リポジトリ名 / ブランチ名」形式
 */
function getDisplayName(repo: GitRepository): string {
  if (repo.isWorktree && repo.parentRepoName && repo.worktreeBranch) {
    return `${repo.parentRepoName} / ${repo.worktreeBranch}`;
  }
  return repo.name;
}

const RepositorySwitcher: React.FC<RepositorySwitcherProps> = ({
  repositories,
  currentRepo,
  repoProcessStatuses = [],
  onSwitchRepository,
}) => {
  // リポジトリがない場合は表示しない
  if (repositories.length === 0) {
    return null;
  }

  const processStatusByPath = new Map(
    repoProcessStatuses.map((status) => [status.repositoryPath, status])
  );

  return (
    <div className={s.container}>
      <Swiper
        modules={[FreeMode, Mousewheel]}
        freeMode={{ enabled: true, sticky: false }}
        mousewheel={{ forceToAxis: true }}
        slidesPerView="auto"
        spaceBetween={6}
      >
        {repositories.map((repo) => {
          const isActive = currentRepo === repo.path;
          const status = processStatusByPath.get(repo.path);

          return (
            <SwiperSlide key={repo.path}>
              <a
                href={`?repo=${encodeURIComponent(repo.path)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
                    return;
                  }
                  e.preventDefault();
                  onSwitchRepository(repo.path);
                }}
                className={`${s.tab} ${
                  isActive ? s.tabActive : s.tabInactive
                }`}
                title={repo.path}
              >
                <div className={s.tabHeader}>
                  <span className={s.tabName}>{getDisplayName(repo)}</span>
                  <div className={s.tabStatus}>
                    <ProjectAiStatusBadge
                      displayProvider={status?.displayProvider ?? 'claude'}
                      displayAiStatus={status?.displayAiStatus ?? 'ready'}
                      selectedProvider={status?.selectedProvider ?? 'claude'}
                    />
                  </div>
                </div>
              </a>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
};

export default RepositorySwitcher;
