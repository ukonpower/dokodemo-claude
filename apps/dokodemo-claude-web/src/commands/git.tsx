import { GitPullRequest, Upload, Download, RefreshCw } from 'lucide-react';
import type { CommandProvider, CommandPaletteCommand } from './types';

// Git 系のコマンドパレット項目。リポジトリ選択中ならどのビューでも pull/push/fetch を出す。
export const gitCommands: CommandProvider = (ctx) => {
  const cmds: CommandPaletteCommand[] = [];
  if (!ctx.currentRepo) return cmds;

  const { gitGraph } = ctx;
  const disabled = gitGraph.actionInProgress;
  const remotes = gitGraph.remotes;

  // push 系コマンドを生成する。remote が 2 つ以上なら宛先ピッカー（サブメニュー）を出し、
  // 0/1 個ならそのまま実行する（0 個は upstream 追跡先へ暗黙 push）。
  const makePush = (
    idBase: string,
    label: string,
    description: string,
    pushOpts: { force?: boolean; setUpstream?: boolean },
    confirmMessage?: string
  ): CommandPaletteCommand => {
    const runFor = (remote?: string) => {
      if (confirmMessage && !window.confirm(confirmMessage)) return;
      gitGraph.push({ ...pushOpts, remote });
    };
    const base = {
      id: idBase,
      label,
      category: 'Git',
      icon: <Upload size={14} />,
      disabled,
    };
    if (remotes.length <= 1) {
      return { ...base, description, run: () => runFor(remotes[0]) };
    }
    return {
      ...base,
      description: `${description}（宛先を選択）`,
      children: remotes.map((r) => ({
        id: `${idBase}.${r}`,
        label: r,
        description: `${r} へ ${pushOpts.setUpstream ? '(-u) ' : ''}push`,
        icon: <Upload size={14} />,
        disabled,
        run: () => runFor(r),
      })),
    };
  };

  cmds.push(
    {
      id: 'git.pull',
      label: 'Git: Pull',
      description: '現在のブランチを upstream から pull',
      category: 'Git',
      icon: <Download size={14} />,
      disabled,
      run: () => gitGraph.pull(),
    },
    makePush('git.push', 'Git: Push', '現在のブランチを push', {}),
    makePush(
      'git.push.upstream',
      'Git: Push (upstream 設定)',
      'upstream を紐付けて push (-u)',
      { setUpstream: true }
    ),
    makePush(
      'git.push.force',
      'Git: Force Push',
      'git push --force-with-lease',
      { force: true },
      'force push (--force-with-lease) を実行しますか？'
    ),
    {
      id: 'git.fetch',
      label: 'Git: Fetch (all)',
      description: 'すべてのリモートから fetch',
      category: 'Git',
      icon: <GitPullRequest size={14} />,
      disabled,
      run: () => gitGraph.fetch(),
    },
    {
      id: 'git.fetch.prune',
      label: 'Git: Fetch (prune)',
      description: 'fetch --all --prune',
      category: 'Git',
      icon: <GitPullRequest size={14} />,
      disabled,
      run: () => gitGraph.fetch({ prune: true }),
    }
  );

  // グラフ再取得はグラフ表示中のみ意味があるので、その時だけ出す
  if (gitGraph.isActive) {
    cmds.push({
      id: 'git.refresh',
      label: 'Git: Refresh Graph',
      description: 'グラフを再取得',
      category: 'Git Graph',
      icon: <RefreshCw size={14} />,
      disabled,
      run: () => gitGraph.refresh(),
    });
  }

  return cmds;
};
