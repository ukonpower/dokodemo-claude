import React, { useState, useCallback, useEffect } from 'react';
import {
  Paperclip,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
} from 'lucide-react';
import s from './TabbedPanel.module.scss';
import type {
  UploadedFileInfo,
  GitDiffSummary,
} from '../types';
import FileManager from './FileManager';
import DiffSummary from './DiffSummary';

type TabId = 'files' | 'git';

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

const TABS: TabDef[] = [
  {
    id: 'files',
    label: 'ファイル',
    activeColor: '#a78bfa',
    icon: <Paperclip size={ICON_SIZE} />,
  },
  {
    id: 'git',
    label: 'Git',
    activeColor: '#4ade80',
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

  // ショートカット: プレビュースキル送信
  onSendPreview?: () => void;
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

const TabbedPanel: React.FC<TabbedPanelProps> = (props) => {
  const { currentRepo } = props;
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    getStoredTab(currentRepo)
  );
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

  return (
    <div
      className={s.root}
      style={{
        backgroundColor: '#1a1b1e',
        borderRadius: 8,
        border: '1px solid #2d2e32',
        height: isCollapsed ? 32 : 150,
        transition: 'height 0.2s ease',
      }}
    >
      {/* タブバー */}
      <div
        className={`${s.tabBar} ${isCollapsed ? s.collapsed : ''}`}
        style={{
          backgroundColor: '#1e1f23',
          height: 32,
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
        {/* 右寄せのショートカットボタン */}
        <div className={s.shortcutSpacer} />
        {props.onSendPreview && (
          <button
            type="button"
            onClick={props.onSendPreview}
            className={s.shortcutButton}
            title="/dokodemo-claude-tools:dokodemo-preview を送信"
          >
            <ImageIcon size={12} />
            <span>Preview</span>
          </button>
        )}
      </div>

      {/* タブコンテンツ */}
      {!isCollapsed && (
        <div style={{ backgroundColor: '#25262b' }} className={s.tabContent}>
          {activeTab === 'files' && (
            <FileManager
              rid={props.rid}
              files={props.files}
              onRefresh={props.onRefreshFiles}
              onDelete={props.onDeleteFile}
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
