import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Send, Inbox, GitBranch, FileText, ExternalLink } from 'lucide-react';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { repositoryIdMap } from '@/shared/utils/repository-id-map';
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import { useFileManagerContext } from '@/features/files/providers/FilesProvider';
import { useGitDiffContext } from '@/features/git/providers/GitProvider';
import { openDiffFileTab } from '@/app/utils/open-views';
import s from './SidePanel.module.scss';
import FileManager from './FileManager';
import DiffSummary from '@/features/git/components/DiffSummary';
import MarkdownPanel from './MarkdownPanel';
import SectionFullscreen from '@/shared/components/SectionFullscreen';
import MarkdownFullscreen from './MarkdownFullscreen';


type SectionId = 'preview' | 'files' | 'md' | 'git';

const TAB_KEY_PREFIX = 'dokodemo-sidepanel-tab';

function getTabKey(repo: string): string {
  return repo ? `${TAB_KEY_PREFIX}-${repo}` : TAB_KEY_PREFIX;
}

const ICON_SIZE = 13;
// lg 以上（右列配置）ではセクション縦積み表示、lg 未満ではタブ切替表示
const LG_MEDIA_QUERY = '(min-width: 860px)';

const SECTION_IDS: SectionId[] = ['preview', 'files', 'md', 'git'];

interface SidePanelProps {
  /** 画像に赤入れする（Lightbox 経由。未指定なら非表示） */
  onAnnotateImage?: (imageUrl: string) => void;
}

function getStoredTab(repo: string): SectionId {
  try {
    const v = localStorage.getItem(getTabKey(repo));
    if (v && (SECTION_IDS as string[]).includes(v)) {
      return v as SectionId;
    }
  } catch {
    // ignore
  }
  return 'preview';
}

interface SectionDef {
  id: SectionId;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  count: number;
  body: React.ReactNode;
  fullscreenBody: React.ReactNode;
}

const SidePanel: React.FC<SidePanelProps> = (props) => {
  // リポジトリ関連
  const { repository } = useRepositoryContext();
  const { currentRepo } = repository;
  const rid = repositoryIdMap.getRid(currentRepo) ?? '';

  // ファイル管理関連
  const {
    files,
    refreshFiles: onRefreshFiles,
    deleteFile: onDeleteFile,
  } = useFileManagerContext();

  // Git差分関連
  const {
    diffSummary,
    diffSummaryLoading,
    diffSummaryError,
    refreshDiffSummary: onRefreshDiffSummary,
  } = useGitDiffContext();
  // 統合コード/git ブラウザを変更モードで別タブに開き、該当ファイルの差分を右ペインに表示
  const onDiffFileClick = openDiffFileTab;

  const userFiles = useMemo(
    () =>
      files
        .filter((f) => f.source === 'user' && f.type !== 'markdown')
        .sort((a, b) => b.uploadedAt - a.uploadedAt),
    [files]
  );
  const previewFiles = useMemo(
    () =>
      files
        .filter((f) => f.source === 'claude' && f.type !== 'markdown')
        .sort((a, b) => b.uploadedAt - a.uploadedAt),
    [files]
  );
  const markdownFiles = useMemo(
    () =>
      files
        .filter((f) => f.type === 'markdown')
        .sort((a, b) => b.uploadedAt - a.uploadedAt),
    [files]
  );

  // lg 以上（右列配置）判定。true なら縦積み表示、false ならタブ切替表示
  const isLg = useMediaQuery(LG_MEDIA_QUERY);
  const [activeTab, setActiveTab] = useState<SectionId>(() =>
    getStoredTab(currentRepo)
  );

  // リポジトリ切り替え時にアクティブタブを復元
  useEffect(() => {
    setActiveTab(getStoredTab(currentRepo));
  }, [currentRepo]);

  const selectTab = useCallback(
    (id: SectionId) => {
      setActiveTab(id);
      try {
        localStorage.setItem(getTabKey(currentRepo), id);
      } catch {
        // ignore
      }
    },
    [currentRepo]
  );

  // localStorage の変更を他タブと同期
  useEffect(() => {
    const key = getTabKey(currentRepo);
    const handleStorage = (e: StorageEvent): void => {
      if (e.key === key && e.newValue) {
        const val = e.newValue as SectionId;
        if ((SECTION_IDS as string[]).includes(val)) {
          setActiveTab(val);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [currentRepo]);

  const [fullscreenId, setFullscreenId] = useState<SectionId | null>(null);

  const sendBody = (
    <FileManager
      rid={rid}
      files={userFiles}
      onRefresh={onRefreshFiles}
      onDelete={onDeleteFile}
      onAnnotate={props.onAnnotateImage}
    />
  );
  const receiveBody = (
    <FileManager
      rid={rid}
      files={previewFiles}
      onRefresh={onRefreshFiles}
      onDelete={onDeleteFile}
      readOnly
      emptyMessage="Claude がアップロードした画像がここに表示されます"
      onAnnotate={props.onAnnotateImage}
    />
  );
  const diffBody = (
    <div className={s.gitSection}>
      <DiffSummary
        rid={rid}
        summary={diffSummary}
        isLoading={diffSummaryLoading}
        error={diffSummaryError}
        onRefresh={onRefreshDiffSummary}
        onFileClick={onDiffFileClick}
      />
    </div>
  );

  const sections: SectionDef[] = [
    {
      id: 'files',
      label: '送信',
      icon: <Send size={ICON_SIZE} />,
      count: userFiles.length,
      body: sendBody,
      fullscreenBody: sendBody,
    },
    {
      id: 'preview',
      label: '受信',
      sub: 'Claude',
      icon: <Inbox size={ICON_SIZE} />,
      count: previewFiles.length,
      body: receiveBody,
      fullscreenBody: receiveBody,
    },
    {
      id: 'md',
      label: 'MD',
      icon: <FileText size={ICON_SIZE} />,
      count: markdownFiles.length,
      body: (
        <MarkdownPanel
          rid={rid}
          files={markdownFiles}
          onDelete={onDeleteFile}
        />
      ),
      fullscreenBody: (
        <MarkdownFullscreen rid={rid} files={markdownFiles} />
      ),
    },
    {
      id: 'git',
      label: 'diff',
      icon: <GitBranch size={ICON_SIZE} />,
      count: diffSummary ? diffSummary.files.length : 0,
      body: diffBody,
      fullscreenBody: diffBody,
    },
  ];

  const fullscreenSection =
    fullscreenId !== null
      ? sections.find((sec) => sec.id === fullscreenId) ?? null
      : null;

  const fullscreenOverlay = (
    <SectionFullscreen
      isOpen={fullscreenSection !== null}
      onClose={() => setFullscreenId(null)}
      icon={fullscreenSection?.icon ?? null}
      title={fullscreenSection?.label ?? ''}
      count={fullscreenSection?.count}
    >
      {fullscreenSection?.fullscreenBody}
    </SectionFullscreen>
  );

  // lg 以上：セクション縦積み（全表示・各ボディ内スクロール）
  if (isLg) {
    return (
      <>
        <div className={s.root}>
          {sections.map((sec) => (
            <div key={sec.id} className={`${s.section} ${s.sectionOpen}`}>
              <div className={`${s.header} ${s.headerStatic}`}>
                <span className={s.headerIcon}>{sec.icon}</span>
                <span className={s.headerLabel}>{sec.label}</span>
                {sec.sub && <span className={s.headerSub}>{sec.sub}</span>}
                <span className={s.spacer} />
                {sec.count > 0 && <span className={s.count}>{sec.count}</span>}
                <button
                  className={s.maximizeButton}
                  onClick={() => setFullscreenId(sec.id)}
                  aria-label="別ウィンドウで開く"
                  title="別ウィンドウで開く"
                >
                  <ExternalLink size={12} strokeWidth={2} />
                </button>
              </div>
              <div className={s.body}>{sec.body}</div>
            </div>
          ))}
        </div>
        {fullscreenOverlay}
      </>
    );
  }

  // lg 未満：タブ切替
  const activeSection =
    sections.find((sec) => sec.id === activeTab) ?? sections[0];
  return (
    <>
      <div className={s.root}>
        <div className={s.tabBar}>
          {sections.map((sec) => {
            const isActive = sec.id === activeTab;
            return (
              <button
                key={sec.id}
                className={`${s.tab} ${isActive ? s.tabActive : ''}`}
                onClick={() => selectTab(sec.id)}
              >
                <span className={s.tabIcon}>{sec.icon}</span>
                <span className={s.tabLabel}>{sec.label}</span>
                {sec.count > 0 && <span className={s.count}>{sec.count}</span>}
              </button>
            );
          })}
          <button
            className={s.tabMaximizeButton}
            onClick={() => setFullscreenId(activeSection.id)}
            aria-label="別ウィンドウで開く"
            title="別ウィンドウで開く"
          >
            <ExternalLink size={13} strokeWidth={2} />
          </button>
        </div>
        <div className={s.tabContent}>{activeSection.body}</div>
      </div>
      {fullscreenOverlay}
    </>
  );
};

export default SidePanel;
