import type { ReactNode } from 'react';
import type { UseGitGraphReturn } from '@/hooks/useGitGraph';

// コマンドパレットに表示する1コマンド。
// children を持つコマンドは実行せずサブメニューへ遷移する（run は無視される）
export interface CommandPaletteCommand {
  id: string;
  label: string;
  description?: string;
  category?: string;
  icon?: ReactNode;
  disabled?: boolean;
  children?: CommandPaletteCommand[];
  run?: () => void;
}

// provider に渡す実行時コンテキスト。
// コマンドが増えて必要になったら App.tsx が組み立てるこの型へフィールドを足す。
export interface CommandContext {
  currentRepo: string;
  gitGraph: UseGitGraphReturn;
  dashboardMode: boolean;
  setDashboardMode: (next: boolean) => void;
  openFileViewer: () => void;
}

// コマンド provider。ctx から表示すべきコマンド配列を返す純関数。
// 状況に応じてコマンドを出し分ける場合も provider 内で分岐する（空配列可）。
export type CommandProvider = (ctx: CommandContext) => CommandPaletteCommand[];
