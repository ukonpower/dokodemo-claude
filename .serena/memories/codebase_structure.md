# コードベース構造

## ルートディレクトリ
```
dokodemo-claude/
├── frontend/          # React フロントエンド
├── backend/           # Node.js バックエンド
├── .serena/           # Serenaメモリファイル
├── .claude/           # Claude設定
├── package.json       # ルートレベルのスクリプト
├── tsconfig.json      # 共通TypeScript設定
├── eslint.config.js   # 共通ESLint設定
├── CLAUDE.md          # プロジェクト指針（重要）
└── README.md          # プロジェクト説明
```

## フロントエンド構造
```
frontend/
├── src/
│   ├── components/       # Reactコンポーネント
│   │   ├── AutoModeSettings.tsx
│   │   ├── BranchSelector.tsx
│   │   ├── ClaudeOutput.tsx
│   │   ├── CommandInput.tsx
│   │   ├── NpmScripts.tsx
│   │   ├── RepositoryManager.tsx
│   │   ├── Terminal.tsx
│   │   └── TerminalManager.tsx
│   ├── types/           # TypeScript型定義
│   │   └── index.ts
│   ├── App.tsx          # メインアプリケーション
│   ├── main.tsx         # エントリーポイント
│   └── index.css        # グローバルスタイル
├── index.html
├── vite.config.ts       # Vite設定
├── tailwind.config.js   # Tailwind CSS設定
└── package.json
```

## バックエンド構造
```
backend/
├── src/
│   ├── types/           # TypeScript型定義
│   │   └── index.ts
│   ├── server.ts        # Expressサーバー
│   └── process-manager.ts # プロセス・ターミナル管理
└── package.json
```

## 主要コンポーネント機能
- **RepositoryManager**: Gitリポジトリ管理
- **ClaudeOutput**: Claude CLI出力表示
- **TerminalManager**: ターミナルタブ管理
- **Terminal**: 個別ターミナル操作
- **CommandInput**: Claude用コマンド入力
- **BranchSelector**: Gitブランチ選択
- **AutoModeSettings**: 自動実行設定