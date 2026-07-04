import React, { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Send,
  Inbox,
  GitBranch,
  ChevronDown,
  ChevronRight,
  FileText,
  RefreshCw,
  Upload,
} from 'lucide-react';
import s from './TabbedPanel.module.scss';
import type {
  UploadedFileInfo,
  GitDiffSummary,
} from '../types';
import FileManager, { type FileManagerHandle } from './FileManager';
import DiffSummary from './DiffSummary';
import MarkdownPanel from './MarkdownPanel';

type TabId = 'files' | 'preview' | 'md' | 'git';

const STORAGE_KEY_PREFIX = 'dokodemo-tabbed-panel-active';
const COLLAPSED_KEY_PREFIX = 'dokodemo-tabbed-panel-collapsed';

function getStorageKey(repo: string): string {
  return repo ? `${STORAGE_KEY_PREFIX}-${repo}` : STORAGE_KEY_PREFIX;
}

function getCollapsedKey(repo: string): string {
  return repo ? `${COLLAPSED_KEY_PREFIX}-${repo}` : COLLAPSED_KEY_PREFIX;
}

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  activeColor: string;
}

const ICON_SIZE = 12;

const ACTIVE_COLOR = '#e5e7eb';

const TABS: TabDef[] = [
  {
    id: 'files',
    label: '添付',
    activeColor: ACTIVE_COLOR,
    icon: <Send size={ICON_SIZE} />,
  },
  {
    id: 'preview',
    label: '受信',
    activeColor: ACTIVE_COLOR,
    icon: <Inbox size={ICON_SIZE} />,
  },
  {
    id: 'md',
    label: 'MD',
    activeColor: ACTIVE_COLOR,
    icon: <FileText size={ICON_SIZE} />,
  },
  {
    id: 'git',
    label: 'Git',
    activeColor: ACTIVE_COLOR,
    icon: <GitBranch size={ICON_SIZE} />,
  },
];

interface TabbedPanelProps {
  // Repository
  currentRepo: string;

  // Files
  rid: string;
  files: UploadedFileInfo[];
  onRefreshFiles: () => void;
  onDeleteFile: (filename: string) => void;

  // Git
  diffSummary: GitDiffSummary | null;
  diffSummaryLoading: boolean;
  diffSummaryError: string | null;
  onRefreshDiffSummary: () => void;
  onDiffFileClick: (filename: string) => void;

  // 展開差分（折りたたみ時 32px との差）の親通知
  // 親側で上位コンテナの高さに加算することで、展開時に xterm の高さが縮まないようにする
  onExpandedExtraHeightChange?: (extraHeight: number) => void;
}

function getStoredTab(repo: string): TabId {
  const key = getStorageKey(repo);
  try {
    const stored = localStorage.getItem(key);
    if (stored && TABS.some((t) => t.id === stored)) {
      return stored as TabId;
    }
  } catch {
    // ignore
  }
  return 'files';
}

const INACTIVE_COLOR = '#6b7280';

const MOBILE_MEDIA_QUERY = '(max-width: 679px)';
const MD_PREVIEW_HEIGHT = 400;
const MD_LIST_PADDING = 16;
const MD_LIST_ITEM_HEIGHT = 28;
const MD_LIST_MIN_HEIGHT = 120;

const COLLAPSED_HEIGHT = 32;

const TabbedPanel: React.FC<TabbedPanelProps> = (props) => {
  const { currentRepo, files, onExpandedExtraHeightChange } = props;
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
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    getStoredTab(currentRepo)
  );
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
      : false
  );
  const [mdView, setMdView] = useState<'list' | 'preview'>('list');
  const filesManagerRef = useRef<FileManagerHandle>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(getCollapsedKey(currentRepo));
      if (stored !== null) return stored === 'true';
    } catch {
      // ignore
    }
    return true;
  });

  // リポジトリ切り替え時に保存済み状態を復元
  useEffect(() => {
    setActiveTab(getStoredTab(currentRepo));
    try {
      const stored = localStorage.getItem(getCollapsedKey(currentRepo));
      setIsCollapsed(stored !== null ? stored === 'true' : true);
    } catch {
      setIsCollapsed(true);
    }
  }, [currentRepo]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(getCollapsedKey(currentRepo), String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [currentRepo]);

  const handleTabChange = useCallback(
    (tabId: TabId) => {
      setActiveTab(tabId);
      try {
        localStorage.setItem(getStorageKey(currentRepo), tabId);
      } catch {
        // ignore
      }
    },
    [currentRepo]
  );

  // localStorage の変更を他タブと同期
  useEffect(() => {
    const key = getStorageKey(currentRepo);
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        const val = e.newValue as TabId;
        if (TABS.some((t) => t.id === val)) {
          setActiveTab(val);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [currentRepo]);

  let expandedHeight = 180;
  if (activeTab === 'md') {
    if (isMobile && mdView === 'list') {
      const listInner =
        MD_LIST_PADDING +
        Math.max(1, markdownFiles.length) * MD_LIST_ITEM_HEIGHT;
      expandedHeight = Math.min(
        MD_PREVIEW_HEIGHT,
        Math.max(MD_LIST_MIN_HEIGHT, listInner)
      );
    } else {
      expandedHeight = MD_PREVIEW_HEIGHT;
    }
  }

  // アクティブタブ毎のカウント / 更新ハンドラ / ローディング状態
  let activeCount: number | null = null;
  let activeOnRefresh: () => void = props.onRefreshFiles;
  let activeIsLoading = false;
  if (activeTab === 'files') {
    activeCount = userFiles.length;
  } else if (activeTab === 'preview') {
    activeCount = previewFiles.length;
  } else if (activeTab === 'md') {
    activeCount = markdownFiles.length;
  } else if (activeTab === 'git') {
    activeCount = props.diffSummary ? props.diffSummary.files.length : null;
    activeOnRefresh = props.onRefreshDiffSummary;
    activeIsLoading = props.diffSummaryLoading;
  }

  // 展開時に親へ「上乗せ高さ（=expandedHeight - COLLAPSED_HEIGHT）」を通知
  // 折りたたみ時は 0
  // useLayoutEffect を使うことで、TabbedPanel の height 変化と cliSection の min-height 変化を
  // 同じ paint cycle で開始させ、アニメ中に xterm の高さがズレるのを防ぐ
  useLayoutEffect(() => {
    if (!onExpandedExtraHeightChange) return;
    const extra = isCollapsed ? 0 : Math.max(0, expandedHeight - COLLAPSED_HEIGHT);
    onExpandedExtraHeightChange(extra);
  }, [isCollapsed, expandedHeight, onExpandedExtraHeightChange]);

  return (
    <div
      className={s.root}
      style={{
        backgroundColor: '#1a1b1e',
        borderRadius: 8,
        border: '1px solid #2d2e32',
        height: isCollapsed ? COLLAPSED_HEIGHT : expandedHeight,
        transition: 'height 0.2s ease',
      }}
    >
      {/* タブバー */}
      <div
        className={`${s.tabBar} ${isCollapsed ? s.collapsed : ''}`}
        style={{
          backgroundColor: '#1e1f23',
          height: COLLAPSED_HEIGHT,
          padding: '0 4px',
          borderBottom: isCollapsed ? 'none' : '1px solid #2d2e32',
        }}
      >
        {/* 折りたたみトグル */}
        <button
          onClick={toggleCollapsed}
          className={s.collapseToggle}
          style={{
            width: 24,
            height: 26,
            color: INACTIVE_COLOR,
          }}
          title={isCollapsed ? 'パネルを展開' : 'パネルを折りたたむ'}
        >
          {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const color = isActive ? tab.activeColor : INACTIVE_COLOR;
          return (
            <button
              key={tab.id}
              onClick={() => {
                if (isCollapsed) {
                  setIsCollapsed(false);
                  try {
                    localStorage.setItem(getCollapsedKey(currentRepo), 'false');
                  } catch {
                    // ignore
                  }
                }
                handleTabChange(tab.id);
              }}
              className={s.tab}
              style={{
                gap: 5,
                padding: '0 12px',
                height: isActive && !isCollapsed ? 28 : 26,
                backgroundColor: isActive && !isCollapsed ? '#25262b' : 'transparent',
                borderRadius: isActive && !isCollapsed ? '6px 6px 0 0' : undefined,
                borderTop: isActive && !isCollapsed ? '1px solid #3a3b40' : 'none',
                borderLeft: isActive && !isCollapsed ? '1px solid #3a3b40' : 'none',
                borderRight: isActive && !isCollapsed ? '1px solid #3a3b40' : 'none',
                borderBottom: 'none',
                color,
              }}
            >
              {tab.icon}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 500,
                  fontFamily: 'Inter, sans-serif',
                  color,
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}

        {/* 右側のスペーサー + アクション */}
        {!isCollapsed && (
          <>
            <div className={s.spacer} />
            <div className={s.tabBarActions}>
              {activeCount !== null && activeCount > 0 && (
                <span className={s.tabBarCount}>{activeCount}</span>
              )}
              {activeTab === 'files' && (
                <button
                  onClick={() => filesManagerRef.current?.pickFiles()}
                  className={s.tabBarAction}
                  title="ファイルを追加"
                  aria-label="ファイルを追加"
                >
                  <Upload size={11} />
                </button>
              )}
              <button
                onClick={activeOnRefresh}
                disabled={activeIsLoading}
                className={s.tabBarAction}
                title="更新"
                aria-label="更新"
              >
                <RefreshCw
                  size={11}
                  className={activeIsLoading ? s.spinning : ''}
                />
              </button>
            </div>
          </>
        )}
      </div>

      {/* タブコンテンツ */}
      {!isCollapsed && (
        <div style={{ backgroundColor: '#25262b' }} className={s.tabContent}>
          {activeTab === 'files' && (
            <FileManager
              ref={filesManagerRef}
              rid={props.rid}
              files={userFiles}
              onRefresh={props.onRefreshFiles}
              onDelete={props.onDeleteFile}
            />
          )}
          {activeTab === 'preview' && (
            <FileManager
              rid={props.rid}
              files={previewFiles}
              onRefresh={props.onRefreshFiles}
              onDelete={props.onDeleteFile}
              readOnly
              emptyMessage="Claude がアップロードした画像がここに表示されます"
            />
          )}
          {activeTab === 'md' && (
            <MarkdownPanel
              rid={props.rid}
              files={markdownFiles}
              onDelete={props.onDeleteFile}
              isMobile={isMobile}
              mobileView={mdView}
              onMobileViewChange={setMdView}
            />
          )}
          {activeTab === 'git' && (
            <DiffSummary
              rid={props.rid}
              summary={props.diffSummary}
              isLoading={props.diffSummaryLoading}
              error={props.diffSummaryError}
              onRefresh={props.onRefreshDiffSummary}
              onFileClick={props.onDiffFileClick}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default TabbedPanel;
