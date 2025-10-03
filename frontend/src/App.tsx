import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  GitRepository,
  GitBranch,
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  ClaudeOutputLine,
  CommandShortcut,
  AutoModeConfig,
  AutoModeState,
  ReviewServer,
  DiffType,
  DiffConfig,
  AiProvider,
  ServerToClientEvents,
  ClientToServerEvents,
} from './types';

import RepositoryManager from './components/RepositoryManager';
import AiOutput from './components/AiOutput';
import CommandInput, { CommandInputRef } from './components/CommandInput';
import TerminalManager from './components/TerminalManager';
import BranchSelector from './components/BranchSelector';
import NpmScripts from './components/NpmScripts';
import AutoModeSettings from './components/AutoModeSettings';
import ProviderSelector from './components/ProviderSelector';

// メモリリーク対策のための最大値設定
const MAX_RAW_OUTPUT_LENGTH = Infinity; // 100KB
const MAX_TERMINAL_MESSAGES = 1000; // ターミナルメッセージの最大保持数

function App() {
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  // プロバイダー別CLIログ管理
  const [aiLogs, setAiLogs] = useState<Map<AiProvider, string>>(new Map());
  const [rawOutput, setRawOutput] = useState<string>(''); // 現在のプロバイダーの生ログを表示用（aiLogsと同期）
  const [currentRepo, setCurrentRepo] = useState<string>(() => {
    // URLのクエリパラメータからリポジトリパスを復元
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('repo') || '';
  });
  const [currentProvider, setCurrentProvider] = useState<AiProvider>(() => {
    // localStorageから復元、デフォルトはclaude
    return (localStorage.getItem('preferred-ai-provider') as AiProvider) || 'claude';
  });

  // プロバイダー変更時にlocalStorageに保存 & rawOutputを同期
  useEffect(() => {
    localStorage.setItem('preferred-ai-provider', currentProvider);

    // プロバイダー切替時にrawOutputを同期
    setRawOutput(aiLogs.get(currentProvider) || '');
  }, [currentProvider, aiLogs]);
  const [claudeOutputFocused, setClaudeOutputFocused] =
    useState<boolean>(false);

  // ブラウザの戻る/進むボタン対応
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const repoFromUrl = urlParams.get('repo') || '';

      if (repoFromUrl !== currentRepo) {
        setCurrentRepo(repoFromUrl);
        if (!repoFromUrl) {
          setRawOutput('');
          setCurrentSessionId('');
          // ホームに戻る際はターミナル状態もクリア
          setTerminals([]);
          setActiveTerminalId('');
          setTerminalMessages([]);
          setTerminalHistories(new Map());
          setShortcuts([]);
          setBranches([]);
          setCurrentBranch('');
          setNpmScripts({});
        } else {
          // 別のリポジトリに切り替わる場合は、そのリポジトリのターミナル一覧を取得
          if (socket) {
            // サーバーにアクティブリポジトリを通知（プロバイダー情報付き）
            socket.emit('switch-repo', { path: repoFromUrl, provider: currentProvider });

            socket.emit('list-terminals', { repositoryPath: repoFromUrl });
            socket.emit('get-ai-history', { repositoryPath: repoFromUrl, provider: currentProvider });
            socket.emit('get-claude-history', { repositoryPath: repoFromUrl }); // 後方互換性
            socket.emit('list-shortcuts', { repositoryPath: repoFromUrl });
            socket.emit('list-branches', { repositoryPath: repoFromUrl });
            socket.emit('get-npm-scripts', { repositoryPath: repoFromUrl });
            socket.emit('get-automode-configs', {
              repositoryPath: repoFromUrl,
            });
            socket.emit('get-automode-status', { repositoryPath: repoFromUrl });
          }
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentRepo, socket]);

  // プロバイダー別セッションID管理（将来の拡張用）
  const [aiSessionIds, _setAiSessionIds] = useState<Map<AiProvider, string>>(new Map());
  const [currentSessionId, setCurrentSessionId] = useState<string>('');

  // currentProviderの最新値を保持するref
  const currentProviderRef = useRef(currentProvider);
  useEffect(() => {
    currentProviderRef.current = currentProvider;
  }, [currentProvider]);

  const [isConnected, setIsConnected] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSwitchingRepo, setIsSwitchingRepo] = useState(false);
  const [isLoadingRepoData, setIsLoadingRepoData] = useState(false);

  // currentRepoの最新値を保持するref
  const currentRepoRef = useRef(currentRepo);
  useEffect(() => {
    currentRepoRef.current = currentRepo;
  }, [currentRepo]);

  // リポジトリが変更された時にローディング状態を管理
  useEffect(() => {
    if (currentRepo) {
      // リポジトリが選択された時はローディング開始
      setIsLoadingRepoData(true);

      // 3秒のタイムアウトを設定（フォールバック）
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoadingRepoData(false);
      }, 3000);
    } else {
      // リポジトリが選択されていない時はローディング終了
      setIsLoadingRepoData(false);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
  }, [currentRepo]);

  // ターミナル関連の状態
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>('');
  const [terminalMessages, setTerminalMessages] = useState<TerminalMessage[]>(
    []
  );
  const [terminalHistories, setTerminalHistories] = useState<
    Map<string, TerminalOutputLine[]>
  >(new Map());

  // コマンドショートカット関連の状態
  const [shortcuts, setShortcuts] = useState<CommandShortcut[]>([]);

  // ブランチ関連の状態
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');

  // npmスクリプト関連の状態
  const [npmScripts, setNpmScripts] = useState<Record<string, string>>({});

  // 自走モード関連の状態
  const [autoModeConfigs, setAutoModeConfigs] = useState<AutoModeConfig[]>([]);
  const [autoModeState, setAutoModeState] = useState<AutoModeState | null>(
    null
  );

  // 差分チェック関連の状態
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_reviewServers, setReviewServers] = useState<ReviewServer[]>([]);
  const [startingReviewServer, setStartingReviewServer] =
    useState<boolean>(false);
  const [showDiffMenu, setShowDiffMenu] = useState<boolean>(false);
  const [difitUrl, setDifitUrl] = useState<string | null>(null);
  const [showDifitNotification, setShowDifitNotification] = useState<boolean>(false);
  const [showDifitOpenButton, setShowDifitOpenButton] = useState<boolean>(false);
  
  // ドロップダウンメニュー用のref
  const diffMenuRef = useRef<HTMLDivElement>(null);

  // CommandInputのrefを作成
  const commandInputRef = useRef<CommandInputRef>(null);

  // ローディング状態のref
  const isLoadingRepoDataRef = useRef(isLoadingRepoData);
  useEffect(() => {
    isLoadingRepoDataRef.current = isLoadingRepoData;
  }, [isLoadingRepoData]);

  // ドロップダウンメニューの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (diffMenuRef.current && !diffMenuRef.current.contains(event.target as Node)) {
        setShowDiffMenu(false);
      }
    };

    if (showDiffMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDiffMenu]);

  // Claude CLI出力が更新されたらローディングを終了する関数
  const endLoadingOnClaudeOutput = useCallback(() => {
    // タイムアウトをクリア
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    // ローディング状態を確実に終了
    setIsLoadingRepoData(false);
  }, []);

  // ローディングタイムアウト用のref
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    const maxReconnectAttempts = 10;
    const reconnectDelay = 2000; // 2秒

    const createConnection = () => {
      // 現在のホストを自動検出してSocket.IO接続
      const socketUrl =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
          ? 'http://localhost:3001'
          : `http://${window.location.hostname}:3001`;

      const socketInstance = io(socketUrl, {
        autoConnect: false, // 手動接続に変更
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      setSocket(socketInstance);

      socketInstance.on('repos-list', (data) => {
        setRepositories(data.repos);
      });

      // 生ログの受信（プロバイダー別に管理）
      socketInstance.on('claude-raw-output', (data) => {
        // repositoryPathが指定されていて、現在のリポジトリと一致する場合のみ表示
        if (
          !data.repositoryPath ||
          data.repositoryPath === currentRepoRef.current
        ) {
          const provider = data.provider || 'claude';

          // プロバイダー別ログマップに追記
          setAiLogs((prevLogs) => {
            const newLogs = new Map(prevLogs);
            const currentLog = newLogs.get(provider) || '';
            let newOutput = currentLog + data.content;

            // 最大文字数を超えた場合、古いデータを削除
            if (newOutput.length > MAX_RAW_OUTPUT_LENGTH) {
              newOutput = newOutput.slice(-MAX_RAW_OUTPUT_LENGTH);
            }

            newLogs.set(provider, newOutput);

            // 現在選択中のプロバイダーと一致する場合のみ表示更新
            if (provider === currentProviderRef.current) {
              setRawOutput(newOutput);
            }

            return newLogs;
          });

          // Claude出力が更新されたらローディング終了
          endLoadingOnClaudeOutput();
        }
      });

      socketInstance.on('repo-cloned', () => {
        // リポジトリクローンメッセージはリポジトリ管理画面で処理されるため、ここでは何もしない
      });

      socketInstance.on('repo-created', () => {
        // リポジトリ作成メッセージはリポジトリ管理画面で処理されるため、ここでは何もしない
      });

      socketInstance.on('repo-deleted', (data) => {
        if (data.success) {
          // 削除されたリポジトリが現在選択中のリポジトリの場合、リポジトリ選択画面に戻る
          if (currentRepoRef.current === data.path) {
            setCurrentRepo('');
            setRawOutput('');
            setCurrentSessionId('');
            setTerminals([]);
            setActiveTerminalId('');
            setTerminalMessages([]);
            setTerminalHistories(new Map());
            setShortcuts([]);
            setBranches([]);
            setCurrentBranch('');
            setNpmScripts({});
            setAutoModeConfigs([]);
            setAutoModeState(null);
            // URLからリポジトリパラメータを削除
            const url = new URL(window.location.href);
            url.searchParams.delete('repo');
            window.history.replaceState({}, '', url.toString());
          }
        }
        // リポジトリ削除メッセージもClaude出力エリアには表示しない
      });

      socketInstance.on('repo-switched', (data) => {
        if (data.success) {
          setCurrentRepo(data.currentPath);
          setCurrentSessionId(data.sessionId || '');
          // リポジトリ切り替え時は出力履歴をクリアしない（履歴は別途受信）

          // ターミナル・ブランチ関連状態をクリア
          setTerminals([]);
          setActiveTerminalId('');
          setTerminalMessages([]);
          setTerminalHistories(new Map());
          setShortcuts([]);
          setBranches([]);
          setCurrentBranch('');

          // URLにリポジトリパスを保存
          const url = new URL(window.location.href);
          url.searchParams.set('repo', data.currentPath);
          window.history.replaceState({}, '', url.toString());

          // 新しいリポジトリのターミナル一覧を取得
          socketInstance.emit('list-terminals', {
            repositoryPath: data.currentPath,
          });

          // 新しいリポジトリのショートカット一覧を取得
          socketInstance.emit('list-shortcuts', {
            repositoryPath: data.currentPath,
          });

          // 新しいリポジトリのブランチ一覧を取得
          socketInstance.emit('list-branches', {
            repositoryPath: data.currentPath,
          });

          // 新しいリポジトリのnpmスクリプト一覧を取得
          socketInstance.emit('get-npm-scripts', {
            repositoryPath: data.currentPath,
          });

          // 新しいリポジトリの自走モード設定を取得
          socketInstance.emit('get-automode-configs', {
            repositoryPath: data.currentPath,
          });
          socketInstance.emit('get-automode-status', {
            repositoryPath: data.currentPath,
          });

          // ローディング状態を解除
          setIsSwitchingRepo(false);
        } else {
          // 切り替えに失敗した場合もローディング状態を解除
          setIsSwitchingRepo(false);
        }
        // システムメッセージは表示しない（Claude CLIの出力のみを表示）
      });

      // Claude セッション作成イベント
      socketInstance.on('claude-session-created', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          setCurrentSessionId(data.sessionId);
          // Claude CLIセッション開始メッセージは表示しない（自動的にプロンプトが表示されるため）
        }
      });

      // AI出力履歴受信イベント（新形式）
      socketInstance.on('ai-output-history', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          const provider = data.provider || 'claude';
          const historyOutput = data.history
            .map((line: ClaudeOutputLine) => line.content)
            .join('');

          // プロバイダー別ログマップに反映
          setAiLogs((prevLogs) => {
            const newLogs = new Map(prevLogs);
            newLogs.set(provider, historyOutput);

            // 現在選択中のプロバイダーと一致する場合のみ表示更新
            if (provider === currentProviderRef.current) {
              setRawOutput(historyOutput);
            }

            return newLogs;
          });

          // 履歴が受信されたらローディング終了
          endLoadingOnClaudeOutput();
        }
      });

      // Claude出力履歴受信イベント（後方互換性）
      socketInstance.on('claude-output-history', (data) => {
        // Received Claude history
        if (data.repositoryPath === currentRepoRef.current) {
          // Applying Claude history to current repo
          // 履歴を復元（既存の出力を置き換え）
          const historyOutput = data.history
            .map((line: ClaudeOutputLine) => line.content)
            .join('');

          // claudeプロバイダーとしてaiLogsに反映
          setAiLogs((prevLogs) => {
            const newLogs = new Map(prevLogs);
            newLogs.set('claude', historyOutput);

            // 現在選択中のプロバイダーがclaudeの場合のみ表示更新
            if (currentProviderRef.current === 'claude') {
              setRawOutput(historyOutput);
            }

            return newLogs;
          });
          // Claude history applied

          // Claude履歴が受信されたらローディング終了
          endLoadingOnClaudeOutput();
        } else {
          // Ignoring Claude history for different repo
        }
      });

      // ターミナル関連のイベントハンドラ
      socketInstance.on('terminals-list', (data) => {
        setTerminals(data.terminals);
        // バックエンドが自動で履歴を送信するため、手動での履歴取得は不要
      });

      socketInstance.on('terminal-created', (terminal) => {
        setTerminals((prev) => [...prev, terminal]);
      });

      socketInstance.on('terminal-output', (message) => {
        setTerminalMessages((prev) => {
          const newMessages = [...prev, message];
          // 最大メッセージ数を超えた場合、古いメッセージを削除
          if (newMessages.length > MAX_TERMINAL_MESSAGES) {
            return newMessages.slice(-MAX_TERMINAL_MESSAGES);
          }
          return newMessages;
        });
      });

      socketInstance.on('terminal-closed', (data) => {
        setTerminals((prev) => prev.filter((t) => t.id !== data.terminalId));
        setTerminalMessages((prev) =>
          prev.filter((m) => m.terminalId !== data.terminalId)
        );
        setTerminalHistories((prev) => {
          const newHistories = new Map(prev);
          newHistories.delete(data.terminalId);
          return newHistories;
        });
      });

      // ターミナル出力履歴の受信
      socketInstance.on('terminal-output-history', (data) => {
        setTerminalHistories((prev) => {
          const newHistories = new Map(prev);
          newHistories.set(data.terminalId, data.history);
          return newHistories;
        });
      });

      // コマンドショートカット関連のイベントハンドラ
      socketInstance.on('shortcuts-list', (data) => {
        setShortcuts(data.shortcuts);
      });

      socketInstance.on('shortcut-created', () => {
        // ショートカット作成メッセージはターミナルエリアで処理されるため、ここでは何もしない
      });

      socketInstance.on('shortcut-deleted', () => {
        // ショートカット削除メッセージはターミナルエリアで処理されるため、ここでは何もしない
      });

      socketInstance.on('shortcut-executed', () => {
        // ショートカット実行メッセージはターミナルエリアで処理されるため、ここでは何もしない
      });

      // ブランチ関連のイベントハンドラ
      socketInstance.on('branches-list', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          setBranches(data.branches);
          const current = data.branches.find((b: GitBranch) => b.current);
          if (current) {
            setCurrentBranch(current.name);
          }
        }
      });

      // npmスクリプト関連のイベントハンドラ
      socketInstance.on('npm-scripts-list', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          setNpmScripts(data.scripts);
        }
      });

      socketInstance.on('npm-script-executed', () => {
        // npmスクリプト実行メッセージはターミナルエリアで処理されるため、ここでは何もしない
      });

      // 自走モード関連のイベントハンドラ
      socketInstance.on('automode-configs-list', (data) => {
        setAutoModeConfigs(data.configs);
      });

      socketInstance.on('automode-config-created', (data) => {
        if (data.success && data.config) {
          setAutoModeConfigs((prev) => [...prev, data.config!]);
        }
      });

      socketInstance.on('automode-config-updated', (data) => {
        if (data.success && data.config) {
          setAutoModeConfigs((prev) =>
            prev.map((config) =>
              config.id === data.config!.id ? data.config! : config
            )
          );
        }
      });

      socketInstance.on('automode-config-deleted', (data) => {
        if (data.success && data.configId) {
          setAutoModeConfigs((prev) =>
            prev.filter((config) => config.id !== data.configId)
          );
        }
      });

      socketInstance.on('automode-status-changed', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          setAutoModeState({
            repositoryPath: data.repositoryPath,
            isRunning: data.isRunning,
            currentConfigId: data.configId,
          });
        }
      });

      socketInstance.on('branch-switched', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          if (data.success) {
            setCurrentBranch(data.currentBranch);
            // ブランチ切り替えメッセージはClaude出力エリアに表示しない
            // （ブランチセレクター自体で状態が更新されるため）
          } else {
            // エラーの場合のみClaude出力エリアに表示
            setRawOutput((prev) => prev + `\n[ERROR] ${data.message}\n`);
          }
        }
      });

      // 差分チェック関連のイベントハンドラ
      socketInstance.on('review-server-started', (data) => {
        if (data.success && data.server) {
          setReviewServers((prev) => {
            const filtered = prev.filter(
              (s) => s.repositoryPath !== data.server!.repositoryPath
            );
            return [...filtered, data.server!];
          });
          setStartingReviewServer(false);

          // 新しいタブでページを開く（ブラウザベースのURLを構築）
          let url = data.server.url;
          if (url.includes('localhost')) {
            // localhostを現在のブラウザのホスト名に置き換える
            const port = url.match(/:(\d+)/)?.[1];
            if (port) {
              url = `${window.location.protocol}//${window.location.hostname}:${port}`;
            }
          }
          
          // iOS Safariでのポップアップブロック対策
          const newWindow = window.open(url, '_blank');
          if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            // ポップアップがブロックされた場合の処理
            console.warn('Popup blocked. Showing notification with link and open button.');
            
            // UI通知を表示
            setDifitUrl(url);
            setShowDifitNotification(true);
            setShowDifitOpenButton(true); // オープンボタンを表示
            
            // 10秒後に自動で通知を閉じる
            setTimeout(() => {
              setShowDifitNotification(false);
            }, 10000); // 10秒間表示
          } else {
            // タブが正常に開けた場合は通知とオープンボタンを隠す
            setShowDifitNotification(false);
            setShowDifitOpenButton(false);
          }
        } else {
          setStartingReviewServer(false);
          console.error('Failed to start review server:', data.message);
        }
      });

      socketInstance.on('review-server-stopped', (data) => {
        if (data.success) {
          setReviewServers((prev) =>
            prev.filter(
              (server) => server.repositoryPath !== data.repositoryPath
            )
          );
        }
      });

      socketInstance.on('review-servers-list', (data) => {
        setReviewServers(data.servers);
      });

      // AI出力クリア通知イベント（新形式）
      socketInstance.on('ai-output-cleared', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          const provider = data.provider || 'claude';

          // プロバイダー別ログマップからクリア
          setAiLogs((prevLogs) => {
            const newLogs = new Map(prevLogs);
            newLogs.set(provider, '');

            // 現在選択中のプロバイダーと一致する場合のみ表示更新
            if (provider === currentProviderRef.current) {
              setRawOutput('');
            }

            return newLogs;
          });
        }
      });

      // Claude出力クリア通知イベント（後方互換性）
      socketInstance.on('claude-output-cleared', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          // claudeプロバイダーとして管理
          setAiLogs((prevLogs) => {
            const newLogs = new Map(prevLogs);
            newLogs.set('claude', '');

            // 現在選択中のプロバイダーがclaudeの場合のみ表示更新
            if (currentProviderRef.current === 'claude') {
              setRawOutput('');
            }

            return newLogs;
          });
        }
      });

      socketInstance.on('connect', () => {
        // Connected to server
        setIsConnected(true);
        setIsReconnecting(false);
        setConnectionAttempts(0);

        // 接続時にリポジトリ一覧を取得
        socketInstance.emit('list-repos');
        // Emitted list-repos

        // 少し遅延を入れてcurrentRepoRef の値が確実に設定されてから履歴取得
        setTimeout(() => {
          const currentPath = currentRepoRef.current;
          const provider = currentProviderRef.current;
          // Delayed check for currentRepo

          if (currentPath) {
            // Current repo detected after delay
            // サーバーにアクティブリポジトリを通知（provider付き）
            socketInstance.emit('switch-repo', { path: currentPath, provider });

            socketInstance.emit('list-terminals', {
              repositoryPath: currentPath,
            });
            // Emitted list-terminals
            // AI履歴を取得（新形式）
            socketInstance.emit('get-ai-history', {
              repositoryPath: currentPath,
              provider,
            });
            // Claude履歴も取得（後方互換性）
            socketInstance.emit('get-claude-history', {
              repositoryPath: currentPath,
            });
            // Emitted get-history
            // ショートカット一覧も取得
            socketInstance.emit('list-shortcuts', {
              repositoryPath: currentPath,
            });
            // Emitted list-shortcuts
            // ブランチ一覧も取得
            socketInstance.emit('list-branches', {
              repositoryPath: currentPath,
            });
            // Emitted list-branches
            // npmスクリプト一覧も取得
            socketInstance.emit('get-npm-scripts', {
              repositoryPath: currentPath,
            });
            // Emitted get-npm-scripts
            // 自走モード設定も取得
            socketInstance.emit('get-automode-configs', {
              repositoryPath: currentPath,
            });
            socketInstance.emit('get-automode-status', {
              repositoryPath: currentPath,
            });
            // Emitted automode events

            // 差分チェックサーバー一覧も取得
            socketInstance.emit('get-review-servers');
          } else {
            // No current repo detected after delay
          }
        }, 100); // 100ms遅延
      });

      socketInstance.on('disconnect', (reason) => {
        setIsConnected(false);

        // 自動再接続の場合は手動再接続を試行
        if (reason === 'io server disconnect') {
          setIsReconnecting(true);
          attemptReconnect();
        }
      });

      socketInstance.on('connect_error', () => {
        setIsConnected(false);
        setIsReconnecting(true);
        attemptReconnect();
      });

      // イベントハンドラー設定後に接続
      socketInstance.connect();

      return socketInstance;
    };

    const attemptReconnect = () => {
      setConnectionAttempts((prevAttempts) => {
        if (prevAttempts < maxReconnectAttempts) {
          reconnectTimeout = setTimeout(
            () => {
              createConnection();
            },
            reconnectDelay * (prevAttempts + 1)
          ); // 指数バックオフ
          return prevAttempts + 1;
        } else {
          setIsReconnecting(false);
          return prevAttempts;
        }
      });
    };

    const socketInstance = createConnection();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      socketInstance.disconnect();
    };
  }, []); // 初期化時のみ実行

  const handleCloneRepository = (url: string, name: string) => {
    if (socket) {
      socket.emit('clone-repo', { url, name });
    }
  };

  const handleCreateRepository = (name: string) => {
    if (socket) {
      socket.emit('create-repo', { name });
    }
  };

  const handleDeleteRepository = (path: string, name: string) => {
    if (socket) {
      socket.emit('delete-repo', { path, name });
    }
  };

  const handleSwitchRepository = (path: string) => {
    if (socket) {
      // ローディング状態を開始
      setIsSwitchingRepo(true);
      socket.emit('switch-repo', { path, provider: currentProvider });
      // URLにリポジトリパスを保存
      const url = new URL(window.location.href);
      url.searchParams.set('repo', path);
      window.history.pushState({}, '', url.toString());
    }
  };

  const handleProviderChange = (provider: AiProvider) => {
    setCurrentProvider(provider);

    // 既にリポジトリが選択されている場合は、新しいプロバイダーでセッションを切り替え
    if (socket && currentRepo) {
      // aiLogsにキャッシュがあれば即座に画面反映
      const cachedLog = aiLogs.get(provider);
      if (cachedLog !== undefined) {
        setRawOutput(cachedLog);
      } else {
        setRawOutput(''); // キャッシュがない場合はクリア
      }

      // サーバーにプロバイダー切替を通知
      socket.emit('switch-repo', { path: currentRepo, provider });
      // 履歴を再取得して同期
      socket.emit('get-ai-history', { repositoryPath: currentRepo, provider });
    }
  };

  const handleBackToRepoSelection = () => {
    // サーバーにアクティブリポジトリのクリアを通知
    if (socket) {
      socket.emit('switch-repo', { path: '' });
    }

    setCurrentRepo('');
    setRawOutput(''); // CLIログをクリア
    setAutoModeConfigs([]);
    setAutoModeState(null);
    // URLからリポジトリパラメータを削除
    const url = new URL(window.location.href);
    url.searchParams.delete('repo');
    window.history.pushState({}, '', url.toString());
  };

  // コマンドショートカット関連のハンドラ
  const handleCreateShortcut = (name: string, command: string) => {
    if (socket && currentRepo) {
      const shortcutData = {
        command,
        repositoryPath: currentRepo,
        ...(name.trim() ? { name: name.trim() } : {}), // nameが入力されている場合のみ追加
      };
      socket.emit('create-shortcut', shortcutData);
    }
  };

  const handleDeleteShortcut = (shortcutId: string) => {
    if (socket) {
      socket.emit('delete-shortcut', { shortcutId });
    }
  };

  const handleExecuteShortcut = (shortcutId: string, terminalId: string) => {
    if (socket) {
      socket.emit('execute-shortcut', { shortcutId, terminalId });
    }
  };

  const handleSendCommand = (command: string) => {
    if (socket) {
      socket.emit('send-command', {
        command,
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  const handleSendArrowKey = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (socket) {
      // 方向キーに対応するANSIエスケープシーケンス
      const arrowKeys = {
        up: '\x1b[A',
        down: '\x1b[B',
        right: '\x1b[C',
        left: '\x1b[D',
      };
      socket.emit('send-command', {
        command: arrowKeys[direction],
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  const handleSendTabKey = (shift: boolean = false) => {
    if (socket) {
      // TabとShift+Tabに対応するコード
      const tabKey = shift ? '\x1b[Z' : '\t'; // Shift+TabはCSI Z、Tabは\t
      socket.emit('send-command', {
        command: tabKey,
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  const handleSendInterrupt = () => {
    if (socket) {
      socket.emit('ai-interrupt', {
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
      // 後方互換性のため
      socket.emit('claude-interrupt', {
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
      });
    }
  };

  const handleSendEscape = () => {
    if (socket) {
      socket.emit('send-command', {
        command: '\x1b', // ESC (ASCII 27)
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  const handleClearClaude = () => {
    if (socket) {
      socket.emit('send-command', {
        command: '/clear',
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };
  const handleClearClaudeOutput = () => {
    // フロントエンド側の表示をクリア
    setRawOutput('');

    // バックエンド側の履歴もクリア
    if (socket && currentRepo) {
      socket.emit('clear-ai-output', { repositoryPath: currentRepo, provider: currentProvider });
      socket.emit('clear-claude-output', { repositoryPath: currentRepo }); // 後方互換性
    }
  };

  // AIOutputからのキー入力ハンドラー
  const handleAiKeyInput = (key: string) => {
    if (socket) {
      const providerSessionId = aiSessionIds.get(currentProvider) || currentSessionId;
      socket.emit('send-command', {
        command: key,
        sessionId: providerSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  // AIOutputのフォーカス切り替えハンドラー
  const handleAiOutputFocus = () => {
    const newFocused = !claudeOutputFocused;
    setClaudeOutputFocused(newFocused);
    // フォーカスが外れた場合は、CommandInputにフォーカスを戻す
    if (claudeOutputFocused && commandInputRef.current) {
      setTimeout(() => {
        commandInputRef.current?.focus();
      }, 100);
    }
  };

  const handleChangeModel = (model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan') => {
    if (socket) {
      // モデル名を適切な値に変換
      const modelValue = model === 'OpusPlan' ? 'opusplan' : model;
      socket.emit('send-command', {
        command: `/model ${modelValue}`,
        sessionId: currentSessionId,
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  // ターミナル関連のハンドラ
  const handleCreateTerminal = (cwd: string, name?: string) => {
    if (socket) {
      socket.emit('create-terminal', { cwd, name });
    }
  };

  const handleTerminalInput = (terminalId: string, input: string) => {
    if (socket) {
      socket.emit('terminal-input', { terminalId, input });
    }
  };

  const handleTerminalSignal = (terminalId: string, signal: string) => {
    if (socket) {
      socket.emit('terminal-signal', { terminalId, signal });
    }
  };

  const handleCloseTerminal = (terminalId: string) => {
    if (socket) {
      socket.emit('close-terminal', { terminalId });
    }
  };

  // ブランチ関連のハンドラ
  const handleSwitchBranch = (branchName: string) => {
    if (socket && currentRepo) {
      socket.emit('switch-branch', { repositoryPath: currentRepo, branchName });
    }
  };

  // npmスクリプト関連のハンドラ
  const handleRefreshNpmScripts = useCallback(() => {
    if (socket && currentRepo) {
      socket.emit('get-npm-scripts', { repositoryPath: currentRepo });
    }
  }, [socket, currentRepo]);

  const handleExecuteNpmScript = (scriptName: string) => {
    if (socket && currentRepo) {
      socket.emit('execute-npm-script', {
        repositoryPath: currentRepo,
        scriptName,
        terminalId: activeTerminalId || undefined,
      });
    }
  };

  // 差分タイプを指定してdifitを起動するハンドラ
  const handleStartDifitWithType = (type: DiffType) => {
    if (socket && currentRepo) {
      setShowDiffMenu(false); // メニューを閉じる
      setStartingReviewServer(true);

      const diffConfig: DiffConfig = {
        type: type,
      };

      socket.emit('start-review-server', {
        repositoryPath: currentRepo,
        diffConfig,
      });
    }
  };


  // リポジトリが選択されていない場合はリポジトリ管理画面を表示
  if (!currentRepo) {
    return (
      <div className="min-h-screen bg-gray-900">
        <div className="min-h-screen flex flex-col">
          {/* ヘッダー */}
          <header className="bg-gray-800 shadow-sm border-b border-gray-700">
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold text-white">
                    dokodemo-claude
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-300 mt-1">
                    Claude Code CLI Web Interface
                  </p>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isConnected
                        ? 'bg-green-500'
                        : isReconnecting
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  ></div>
                  <span className="text-xs text-gray-300 font-medium">
                    {isConnected
                      ? '接続中'
                      : isReconnecting
                        ? `再接続中 (${connectionAttempts})`
                        : '未接続'}
                  </span>
                </div>
              </div>
            </div>
          </header>

          {/* メインコンテンツ */}
          <main className="flex-1 flex items-center justify-center p-3 sm:p-4">
            <div className="w-full max-w-4xl">
              <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden">
                <div className="px-4 py-4 sm:px-8 sm:py-6 bg-gradient-to-r from-gray-700 to-gray-600 text-white">
                  <h2 className="text-lg sm:text-xl font-semibold text-center">
                    リポジトリを選択してください
                  </h2>
                  <p className="text-gray-200 text-xs sm:text-sm text-center mt-2">
                    既存のリポジトリを選択するか、新しいリポジトリをクローンしてください
                  </p>
                </div>
                <div className="p-4 sm:p-8">
                  <RepositoryManager
                    repositories={repositories}
                    currentRepo={currentRepo}
                    onCloneRepository={handleCloneRepository}
                    onCreateRepository={handleCreateRepository}
                    onSwitchRepository={handleSwitchRepository}
                    isConnected={isConnected}
                  />
                </div>
              </div>
            </div>
          </main>

          {/* リポジトリ切り替え中のローディングオーバーレイ */}
          {isSwitchingRepo && (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
              <div className="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
                <div className="flex flex-col items-center space-y-4">
                  <svg
                    className="animate-spin h-12 w-12 text-blue-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      リポジトリを切り替えています
                    </h3>
                    <p className="text-sm text-gray-300">
                      {currentProvider === 'claude' ? 'Claude CLI' : 'Codex CLI'}セッションを準備中です...
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // リポジトリが選択されている場合はメイン画面を表示
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-gray-800 shadow-sm border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
            <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
              <button
                onClick={handleBackToRepoSelection}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-200 bg-gray-700 border border-gray-600 rounded-md hover:bg-gray-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors flex-shrink-0"
              >
                <svg
                  className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                <span className="hidden xs:inline">リポジトリ選択</span>
                <span className="xs:hidden">戻る</span>
              </button>
              <div className="border-l border-gray-600 pl-2 sm:pl-4 min-w-0 flex-1">
                <h1 className="text-sm sm:text-lg font-semibold text-white truncate">
                  {currentRepo.split('/').pop() || 'プロジェクト'}
                </h1>
                <p className="text-xs text-gray-400 truncate max-w-full sm:max-w-96">
                  {currentRepo}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3">
              {/* プロバイダー選択 */}
              <div className="hidden sm:block">
                <ProviderSelector
                  currentProvider={currentProvider}
                  onProviderChange={handleProviderChange}
                  disabled={!currentRepo || !isConnected}
                />
              </div>
              <div className="flex items-center space-x-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isConnected
                      ? 'bg-green-500'
                      : isReconnecting
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                ></div>
                <span className="text-xs text-gray-300 font-medium">
                  {isConnected
                    ? '接続中'
                    : isReconnecting
                      ? `再接続中 (${connectionAttempts})`
                      : '未接続'}
                </span>
                {currentSessionId && (
                  <span className="text-xs text-blue-400 font-mono">
                    #{currentSessionId.split('-')[1]}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 lg:px-8 py-4 sm:py-6 flex flex-col space-y-4 sm:space-y-6">
        {/* ブランチセレクター */}
        <div className="flex items-center space-x-4 justify-between">
          <BranchSelector
            branches={branches}
            currentBranch={currentBranch}
            onSwitchBranch={handleSwitchBranch}
            isConnected={isConnected}
          />
          
          {/* difitボタングループ */}
          <div className="flex items-center">
            {/* difitページオープンボタン（ポップアップブロック対応） */}
            {showDifitOpenButton && difitUrl && (
              <button
                onClick={() => {
                  window.open(difitUrl, '_blank');
                  setShowDifitOpenButton(false);
                  setShowDifitNotification(false);
                }}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 mr-2 text-xs sm:text-sm font-medium text-white bg-green-600 border border-green-500 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                title="difitページを開く"
              >
                <svg
                  className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                <span className="hidden sm:inline">🚀 Open</span>
                <span className="sm:hidden">🚀</span>
              </button>
            )}

            {/* difitドロップダウンボタン */}
            <div className="relative">
            {startingReviewServer ? (
              // 起動中 - ローディングアイコン
              <button
                disabled
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-400 bg-gray-600 border border-gray-500 rounded-md cursor-not-allowed"
                title="difit起動中..."
              >
                <svg
                  className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span className="hidden sm:inline">起動中...</span>
              </button>
            ) : (
              // difitドロップダウンボタン
              <div ref={diffMenuRef}>
                <button
                  onClick={() => setShowDiffMenu(!showDiffMenu)}
                  disabled={!isConnected}
                  className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 border border-blue-500 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="差分タイプを選択してdifitを起動"
                >
                  <span>difit</span>
                  <svg
                    className="w-3 h-3 sm:w-4 sm:h-4 ml-1 sm:ml-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* ドロップダウンメニュー - ダークモード対応コンパクト */}
                {showDiffMenu && (
                  <div className="absolute right-0 mt-2 w-24 sm:w-28 bg-gray-800 rounded-md shadow-lg ring-1 ring-gray-700 z-50">
                    <div className="py-0.5">
                      <button
                        onClick={() => handleStartDifitWithType('HEAD')}
                        className="flex items-center justify-center w-full px-2 py-2 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        <span>HEAD</span>
                        <span className="hidden sm:inline ml-1 text-gray-400 text-xs">最新</span>
                      </button>
                      <button
                        onClick={() => handleStartDifitWithType('staged')}
                        className="flex items-center justify-center w-full px-2 py-2 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        <span>Staged</span>
                        <span className="hidden sm:inline ml-1 text-gray-400 text-xs">準備済</span>
                      </button>
                      <button
                        onClick={() => handleStartDifitWithType('working')}
                        className="flex items-center justify-center w-full px-2 py-2 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        <span>Working</span>
                        <span className="hidden sm:inline ml-1 text-gray-400 text-xs">作業中</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Claude CLI セクション */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700 flex-1 flex flex-col min-h-80 sm:min-h-96">
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-gray-700 bg-gray-750 rounded-t-lg">
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {currentProvider === 'claude' ? 'Claude CLI' : 'Codex CLI'}
            </h2>
          </div>
          <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-6">
            {/* AI出力エリア */}
            <div className="flex-1 min-h-0">
              <AiOutput
                rawOutput={rawOutput}
                currentProvider={currentProvider}
                isLoading={isLoadingRepoData}
                onClickFocus={handleAiOutputFocus}
                onClearOutput={handleClearClaudeOutput}
                onKeyInput={handleAiKeyInput}
                isFocused={claudeOutputFocused}
              />
            </div>

            {/* AI コマンド入力エリア */}
            <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-gray-700">
              <CommandInput
                ref={commandInputRef}
                onSendCommand={handleSendCommand}
                onSendArrowKey={handleSendArrowKey}
                onSendTabKey={handleSendTabKey}
                onSendInterrupt={handleSendInterrupt}
                onSendEscape={handleSendEscape}
                onClearAi={handleClearClaude}
                onChangeModel={handleChangeModel}
                currentProvider={currentProvider}
                disabled={!isConnected || !currentRepo}
              />
            </div>
          </div>
        </section>

        {/* ターミナルエリア */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700 flex-1 flex flex-col min-h-80 sm:min-h-96">
          <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-gray-700 bg-gray-750 rounded-t-lg">
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              ターミナル
            </h2>
          </div>
          <div className="flex-1 min-h-0 p-3 sm:p-6">
            <TerminalManager
              terminals={terminals}
              messages={terminalMessages}
              histories={terminalHistories}
              shortcuts={shortcuts}
              currentRepo={currentRepo}
              isConnected={isConnected}
              activeTerminalId={activeTerminalId}
              onActiveTerminalChange={setActiveTerminalId}
              onCreateTerminal={handleCreateTerminal}
              onTerminalInput={handleTerminalInput}
              onTerminalSignal={handleTerminalSignal}
              onCloseTerminal={handleCloseTerminal}
              onCreateShortcut={handleCreateShortcut}
              onDeleteShortcut={handleDeleteShortcut}
              onExecuteShortcut={handleExecuteShortcut}
            />
          </div>
        </section>

        {/* npmスクリプトセクション */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700">
          <NpmScripts
            repositoryPath={currentRepo}
            scripts={npmScripts}
            isConnected={isConnected}
            onExecuteScript={handleExecuteNpmScript}
            onRefreshScripts={handleRefreshNpmScripts}
          />
        </section>

        {/* 自走モード設定セクション */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700">
          <div className="px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-white flex items-center">
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-purple-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                自走モード
              </h3>

              {/* 自走モード停止ボタン */}
              {autoModeState?.isRunning && (
                <button
                  onClick={() => {
                    if (socket && currentRepo) {
                      socket.emit('stop-automode', {
                        repositoryPath: currentRepo,
                      });
                    }
                  }}
                  disabled={!isConnected}
                  className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-red-600 border border-red-500 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="自走モードを停止"
                >
                  <svg
                    className="w-4 h-4 mr-1.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 10h6v4H9z"
                    />
                  </svg>
                  停止
                </button>
              )}
            </div>
            <AutoModeSettings
              socket={socket!}
              repositoryPath={currentRepo}
              configs={autoModeConfigs}
              autoModeState={autoModeState}
            />
          </div>
        </section>

        {/* リポジトリ削除セクション */}
        <section className="bg-gray-800 rounded-lg shadow-sm border border-gray-700">
          <div className="px-4 sm:px-6 py-4">
            <h3 className="text-base font-semibold text-white mb-3">
              リポジトリを削除
            </h3>
            <div className="text-center">
              <p className="text-sm text-gray-300 mb-4">
                このリポジトリを完全に削除します（この操作は元に戻せません）
              </p>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={!isConnected}
                className="inline-flex items-center justify-center px-6 py-2 text-sm font-medium text-red-200 bg-red-900 border border-red-700 rounded-md hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                削除
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* difit サーバー通知（ポップアップブロック対応） */}
      {showDifitNotification && difitUrl && (
        <div className="fixed bottom-4 right-4 bg-gray-800 rounded-lg shadow-xl max-w-xs w-full p-3 border border-gray-700 z-50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-white">
              🚀 difitサーバー起動
            </h3>
            <button
              onClick={() => {
                setShowDifitNotification(false);
              }}
              className="text-gray-400 hover:text-gray-300 focus:outline-none"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-300 mb-3">
            ポップアップがブロックされました
          </p>
          <button
            onClick={() => {
              window.open(difitUrl, '_blank');
              setShowDifitNotification(false);
            }}
            className="w-full bg-blue-600 text-white px-4 py-2.5 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors mb-2"
          >
            ページを開く
          </button>
          <div className="bg-gray-700 rounded p-2 border border-gray-600">
            <p className="text-xs text-gray-300 break-all">
              {difitUrl}
            </p>
          </div>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-700">
            <div className="flex items-center space-x-3 mb-4">
              <div className="flex-shrink-0">
                <svg
                  className="h-6 w-6 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-white">
                  リポジトリを削除しますか？
                </h3>
              </div>
            </div>
            <div className="mb-6">
              <div className="bg-red-900 rounded-md p-4 mb-4 border border-red-700">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-red-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h4 className="text-sm font-medium text-red-200">
                      注意: この操作は元に戻せません
                    </h4>
                    <div className="mt-2 text-sm text-red-300">
                      <ul className="list-disc list-inside space-y-1">
                        <li>リポジトリディレクトリ全体が削除されます</li>
                        <li>Claude CLIセッションが終了されます</li>
                        <li>実行中のターミナルが全て終了されます</li>
                        <li>履歴データがすべて消去されます</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-700 rounded-md p-3 border border-gray-600">
                <p className="text-sm font-medium text-white">
                  {currentRepo.split('/').pop()}
                </p>
                <p className="text-xs text-gray-400 mt-1">{currentRepo}</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-gray-700 text-gray-200 border border-gray-600 py-2 px-4 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const repoName = currentRepo.split('/').pop() || '';
                  handleDeleteRepository(currentRepo, repoName);
                  setShowDeleteConfirm(false);
                }}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors font-medium"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
