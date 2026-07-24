import React from 'react';
import {
  Atom,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Palette,
  Settings,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

interface FileIconDef {
  Icon: LucideIcon;
  color: string;
}

const DEFAULT_ICON: FileIconDef = { Icon: File, color: '#8b949e' };

// 拡張子 → アイコン + 色 のマッピング（VS Code のファイルアイコン配色に寄せる）
const EXT_ICON_MAP: Record<string, FileIconDef> = {
  tsx: { Icon: Atom, color: '#58c4dc' },
  jsx: { Icon: Atom, color: '#58c4dc' },
  ts: { Icon: FileCode, color: '#3178c6' },
  mts: { Icon: FileCode, color: '#3178c6' },
  cts: { Icon: FileCode, color: '#3178c6' },
  js: { Icon: FileCode, color: '#e8d44d' },
  mjs: { Icon: FileCode, color: '#e8d44d' },
  cjs: { Icon: FileCode, color: '#e8d44d' },
  scss: { Icon: Palette, color: '#cd6799' },
  sass: { Icon: Palette, color: '#cd6799' },
  css: { Icon: Palette, color: '#42a5f5' },
  less: { Icon: Palette, color: '#2b5086' },
  html: { Icon: FileCode, color: '#e34c26' },
  json: { Icon: FileJson, color: '#cbcb41' },
  jsonc: { Icon: FileJson, color: '#cbcb41' },
  md: { Icon: FileText, color: '#519aba' },
  mdx: { Icon: FileText, color: '#519aba' },
  txt: { Icon: FileText, color: '#8b949e' },
  svg: { Icon: FileImage, color: '#ffb13b' },
  png: { Icon: FileImage, color: '#a074c4' },
  jpg: { Icon: FileImage, color: '#a074c4' },
  jpeg: { Icon: FileImage, color: '#a074c4' },
  gif: { Icon: FileImage, color: '#a074c4' },
  webp: { Icon: FileImage, color: '#a074c4' },
  avif: { Icon: FileImage, color: '#a074c4' },
  ico: { Icon: FileImage, color: '#a074c4' },
  yml: { Icon: Settings, color: '#cb4b4b' },
  yaml: { Icon: Settings, color: '#cb4b4b' },
  toml: { Icon: Settings, color: '#9c7de0' },
  sh: { Icon: Terminal, color: '#89e051' },
  bash: { Icon: Terminal, color: '#89e051' },
  zsh: { Icon: Terminal, color: '#89e051' },
};

function getFileIconDef(filename: string): FileIconDef {
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return DEFAULT_ICON;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_ICON_MAP[ext] ?? DEFAULT_ICON;
}

interface FileIconProps {
  filename: string;
  size?: number;
}

/**
 * ファイル種別アイコン（拡張子ベース）。
 * diff / gitgraph のファイル一覧で共通利用する。
 */
export const FileIcon: React.FC<FileIconProps> = ({ filename, size = 14 }) => {
  const { Icon, color } = getFileIconDef(filename);
  return <Icon size={size} color={color} strokeWidth={1.75} />;
};

/**
 * ファイルパスを「ファイル名」と「ディレクトリパス（末尾スラッシュなし）」に分割する。
 */
export function splitFilePath(filename: string): {
  name: string;
  dir: string;
} {
  const lastSlash = filename.lastIndexOf('/');
  if (lastSlash === -1) return { name: filename, dir: '' };
  return {
    name: filename.substring(lastSlash + 1),
    dir: filename.substring(0, lastSlash),
  };
}
