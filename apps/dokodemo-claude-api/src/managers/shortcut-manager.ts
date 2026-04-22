/**
 * ショートカット管理マネージャー
 * コマンドショートカットの作成・削除・実行を担当
 */

import { EventEmitter } from 'events';
import type { CommandShortcut } from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { ShortcutError } from '../utils/errors.js';

const SHORTCUTS_FILE = 'command-shortcuts.json';

/**
 * ターミナルプロセスへの書き込みインターフェース
 */
export interface TerminalWriter {
  writeToTerminal(terminalId: string, data: string): boolean;
}

export class ShortcutManager extends EventEmitter {
  private shortcuts: Map<string, CommandShortcut> = new Map();
  private shortcutCounter = 0;
  private terminalWriter: TerminalWriter | null = null;

  constructor(
    private readonly persistenceService: PersistenceService,
    terminalWriter?: TerminalWriter
  ) {
    super();
    if (terminalWriter) {
      this.terminalWriter = terminalWriter;
    }
  }

  /**
   * ターミナルライターを設定
   */
  setTerminalWriter(writer: TerminalWriter): void {
    this.terminalWriter = writer;
  }

  /**
   * 初期化（永続化データの復元）
   */
  async initialize(): Promise<void> {
    await this.restoreShortcuts();
  }

  /**
   * ショートカットを作成
   */
  async createShortcut(
    name: string | undefined,
    command: string,
    repositoryPath: string
  ): Promise<Result<CommandShortcut, ShortcutError>> {
    try {
      const shortcutId = `shortcut-${++this.shortcutCounter}-${Date.now()}`;

      const shortcut: CommandShortcut = {
        id: shortcutId,
        ...(name && name.trim() ? { name: name.trim() } : {}),
        command,
        repositoryPath,
        createdAt: Date.now(),
      };

      this.shortcuts.set(shortcutId, shortcut);

      const persistResult = await this.persistShortcuts();
      if (!persistResult.ok) {
        console.error(
          '[ShortcutManager] 永続化エラー:',
          persistResult.error.message
        );
      }

      this.emit('shortcut-created', shortcut);
      return Ok(shortcut);
    } catch (e) {
      const error = ShortcutError.creationFailed(name || command, e);
      console.error('[ShortcutManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * ショートカットを削除
   */
  async deleteShortcut(
    shortcutId: string
  ): Promise<Result<void, ShortcutError>> {
    const shortcut = this.shortcuts.get(shortcutId);

    if (!shortcut) {
      return Err(ShortcutError.notFound(shortcutId));
    }

    // デフォルトショートカットは削除不可
    if (shortcut.isDefault) {
      return Err(
        new ShortcutError(
          `デフォルトショートカットは削除できません: ${shortcutId}`
        )
      );
    }

    this.shortcuts.delete(shortcutId);

    const persistResult = await this.persistShortcuts();
    if (!persistResult.ok) {
      console.error(
        '[ShortcutManager] 永続化エラー:',
        persistResult.error.message
      );
    }

    this.emit('shortcut-deleted', { shortcutId });
    return Ok(undefined);
  }

  /**
   * ショートカットを実行
   * @param shortcutId ショートカットID
   * @param terminalWriter ターミナルへの書き込みインターフェース
   * @param repositoryPath リポジトリパス（デフォルトショートカット用）
   */
  executeShortcut(
    shortcutId: string,
    terminalId: string,
    repositoryPath?: string
  ): Result<boolean, ShortcutError> {
    if (!this.terminalWriter) {
      return Err(
        ShortcutError.executeFailed(
          shortcutId,
          'Terminal writer not configured'
        )
      );
    }

    let shortcut = this.shortcuts.get(shortcutId);

    // デフォルトショートカットの場合は動的に取得
    if (!shortcut && shortcutId.startsWith('default-') && repositoryPath) {
      const defaultShortcuts = this.getDefaultShortcuts(repositoryPath);
      shortcut = defaultShortcuts.find((s) => s.id === shortcutId);
    }

    if (!shortcut) {
      return Err(ShortcutError.notFound(shortcutId));
    }

    try {
      // コマンドの末尾に改行を追加して送信
      const commandToSend = shortcut.command.endsWith('\n')
        ? shortcut.command
        : shortcut.command + '\n';
      const success = this.terminalWriter.writeToTerminal(
        terminalId,
        commandToSend
      );

      if (success) {
        this.emit('shortcut-executed', {
          shortcutId,
          command: shortcut.command,
        });
      }
      return Ok(success);
    } catch (e) {
      const error = ShortcutError.executeFailed(shortcutId, e);
      console.error('[ShortcutManager]', error.message, e);
      return Err(error);
    }
  }

  /**
   * リポジトリのショートカット一覧を取得
   */
  getShortcutsByRepository(repositoryPath: string): CommandShortcut[] {
    // デフォルトショートカット（常に表示、削除不可）
    const defaultShortcuts = this.getDefaultShortcuts(repositoryPath);

    // ユーザーが作成したショートカットを取得
    const userShortcuts = Array.from(this.shortcuts.values())
      .filter((shortcut) => shortcut.repositoryPath === repositoryPath)
      .sort((a, b) => a.createdAt - b.createdAt);

    // デフォルトショートカットを先頭に、ユーザーショートカットを後ろに結合
    return [...defaultShortcuts, ...userShortcuts];
  }

  /**
   * デフォルトショートカットを取得
   */
  getDefaultShortcuts(repositoryPath: string): CommandShortcut[] {
    return [
      {
        id: 'default-git-pull',
        command: 'git pull',
        repositoryPath,
        createdAt: 0,
        isDefault: true,
      },
      {
        id: 'default-dev-server',
        command: 'npm run dev',
        repositoryPath,
        createdAt: 1,
        isDefault: true,
      },
      {
        id: 'default-npm-install',
        command: 'npm install',
        repositoryPath,
        createdAt: 2,
        isDefault: true,
      },
      {
        id: 'default-git-status',
        command: 'git status',
        repositoryPath,
        createdAt: 3,
        isDefault: true,
      },
      {
        id: 'default-git-reset',
        command: 'git reset --hard HEAD',
        repositoryPath,
        createdAt: 4,
        isDefault: true,
      },
    ];
  }

  /**
   * リポジトリのショートカットをクリーンアップ
   */
  async cleanupRepositoryShortcuts(
    repositoryPath: string
  ): Promise<Result<void, ShortcutError>> {
    let hasChanges = false;

    for (const [shortcutId, shortcut] of this.shortcuts.entries()) {
      if (shortcut.repositoryPath === repositoryPath) {
        this.shortcuts.delete(shortcutId);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      const persistResult = await this.persistShortcuts();
      if (!persistResult.ok) {
        console.error(
          '[ShortcutManager] 永続化エラー:',
          persistResult.error.message
        );
      }
      this.emit('shortcuts-cleaned', { repositoryPath });
    }

    return Ok(undefined);
  }

  /**
   * 全ショートカットを取得
   */
  getAllShortcuts(): CommandShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  /**
   * ショートカットを永続化
   */
  private async persistShortcuts(): Promise<Result<void, ShortcutError>> {
    const shortcutsArray = Array.from(this.shortcuts.values());
    const result = await this.persistenceService.save(
      SHORTCUTS_FILE,
      shortcutsArray
    );

    if (!result.ok) {
      return Err(
        new ShortcutError(`ショートカットの永続化に失敗しました`, result.error)
      );
    }

    return Ok(undefined);
  }

  /**
   * ショートカットを復元
   */
  private async restoreShortcuts(): Promise<void> {
    const result =
      await this.persistenceService.load<CommandShortcut[]>(SHORTCUTS_FILE);

    if (!result.ok) {
      console.error(
        '[ShortcutManager] ショートカットの復元に失敗:',
        result.error.message
      );
      return;
    }

    if (result.value === null) {
      // ファイルが存在しない場合は何もしない
      return;
    }

    this.shortcuts.clear();
    for (const shortcut of result.value) {
      this.shortcuts.set(shortcut.id, shortcut);
      // カウンターの更新
      const idParts = shortcut.id.split('-');
      const idNumber = parseInt(idParts[idParts.length - 1] || '0');
      if (idNumber > this.shortcutCounter) {
        this.shortcutCounter = idNumber;
      }
    }

  }

  /**
   * シャットダウン
   */
  async shutdown(): Promise<void> {
    await this.persistShortcuts();
    this.shortcuts.clear();
    this.removeAllListeners();
  }
}
