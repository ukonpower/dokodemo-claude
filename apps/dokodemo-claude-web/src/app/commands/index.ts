import type { CommandContext, CommandPaletteCommand, CommandProvider } from './types';
import { gitCommands } from './git';
import { viewCommands } from './view';

// コマンド provider の登録リスト。コマンド群を追加するときは
// provider ファイルを作ってここに1行足すだけでよい。
const providers: CommandProvider[] = [gitCommands, viewCommands];

export function buildCommands(ctx: CommandContext): CommandPaletteCommand[] {
  return providers.flatMap((p) => p(ctx));
}

export type { CommandContext, CommandPaletteCommand, CommandProvider } from './types';
