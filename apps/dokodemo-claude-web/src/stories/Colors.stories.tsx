import type { Meta, StoryObj } from '@storybook/react-vite';
import tokens from './tokens.module.scss';
import s from './story-layout.module.scss';

// tokens.module.scss の :export から解決済みの値（hex 文字列）を読む。
// 変数名 → 表示ラベルの対応を持ち、値はトークン側を単一ソースとして参照する。

const semanticGroups: { title: string; items: [string, string][] }[] = [
  {
    title: '背景 / ボーダー / テキスト',
    items: [
      ['$dark-bg-primary', tokens.darkBgPrimary],
      ['$dark-bg-secondary', tokens.darkBgSecondary],
      ['$dark-bg-tertiary', tokens.darkBgTertiary],
      ['$dark-bg-hover', tokens.darkBgHover],
      ['$dark-border', tokens.darkBorder],
      ['$dark-border-light', tokens.darkBorderLight],
      ['$dark-border-focus', tokens.darkBorderFocus],
      ['$dark-text-primary', tokens.darkTextPrimary],
      ['$dark-text-secondary', tokens.darkTextSecondary],
      ['$dark-text-muted', tokens.darkTextMuted],
    ],
  },
  {
    title: '強調 / ステータス',
    items: [
      ['$accent', tokens.accent],
      ['$accent-hover', tokens.accentHover],
      ['$color-success', tokens.colorSuccess],
      ['$color-success-hover', tokens.colorSuccessHover],
      ['$color-warning', tokens.colorWarning],
      ['$color-warning-hover', tokens.colorWarningHover],
      ['$color-error', tokens.colorError],
      ['$color-error-hover', tokens.colorErrorHover],
      ['$color-info', tokens.colorInfo],
      ['$color-info-hover', tokens.colorInfoHover],
    ],
  },
  {
    title: 'ステータス淡色',
    items: [
      ['$color-success-bg', tokens.colorSuccessBg],
      ['$color-success-border', tokens.colorSuccessBorder],
      ['$color-warning-bg', tokens.colorWarningBg],
      ['$color-warning-border', tokens.colorWarningBorder],
      ['$color-error-bg', tokens.colorErrorBg],
      ['$color-error-border', tokens.colorErrorBorder],
      ['$color-info-bg', tokens.colorInfoBg],
      ['$color-info-border', tokens.colorInfoBorder],
    ],
  },
  {
    title: 'diff',
    items: [
      ['$diff-added-text', tokens.diffAddedText],
      ['$diff-added-bg', tokens.diffAddedBg],
      ['$diff-removed-text', tokens.diffRemovedText],
      ['$diff-removed-bg', tokens.diffRemovedBg],
    ],
  },
];

const paletteFamilies = [
  'gray',
  'red',
  'orange',
  'amber',
  'yellow',
  'green',
  'emerald',
  'blue',
  'cyan',
  'purple',
];
const paletteShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className={s.swatch}>
      <div className={s.swatchColor} style={{ backgroundColor: value }} />
      <div className={s.swatchMeta}>
        <span className={s.swatchName}>{name}</span>
        <span className={s.swatchValue}>{value}</span>
      </div>
    </div>
  );
}

function ColorsView() {
  return (
    <div>
      {semanticGroups.map((group) => (
        <section key={group.title} className={s.section}>
          <h3 className={s.sectionTitle}>{group.title}</h3>
          <div className={s.swatchGrid}>
            {group.items.map(([name, value]) => (
              <Swatch key={name} name={name} value={value} />
            ))}
          </div>
        </section>
      ))}

      <section className={s.section}>
        <h3 className={s.sectionTitle}>プリミティブパレット</h3>
        <p className={s.sectionDesc}>
          装飾的に多色が必要な場面（GitGraph のブランチ色など）でのみ直接参照する。
        </p>
        {paletteFamilies.map((family) => (
          <div key={family} className={s.paletteRow}>
            <div className={s.paletteFamily}>{family}</div>
            {paletteShades.map((shade) => {
              const value = tokens[`${family}${shade}`];
              return (
                <div
                  key={shade}
                  className={s.paletteChip}
                  style={{ backgroundColor: value }}
                  title={`$${family}-${shade} ${value}`}
                >
                  {shade}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

const meta: Meta<typeof ColorsView> = {
  title: 'Tokens/Colors',
  component: ColorsView,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ColorsView>;

export const All: Story = {};
