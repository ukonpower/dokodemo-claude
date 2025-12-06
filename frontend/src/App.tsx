import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  GitRepository,
  GitBranch,
  Terminal,
  TerminalMessage,
  TerminalOutputLine,
  ClaudeOutputLine,
  AiOutputLine,
  CommandShortcut,
  AutoModeConfig,
  AutoModeState,
  ReviewServer,
  DiffType,
  DiffConfig,
  AiProvider,
  EditorInfo,
  ProjectTemplate,
  ServerToClientEvents,
  ClientToServerEvents,
  CommandType,
  CommandConfig,
} from './types';

import RepositoryManager from './components/RepositoryManager';
import AiOutput from './components/AiOutput';
import TextInput, { TextInputRef } from './components/CommandInput';
import { KeyboardButtons } from './components/KeyboardButtons';
import TerminalManager from './components/TerminalManager';
import BranchSelector from './components/BranchSelector';
import NpmScripts from './components/NpmScripts';
import AutoModeSettings from './components/AutoModeSettings';
import ProviderSelector from './components/ProviderSelector';
import { PopupBlockedModal } from './components/PopupBlockedModal';

// メモリリーク対策のための最大値設定
const MAX_TERMINAL_MESSAGES = 1000; // ターミナルメッセージの最大保持数

function App() {
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  // プロバイダー別CLIログ管理（メッセージ配列ベース）
  const [aiMessages, setAiMessages] = useState<Map<AiProvider, AiOutputLine[]>>(
    new Map()
  );
  const aiMessagesRef = useRef(aiMessages);
  useEffect(() => {
    aiMessagesRef.current = aiMessages;
  }, [aiMessages]);
  const [currentAiMessages, setCurrentAiMessages] = useState<AiOutputLine[]>(
    []
  ); // 現在のプロバイダーのメッセージを表示用（aiMessagesと同期）
  const [currentRepo, setCurrentRepo] = useState<string>(() => {
    // URLのクエリパラメータからリポジトリパスを復元
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('repo') || '';
  });
  const [currentProvider, setCurrentProvider] = useState<AiProvider>(() => {
    // localStorageから復元、デフォルトはclaude
    return (
      (localStorage.getItem('preferred-ai-provider') as AiProvider) || 'claude'
    );
  });

  // プロバイダー変更時にlocalStorageに保存 & currentAiMessagesを同期
  useEffect(() => {
    localStorage.setItem('preferred-ai-provider', currentProvider);

    const nextMessages = aiMessages.get(currentProvider) || [];
    console.log('[App] Provider changed, updating currentAiMessages:', {
      provider: currentProvider,
      messageCount: nextMessages.length,
    });
    // 新しい配列参照を作成して確実に再レンダリングをトリガー
    setCurrentAiMessages([...nextMessages]);
  }, [aiMessages, currentProvider]);

  // ブラウザの戻る/進むボタン対応
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const repoFromUrl = urlParams.get('repo') || '';

      if (repoFromUrl !== currentRepo) {
        setCurrentRepo(repoFromUrl);
        if (!repoFromUrl) {
          setCurrentAiMessages([]);
          setCurrentSessionId('');
          // ホームに戻る際はターミナル状態もクリア
          setTerminals([]);
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
            socket.emit('switch-repo', {
              path: repoFromUrl,
              provider: currentProvider,
              initialSize: aiTerminalSize || undefined,
            });

            socket.emit('list-terminals', { repositoryPath: repoFromUrl });
            socket.emit('get-ai-history', {
              repositoryPath: repoFromUrl,
              provider: currentProvider,
            });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo, socket]);

  // プロバイダー別セッションID管理（将来の拡張用）
  const [aiSessionIds, setAiSessionIds] = useState<Map<AiProvider, string>>(
    new Map()
  );
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
  const [availableEditors, setAvailableEditors] = useState<EditorInfo[]>([]);

  // localhostからのアクセスかどうかを判定
  const isLocalhost = useMemo(() => {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }, []);
  // AI CLIターミナルの現在のサイズを保持
  const [aiTerminalSize, setAiTerminalSize] = useState<{
    cols: number;
    rows: number;
  } | null>(null);

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

  // ページタイトルをリポジトリ名で更新
  useEffect(() => {
    if (currentRepo) {
      // リポジトリパスから最後のディレクトリ名を取得
      const repoName = currentRepo.split('/').filter(Boolean).pop() || 'Repository';
      document.title = repoName;
    } else {
      // リポジトリが選択されていない場合は元のタイトルに戻す
      document.title = 'Claude Code Web';
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
  const [showDifitNotification, setShowDifitNotification] =
    useState<boolean>(false);
  const [showDifitOpenButton, setShowDifitOpenButton] =
    useState<boolean>(false);
  const [showEditorMenu, setShowEditorMenu] = useState<boolean>(false);

  // GitHubリモートURL関連
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  // code-server関連の状態
  const [startingCodeServer, setStartingCodeServer] =
    useState<boolean>(false);
  const [showPopupBlockedModal, setShowPopupBlockedModal] =
    useState<boolean>(false);
  const [blockedCodeServerUrl, setBlockedCodeServerUrl] = useState<string>('');

  // ドロップダウンメニュー用のref
  const diffMenuRef = useRef<HTMLDivElement>(null);
  const editorMenuRef = useRef<HTMLDivElement>(null);

  // CommandInputのrefを作成
  const textInputRef = useRef<TextInputRef>(null);

  // ローディング状態のref
  const isLoadingRepoDataRef = useRef(isLoadingRepoData);
  useEffect(() => {
    isLoadingRepoDataRef.current = isLoadingRepoData;
  }, [isLoadingRepoData]);

  // ドロップダウンメニューの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        diffMenuRef.current &&
        !diffMenuRef.current.contains(event.target as Node)
      ) {
        setShowDiffMenu(false);
      }
      if (
        editorMenuRef.current &&
        !editorMenuRef.current.contains(event.target as Node)
      ) {
        setShowEditorMenu(false);
      }
    };

    if (showDiffMenu || showEditorMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDiffMenu, showEditorMenu]);

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
      // フロントエンドと同じホスト名でバックエンドに接続（外部アクセス対応）
      const backendPort = import.meta.env.VITE_BACKEND_PORT || '3200';
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socketUrl = `${protocol}//${window.location.hostname}:${backendPort}`;

      const socketInstance = io(socketUrl, {
        autoConnect: false, // 手動接続に変更
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        transports: ['websocket'],
      });

      setSocket(socketInstance);

      socketInstance.on('repos-list', (data) => {
        setRepositories(data.repos);
      });

      // テンプレート関連のイベントリスナー
      socketInstance.on('templates-list', (data) => {
        setTemplates(data.templates);
      });

      socketInstance.on('template-saved', (data) => {
        if (data.success) {
          console.log(data.message);
        } else {
          console.error(data.message);
        }
      });

      socketInstance.on('template-deleted', (data) => {
        if (data.success) {
          console.log(data.message);
        } else {
          console.error(data.message);
        }
      });

      // テンプレート一覧を取得
      socketInstance.emit('get-templates');

      // 利用可能なエディタリストの受信
      socketInstance.on('available-editors', (data) => {
        setAvailableEditors(
          data.editors.filter((editor: EditorInfo) => editor.available)
        );
      });

      // リモートURL受信
      socketInstance.on('remote-url', (data) => {
        if (data.success && data.remoteUrl) {
          setRemoteUrl(data.remoteUrl);
        } else {
          setRemoteUrl(null);
        }
      });

      // 新しい構造化メッセージの受信（プロバイダー別に管理）
      socketInstance.on('ai-output-line', (data) => {
        // repositoryPathが指定されていて、現在のリポジトリと一致する場合のみ表示
        if (
          !data.repositoryPath ||
          data.repositoryPath === currentRepoRef.current
        ) {
          const provider = data.provider;

          // デバッグログ
          console.log('[ai-output-line] received:', {
            provider,
            currentProvider: currentProviderRef.current,
            messageId: data.outputLine.id,
            contentLength: data.outputLine.content.length,
          });

          // プロバイダー別メッセージ配列に追記
          setAiMessages((prevMessages) => {
            const newMessages = new Map(prevMessages);
            const currentMessages = newMessages.get(provider) || [];

            // 重複チェック: 同じIDのメッセージは追加しない
            const isDuplicate = currentMessages.some(
              (msg) => msg.id === data.outputLine.id
            );

            if (isDuplicate) {
              console.warn(
                '[ai-output-line] Duplicate message:',
                data.outputLine.id
              );
              return prevMessages; // 変更なし
            }

            const updatedMessages = [...currentMessages, data.outputLine];

            // 最大行数を超えた場合、古いデータを削除
            const MAX_MESSAGES = 500;
            const finalMessages =
              updatedMessages.length > MAX_MESSAGES
                ? updatedMessages.slice(-MAX_MESSAGES)
                : updatedMessages;

            newMessages.set(provider, finalMessages);

            console.log('[ai-output-line] State updated:', {
              provider,
              messageCount: finalMessages.length,
              isCurrentProvider: provider === currentProviderRef.current,
            });

            // 現在選択中のプロバイダーと一致する場合のみ表示更新
            if (provider === currentProviderRef.current) {
              // 新しい配列参照を作成して確実に再レンダリングをトリガー
              setCurrentAiMessages([...finalMessages]);
            }

            return newMessages;
          });

          // Claude出力が更新されたらローディング終了
          endLoadingOnClaudeOutput();
        }
      });

      // 生ログの受信（後方互換性用、プロバイダー別に管理）
      socketInstance.on('claude-raw-output', () => {
        // 新しい 'ai-output-line' イベントが使用されている場合は無視
        // (後方互換性のために残しておくが、新しいイベントが優先される)
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
            setCurrentAiMessages([]);
            setCurrentSessionId('');
            setTerminals([]);
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
          setTerminalMessages([]);
          setTerminalHistories(new Map());
          setShortcuts([]);
          setBranches([]);
          setCurrentBranch('');

          // リモートURLをリセット
          setRemoteUrl(null);
          // 新しいリポジトリのリモートURLを取得
          if (data.currentPath) {
            socketInstance.emit('get-remote-url', {
              repositoryPath: data.currentPath,
            });
          }

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

      // AI CLI再起動イベント
      socketInstance.on('ai-restarted', (data) => {
        if (
          data.repositoryPath === currentRepoRef.current &&
          data.provider === currentProviderRef.current
        ) {
          if (data.success && data.sessionId) {
            // 新しいセッションIDを更新
            setCurrentSessionId(data.sessionId);

            // aiSessionIdsマップも更新
            setAiSessionIds((prevIds) => {
              const newIds = new Map(prevIds);
              newIds.set(data.provider, data.sessionId);
              return newIds;
            });
          }
        }
      });

      // AI出力履歴受信イベント（新形式）
      socketInstance.on('ai-output-history', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          const provider = data.provider || 'claude';
          const historyMessages: AiOutputLine[] = data.history;

          console.log('[ai-output-history] received:', {
            provider,
            historyCount: historyMessages.length,
            currentProvider: currentProviderRef.current,
          });

          const existingMessages = aiMessagesRef.current.get(provider) || [];
          if (historyMessages.length === 0 && existingMessages.length > 0) {
            console.log(
              '[ai-output-history] Skipping empty history (already have messages)'
            );
            return;
          }

          // プロバイダー別メッセージ配列に反映
          setAiMessages((prevMessages) => {
            const newMessages = new Map(prevMessages);
            newMessages.set(provider, historyMessages);

            // 現在選択中のプロバイダーと一致する場合のみ表示更新
            if (provider === currentProviderRef.current) {
              console.log('[ai-output-history] Updating currentAiMessages');
              // 新しい配列参照を作成して確実に再レンダリングをトリガー
              setCurrentAiMessages([...historyMessages]);
            }

            return newMessages;
          });

          // 履歴が受信されたらローディング終了
          endLoadingOnClaudeOutput();
        }
      });

      // Claude出力履歴受信イベント（後方互換性）
      socketInstance.on('claude-output-history', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          // ClaudeOutputLineをAiOutputLineに変換してclaudeプロバイダーとして処理
          const historyMessages: AiOutputLine[] = data.history.map(
            (line: ClaudeOutputLine) => ({
              ...line,
              provider: 'claude' as AiProvider,
            })
          );

          console.log('[claude-output-history] received (legacy):', {
            historyCount: historyMessages.length,
            currentProvider: currentProviderRef.current,
          });

          const existingMessages = aiMessagesRef.current.get('claude') || [];
          if (historyMessages.length === 0 && existingMessages.length > 0) {
            console.log(
              '[claude-output-history] Skipping empty history (already have messages)'
            );
            return;
          }

          // claudeプロバイダーとしてaiMessagesに反映
          setAiMessages((prevMessages) => {
            const newMessages = new Map(prevMessages);
            newMessages.set('claude', historyMessages);

            // 現在選択中のプロバイダーがclaudeの場合のみ表示更新
            if (currentProviderRef.current === 'claude') {
              console.log('[claude-output-history] Updating currentAiMessages');
              // 新しい配列参照を作成して確実に再レンダリングをトリガー
              setCurrentAiMessages([...historyMessages]);
            }

            return newMessages;
          });

          // Claude履歴が受信されたらローディング終了
          endLoadingOnClaudeOutput();
        }
      });

      // ターミナル関連のイベントハンドラ
      socketInstance.on('terminals-list', (data) => {
        setTerminals(data.terminals);
        // バックエンドが自動で履歴を送信するため、手動での履歴取得は不要
      });

      socketInstance.on('terminal-created', (terminal) => {
        setTerminals((prev) => [...prev, terminal]);
        // 最初のターミナル作成時にデフォルトショートカットが作成されるため、リストを再取得
        const repo = currentRepoRef.current;
        if (repo) {
          socketInstance.emit('list-shortcuts', {
            repositoryPath: repo,
          });
        }
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
            // エラーの場合のみAI出力エリアに表示
            const errorMessage: AiOutputLine = {
              id: `error-${Date.now()}`,
              content: `\n[ERROR] ${data.message}\n`,
              timestamp: Date.now(),
              type: 'system',
              provider: currentProviderRef.current,
            };
            setCurrentAiMessages((prev) => [...prev, errorMessage]);
            setAiMessages((prevMessages) => {
              const newMessages = new Map(prevMessages);
              const currentMessages =
                newMessages.get(currentProviderRef.current) || [];
              newMessages.set(currentProviderRef.current, [
                ...currentMessages,
                errorMessage,
              ]);
              return newMessages;
            });
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
          if (
            !newWindow ||
            newWindow.closed ||
            typeof newWindow.closed === 'undefined'
          ) {
            // ポップアップがブロックされた場合の処理
            console.warn(
              'Popup blocked. Showing notification with link and open button.'
            );

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

      // エディタ起動関連イベントハンドラ
      socketInstance.on('editor-opened', (data) => {
        if (!data.success) {
          console.error(data.message);
          alert(data.message);
        }
      });

      // code-server URL取得イベントハンドラ
      socketInstance.on('code-server-url', (data) => {
        setStartingCodeServer(false);
        if (data.success && data.url) {
          // 新しいタブでcode-serverを開く
          const newWindow = window.open(data.url, '_blank');
          if (
            !newWindow ||
            newWindow.closed ||
            typeof newWindow.closed === 'undefined'
          ) {
            console.warn('Popup blocked. Showing modal.');
            // Safari等でポップアップがブロックされた場合、モーダルを表示
            setBlockedCodeServerUrl(data.url);
            setShowPopupBlockedModal(true);
          }
        } else {
          console.error('Failed to get code-server URL:', data.message);
          alert(`code-serverのURLを取得できませんでした: ${data.message}`);
        }
      });

      // AI出力クリア通知イベント（新形式）
      socketInstance.on('ai-output-cleared', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          const provider = data.provider || 'claude';

          // プロバイダー別メッセージ配列をクリア
          setAiMessages((prevMessages) => {
            const newMessages = new Map(prevMessages);
            newMessages.set(provider, []);

            // 現在選択中のプロバイダーと一致する場合のみ表示更新
            if (provider === currentProviderRef.current) {
              setCurrentAiMessages([]);
            }

            return newMessages;
          });
        }
      });

      // Claude出力クリア通知イベント（後方互換性）
      socketInstance.on('claude-output-cleared', (data) => {
        if (data.repositoryPath === currentRepoRef.current) {
          // claudeプロバイダーとして管理
          setAiMessages((prevMessages) => {
            const newMessages = new Map(prevMessages);
            newMessages.set('claude', []);

            // 現在選択中のプロバイダーがclaudeの場合のみ表示更新
            if (currentProviderRef.current === 'claude') {
              setCurrentAiMessages([]);
            }

            return newMessages;
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

        // 利用可能なエディタリストを取得
        socketInstance.emit('get-available-editors');

        // リポジトリが選択されている場合は即座に履歴取得
        const currentPath = currentRepoRef.current;
        const provider = currentProviderRef.current;

        if (currentPath) {
          // Current repo detected
          // サーバーにアクティブリポジトリを通知（provider付き）
          socketInstance.emit('switch-repo', {
            path: currentPath,
            provider,
            initialSize: aiTerminalSize || undefined,
          });

          // ターミナル一覧と履歴を取得
          socketInstance.emit('list-terminals', {
            repositoryPath: currentPath,
          });

          // AI出力履歴を取得（新形式）
          socketInstance.emit('get-ai-history', {
            repositoryPath: currentPath,
            provider,
          });

          // Claude出力履歴も取得（後方互換性）
          socketInstance.emit('get-claude-history', {
            repositoryPath: currentPath,
          });

          // ショートカット一覧も取得
          socketInstance.emit('list-shortcuts', {
            repositoryPath: currentPath,
          });

          // ブランチ一覧も取得
          socketInstance.emit('list-branches', {
            repositoryPath: currentPath,
          });

          // npmスクリプト一覧も取得
          socketInstance.emit('get-npm-scripts', {
            repositoryPath: currentPath,
          });

          // 自走モード設定も取得
          socketInstance.emit('get-automode-configs', {
            repositoryPath: currentPath,
          });
          socketInstance.emit('get-automode-status', {
            repositoryPath: currentPath,
          });

          // 差分チェックサーバー一覧も取得
          socketInstance.emit('get-review-servers');
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleCreateFromTemplate = (
    templateUrl: string,
    projectName: string,
    createInitialCommit: boolean,
    updatePackageJson: boolean
  ) => {
    if (socket) {
      socket.emit('create-from-template', {
        templateUrl,
        projectName,
        createInitialCommit,
        updatePackageJson,
      });
    }
  };

  const handleSaveTemplate = (
    name: string,
    url: string,
    description?: string
  ) => {
    if (socket) {
      socket.emit('save-template', { name, url, description });
    }
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (socket) {
      socket.emit('delete-template', { templateId });
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
      socket.emit('switch-repo', {
        path,
        provider: currentProvider,
        initialSize: aiTerminalSize || undefined,
      });
      // URLにリポジトリパスを保存
      const url = new URL(window.location.href);
      url.searchParams.set('repo', path);
      window.history.pushState({}, '', url.toString());

      // 最終アクセス時刻をlocalStorageに保存
      const now = Date.now();
      const lastAccessTimes = JSON.parse(
        localStorage.getItem('repo-last-access') || '{}'
      );
      lastAccessTimes[path] = now;
      localStorage.setItem('repo-last-access', JSON.stringify(lastAccessTimes));
    }
  };

  const handleProviderChange = (provider: AiProvider) => {
    setCurrentProvider(provider);

    // 既にリポジトリが選択されている場合は、新しいプロバイダーでセッションを切り替え
    if (socket && currentRepo) {
      // aiMessagesにキャッシュがあれば即座に画面反映
      const cachedMessages = aiMessages.get(provider);
      if (cachedMessages !== undefined) {
        setCurrentAiMessages(cachedMessages);
      } else {
        setCurrentAiMessages([]); // キャッシュがない場合はクリア
      }

      // サーバーにプロバイダー切替を通知
      socket.emit('switch-repo', {
        path: currentRepo,
        provider,
        initialSize: aiTerminalSize || undefined,
      });
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
    setCurrentAiMessages([]); // CLIログをクリア
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

  /**
   * コマンドタイプごとの設定
   * needsEnter: コマンド送信後に自動的に改行を送信するか
   */
  const commandConfigs: Record<CommandType, CommandConfig> = {
    prompt: { needsEnter: true }, // ユーザープロンプトは改行を送信
    clear: { needsEnter: true }, // /clearコマンドは改行を送信
    commit: { needsEnter: true }, // /commitコマンドは改行を送信
    raw: { needsEnter: false }, // 生のコマンド（方向キーなど）は改行不要
  };

  /**
   * AI CLIにコマンドを送信する統一ヘルパー関数
   * @param command 送信するコマンド文字列
   * @param type コマンドタイプ（改行送信の有無を決定）
   * @param options オプション（sessionIdを上書き可能）
   */
  const sendCommandToAi = (
    command: string,
    type: CommandType = 'raw',
    options?: { sessionId?: string }
  ) => {
    if (!socket) return;

    const config = commandConfigs[type];
    const targetSessionId = options?.sessionId || currentSessionId;

    // コマンドを送信
    socket.emit('send-command', {
      command,
      sessionId: targetSessionId,
      repositoryPath: currentRepo,
      provider: currentProvider,
    });

    // 設定に応じて改行を送信
    if (config.needsEnter) {
      setTimeout(() => {
        socket.emit('send-command', {
          command: '\r',
          sessionId: targetSessionId,
          repositoryPath: currentRepo,
          provider: currentProvider,
        });
      }, 300); // 300ms後に改行送信
    }
  };

  const handleSendCommand = (command: string) => {
    // プロンプト入力として送信（改行を自動送信）
    sendCommandToAi(command, 'prompt');
  };

  const handleSendArrowKey = (direction: 'up' | 'down' | 'left' | 'right') => {
    // 方向キーに対応するANSIエスケープシーケンス
    const arrowKeys = {
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\x1b[C',
      left: '\x1b[D',
    };
    // 生のコマンドとして送信（改行不要）
    sendCommandToAi(arrowKeys[direction], 'raw');
  };

  const handleSendTabKey = (shift: boolean = false) => {
    // TabとShift+Tabに対応するコード
    const tabKey = shift ? '\x1b[Z' : '\t'; // Shift+TabはCSI Z、Tabは\t
    // 生のコマンドとして送信（改行不要）
    sendCommandToAi(tabKey, 'raw');
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
    // ESCキーを生のコマンドとして送信（改行不要）
    sendCommandToAi('\x1b', 'raw'); // ESC (ASCII 27)
  };

  const handleClearClaude = () => {
    // /clearコマンドとして送信（改行を自動送信）
    sendCommandToAi('/clear', 'clear');
  };

  // AI CLIの再起動ハンドラー
  const handleRestartAiCli = () => {
    if (socket && currentRepo) {
      socket.emit('restart-ai-cli', {
        repositoryPath: currentRepo,
        provider: currentProvider,
        initialSize: aiTerminalSize || undefined,
      });
    }
  };

  // AIOutputからのキー入力ハンドラー
  const handleAiKeyInput = (key: string) => {
    const providerSessionId =
      aiSessionIds.get(currentProvider) || currentSessionId;
    // 生のキー入力として送信（改行不要）
    sendCommandToAi(key, 'raw', { sessionId: providerSessionId });
  };

  // AI出力のリロードハンドラー（リサイズ + 履歴再取得）
  const handleReloadAiOutput = (cols: number, rows: number) => {
    if (socket && currentRepo) {
      // 1. リサイズを送信
      socket.emit('ai-resize', {
        repositoryPath: currentRepo,
        provider: currentProvider,
        cols,
        rows,
      });

      // 2. 履歴を再取得
      socket.emit('get-ai-history', {
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
    }
  };

  const handleChangeModel = (
    model: 'default' | 'Opus' | 'Sonnet' | 'OpusPlan'
  ) => {
    // モデル名を適切な値に変換
    const modelValue = model === 'OpusPlan' ? 'opusplan' : model;
    // /modelコマンドとして送信（改行を自動送信）
    sendCommandToAi(`/model ${modelValue}`, 'prompt');
  };

  const handleSendCommit = () => {
    // /commitコマンドとして送信（改行を自動送信）
    sendCommandToAi('/commit', 'commit');
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

  const handleTerminalResize = (
    terminalId: string,
    cols: number,
    rows: number
  ) => {
    if (socket) {
      socket.emit('terminal-resize', { terminalId, cols, rows });
    }
  };

  const handleAiOutputResize = (cols: number, rows: number) => {
    // サイズ情報を保存
    setAiTerminalSize({ cols, rows });

    if (socket && currentRepo) {
      socket.emit('ai-resize', {
        repositoryPath: currentRepo,
        provider: currentProvider,
        cols,
        rows,
      });
    }
  };

  const handleClearAiHistory = () => {
    if (socket && currentRepo) {
      socket.emit('clear-ai-output', {
        repositoryPath: currentRepo,
        provider: currentProvider,
      });
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
      console.log('Executing npm script:', scriptName, 'activeTerminalId:', activeTerminalId);
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

  // エディタ起動ハンドラー
  const handleOpenInEditor = (editor: 'vscode' | 'cursor') => {
    if (socket && currentRepo) {
      setShowEditorMenu(false); // メニューを閉じる
      socket.emit('open-in-editor', {
        repositoryPath: currentRepo,
        editor,
      });
    }
  };

  // code-server起動ハンドラー (外部アクセス時のみ使用)
  const handleStartCodeServer = () => {
    if (socket && currentRepo) {
      setStartingCodeServer(true);
      // code-serverのURL取得を要求
      socket.emit('get-code-server-url', {
        repositoryPath: currentRepo,
      });
    }
  };

  // リポジトリが選択されていない場合はリポジトリ管理画面を表示
  if (!currentRepo) {
    return (
      <div className="min-h-screen bg-dark-bg-primary">
        <div className="min-h-screen flex flex-col">
          {/* ヘッダー */}
          <header className="bg-dark-bg-secondary shadow-sm border-b border-dark-border-DEFAULT">
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
              <div className="bg-dark-bg-secondary rounded-xl shadow-2xl border border-dark-border-light overflow-hidden">
                <div className="px-4 py-4 sm:px-8 sm:py-6 bg-gradient-to-r from-dark-bg-tertiary to-dark-bg-hover text-white">
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
                    templates={templates}
                    onCloneRepository={handleCloneRepository}
                    onCreateRepository={handleCreateRepository}
                    onCreateFromTemplate={handleCreateFromTemplate}
                    onSaveTemplate={handleSaveTemplate}
                    onDeleteTemplate={handleDeleteTemplate}
                    onSwitchRepository={handleSwitchRepository}
                    isConnected={isConnected}
                  />
                </div>
              </div>
            </div>
          </main>

          {/* リポジトリ切り替え中のローディングオーバーレイ */}
          {isSwitchingRepo && (
            <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
              <div className="bg-dark-bg-secondary rounded-lg shadow-2xl p-8 border border-dark-border-light">
                <div className="flex flex-col items-center space-y-4">
                  <svg
                    className="animate-spin h-12 w-12 text-gray-400"
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
                      {currentProvider === 'claude'
                        ? 'Claude CLI'
                        : 'Codex CLI'}
                      セッションを準備中です...
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
    <div className="min-h-screen bg-dark-bg-primary flex flex-col">
      {/* ヘッダー */}
      <header className="bg-dark-bg-secondary shadow-sm border-b border-dark-border-DEFAULT">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-2 sm:py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
            <div className="flex items-center space-x-2 sm:space-x-4 min-w-0">
              <button
                onClick={handleBackToRepoSelection}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-dark-text-primary bg-dark-bg-tertiary border border-dark-border-light rounded-lg hover:bg-dark-bg-hover hover:border-dark-border-focus focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-focus transition-all duration-150 flex-shrink-0 shadow-md"
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
              <div className="border-l border-dark-border-light pl-2 sm:pl-4 min-w-0 flex-1">
                <h1 className="text-sm sm:text-lg font-semibold text-white truncate">
                  {currentRepo.split('/').pop() || 'プロジェクト'}
                </h1>
                <p className="text-xs text-gray-400 truncate max-w-full sm:max-w-96">
                  {currentRepo}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3">
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
                  <span className="text-xs text-gray-400 font-mono">
                    #{currentSessionId.split('-')[1]}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 max-w-[1920px] mx-auto w-full px-3 sm:px-4 lg:px-8 py-4 sm:py-6 flex flex-col space-y-4 sm:space-y-6">
        {/* ブランチセレクター・ツールバー */}
        <div className="flex items-center space-x-4 justify-between">
          <div className="flex items-center space-x-2">
            <BranchSelector
              branches={branches}
              currentBranch={currentBranch}
              onSwitchBranch={handleSwitchBranch}
              isConnected={isConnected}
            />

            {/* エディタ起動ドロップダウン (localhostアクセス時のみ表示) */}
            {isLocalhost && (
              <div className="relative" ref={editorMenuRef}>
                <button
                  onClick={() => setShowEditorMenu(!showEditorMenu)}
                  disabled={!isConnected}
                  className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-100 bg-gray-700 border border-dark-border-light rounded-md hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-focus disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="エディタで開く"
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
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
                <span className="hidden sm:inline">エディタ</span>
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

              {/* エディタ選択ドロップダウンメニュー */}
              {showEditorMenu && availableEditors.length > 0 && (
                <div className="absolute left-0 mt-2 w-32 sm:w-36 bg-gray-800 rounded-md shadow-lg ring-1 ring-gray-700 z-50">
                  <div className="py-0.5">
                    {availableEditors.map((editor) => (
                      <button
                        key={editor.id}
                        onClick={() => handleOpenInEditor(editor.id)}
                        className={`flex items-center w-full px-3 py-2 text-xs sm:text-sm font-medium text-white transition-colors ${
                          editor.id === 'vscode'
                            ? 'hover:bg-blue-700'
                            : 'hover:bg-purple-700'
                        }`}
                      >
                        {editor.id === 'vscode' ? (
                          <svg
                            className="w-4 h-4 mr-2"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
                          </svg>
                        ) : (
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
                              d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                            />
                          </svg>
                        )}
                        {editor.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              </div>
            )}

            {/* GitHubで開くボタン */}
            {remoteUrl && (
              <button
                onClick={() => window.open(remoteUrl, '_blank')}
                disabled={!isConnected}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-100 bg-gray-700 border border-dark-border-light rounded-md hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-focus disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="GitHubで開く"
              >
                <svg
                  className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span className="hidden sm:inline">GitHub</span>
              </button>
            )}

            {/* code-serverボタン (外部アクセス時のみ表示) */}
            {!isLocalhost && (
              <button
                onClick={handleStartCodeServer}
                disabled={!isConnected || startingCodeServer}
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 border border-blue-500 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="ブラウザでVS Code起動"
              >
                {startingCodeServer ? (
                  <>
                    <svg
                      className="animate-spin w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2"
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
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span className="hidden sm:inline">起動中...</span>
                  </>
                ) : (
                  <>
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
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                    <span className="hidden sm:inline">code-server</span>
                  </>
                )}
              </button>
            )}
          </div>

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
                className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 mr-2 text-xs sm:text-sm font-medium text-white bg-green-600 border border-green-500 rounded-md hover:bg-green-700 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-green-500 transition-colors"
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
                  className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-400 bg-gray-600 border border-dark-border-light rounded-md cursor-not-allowed"
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
                    className="inline-flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-gray-100 bg-gray-700 border border-dark-border-light rounded-md hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-focus disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                          <span className="hidden sm:inline ml-1 text-gray-400 text-xs">
                            最新
                          </span>
                        </button>
                        <button
                          onClick={() => handleStartDifitWithType('staged')}
                          className="flex items-center justify-center w-full px-2 py-2 text-xs font-medium text-white hover:bg-gray-700"
                        >
                          <span>Staged</span>
                          <span className="hidden sm:inline ml-1 text-gray-400 text-xs">
                            準備済
                          </span>
                        </button>
                        <button
                          onClick={() => handleStartDifitWithType('working')}
                          className="flex items-center justify-center w-full px-2 py-2 text-xs font-medium text-white hover:bg-gray-700"
                        >
                          <span>Working</span>
                          <span className="hidden sm:inline ml-1 text-gray-400 text-xs">
                            作業中
                          </span>
                        </button>
                        <button
                          onClick={() => handleStartDifitWithType('all')}
                          className="flex items-center justify-center w-full px-2 py-2 text-xs font-medium text-white hover:bg-gray-700"
                        >
                          <span>All</span>
                          <span className="hidden sm:inline ml-1 text-gray-400 text-xs">
                            全変更
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 縦並びレイアウト: AI CLI & ターミナル */}
        <div className="flex flex-col gap-4 sm:gap-6 flex-1 min-h-0">
          {/* Claude CLI セクション (高さ拡大) */}
          <section className="bg-dark-bg-secondary rounded-lg shadow-xl border border-dark-border-light flex flex-col min-h-[25rem] sm:flex-[3] sm:min-h-[900px]">
            <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-dark-border-DEFAULT bg-dark-bg-tertiary rounded-t-lg flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-semibold text-white flex items-center">
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-gray-400"
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
              {/* プロバイダー選択とリセットボタン */}
              <div className="flex items-center space-x-2">
                <ProviderSelector
                  currentProvider={currentProvider}
                  onProviderChange={handleProviderChange}
                  disabled={!currentRepo || !isConnected}
                />
                <button
                  onClick={handleRestartAiCli}
                  disabled={!currentRepo || !isConnected}
                  className="flex items-center justify-center w-7 h-7 bg-dark-bg-secondary hover:bg-dark-bg-hover rounded border border-dark-border-light text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-dark-border-focus transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="AI CLIセッションを再起動"
                >
                  <svg
                    className="w-4 h-4"
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
                    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                  </svg>
                </button>
              </div>
            </div>

            {/* PC時: CLI+入力と操作ボタンを横並び、モバイル時: 縦並び */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row p-3 sm:p-6 gap-4 lg:gap-6 overflow-hidden">
              {/* 左側: AI出力 + テキスト入力の塊 */}
              <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
                {/* AI出力エリア */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AiOutput
                    key={`${currentRepo}:${currentProvider}`}
                    messages={currentAiMessages}
                    currentProvider={currentProvider}
                    isLoading={isLoadingRepoData}
                    onKeyInput={handleAiKeyInput}
                    onResize={handleAiOutputResize}
                    onReload={handleReloadAiOutput}
                    onClearHistory={handleClearAiHistory}
                  />
                </div>

                {/* AI コマンド入力エリア */}
                <div className="mt-4 flex-shrink-0">
                  <TextInput
                    ref={textInputRef}
                    onSendCommand={handleSendCommand}
                    onSendEscape={handleSendEscape}
                    currentProvider={currentProvider}
                    currentRepository={currentRepo}
                    disabled={!isConnected || !currentRepo}
                    autoFocus={false}
                  />
                </div>
              </div>

              {/* 右側: 操作ボタン（PCのみ横並び） */}
              <div className="flex-shrink-0 lg:w-[220px]">
                <KeyboardButtons
                  disabled={!isConnected || !currentRepo}
                  onSendArrowKey={handleSendArrowKey}
                  onSendEnter={() => textInputRef.current?.submit()}
                  onSendInterrupt={handleSendInterrupt}
                  onSendEscape={handleSendEscape}
                  onClearAi={handleClearClaude}
                  onSendTabKey={handleSendTabKey}
                  onChangeModel={handleChangeModel}
                  onSendCommit={handleSendCommit}
                  currentProvider={currentProvider}
                  providerInfo={{
                    clearTitle:
                      currentProvider === 'claude'
                        ? 'Claude CLIをクリア (/clear)'
                        : currentProvider === 'codex'
                          ? 'Codex CLIをクリア (/clear)'
                          : 'AI CLIをクリア (/clear)',
                  }}
                />
              </div>
            </div>
          </section>

          {/* ターミナルエリア */}
          <section className="bg-dark-bg-secondary rounded-lg shadow-xl border border-dark-border-light flex flex-col min-h-[35rem]">
            <div className="px-3 py-3 sm:px-6 sm:py-4 border-b border-dark-border-DEFAULT bg-dark-bg-tertiary rounded-t-lg">
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
            <div className="flex-1 min-h-0 overflow-hidden relative">
              <TerminalManager
                terminals={terminals}
                messages={terminalMessages}
                histories={terminalHistories}
                shortcuts={shortcuts}
                currentRepo={currentRepo}
                isConnected={isConnected}
                onCreateTerminal={handleCreateTerminal}
                onTerminalInput={handleTerminalInput}
                onTerminalSignal={handleTerminalSignal}
                onTerminalResize={handleTerminalResize}
                onCloseTerminal={handleCloseTerminal}
                onCreateShortcut={handleCreateShortcut}
                onDeleteShortcut={handleDeleteShortcut}
                onExecuteShortcut={handleExecuteShortcut}
                onActiveTerminalChange={setActiveTerminalId}
              />
            </div>
          </section>
        </div>

        {/* 下部セクション: npmスクリプト、自走モード、リポジトリ削除 (横並び) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* npmスクリプトセクション */}
          <section className="bg-dark-bg-secondary rounded-lg shadow-xl border border-dark-border-light">
            <NpmScripts
              repositoryPath={currentRepo}
              scripts={npmScripts}
              isConnected={isConnected}
              onExecuteScript={handleExecuteNpmScript}
              onRefreshScripts={handleRefreshNpmScripts}
            />
          </section>

          {/* 自走モード設定セクション */}
          <section className="bg-dark-bg-secondary rounded-lg shadow-xl border border-dark-border-light">
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
                    className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-red-600 border border-red-500 rounded-md hover:bg-red-700 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          <section className="bg-dark-bg-secondary rounded-lg shadow-xl border border-dark-border-light md:col-span-2 lg:col-span-1">
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
                  className="inline-flex items-center justify-center px-6 py-2 text-sm font-medium text-red-200 bg-red-900 border border-red-700 rounded-md hover:bg-red-800 focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        </div>
      </main>

      {/* difit サーバー通知（ポップアップブロック対応） */}
      {showDifitNotification && difitUrl && (
        <div className="fixed bottom-4 right-4 bg-dark-bg-secondary rounded-lg shadow-2xl max-w-xs w-full p-3 border border-dark-border-light z-50">
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
            className="w-full bg-dark-accent-blue text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-dark-accent-blue-hover focus:outline-none focus:ring-1 focus:ring-dark-accent-blue shadow-md transition-all duration-150 mb-2"
          >
            ページを開く
          </button>
          <div className="bg-dark-bg-tertiary rounded p-2 border border-dark-border-light">
            <p className="text-xs text-gray-300 break-all">{difitUrl}</p>
          </div>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-bg-secondary rounded-lg shadow-2xl max-w-md w-full p-6 border border-dark-border-light">
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
              <div className="bg-dark-bg-tertiary rounded-md p-3 border border-dark-border-light">
                <p className="text-sm font-medium text-white">
                  {currentRepo.split('/').pop()}
                </p>
                <p className="text-xs text-gray-400 mt-1">{currentRepo}</p>
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-dark-bg-tertiary text-dark-text-primary border border-dark-border-light py-2 px-4 rounded-lg hover:bg-dark-bg-hover hover:border-dark-border-focus focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-border-focus transition-all duration-150 shadow-md"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  const repoName = currentRepo.split('/').pop() || '';
                  handleDeleteRepository(currentRepo, repoName);
                  setShowDeleteConfirm(false);
                }}
                className="flex-1 bg-dark-accent-red text-white py-2 px-4 rounded-lg hover:bg-dark-accent-red-hover focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-dark-accent-red transition-all duration-150 font-medium shadow-md"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ポップアップブロックモーダル */}
      <PopupBlockedModal
        isOpen={showPopupBlockedModal}
        url={blockedCodeServerUrl}
        onClose={() => setShowPopupBlockedModal(false)}
        onOpenInNewTab={() => {
          window.open(blockedCodeServerUrl, '_blank');
        }}
      />
    </div>
  );
}

export default App;
