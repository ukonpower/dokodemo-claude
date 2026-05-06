/**
 * カスタム送信ボタン管理マネージャー
 * AI CLI に送信するユーザー定義ボタンを管理する。
 * 各ボタンは scope によって全リポジトリ共通（global）かリポジトリ固有（repository）か
 * を切り替え可能。
 */

import { EventEmitter } from 'events';
import type {
  CustomAiButton,
  CustomAiButtonScope,
} from '../types/index.js';
import { PersistenceService } from '../services/persistence-service.js';
import { Result, Ok, Err } from '../utils/result.js';
import { CustomAiButtonError } from '../utils/errors.js';

const FILE = 'custom-ai-buttons.json';

export class CustomAiButtonManager extends EventEmitter {
  private buttons: Map<string, CustomAiButton> = new Map();
  private counter = 0;

  constructor(private readonly persistenceService: PersistenceService) {
    super();
  }

  async initialize(): Promise<void> {
    const result = await this.persistenceService.load<CustomAiButton[]>(FILE);
    if (!result.ok) {
      console.error(
        '[CustomAiButtonManager] 復元に失敗:',
        result.error.message
      );
      return;
    }
    if (result.value === null) return;

    this.buttons.clear();
    for (const btn of result.value) {
      // scope 未設定の旧データは global として扱う
      const normalized: CustomAiButton = {
        ...btn,
        scope: btn.scope ?? 'global',
        repositoryPath:
          btn.scope === 'repository' ? btn.repositoryPath : undefined,
      };
      this.buttons.set(normalized.id, normalized);
      const idParts = normalized.id.split('-');
      const idNumber = parseInt(idParts[1] ?? '0', 10);
      if (Number.isFinite(idNumber) && idNumber > this.counter) {
        this.counter = idNumber;
      }
    }
  }

  list(): CustomAiButton[] {
    return Array.from(this.buttons.values()).sort(
      (a, b) => a.order - b.order || a.createdAt - b.createdAt
    );
  }

  async create(
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ): Promise<Result<CustomAiButton, CustomAiButtonError>> {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName) {
      return Err(CustomAiButtonError.invalidInput('name is empty'));
    }
    if (!trimmedCommand) {
      return Err(CustomAiButtonError.invalidInput('command is empty'));
    }
    if (scope === 'repository' && !repositoryPath) {
      return Err(
        CustomAiButtonError.invalidInput(
          'repositoryPath is required for repository scope'
        )
      );
    }

    const id = `cbtn-${++this.counter}-${Date.now()}`;
    const order = this.buttons.size;
    const button: CustomAiButton = {
      id,
      name: trimmedName,
      command: trimmedCommand,
      createdAt: Date.now(),
      order,
      scope,
      repositoryPath: scope === 'repository' ? repositoryPath : undefined,
    };
    this.buttons.set(id, button);

    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    this.emit('button-created', button);
    return Ok(button);
  }

  async update(
    id: string,
    name: string,
    command: string,
    scope: CustomAiButtonScope,
    repositoryPath?: string
  ): Promise<Result<CustomAiButton, CustomAiButtonError>> {
    const existing = this.buttons.get(id);
    if (!existing) {
      return Err(CustomAiButtonError.notFound(id));
    }
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName) {
      return Err(CustomAiButtonError.invalidInput('name is empty'));
    }
    if (!trimmedCommand) {
      return Err(CustomAiButtonError.invalidInput('command is empty'));
    }
    if (scope === 'repository' && !repositoryPath) {
      return Err(
        CustomAiButtonError.invalidInput(
          'repositoryPath is required for repository scope'
        )
      );
    }

    const updated: CustomAiButton = {
      ...existing,
      name: trimmedName,
      command: trimmedCommand,
      scope,
      repositoryPath: scope === 'repository' ? repositoryPath : undefined,
    };
    this.buttons.set(id, updated);

    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    this.emit('button-updated', updated);
    return Ok(updated);
  }

  async delete(id: string): Promise<Result<void, CustomAiButtonError>> {
    if (!this.buttons.has(id)) {
      return Err(CustomAiButtonError.notFound(id));
    }
    this.buttons.delete(id);

    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    this.emit('button-deleted', { id });
    return Ok(undefined);
  }

  async reorder(
    orderedIds: string[]
  ): Promise<Result<void, CustomAiButtonError>> {
    orderedIds.forEach((id, index) => {
      const btn = this.buttons.get(id);
      if (btn) {
        this.buttons.set(id, { ...btn, order: index });
      }
    });
    const persistResult = await this.persist();
    if (!persistResult.ok) {
      return Err(persistResult.error);
    }
    this.emit('buttons-reordered', { orderedIds });
    return Ok(undefined);
  }

  private async persist(): Promise<Result<void, CustomAiButtonError>> {
    const data = this.list();
    const result = await this.persistenceService.save(FILE, data);
    if (!result.ok) {
      return Err(CustomAiButtonError.persistFailed(result.error));
    }
    return Ok(undefined);
  }
}
