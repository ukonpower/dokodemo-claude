import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';
import type { AiProvider } from '../types/index.js';

interface HookHandler {
  type: string;
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookHandler[];
}

interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

interface CodexHooksFile {
  hooks: Record<string, HookMatcher[]>;
}

type TomlObject = Record<string, unknown>;

class AiHooksService {
  private getClaudeSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  private getCodexHooksPath(): string {
    return path.join(os.homedir(), '.codex', 'hooks.json');
  }

  private getCodexConfigPath(): string {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  private getHookEndpointPath(provider: AiProvider): string {
    return provider === 'claude' ? '/hook/claude-event' : '/hook/codex-event';
  }

  private getHookUrl(port: number, provider: AiProvider): string {
    return `https://localhost:${port}${this.getHookEndpointPath(provider)}`;
  }

  private isDokodemoHook(matcher: HookMatcher, port: number, provider: AiProvider): boolean {
    if (!matcher.hooks || !Array.isArray(matcher.hooks)) return false;
    const endpointPath = this.getHookEndpointPath(provider);
    const targetUrlHttp = `http://localhost:${port}${endpointPath}`;
    const targetUrlHttps = `https://localhost:${port}${endpointPath}`;
    return matcher.hooks.some(
      (hook) => hook.command && (hook.command.includes(targetUrlHttp) || hook.command.includes(targetUrlHttps))
    );
  }

  private generateHooks(port: number, provider: AiProvider): {
    stop: HookMatcher;
    notificationPermission: HookMatcher;
    userPromptSubmit: HookMatcher;
    preToolUseAskUserQuestion: HookMatcher;
  } {
    const hookUrl = this.getHookUrl(port, provider);
    const createHookCommand = (event: string): string => {
      return `jq -nc --arg event "${event}" --arg cwd "$PWD" 'first(inputs) | {event: $event, transcript_path: .transcript_path, session_id: .session_id, cwd: $cwd}' | curl -k --connect-timeout 1 --max-time 3 -X POST ${hookUrl} -H 'Content-Type: application/json' -d @- || true`;
    };

    return {
      stop: {
        hooks: [{ type: 'command', command: createHookCommand('Stop') }],
      },
      notificationPermission: {
        matcher: 'permission_prompt',
        hooks: [{ type: 'command', command: createHookCommand('PermissionRequest') }],
      },
      userPromptSubmit: {
        hooks: [{ type: 'command', command: createHookCommand('UserPromptSubmit') }],
      },
      preToolUseAskUserQuestion: {
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'command', command: createHookCommand('AskUserQuestion') }],
      },
    };
  }

  // --- 共通ヘルパー ---

  private async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  // --- Claude settings.json ---

  private async loadClaudeSettings(): Promise<ClaudeSettings> {
    let content: string;
    try {
      content = await fs.readFile(this.getClaudeSettingsPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    try {
      return JSON.parse(content) as ClaudeSettings;
    } catch {
      throw new Error(
        '~/.claude/settings.json が壊れています（JSON パース失敗）。手動で修正してから再度お試しください。',
      );
    }
  }

  private async saveClaudeSettings(settings: ClaudeSettings): Promise<void> {
    await this.writeFileAtomic(this.getClaudeSettingsPath(), JSON.stringify(settings, null, 2));
  }

  // --- Codex hooks.json ---

  private async loadCodexHooks(): Promise<CodexHooksFile> {
    let content: string;
    try {
      content = await fs.readFile(this.getCodexHooksPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { hooks: {} };
      throw err;
    }
    try {
      return JSON.parse(content) as CodexHooksFile;
    } catch {
      throw new Error(
        '~/.codex/hooks.json が壊れています（JSON パース失敗）。手動で修正してから再度お試しください。',
      );
    }
  }

  private async saveCodexHooks(hooksFile: CodexHooksFile): Promise<void> {
    await this.writeFileAtomic(this.getCodexHooksPath(), JSON.stringify(hooksFile, null, 2));
  }

  // --- Codex config.toml ---

  private async loadCodexConfig(): Promise<TomlObject | null> {
    let content: string;
    try {
      content = await fs.readFile(this.getCodexConfigPath(), 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    try {
      return TOML.parse(content) as TomlObject;
    } catch {
      throw new Error(
        '~/.codex/config.toml が壊れています（TOML パース失敗）。手動で修正してから再度お試しください。',
      );
    }
  }

  private async ensureCodexHooksFeature(): Promise<void> {
    const parsed = (await this.loadCodexConfig()) ?? {};
    const features = (parsed.features as TomlObject | undefined) ?? {};
    if (features.codex_hooks === true) return;
    features.codex_hooks = true;
    parsed.features = features;
    await this.writeFileAtomic(this.getCodexConfigPath(), TOML.stringify(parsed as TOML.JsonMap));
  }

  private async removeCodexHooksFeature(): Promise<void> {
    const parsed = await this.loadCodexConfig();
    if (!parsed) return;
    const features = parsed.features as TomlObject | undefined;
    if (!features || features.codex_hooks !== true) return;
    delete features.codex_hooks;
    if (Object.keys(features).length === 0) delete parsed.features;
    await this.writeFileAtomic(this.getCodexConfigPath(), TOML.stringify(parsed as TOML.JsonMap));
  }

  // --- Public API ---

  async isHooksConfigured(port: number, provider: AiProvider): Promise<boolean> {
    if (provider === 'claude') {
      const settings = await this.loadClaudeSettings();
      if (!settings.hooks) return false;

      const stopMatchers = settings.hooks['Stop'];
      if (stopMatchers?.some((m) => this.isDokodemoHook(m, port, provider))) return true;

      const notifMatchers = settings.hooks['Notification'];
      if (notifMatchers?.some((m) => this.isDokodemoHook(m, port, provider))) return true;

      const userPromptMatchers = settings.hooks['UserPromptSubmit'];
      if (userPromptMatchers?.some((m) => this.isDokodemoHook(m, port, provider))) return true;

      const preToolUseMatchers = settings.hooks['PreToolUse'];
      if (preToolUseMatchers?.some((m) => this.isDokodemoHook(m, port, provider))) return true;

      return false;
    }

    // Codex
    const hooksFile = await this.loadCodexHooks();
    const stopMatchers = hooksFile.hooks['Stop'];
    if (stopMatchers?.some((m) => this.isDokodemoHook(m, port, provider))) return true;
    return false;
  }

  async addHooks(port: number, provider: AiProvider): Promise<void> {
    const newHooks = this.generateHooks(port, provider);

    if (provider === 'claude') {
      const settings = await this.loadClaudeSettings();
      if (!settings.hooks) settings.hooks = {};

      // Stop
      if (!settings.hooks['Stop']) settings.hooks['Stop'] = [];
      settings.hooks['Stop'] = settings.hooks['Stop'].filter((m) => !this.isDokodemoHook(m, port, provider));
      settings.hooks['Stop'].push(newHooks.stop);

      // Notification
      if (!settings.hooks['Notification']) settings.hooks['Notification'] = [];
      settings.hooks['Notification'] = settings.hooks['Notification'].filter((m) => !this.isDokodemoHook(m, port, provider));
      settings.hooks['Notification'].push(newHooks.notificationPermission);

      // UserPromptSubmit
      if (!settings.hooks['UserPromptSubmit']) settings.hooks['UserPromptSubmit'] = [];
      settings.hooks['UserPromptSubmit'] = settings.hooks['UserPromptSubmit'].filter((m) => !this.isDokodemoHook(m, port, provider));
      settings.hooks['UserPromptSubmit'].push(newHooks.userPromptSubmit);

      // PreToolUse (AskUserQuestion)
      if (!settings.hooks['PreToolUse']) settings.hooks['PreToolUse'] = [];
      settings.hooks['PreToolUse'] = settings.hooks['PreToolUse'].filter((m) => !this.isDokodemoHook(m, port, provider));
      settings.hooks['PreToolUse'].push(newHooks.preToolUseAskUserQuestion);

      // SubagentStop cleanup
      if (settings.hooks['SubagentStop']) {
        settings.hooks['SubagentStop'] = settings.hooks['SubagentStop'].filter((m) => !this.isDokodemoHook(m, port, provider));
        if (settings.hooks['SubagentStop'].length === 0) delete settings.hooks['SubagentStop'];
      }

      await this.saveClaudeSettings(settings);
    } else {
      // Codex
      await this.ensureCodexHooksFeature();

      const hooksFile = await this.loadCodexHooks();

      // Stop
      if (!hooksFile.hooks['Stop']) hooksFile.hooks['Stop'] = [];
      hooksFile.hooks['Stop'] = hooksFile.hooks['Stop'].filter((m) => !this.isDokodemoHook(m, port, provider));
      hooksFile.hooks['Stop'].push(newHooks.stop);

      await this.saveCodexHooks(hooksFile);
    }
  }

  async removeHooks(port: number, provider: AiProvider): Promise<void> {
    if (provider === 'claude') {
      const settings = await this.loadClaudeSettings();
      if (!settings.hooks) return;

      for (const eventName of ['Stop', 'Notification', 'SubagentStop', 'UserPromptSubmit', 'PreToolUse']) {
        if (settings.hooks[eventName]) {
          settings.hooks[eventName] = settings.hooks[eventName].filter((m) => !this.isDokodemoHook(m, port, provider));
          if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
        }
      }

      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      await this.saveClaudeSettings(settings);
    } else {
      // Codex
      const hooksFile = await this.loadCodexHooks();

      for (const eventName of Object.keys(hooksFile.hooks)) {
        hooksFile.hooks[eventName] = hooksFile.hooks[eventName].filter((m) => !this.isDokodemoHook(m, port, provider));
        if (hooksFile.hooks[eventName].length === 0) delete hooksFile.hooks[eventName];
      }

      await this.saveCodexHooks(hooksFile);
      await this.removeCodexHooksFeature();
    }
  }
}

export const aiHooksService = new AiHooksService();
