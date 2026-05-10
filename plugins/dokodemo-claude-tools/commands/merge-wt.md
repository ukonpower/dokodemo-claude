---
allowed-tools: Bash(git:*), Read
description: Merge current branch into main branch (preserve both changes on conflicts)
---

## Context

- Current branch: !`git branch --show-current`
- Main branch: !`git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`
- Current git status: !`git status`
- Current git diff: !`git diff HEAD`
- Recent commits on current branch: !`git log --oneline -10`

## Critical

- **必ず通常マージ（`git merge`）を使う。** `git rebase` や `git pull --rebase` などリベース系の操作は絶対に使わない。
- **絶対に `-X ours` や `-X theirs` を使わない。** どちらかのブランチを一括優先するマージ戦略は禁止。
- **コンフリクト解決に git コマンドを使わない。** `git checkout --ours/--theirs`、`git restore --ours/--theirs`、`git mergetool` なども禁止。解決は **必ず Edit ツールでファイルを手動編集**して行う。
- **絶対にどちらかの変更を捨てない。** コンフリクトが発生したら、必ず両方の変更内容を詳細に読み、両方が生きるように手動で統合する。
- **明らかな競合（自動統合が危険なケース）は、マージを中止せずユーザーに指示を仰ぐ。** `git merge --abort` はせず、コンフリクト状態を保持したまま、競合内容を要約して報告し、ユーザーの判断を待つ。

## Your task

Merge the current working branch with the main branch.

**Important**: Since main branch may be checked out by another worktree, do NOT checkout main. Instead, merge origin/main into the current branch first.

### Steps:

1. **Check for uncommitted changes**
   - If there are uncommitted changes, commit them **inline** before proceeding to the merge:
     1. Stage all relevant changes: `git add <files>`
     2. Create a commit with an appropriate message based on the diff
     3. **After committing, continue immediately to Step 2** — do NOT stop or return to the user
   - **Important**: Do NOT use the Skill tool to call `git:commit`. Handle the commit directly within this command to ensure the merge process continues without interruption.

2. **Get branch names**
   - Current branch (working branch)
   - Main branch (detect from origin/HEAD or default to "main")

3. **Fetch latest main from remote**
   ```bash
   git fetch origin <main-branch>
   ```

4. **Merge origin/main into current branch**
   ```bash
   git merge origin/<main-branch> -m "Merge <main-branch> into <current-branch>"
   ```
   - **絶対に** `-X theirs` や `-X ours` を使わない
   - This approach avoids checking out main, which may be used by another worktree

5. **If merge conflicts occur — 慎重に解決する**

   コンフリクトが発生した場合、以下の手順を**厳密に**守ること：

   a. **コンフリクトファイルの一覧を取得**
      ```bash
      git diff --name-only --diff-filter=U
      ```

   b. **各コンフリクトファイルについて、以下を実行**：

      1. **ファイル全体を Read ツールで読む**（conflict markers を含む状態）
      2. **両ブランチの変更意図を分析する**：
         - `<<<<<<< HEAD` 側（current branch）: 何を変更しようとしていたのか？
         - `======= ... >>>>>>> origin/main` 側: 何を変更しようとしていたのか？
      3. **マージ可能性を判断する**：
         - **両方の変更を統合できる場合**: 両方の変更が反映されるようにコードを書き直す。片方だけを採用することは絶対にしない。
         - **統合が危険な場合（下記参照）**: そのファイルのマージを「危険」とマークする

      4. **「危険」と判断する基準**：
         - 同じ行・同じロジックを異なる方向に修正している（例: 一方は値を A に変更、他方は B に変更）
         - 一方が削除したコードを他方が修正している
         - 両方が同じ関数・コンポーネントの構造を大きく変更している
         - 統合した結果、意味的に正しいかどうか自信が持てない

   c. **1つでも「危険」なコンフリクトがある場合**：
      - **`git merge --abort` はしない。** コンフリクト状態を保持したまま、ユーザーに判断を委ねる。
      - 安全に統合できる他のファイルは、先に Edit ツールで解決しておいてもよい（ただし `git add` / `git commit` はしない）。
      - ユーザーに以下を報告する：
        - どのファイルにコンフリクトがあったか
        - 各コンフリクトの具体的な内容（両方の変更を要約、`<<<<<<<` 〜 `>>>>>>>` の中身を抜粋）
        - なぜ自動統合が危険だと判断したか
        - どう解決すべきかの選択肢があれば提示する
      - ユーザーの指示を待つ（絶対に自分で勝手に解決を続行しない、`git merge --abort` も勝手に実行しない）

   d. **全てのコンフリクトが安全に統合できた場合**：
      - 各ファイルを **Edit ツールで修正**（conflict markers を除去し、両方の変更を統合）。`git checkout --ours/--theirs` などの git コマンドは絶対に使わない。
      - `git add <resolved-files>`
      - `git commit` でマージコミットを完了

6. **Push the merged branch to remote**
   ```bash
   git push origin <current-branch>
   ```

7. **Update main branch with the merged changes**
   Since main is checked out by another worktree, merge from the main worktree:

   a. **Find the main worktree path**
      ```bash
      git worktree list
      ```
      - Look for the worktree that has the main branch checked out
      - The main worktree is typically the one without a branch suffix in brackets, or explicitly shows `[main]` or `[master]`

   b. **Merge in the main worktree (with --no-ff to create merge commit)**
      ```bash
      cd <main-worktree-path>
      git fetch origin
      git merge --no-ff origin/<current-branch> -m "Merge <current-branch> into <main-branch>"
      ```
      - `--no-ff` ensures a merge commit is always created, even if fast-forward is possible
      - This preserves the branch history

   c. **Push main to remote**
      ```bash
      git push origin <main-branch>
      ```

   d. **Return to original worktree**
      ```bash
      cd <original-worktree-path>
      ```

8. **Show result**
   - `git log --oneline -3` to show the merge commit on current branch
   - In main worktree: `git log --oneline -3` to confirm the merge commit

### Conflict Resolution Examples

**安全に統合できるケース（マージ続行）：**
- ファイルの別々の場所にそれぞれ追加がある → 両方の追加をそのまま含める
- 一方が import を追加、他方が別の import を追加 → 両方の import を含める
- 一方が新しい関数を追加、他方が既存の別の関数を修正 → 両方を反映

**統合が危険なケース（マージは中止せず、ユーザーに指示を仰ぐ）：**
- 同じ変数のデフォルト値を一方は `true`、他方は `false` に変更 → ユーザー確認
- 一方が関数を削除、他方がその関数を修正 → ユーザー確認
- 同じ API エンドポイントのレスポンス形式を異なる方向に変更 → ユーザー確認
- 同じ CSS プロパティを異なる値に変更 → ユーザー確認

**原則: 迷ったらコンフリクト状態を保持したままユーザーに確認する。`git merge --abort` は勝手に実行しない。変更を失うリスクより、ユーザーに確認するコストの方がはるかに小さい。**

After successful merge, both the current branch and main branch will be updated with all changes. The merge is performed directly in the main worktree with `--no-ff` to ensure a merge commit is created, preserving the branch history.
