# dokodemo-claude

Claude Code CLIをWebブラウザから操作するためのシンプルなインターフェース

## 概要

dokodemo-claude は、Claude Code CLIをWebブラウザから操作するツールです。Gitリポジトリのクローン、Claude Code CLIとの対話、ターミナル操作を統合したWeb UIを提供します。

## 必要な環境

- Node.js v18以上
- Claude Code CLI
- Git
- モダンなWebブラウザ

## 起動手順

1. リポジトリをクローン
```bash
git clone https://github.com/yourusername/dokodemo-claude.git
cd dokodemo-claude
```

2. 依存関係をインストール
```bash
npm run install
```

3. 開発サーバーを起動
```bash
npm run dev
```

4. ブラウザで http://localhost:8000 にアクセス

## 使い方

1. **リポジトリクローン**: URL入力後[Clone]ボタンをクリック
2. **Claude CLI操作**: 下部のテキストエリアに指示を入力して送信
3. **ターミナル操作**: [+]ボタンで新しいターミナルタブを作成し、通常のターミナルと同様に操作

## Claude Code 設定

### 自走モード（Hook モード）を使用する場合

自走モードの Hook モードを使用するには、Claude Code の設定ファイルに以下の hook 設定を追加する必要があります。

1. Claude Code の設定ファイルを開く（通常は `~/.claude/settings.json`）

2. 以下の hook 設定を追加：

```json
{
  "hooks": {
    "matchers": [
      {
        "pattern": ".*",
        "hooks": {
          "PostToolUse": [
            {
              "command": "curl -X POST http://localhost:8001/hook/claude-event -H 'Content-Type: application/json' -d '{\"event\":\"PostToolUse\",\"matchers\":{},\"metadata\":{\"cwd\":\"'$PWD'\"}}'",
              "shell": "sh"
            }
          ],
          "Stop": [
            {
              "command": "curl -X POST http://localhost:8001/hook/claude-event -H 'Content-Type: application/json' -d '{\"event\":\"Stop\",\"matchers\":{},\"metadata\":{\"cwd\":\"'$PWD'\"}}'",
              "shell": "sh"
            }
          ],
          "SubagentStop": [
            {
              "command": "curl -X POST http://localhost:8001/hook/claude-event -H 'Content-Type: application/json' -d '{\"event\":\"SubagentStop\",\"matchers\":{},\"metadata\":{\"cwd\":\"'$PWD'\"}}'",
              "shell": "sh"
            }
          ]
        }
      }
    ]
  }
}
```

3. Claude Code を再起動

### 注意事項

- Hook モードは Claude Code の処理完了時に自動的に次のプロンプトを実行します
- タイマーモードは指定された間隔で定期的にプロンプトを実行します
- 両モードともバックエンドで動作するため、ブラウザを閉じても継続実行されます
- dokodemo-claude のバックエンドサーバーがポート 8001 で動作している必要があります