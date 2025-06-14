import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { GitRepository } from './types/index.js';

export class ClaudeCodeManager {
  private claudeProcess: ChildProcess | null = null;
  private currentRepo: string | null = null;
  private repositoriesDir = './repositories';

  constructor() {
    this.initializeRepositoriesDir();
  }

  private async initializeRepositoriesDir(): Promise<void> {
    try {
      await fs.mkdir(this.repositoriesDir, { recursive: true });
    } catch {
      // リポジトリディレクトリ作成エラーは無視
    }
  }

  async listRepositories(): Promise<GitRepository[]> {
    try {
      const entries = await fs.readdir(this.repositoriesDir, { withFileTypes: true });
      const repos: GitRepository[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const repoPath = path.join(this.repositoriesDir, entry.name);
          const gitPath = path.join(repoPath, '.git');
          
          try {
            await fs.access(gitPath);
            repos.push({
              url: '', // 実際のURLは.git/configから取得できるが、簡略化
              path: entry.name,
              status: 'ready'
            });
          } catch {
            // .gitディレクトリがない場合はスキップ
          }
        }
      }

      return repos;
    } catch {
      return [];
    }
  }

  async cloneRepository(url: string, repoName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const repoPath = path.join(this.repositoriesDir, repoName);
      
      const gitProcess = spawn('git', ['clone', url, repoPath], {
        stdio: 'pipe'
      });

      let errorOutput = '';

      gitProcess.stdout?.on('data', () => {
        // 標準出力は無視
      });

      gitProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed: ${errorOutput}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  async switchRepository(repoName: string): Promise<void> {
    const repoPath = path.join(this.repositoriesDir, repoName);
    
    try {
      await fs.access(repoPath);
      this.currentRepo = repoPath;
      
      // 現在のClaude Code プロセスを終了
      if (this.claudeProcess) {
        this.claudeProcess.kill();
        this.claudeProcess = null;
      }
      
    } catch {
      throw new Error(`リポジトリが見つかりません: ${repoPath}`);
    }
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.currentRepo) {
      return 'エラー: リポジトリが選択されていません。まずリポジトリを選択してください。';
    }

    return new Promise((resolve, reject) => {
      // 簡易的なClaude Code CLIシミュレーション
      // 実際の実装では、claude cliコマンドを実行する
      const claudeProcess = spawn('echo', [`「${command}」コマンドを受信しました。現在のリポジトリ: ${this.currentRepo}`], {
        cwd: this.currentRepo,
        stdio: 'pipe'
      });

      let output = '';
      let errorOutput = '';

      claudeProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      claudeProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      claudeProcess.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim() || 'コマンドが正常に実行されました');
        } else {
          reject(new Error(errorOutput || 'コマンドの実行に失敗しました'));
        }
      });

      claudeProcess.on('error', (error) => {
        reject(error);
      });

      // タイムアウト設定（30秒）
      setTimeout(() => {
        claudeProcess.kill();
        reject(new Error('コマンドがタイムアウトしました'));
      }, 30000);
    });
  }

  destroy(): void {
    if (this.claudeProcess) {
      this.claudeProcess.kill();
      this.claudeProcess = null;
    }
  }
}