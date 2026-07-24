# デザインシステム

dokodemo-claude のデザイントークンと使用ルールをまとめる。トークンの実体は
`libs/design-tokens/src/scss/_variables.scss` にあり、Vite の `additionalData`
（`apps/dokodemo-claude-web/vite.config.ts`）で全 SCSS にグローバル注入される。
そのため各 `*.module.scss` では **import 文なしで変数を参照できる**。

## 2 層構造

トークンは 2 層に分かれる。

1. **プリミティブ層** — 生の値。カラーパレット（Tailwind CSS v3 準拠）やスケール
   （スペーシング・フォントサイズ等）。名前は値そのものを表す（`$blue-500` など）。
2. **セマンティック層** — 用途に紐づく名前。プリミティブを参照して定義する
   （`$color-error: $red-500` など）。名前は「何に使うか」を表す。

### 使い分けルール

- **コンポーネントは原則セマンティックトークンを使う。** 「成功」なら `$color-success`、
  「エラー」なら `$color-error`、強調なら `$accent` を参照する。プリミティブ（`$red-500` 等）を
  直接書かない。
- **プリミティブの直接参照が許されるのは、装飾的に多色が必要な場面のみ。** 例えば GitGraph の
  ブランチ色のように、セマンティックな意味を持たない色を機械的に何色も割り当てるケース。
  この場合はパレット（`$blue-500`, `$purple-500` …）を直接使ってよい。

## トークンリファレンス

### カラー: プリミティブ

グレースケールは純粋なニュートラル（青みなし・Tailwind neutral 相当）。

| スケール | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|----------|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| `$gray-*`    | #fafafa | #f5f5f5 | #e5e5e5 | #d4d4d4 | #a3a3a3 | #737373 | #525252 | #404040 | #262626 | #171717 |
| `$red-*`     | #fef2f2 | #fee2e2 | #fecaca | #fca5a5 | #f87171 | #ef4444 | #dc2626 | #b91c1c | #991b1b | #7f1d1d |
| `$orange-*`  | #fff7ed | #ffedd5 | #fed7aa | #fdba74 | #fb923c | #f97316 | #ea580c | #c2410c | #9a3412 | #7c2d12 |
| `$amber-*`   | #fffbeb | #fef3c7 | #fde68a | #fcd34d | #fbbf24 | #f59e0b | #d97706 | #b45309 | #92400e | #78350f |
| `$yellow-*`  | #fefce8 | #fef9c3 | #fef08a | #fde047 | #facc15 | #eab308 | #ca8a04 | #a16207 | #854d0e | #713f12 |
| `$green-*`   | #f0fdf4 | #dcfce7 | #bbf7d0 | #86efac | #4ade80 | #22c55e | #16a34a | #15803d | #166534 | #14532d |
| `$emerald-*` | #ecfdf5 | #d1fae5 | #a7f3d0 | #6ee7b7 | #34d399 | #10b981 | #059669 | #047857 | #065f46 | #064e3b |
| `$blue-*`    | #eff6ff | #dbeafe | #bfdbfe | #93c5fd | #60a5fa | #3b82f6 | #2563eb | #1d4ed8 | #1e40af | #1e3a8a |
| `$cyan-*`    | #ecfeff | #cffafe | #a5f3fc | #67e8f9 | #22d3ee | #06b6d4 | #0891b2 | #0e7490 | #155e75 | #164e63 |
| `$purple-*`  | #faf5ff | #f3e8ff | #e9d5ff | #d8b4fe | #c084fc | #a855f7 | #9333ea | #7e22ce | #6b21a8 | #581c87 |

### カラー: セマンティック

| トークン | 値 | 用途 |
|----------|----|----|
| `$dark-bg-primary` | #0a0a0a | 背景（最下層） |
| `$dark-bg-secondary` | #141414 | 背景（パネル等） |
| `$dark-bg-tertiary` | #1c1c1c | 背景（1 段上のサーフェス） |
| `$dark-bg-hover` | #252525 | ホバー背景 |
| `$dark-border` | #1f1f1f | ボーダー（標準） |
| `$dark-border-light` | #2a2a2a | ボーダー（やや明るい） |
| `$dark-border-focus` | #333333 | ボーダー（フォーカス） |
| `$dark-text-primary` | #ffffff | テキスト（主） |
| `$dark-text-secondary` | #a0a0a0 | テキスト（副） |
| `$dark-text-muted` | #666666 | テキスト（控えめ） |
| `$accent` | `$gray-500` | インタラクション強調（ボタン・選択・フォーカスリング等） |
| `$accent-hover` | `$gray-600` | 強調のホバー |
| `$color-success` / `-hover` | `$emerald-500` / `$emerald-600` | 成功 |
| `$color-warning` / `-hover` | `$amber-500` / `$amber-600` | 警告 |
| `$color-error` / `-hover` | `$red-500` / `$red-600` | エラー |
| `$color-info` / `-hover` | `$blue-500` / `$blue-600` | 情報 |
| `$color-success-bg` / `-border` | rgba(emerald-500, .12) / (.35) | 成功の淡色（背景 / ボーダー） |
| `$color-warning-bg` / `-border` | rgba(amber-500, .12) / (.35) | 警告の淡色 |
| `$color-error-bg` / `-border` | rgba(red-500, .12) / (.35) | エラーの淡色 |
| `$color-info-bg` / `-border` | rgba(blue-500, .12) / (.35) | 情報の淡色 |
| `$diff-added-text` | `$green-400` | diff 追加行のテキスト |
| `$diff-added-bg` | rgba(green-500, .1) | diff 追加行の背景 |
| `$diff-removed-text` | `$red-400` | diff 削除行のテキスト |
| `$diff-removed-bg` | rgba(red-500, .1) | diff 削除行の背景 |

### タイポグラフィ

| 種別 | トークン | 値 |
|------|----------|----|
| フォント | `$font-sans` | Inter, system-ui, … |
| フォント | `$font-mono` | JetBrains Mono, Fira Code, … |
| サイズ | `$font-size-2xs` | 0.625rem (10px) |
| サイズ | `$font-size-xs` | 0.75rem (12px) |
| サイズ | `$font-size-sm` | 0.875rem (14px) |
| サイズ | `$font-size-base` | 1rem (16px) |
| サイズ | `$font-size-lg` | 1.125rem (18px) |
| サイズ | `$font-size-xl` | 1.25rem (20px) |
| サイズ | `$font-size-2xl` | 1.5rem (24px) |
| サイズ | `$font-size-3xl` | 1.875rem (30px) |
| ウェイト | `$font-weight-normal` / `-medium` / `-semibold` / `-bold` | 400 / 500 / 600 / 700 |
| 行送り | `$line-height-tight` / `-normal` | 1.25 / 1.5 |

### スペーシング

余白（margin / padding / gap）は必ずこのスケールから選ぶ。

| トークン | 値 |
|----------|----|
| `$space-3xs` | 0.125rem (2px) |
| `$space-2xs` | 0.25rem (4px) |
| `$space-xs` | 0.375rem (6px) |
| `$space-sm` | 0.5rem (8px) |
| `$space-md` | 0.75rem (12px) |
| `$space-lg` | 1rem (16px) |
| `$space-xl` | 1.5rem (24px) |
| `$space-2xl` | 2rem (32px) |
| `$space-3xl` | 3rem (48px) |
| `$spacing-touch` / `-lg` | 44px / 56px（タッチターゲット最小サイズ） |

### 角丸

| トークン | 値 |
|----------|----|
| `$radius-sm` | 2px |
| `$radius` | 4px |
| `$radius-md` | 6px |
| `$radius-lg` | 8px |
| `$radius-xl` | 12px |
| `$radius-2xl` | 16px |
| `$radius-full` | 9999px（丸・ピル） |

### シャドウ

| トークン | 値 |
|----------|----|
| `$shadow-sm` | 0 1px 2px 0 rgba(0,0,0,.05) |
| `$shadow` | 0 1px 3px 0 rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1) |
| `$shadow-md` | 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1) |
| `$shadow-lg` | 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1) |

### トランジション

| トークン | 値 |
|----------|----|
| `$transition-fast` | 150ms |
| `$transition-normal` | 200ms |
| `$transition-slow` | 300ms |
| `$transition-easing` | cubic-bezier(0.4, 0, 0.2, 1) |

### ブレークポイント

`_mixins.scss` の `sm-up` / `md-down` などのミックスイン経由で使う。

| トークン | 値 |
|----------|----|
| `$breakpoint-xs` | 475px |
| `$breakpoint-sm` | 560px |
| `$breakpoint-md` | 680px |
| `$breakpoint-lg` | 860px |
| `$breakpoint-xl` | 1280px |
| `$breakpoint-2xl` | 1536px |

## 使用ルール

- **hex 直書き禁止。** 色は必ずトークンを参照する（プリミティブ or セマンティック）。
  新しい色が要る場合はまずセマンティックトークンの追加を検討する。
- **余白は `$space-*` から選ぶ。** 任意の px / rem 値を直書きしない。
- **font-size はスケールのみ。** `$font-size-*` 以外の値を使わない。
- **アイコンは lucide-react のみ。** サイズは **12, 14, 16, 20, 32** の 5 種に限定する
  （それ以外のサイズを新規に増やさない）。

## 共通コンポーネント

トークンを内包した基本部品。`apps/dokodemo-claude-web/src/shared/components/` に置く。
import は `@/shared/components/<Name>` で行う（barrel index.ts は作らない）。

### Button

`Button.tsx` — トークンのみで構成した基本ボタン。native の `button` 属性
（`React.ButtonHTMLAttributes<HTMLButtonElement>`）をそのまま透過する。

| prop | 型 | 既定 | 説明 |
|------|----|------|------|
| `variant` | `'primary' \| 'danger' \| 'ghost'` | `'ghost'` | primary=`$accent`、danger=`$color-error`、ghost=透明+`$dark-border-light` |
| `size` | `'sm' \| 'md'` | `'md'` | sm=`$font-size-2xs`、md=`$font-size-xs` |
| `className` | `string` | — | レイアウト調整用に merge される |

```tsx
import Button from '@/shared/components/Button';

<Button variant="primary" onClick={handleCreate}>作成</Button>
<Button variant="danger" size="sm">削除</Button>
<Button onClick={onClose}>キャンセル</Button> {/* 既定は ghost */}
```

`disabled` は native 属性がそのまま効き、`opacity` + `cursor: not-allowed` になる。

### IconButton

`IconButton.tsx` — アイコン 1 つを収めた正方形ボタン。既存グローバルクラス
`.btn-icon` / `.btn-icon-xs` の React 化。children にアイコン（lucide-react）を渡す。
サイズは CSS 側で svg を含めて固定するため、アイコンに個別の size 指定は不要。

| prop | 型 | 既定 | 説明 |
|------|----|------|------|
| `size` | `'md' \| 'xs'` | `'md'` | md=2rem / アイコン1rem、xs=1.5rem / アイコン0.75rem |
| `label` | `string` | （必須） | `aria-label` / `title` に使う。アイコンのみのボタンなので必須 |

```tsx
import IconButton from '@/shared/components/IconButton';
import { Plus } from 'lucide-react';

<IconButton size="md" label="追加" onClick={onAdd}>
  <Plus />
</IconButton>
```

### ModalShell

`ModalShell.tsx` — モーダルの骨組み（オーバーレイ + パネル + ヘッダー[タイトル +
閉じる IconButton] + コンテンツ + 任意フッター）。オーバーレイクリックと Escape キーで
`onClose` する。

| prop | 型 | 説明 |
|------|----|------|
| `title` | `React.ReactNode` | ヘッダーのタイトル |
| `onClose` | `() => void` | 閉じる操作（オーバーレイクリック / Escape / 閉じるボタン） |
| `children` | `React.ReactNode` | コンテンツ領域 |
| `footer` | `React.ReactNode`（任意） | フッター領域（ボタン列など） |

```tsx
import ModalShell from '@/shared/components/ModalShell';
import Button from '@/shared/components/Button';

<ModalShell
  title="ワークツリーを作成"
  onClose={onClose}
  footer={
    <>
      <Button onClick={onClose}>キャンセル</Button>
      <Button variant="primary" onClick={onCreate}>作成</Button>
    </>
  }
>
  {/* フォームなど */}
</ModalShell>
```

> 既存モーダル（AddRepositoryModal / WorktreeCreateModal / BranchCreateModal）の
> 置き換えは後続フェーズで行う。既存のグローバルクラス `.btn-icon` 系もまだ残す。

## Storybook

共通コンポーネントとトークンのカタログ。`apps/dokodemo-claude-web` に同居する
（`@storybook/react-vite`）。設定は `.storybook/main.ts` / `.storybook/preview.ts`。

- 既存の `vite.config.ts`（SCSS の `additionalData` によるトークン注入・`@` エイリアス）を
  react-vite が自動でマージするため、ストーリーでもトークンが import なしで効く。
  VitePWA だけは Storybook ビルドを妨げるため `viteFinal` で除外している。
- preview はダーク前提（背景 `#0a0a0a`、`src/index.scss` を読み込み）。
- ストーリーは `src/stories/` に置く。トークン系（Tokens/Colors・Typography・Spacing）は
  `tokens.module.scss` の `:export` からトークン値を読むため、hex を二重管理しない。

```bash
cd apps/dokodemo-claude-web && npm run storybook       # 開発サーバー（既定 6006）
cd apps/dokodemo-claude-web && npm run build-storybook # 静的ビルド（storybook-static/）
```

`check-all` には組み込まない（Storybook は独立して起動・ビルドする）。
