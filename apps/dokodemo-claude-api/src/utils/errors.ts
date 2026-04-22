/**
 * カスタムエラー定義
 * 各ドメインごとに型安全なエラーを定義
 */

/**
 * アプリケーションエラーの基底クラス
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  readonly timestamp = Date.now();

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    // Errorクラスの継承で必要
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

/**
 * ターミナル関連エラー
 */
export class TerminalError extends AppError {
  readonly code = 'TERMINAL_ERROR';

  static notFound(terminalId: string): TerminalError {
    return new TerminalError(`ターミナルが見つかりません: ${terminalId}`);
  }

  static alreadyClosed(terminalId: string): TerminalError {
    return new TerminalError(`ターミナルは既に閉じています: ${terminalId}`);
  }

  static creationFailed(path: string, cause?: unknown): TerminalError {
    return new TerminalError(`ターミナルの作成に失敗しました: ${path}`, cause);
  }

  static sendFailed(terminalId: string, cause?: unknown): TerminalError {
    return new TerminalError(
      `ターミナルへの送信に失敗しました: ${terminalId}`,
      cause
    );
  }

  static resizeFailed(terminalId: string, cause?: unknown): TerminalError {
    return new TerminalError(
      `ターミナルのリサイズに失敗しました: ${terminalId}`,
      cause
    );
  }
}

/**
 * ショートカット関連エラー
 */
export class ShortcutError extends AppError {
  readonly code = 'SHORTCUT_ERROR';

  static notFound(shortcutId: string): ShortcutError {
    return new ShortcutError(`ショートカットが見つかりません: ${shortcutId}`);
  }

  static creationFailed(name: string, cause?: unknown): ShortcutError {
    return new ShortcutError(
      `ショートカットの作成に失敗しました: ${name}`,
      cause
    );
  }

  static deleteFailed(shortcutId: string, cause?: unknown): ShortcutError {
    return new ShortcutError(
      `ショートカットの削除に失敗しました: ${shortcutId}`,
      cause
    );
  }

  static executeFailed(shortcutId: string, cause?: unknown): ShortcutError {
    return new ShortcutError(
      `ショートカットの実行に失敗しました: ${shortcutId}`,
      cause
    );
  }
}

/**
 * カスタム送信ボタン関連エラー
 */
export class CustomAiButtonError extends AppError {
  readonly code = 'CUSTOM_AI_BUTTON_ERROR';

  static notFound(id: string): CustomAiButtonError {
    return new CustomAiButtonError(`カスタムボタンが見つかりません: ${id}`);
  }

  static invalidInput(reason: string): CustomAiButtonError {
    return new CustomAiButtonError(`入力が不正です: ${reason}`);
  }

  static persistFailed(cause?: unknown): CustomAiButtonError {
    return new CustomAiButtonError(`カスタムボタンの永続化に失敗しました`, cause);
  }
}

/**
 * PromptQueue関連エラー
 */
export class QueueError extends AppError {
  readonly code = 'QUEUE_ERROR';

  static itemNotFound(itemId: string): QueueError {
    return new QueueError(`キューアイテムが見つかりません: ${itemId}`);
  }

  static queuePaused(repositoryPath: string): QueueError {
    return new QueueError(`キューは一時停止中です: ${repositoryPath}`);
  }

  static addFailed(repositoryPath: string, cause?: unknown): QueueError {
    return new QueueError(
      `キューへの追加に失敗しました: ${repositoryPath}`,
      cause
    );
  }

  static removeFailed(itemId: string, cause?: unknown): QueueError {
    return new QueueError(`キューからの削除に失敗しました: ${itemId}`, cause);
  }

  static processFailed(repositoryPath: string, cause?: unknown): QueueError {
    return new QueueError(
      `キューの処理に失敗しました: ${repositoryPath}`,
      cause
    );
  }
}

/**
 * 永続化関連エラー
 */
export class PersistenceError extends AppError {
  readonly code = 'PERSISTENCE_ERROR';

  static readFailed(filePath: string, cause?: unknown): PersistenceError {
    return new PersistenceError(
      `ファイルの読み込みに失敗しました: ${filePath}`,
      cause
    );
  }

  static writeFailed(filePath: string, cause?: unknown): PersistenceError {
    return new PersistenceError(
      `ファイルの書き込みに失敗しました: ${filePath}`,
      cause
    );
  }

  static deleteFailed(filePath: string, cause?: unknown): PersistenceError {
    return new PersistenceError(
      `ファイルの削除に失敗しました: ${filePath}`,
      cause
    );
  }

  static parseFailed(filePath: string, cause?: unknown): PersistenceError {
    return new PersistenceError(
      `ファイルの解析に失敗しました: ${filePath}`,
      cause
    );
  }
}

/**
 * AIセッション関連エラー
 */
export class AiSessionError extends AppError {
  readonly code = 'AI_SESSION_ERROR';

  static notFound(sessionId: string): AiSessionError {
    return new AiSessionError(`AIセッションが見つかりません: ${sessionId}`);
  }

  static creationFailed(
    repositoryPath: string,
    cause?: unknown
  ): AiSessionError {
    return new AiSessionError(
      `AIセッションの作成に失敗しました: ${repositoryPath}`,
      cause
    );
  }

  static sendFailed(sessionId: string, cause?: unknown): AiSessionError {
    return new AiSessionError(
      `AIセッションへの送信に失敗しました: ${sessionId}`,
      cause
    );
  }

  static alreadyClosed(sessionId: string): AiSessionError {
    return new AiSessionError(`AIセッションは既に閉じています: ${sessionId}`);
  }
}
