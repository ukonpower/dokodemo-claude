import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Send, Inbox, GitBranch, FileText } from 'lucide-react';
import { useMediaQuery } from '../hooks';
import s from './SidePanel.module.scss';
import type { UploadedFileInfo, GitDiffSummary } from '../types';
import FileManager from './FileManager';
import DiffSummary from './DiffSummary';
import MarkdownPanel from './MarkdownPanel';

type SectionId = 'preview' | 'files' | 'md' | 'git';

const TAB_KEY_PREFIX = 'dokodemo-sidepanel-tab';

function getTabKey(repo: string): string {
  return repo ? `${TAB_KEY_PREFIX}-${repo}` : TAB_KEY_PREFIX;
}

const ICON_SIZE = 13;
const MOBILE_MEDIA_QUERY = '(max-width: 679px)';
// lg 以上（右列配置）ではセクション縦積み表示、lg 未満ではタブ切替表示
const LG_MEDIA_QUERY = '(min-width: 860px)';

const SECTION_IDS: SectionId[] = ['preview', 'files', 'md', 'git'];

interface SidePanelProps {
  currentRepo: string;
  rid: string;
  files: UploadedFileInfo[];
  onRefreshFiles: () => void;
  onDeleteFile: (filename: string) => void;
  /** 画像に赤入れする（Lightbox 経由。未指定なら非表示） */
  onAnnotateImage?: (imageUrl: string) => void;
  diffSummary: GitDiffSummary | null;
  diffSummaryLoading: boolean;
  diffSummaryError: string | null;
  onRefreshDiffSummary: () => void;
  onDiffFileClick: (filename: string) => void;
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
}

const SidePanel: React.FC<SidePanelProps> = (props) => {
  const { currentRepo, files } = props;

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

  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  // lg 以上（右列配置）判定。true なら縦積み表示、false ならタブ切替表示
  const isLg = useMediaQuery(LG_MEDIA_QUERY);
  const [activeTab, setActiveTab] = useState<SectionId>(() =>
    getStoredTab(currentRepo)
  );
  const [mdView, setMdView] = useState<'list' | 'preview'>('list');

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

  const sections: SectionDef[] = [
    {
      id: 'preview',
      label: '受信',
      sub: 'Claude',
      icon: <Inbox size={ICON_SIZE} />,
      count: previewFiles.length,
      body: (
        <FileManager
          rid={props.rid}
          files={previewFiles}
          onRefresh={props.onRefreshFiles}
          onDelete={props.onDeleteFile}
          readOnly
          emptyMessage="Claude がアップロードした画像がここに表示されます"
          onAnnotate={props.onAnnotateImage}
        />
      ),
    },
    {
      id: 'files',
      label: '添付',
      icon: <Send size={ICON_SIZE} />,
      count: userFiles.length,
      body: (
        <FileManager
          rid={props.rid}
          files={userFiles}
          onRefresh={props.onRefreshFiles}
          onDelete={props.onDeleteFile}
          onAnnotate={props.onAnnotateImage}
        />
      ),
    },
    {
      id: 'md',
      label: 'MD',
      icon: <FileText size={ICON_SIZE} />,
      count: markdownFiles.length,
      body: (
        <MarkdownPanel
          rid={props.rid}
          files={markdownFiles}
          onDelete={props.onDeleteFile}
          isMobile={isMobile}
          mobileView={mdView}
          onMobileViewChange={setMdView}
        />
      ),
    },
    {
      id: 'git',
      label: 'Git',
      icon: <GitBranch size={ICON_SIZE} />,
      count: props.diffSummary ? props.diffSummary.files.length : 0,
      body: (
        <DiffSummary
          rid={props.rid}
          summary={props.diffSummary}
          isLoading={props.diffSummaryLoading}
          error={props.diffSummaryError}
          onRefresh={props.onRefreshDiffSummary}
          onFileClick={props.onDiffFileClick}
        />
      ),
    },
  ];

  // lg 以上：セクション縦積み（全表示・各ボディ内スクロール）
  if (isLg) {
    return (
      <div className={s.root}>
        {sections.map((sec) => (
          <div key={sec.id} className={`${s.section} ${s.sectionOpen}`}>
            <div className={`${s.header} ${s.headerStatic}`}>
              <span className={s.headerIcon}>{sec.icon}</span>
              <span className={s.headerLabel}>{sec.label}</span>
              {sec.sub && <span className={s.headerSub}>{sec.sub}</span>}
              <span className={s.spacer} />
              {sec.count > 0 && <span className={s.count}>{sec.count}</span>}
            </div>
            <div className={s.body}>{sec.body}</div>
          </div>
        ))}
      </div>
    );
  }

  // lg 未満：タブ切替
  const activeSection =
    sections.find((sec) => sec.id === activeTab) ?? sections[0];
  return (
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
      </div>
      <div className={s.tabContent}>{activeSection.body}</div>
    </div>
  );
};

export default SidePanel;
