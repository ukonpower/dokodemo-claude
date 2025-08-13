# コードスタイル・規約

## Prettier設定
```json
{
  "semi": true,                // セミコロンを使用
  "trailingComma": "es5",     // ES5互換のtrailingComma
  "singleQuote": true,        // シングルクォートを使用
  "printWidth": 80,           // 行の長さ80文字
  "tabWidth": 2,              // インデント2スペース
  "useTabs": false            // タブではなくスペースを使用
}
```

## ESLint設定
- **基本**: `@eslint/js` recommended設定
- **TypeScript**: `typescript-eslint` recommended設定
- **React**: React Hooks、React Refresh プラグイン使用
- **対象ファイル**: `**/*.{ts,tsx}`
- **除外**: `dist` ディレクトリ

## TypeScript設定
- **ES Modules**: `"type": "module"` 使用
- **厳格モード**: TypeScript strict設定有効
- **ECMAScript**: 2020対応

## 命名規約
- **ファイル名**: kebab-case（例: `repository-manager.tsx`）
- **コンポーネント名**: PascalCase（例: `RepositoryManager`）
- **変数・関数**: camelCase
- **型・インターフェース**: PascalCase

## 言語設定
- **コメント**: 日本語
- **ドキュメント**: 日本語
- **コミットメッセージ**: 日本語
- **変数名・関数名**: 英語（国際標準）

## プロジェクト固有ルール
- **Claude.md準拠**: プロジェクト指針に従う
- **コメント最小限**: コードの自己説明性を重視
- **型安全性**: TypeScriptの型チェックを最大限活用