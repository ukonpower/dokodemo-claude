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
  path?: string; // directory ソースの登録パス
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

  /** 同梱 marketplace の登録情報を取得（未登録なら null） */
  private async getRegisteredMarketplace(): Promise<MarketplaceListItem | null> {
    const r = await this.runClaude(['plugin', 'marketplace', 'list', '--json']);
    if (r.code !== 0) return null;
    try {
      const list = JSON.parse(r.stdout) as MarketplaceListItem[];
      if (!Array.isArray(list)) return null;
      return (
        list.find((m) => m.name === BUNDLED_PLUGIN.marketplaceName) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * 同梱 marketplace を現在の projectRoot に正しく向ける。
   * - 未登録: 追加する
   * - 登録済みだがパスがズレている: 貼り直す（古い checkout を指したままにしない）
   * - 登録済みでパスも一致: update でディレクトリのキャッシュを最新化する
   */
  private async ensureMarketplaceRegistered(projectRoot: string): Promise<void> {
    const localPath = this.getBundledMarketplacePath(projectRoot);
    const existing = await this.getRegisteredMarketplace();

    if (!existing) {
      await this.addMarketplace(localPath);
      return;
    }

    const registeredPath = existing.path ?? existing.installLocation;
    const pointsToCurrent =
      !!registeredPath &&
      path.resolve(registeredPath) === path.resolve(localPath);

    if (!pointsToCurrent) {
      // 古いパスを指しているので貼り直す（既存プラグインは外してから）
      await this.runClaude(['plugin', 'uninstall', BUNDLED_PLUGIN.id]);
      await this.runClaude([
        'plugin',
        'marketplace',
        'remove',
        BUNDLED_PLUGIN.marketplaceName,
      ]);
      await this.addMarketplace(localPath);
      return;
    }

    // パスは正しい。directory ソースはキャッシュされるため update で最新化する
    await this.runClaude([
      'plugin',
      'marketplace',
      'update',
      BUNDLED_PLUGIN.marketplaceName,
    ]);
  }

  /** marketplace を追加（パス指定） */
  private async addMarketplace(localPath: string): Promise<void> {
    const r = await this.runClaude(['plugin', 'marketplace', 'add', localPath]);
    if (r.code !== 0) {
      const msg =
        stripAnsi(r.stderr || r.stdout) || 'marketplace 追加に失敗しました';
      throw new Error(`marketplace 追加に失敗: ${msg}`);
    }
  }

  /** プラグインをインストール（marketplace を現在の projectRoot に合わせてから） */
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
