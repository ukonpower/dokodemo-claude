// ターミナル関連の型定義
export interface Terminal {
  id: string;
  name: string;
  cwd: string;
  status: 'active' | 'running' | 'exited';
  pid?: number;
  createdAt: number;
}

export interface TerminalMessage {
  terminalId: string;
  type: 'stdout' | 'stderr' | 'input' | 'exit';
  data: string;
  timestamp: number;
}

// ターミナル出力履歴の行情報
export interface TerminalOutputLine {
  id: string;
  content: string;
  timestamp: number;
  type: 'stdout' | 'stderr' | 'system';
}

// 検出された開発サーバーのポート情報
export interface DetectedPortInfo {
  terminalId: string;
  port: number;
  pid: number;
  command: string;
  // 実際に待ち受けているプロトコル（TLS ハンドシェイクの成否で判定）
  protocol: 'http' | 'https';
}

// コマンドショートカット関連の型定義
export interface CommandShortcut {
  id: string;
  name?: string; // オプショナル：未入力時はcommandを表示に使用
  command: string;
  repositoryPath: string;
  createdAt: number;
  isDefault?: boolean; // デフォルトショートカットフラグ（削除不可）
}
