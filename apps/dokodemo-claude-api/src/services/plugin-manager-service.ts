import { spawn } from 'child_process';
import * as path from 'path';
import { cleanChildEnv } from '../utils/clean-env.js';

/** 同梱プラグインの識別情報 */
export const BUNDLED_PLUGIN = {
  marketplaceName: 'dokodemo-claude-plugins',
  pluginName: 'dokodemo-claude-tools',
  get id(): string {
    return `${this.pluginName}@${this.marketplaceName}`;
  },
} as const;

interface PluginListItem {
  id: string;
  version?: string;
  scope?: string;
  enabled?: boolean;
}

interface MarketplaceListItem {
  name: string;
  source?: string;
  url?: string;
  installLocation?: string;
}

interface ClaudeResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** ANSI エスケープシーケンスを除去 */
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();
}

class PluginManagerService {
  /** 同梱プラグインの marketplace ディレクトリ（projectRoot/plugins） */
  getBundledMarketplacePath(projectRoot: string): string {
    return path.join(projectRoot, 'plugins');
  }

  /** claude CLI を実行して結果を取得 */
  private runClaude(args: string[]): Promise<ClaudeResult> {
    return new Promise((resolve) => {
      const proc = spawn('claude', args, {
        env: cleanChildEnv(),
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('close', (code) => {
        resolve({ code: code ?? -1, stdout, stderr });
      });
      proc.on('error', (err) => {
        resolve({ code: -1, stdout, stderr: stderr || err.message });
      });
    });
  }

  /** 同梱プラグインがインストール済か */
  async isInstalled(): Promise<boolean> {
    const r = await this.runClaude(['plugin', 'list', '--json']);
    if (r.code !== 0) return false;
    try {
      const list = JSON.parse(r.stdout) as PluginListItem[];
      return Array.isArray(list) && list.some((p) => p.id === BUNDLED_PLUGIN.id);
    } catch {
      return false;
    }
  }

  /** 同梱 marketplace が登録済か */
  async isMarketplaceRegistered(): Promise<boolean> {
    const r = await this.runClaude(['plugin', 'marketplace', 'list', '--json']);
    if (r.code !== 0) return false;
    try {
      const list = JSON.parse(r.stdout) as MarketplaceListItem[];
      return (
        Array.isArray(list) &&
        list.some((m) => m.name === BUNDLED_PLUGIN.marketplaceName)
      );
    } catch {
      return false;
    }
  }

  /** 同梱 marketplace を登録（未登録時のみ） */
  private async ensureMarketplaceRegistered(projectRoot: string): Promise<void> {
    if (await this.isMarketplaceRegistered()) return;
    const localPath = this.getBundledMarketplacePath(projectRoot);
    const r = await this.runClaude(['plugin', 'marketplace', 'add', localPath]);
    if (r.code !== 0) {
      const msg = stripAnsi(r.stderr || r.stdout) || 'marketplace 追加に失敗しました';
      throw new Error(`marketplace 追加に失敗: ${msg}`);
    }
  }

  /** プラグインをインストール */
  async install(projectRoot: string): Promise<void> {
    await this.ensureMarketplaceRegistered(projectRoot);
    const r = await this.runClaude([
      'plugin',
      'install',
      BUNDLED_PLUGIN.id,
      '--scope',
      'user',
    ]);
    if (r.code !== 0) {
      const msg = stripAnsi(r.stderr || r.stdout) || 'インストールに失敗しました';
      throw new Error(`プラグインのインストールに失敗: ${msg}`);
    }
  }

  /** プラグインをアンインストール */
  async uninstall(): Promise<void> {
    const r = await this.runClaude(['plugin', 'uninstall', BUNDLED_PLUGIN.id]);
    if (r.code !== 0) {
      const msg = stripAnsi(r.stderr || r.stdout) || 'アンインストールに失敗しました';
      throw new Error(`プラグインのアンインストールに失敗: ${msg}`);
    }
  }
}

export const pluginManagerService = new PluginManagerService();
