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
- **プリミティブの直接参照が許されるのは、装飾的に多色が必要な場面のみ。** セマンティックな
  意味を持たない色を機械的に何色も割り当てるケースでは、パレット（`$blue-500`,
  `$purple-500` …）を直接使ってよい。

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
| `$dark-bg-secondary` | #191919 | 背景（パネル・カード等） |
| `$dark-bg-tertiary` | #2a2a2a | 背景（パネルの上の部品: ボタン・タブ・行など） |
| `$dark-bg-raised` | #212121 | パネルの中にさらに置く区画（サイドパネルの各セクション等）。部品（tertiary）より暗い |
| `$dark-bg-hover` | #3a3a3a | ホバー背景 |
| `$dark-bg-active` | #4a4a4a | 選択中・ON の面 |
| `$dark-bg-input` | #262626 | テキスト入力欄の面 |
| `$dark-bg-float` | #2e2e2e | メニュー・ダイアログ等の浮く面（`$shadow-float` と組） |
| `$dark-bg-chrome` | #141414 | タブバー・パネル見出しなど、パネルの中身を切り替える枠の面（内容より暗く沈める） |
| `$dark-bg-chrome-hover` | rgba(white, .04) | chrome 上のホバー |
| `$dark-border` | #232323 | 中身の構造を示す線（表の罫線・Markdown の区切り等）。要素の枠には使わない |
| `$dark-border-light` | #2c2c2c | 同上（やや明るい） |
| `$dark-border-focus` | #333333 | 同上（強め） |
| `$dark-text-primary` | #ffffff | テキスト（主） |
| `$dark-text-secondary` | #a3a3a3 | テキスト（副） |
| `$dark-text-muted` | #6b6b6b | テキスト（控えめ） |
| `$accent` | `$gray-200` | 強い強調の面（主ボタン・送信など）。白に近い |
| `$accent-hover` | `$gray-300` | 強調のホバー |
| `$accent-fg` | `$gray-900` | `$accent` の上に載せる文字・アイコン |
| `$focus-ring` | `$gray-400` | キーボードフォーカス・入力中の欄の outline |
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
| フォント | `$font-sans` | Helvetica Neue, Arial, ヒラギノ角ゴ, …（OREngine の uipower と同じ並び） |
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

外側の面ほど少し大きく丸める（部品 5 → 区画 6 → パネル 8 → 浮く面 10）。
面は内側に余白を取って部品を入れるため、外側の角が内側より小さいと入れ子の輪郭がちぐはぐに見える。
入れ子の面は、内側の角丸を外側以下にする（例: 区画 6px の中の行は 5px）。

| トークン | 値 | 用途 |
|----------|----|----|
| `$radius-sm` | 3px | 小さなチップ・バッジ・チェックボックス |
| `$radius` | 5px | 部品（ボタン・入力欄・行・キー・タブ） |
| `$radius-md` | 5px | 部品（`$radius` と同じ値の別名） |
| `$radius-lg` | 6px | パネル内の区画（`$dark-bg-raised` の面・選択肢を並べるトラック・注意書きの箱など） |
| `$radius-xl` | 8px | パネル・カード |
| `$radius-2xl` | 10px | メニュー・ダイアログ・トーストなど浮く面 |
| `$radius-full` | 9999px | 丸・ピル |

片側だけ丸める場合（タブバーの上辺など）も、その面の役割のトークンを使う（例: パネル上端のタブバーは `$radius-xl $radius-xl 0 0`）。
行が左右いっぱいに並ぶメニューは、hover の面が角からはみ出さないよう `overflow: hidden` で切り取る。

### シャドウ

| トークン | 値 |
|----------|----|
| `$shadow-sm` | 0 1px 2px 0 rgba(0,0,0,.05) |
| `$shadow` | 0 1px 3px 0 rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1) |
| `$shadow-md` | 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1) |
| `$shadow-lg` | 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1) |
| `$shadow-float` | 0 8px 24px rgba(0,0,0,.55)（枠線の無い浮く面を下から離す） |

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
- **同じ群に並ぶ部品の隙間は縦横で同じ値にする。** 入力欄まわり（CommandInput）と SP のキー群（KeyboardButtons）は
  `$space-2xs`。群と群の間は一段広く（`$space-sm`）空け、区切り線は引かない。
  高さの違う部品が隣り合う場合は、隙間で調整せず部品を伸ばして端を揃える（例: Enter の高さに合わせて 2×2 のコマンドを伸ばす）。
- **font-size はスケールのみ。** `$font-size-*` 以外の値を使わない。
- **アイコンは lucide-react のみ。** サイズは **12, 14, 16, 20, 32** の 5 種に限定する
  （それ以外のサイズを新規に増やさない）。

## 枠線を使わない

要素の形や区切りは枠線（border）ではなく**面の明るさの段差**で見せる（OREngine の uipower と同じ考え方）。
奥から `$dark-bg-primary` → `secondary`（パネル）→ `tertiary`（パネル上の部品）の順に明るくする。

| やりたいこと | 書き方 |
|--------------|--------|
| 要素を囲む | border は付けない。親より一段明るい背景を付ける（パネル=`secondary`、パネル内の区画=`$dark-bg-raised`、部品=`tertiary`、入力欄=`$dark-bg-input`） |
| ボタン（アイコンボタン・文字だけの小ボタン） | 平常時から `tertiary` の面＋`$dark-text-secondary`。hover で `$dark-bg-hover`＋`$dark-text-primary` |
| トラックに並ぶ選択肢（送信モード・ワークフロー等） | 非選択は面なし＋`$dark-text-secondary`、hover で `tertiary` の面。選択中は `$dark-bg-active` |
| 行（一覧・メニュー項目）・タブ | 平常時は面なし。hover で面を出す |
| 領域を区切る（ヘッダー下など） | 区切り線は引かない。余白（gap）か、片方の背景を一段変えて区切る |
| ホバー | `background-color: $dark-bg-hover` |
| 下のパネルを切り替えるタブバー・パネル見出し | バーは `$dark-bg-chrome`（ホバーは `$dark-bg-chrome-hover`）。選択中のタブは下のパネルと同じ面（`secondary`）＋白文字にして地続きに見せる。枠を内容より明るくしない |
| 選択中・ON | `background-color: $dark-bg-active`。特に強く示すものだけ `$accent` + `$accent-fg` |
| フォーカス（入力欄・キーボード操作） | `outline: 1px solid $focus-ring; outline-offset: -1px;` |
| メニュー・ダイアログなど浮く面 | `background-color: $dark-bg-float; box-shadow: $shadow-float;` |
| 状態色（エラー・成功など）を示す | 色付きの枠ではなく、背景を `$color-*-bg`（または `rgba($color-*, 0.18)` 程度）で染め、文字を状態色にする |
| 画像・キャンバスの上に浮くボタン | 枠を付けず、半透明の背景（`rgba(white, …)` + `backdrop-filter`）で見せる（`tertiary` の面は付けない） |

押せるものは平常時から面を持ち、行・タブは面なしにする。ボタンと行・タブの区別は「面があるかどうか」で付ける
（迷ったら、並んだ一覧の 1 件なら行、パネルの中身を切り替えるならタブ、単発の操作ならボタン）。

例外として線を使ってよいのは、**中身の構造を表す線**だけ:
Markdown（見出しの下線・表の罫線・引用の左線・hr）、diff やコードの行の印、スピナー（border で描く回転）、
CSS の三角形、ドラッグ中だけ出るドロップ位置の印。これらには `$dark-border*` などを使う。

## 強制（stylelint）

上記の使用ルールのうち機械的に検査できるものは、stylelint で強制する（`apps/dokodemo-claude-web`
のみ・対象は `src/**/*.scss`）。設定は `apps/dokodemo-claude-web/.stylelintrc.cjs`。プリセットは
入れず、目的特化の 3 ルールに限定している。

| ルール | 内容 |
|--------|------|
| `color-no-hex` | hex 色の直書き禁止。色はトークン（プリミティブ / セマンティック）で参照する |
| 余白リテラル禁止 | `padding*` / `margin*` / `gap` / `row-gap` / `column-gap` に `px` / `rem` / `em` リテラルを禁止。`$space-*` / `0` / `auto` / `calc(...)` は通す |
| タイポグラフィリテラル禁止 | `font-size` に `px` / `rem` / `em` リテラルを禁止（`$font-size-*` のみ）、`font-weight` に数値リテラルを禁止（`$font-weight-*` のみ・`inherit` 等の語は可） |

`npm run check-all`（ルート）に組み込まれており、`npm run lint:style` 単体でも実行できる。

### 例外の書き方

ライトボックスの左右クリアランスや iOS Safari の zoom 防止（`font-size: 16px`）、負マージンなど、
スケールに存在しないレイアウト級の値がどうしても必要な箇所は、その行の直前に理由付きの
disable コメントを置く（トークン化できる同値があるならまずトークンを使う）。

```scss
.foo {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 理由をここに書く */
  padding: 0 64px;
}
```

例外が増えすぎる場合（20 超）は、まずトークン化できる値がないかを先に検討する。

## 共通コンポーネント

トークンを内包した基本部品。`apps/dokodemo-claude-web/src/shared/components/` に置く。
import は `@/shared/components/<Name>` で行う（barrel index.ts は作らない）。

### Button

`Button.tsx` — トークンのみで構成した基本ボタン。native の `button` 属性
（`React.ButtonHTMLAttributes<HTMLButtonElement>`）をそのまま透過する。

| prop | 型 | 既定 | 説明 |
|------|----|------|------|
| `variant` | `'primary' \| 'danger' \| 'ghost'` | `'ghost'` | primary=`$accent`、danger=`$color-error`、ghost=`$dark-bg-tertiary` の面 |
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
平常時から `$dark-bg-tertiary` の面を持ち、hover で `$dark-bg-hover` になる。
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
