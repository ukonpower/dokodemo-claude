# 推奨コマンド

## 開発サーバー起動
```bash
# 推奨: フロントエンド・バックエンド同時起動
npm run dev

# 個別起動
npm run dev:frontend    # フロントエンド（ポート5173）
npm run dev:backend     # バックエンド（ポート0001）
```

## ビルド
```bash
npm run build           # フロントエンド・バックエンド両方ビルド
npm run build:frontend  # フロントエンドのみ
npm run build:backend   # バックエンドのみ
```

## コード品質チェック
```bash
npm run check-all       # 全チェック（lint + type-check + format:check）
npm run lint            # ESLintチェック
npm run type-check      # TypeScript型チェック
npm run format:check    # Prettierフォーマットチェック
```

## コード修正・フォーマット
```bash
npm run lint:frontend --fix    # ESLint自動修正（フロントエンド）
npm run lint:backend --fix     # ESLint自動修正（バックエンド）
npm run format                 # Prettierフォーマット適用
```

## 個別サブプロジェクト操作
```bash
cd frontend && npm run [command]  # フロントエンド個別操作
cd backend && npm run [command]   # バックエンド個別操作
```

## システム固有コマンド（Darwin/macOS）
```bash
ls -la           # ファイル一覧（詳細表示）
find . -name     # ファイル検索
grep -r          # 文字列検索
git status       # Git状態確認
git add .        # 全変更をステージング
git commit -m    # コミット（日本語メッセージ）
```

## 依存関係管理
```bash
npm run install  # 全プロジェクトの依存関係インストール
```