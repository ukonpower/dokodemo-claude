import {
  GitBranch,
  Files,
  LayoutList,
  LayoutDashboard,
} from 'lucide-react';
import type { CommandProvider, CommandPaletteCommand } from './types';

// ビュー遷移コマンド。provider 複数登録の実証も兼ねる。
export const viewCommands: CommandProvider = (ctx) => {
  if (!ctx.currentRepo) return [];

  const cmds: CommandPaletteCommand[] = [
    {
      id: 'view.graph',
      label: 'View: Git Graph',
      description: 'コミットグラフを表示',
      category: 'View',
      icon: <GitBranch size={14} />,
      run: () => ctx.gitGraph.openGraphView(),
    },
    {
      id: 'view.files',
      label: 'View: Files',
      description: 'ファイルビュワーを新しいタブで開く',
      category: 'View',
      icon: <Files size={14} />,
      run: () => ctx.openFileViewer(),
    },
    ctx.dashboardMode
      ? {
          id: 'view.project',
          label: 'View: Project',
          description: 'プロジェクトビューへ戻る',
          category: 'View',
          icon: <LayoutList size={14} />,
          run: () => ctx.setDashboardMode(false),
        }
      : {
          id: 'view.dashboard',
          label: 'View: Dashboard',
          description: 'ダッシュボードを表示',
          category: 'View',
          icon: <LayoutDashboard size={14} />,
          run: () => ctx.setDashboardMode(true),
        },
  ];
  return cmds;
};
