# Claude Code Hooks

このディレクトリには、Claude Code CLIの動作を制御するためのhookスクリプトが含まれています。

## tool-use Hook

### 目的

このプロジェクトでは、Claude Codeが**このプロジェクト配下のファイルのみ**を編集できるように制限しています。

外側のdokodemo-claudeシステム（親プロジェクト）のファイルを誤って編集することを**技術的に防止**するためのセキュリティ機構です。

### 制限内容

#### 編集可能なディレクトリ

```
/Users/ukonpower/Documents/work-space/dokodemo-claude/backend/repositories/dokodemo-claude/
```

このディレクトリ配下のファイルのみ、Edit、Write、NotebookEditツールでの編集が許可されます。

#### 編集禁止のディレクトリ

以下のディレクトリのファイルは編集が**拒否**されます：

- `/Users/ukonpower/Documents/work-space/dokodemo-claude/backend/` - 親プロジェクトのバックエンド
- `/Users/ukonpower/Documents/work-space/dokodemo-claude/frontend/` - 親プロジェクトのフロントエンド
- その他、repositories外の全てのファイル

### 動作の仕組み

1. Claude Codeがファイル編集ツール（Edit、Write、NotebookEdit）を使用しようとする
2. `tool-use` hookスクリプトが実行される
3. スクリプトが編集対象のファイルパスをチェック
4. 許可されたディレクトリ外の場合、エラーメッセージを表示して操作を拒否
5. 許可されたディレクトリ内の場合、操作を許可

### エラーメッセージ例

```
❌ エラー: このファイルは編集できません

編集が許可されているのは以下のディレクトリのみです：
  /Users/ukonpower/Documents/work-space/dokodemo-claude/backend/repositories/dokodemo-claude

指定されたファイル：
  /Users/ukonpower/Documents/work-space/dokodemo-claude/backend/src/server.ts

IMPORTANT: repositories外のファイルは編集禁止です。
作業対象はrepositories/dokodemo-claude内のプロジェクトのみです。
```

### 依存関係

- `jq`: JSONパーサー（インストールされていない場合はチェックをスキップ）

jqのインストール方法：
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

### hookの無効化（非推奨）

hookを無効化する場合は、以下のファイルを削除またはリネームしてください：

```bash
mv .claude/hooks/tool-use .claude/hooks/tool-use.disabled
```

ただし、**システムファイルの誤編集リスクが高まる**ため、無効化は推奨しません。

## 参考

- [Claude Code Hooks Documentation](https://docs.claude.com/en/docs/claude-code/hooks)
- CLAUDE.md - プロジェクト指針
