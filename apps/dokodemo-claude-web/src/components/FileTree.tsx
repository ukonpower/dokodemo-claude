import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
} from 'lucide-react';
import type { FileTreeEntry } from '../types';
import s from './FileTree.module.scss';

interface FileTreeProps {
  directoryCache: Map<string, FileTreeEntry[]>;
  expandedDirs: Set<string>;
  selectedFilePath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  gitChangedFiles?: Map<string, string>;
}

interface FileTreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  directoryCache: Map<string, FileTreeEntry[]>;
  expandedDirs: Set<string>;
  selectedFilePath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  gitChangedFiles?: Map<string, string>;
}

function getStatusClass(status: string | undefined): string {
  switch (status) {
    case 'M':
      return s.statusModified;
    case 'A':
      return s.statusAdded;
    case 'D':
      return s.statusDeleted;
    case 'U':
      return s.statusUntracked;
    case 'R':
      return s.statusRenamed;
    default:
      return '';
  }
}

function hasChangedDescendant(
  dirPath: string,
  gitChangedFiles: Map<string, string>
): boolean {
  const prefix = dirPath ? dirPath + '/' : '';
  for (const filePath of gitChangedFiles.keys()) {
    if (filePath.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function FileTreeNode({
  entry,
  depth,
  directoryCache,
  expandedDirs,
  selectedFilePath,
  onToggleDir,
  onSelectFile,
  gitChangedFiles,
}: FileTreeNodeProps) {
  const isDirectory = entry.type === 'directory';
  const isExpanded = expandedDirs.has(entry.path);
  const isSelected = selectedFilePath === entry.path;
  const children = isDirectory ? directoryCache.get(entry.path) : undefined;

  const fileStatus = gitChangedFiles?.get(entry.path);
  const statusClass = getStatusClass(fileStatus);
  const dirHasChanges =
    isDirectory &&
    gitChangedFiles &&
    hasChangedDescendant(entry.path, gitChangedFiles);

  const handleClick = () => {
    if (isDirectory) {
      onToggleDir(entry.path);
    } else {
      onSelectFile(entry.path);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`${s.treeButton} ${
          isSelected
            ? s.treeButtonSelected
            : s.treeButtonDefault
        }`}
        style={{
          paddingLeft: `${depth * 12 + 8}px`,
        }}
      >
        {isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown size={14} className={s.chevronIcon} />
            ) : (
              <ChevronRight size={14} className={s.chevronIcon} />
            )}
            {isExpanded ? (
              <FolderOpen size={16} className={s.folderIcon} />
            ) : (
              <Folder size={16} className={s.folderIcon} />
            )}
          </>
        ) : (
          <>
            <span className={s.spacer} />
            <File size={16} className={s.fileIcon} />
          </>
        )}
        <span className={`${s.entryName} ${statusClass}`}>
          {entry.name}
        </span>
        {dirHasChanges && (
          <span className={s.dirChangeDot} />
        )}
      </button>

      {isDirectory && isExpanded && children && (
        <>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              directoryCache={directoryCache}
              expandedDirs={expandedDirs}
              selectedFilePath={selectedFilePath}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              gitChangedFiles={gitChangedFiles}
            />
          ))}
        </>
      )}

      {isDirectory && isExpanded && !children && (
        <div
          className={s.loadingChild}
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
        >
          読み込み中...
        </div>
      )}
    </>
  );
}

export default function FileTree({
  directoryCache,
  expandedDirs,
  selectedFilePath,
  onToggleDir,
  onSelectFile,
  gitChangedFiles,
}: FileTreeProps) {
  const rootEntries = directoryCache.get('') || [];

  if (rootEntries.length === 0) {
    return (
      <div className={s.loadingCenter}>
        読み込み中...
      </div>
    );
  }

  return (
    <div className={s.scrollContainer}>
      {rootEntries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          directoryCache={directoryCache}
          expandedDirs={expandedDirs}
          selectedFilePath={selectedFilePath}
          onToggleDir={onToggleDir}
          onSelectFile={onSelectFile}
          gitChangedFiles={gitChangedFiles}
        />
      ))}
    </div>
  );
}
