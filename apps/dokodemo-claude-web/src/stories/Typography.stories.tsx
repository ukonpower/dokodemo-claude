import type { Meta, StoryObj } from '@storybook/react-vite';
import tokens from './tokens.module.scss';
import s from './story-layout.module.scss';

const fontSizes: [string, string][] = [
  ['$font-size-2xs', tokens.fontSize_2xs],
  ['$font-size-xs', tokens.fontSize_xs],
  ['$font-size-sm', tokens.fontSize_sm],
  ['$font-size-base', tokens.fontSize_base],
  ['$font-size-lg', tokens.fontSize_lg],
  ['$font-size-xl', tokens.fontSize_xl],
  ['$font-size-2xl', tokens.fontSize_2xl],
  ['$font-size-3xl', tokens.fontSize_3xl],
];

const fontWeights: [string, string][] = [
  ['$font-weight-normal', tokens.fontWeight_normal],
  ['$font-weight-medium', tokens.fontWeight_medium],
  ['$font-weight-semibold', tokens.fontWeight_semibold],
  ['$font-weight-bold', tokens.fontWeight_bold],
];

function TypographyView() {
  return (
    <div>
      <section className={s.section}>
        <h3 className={s.sectionTitle}>フォントサイズ</h3>
        {fontSizes.map(([name, value]) => (
          <div key={name} className={s.typeRow}>
            <div className={s.typeMeta}>
              {name} / {value}
            </div>
            <div className={s.typeSample} style={{ fontSize: value }}>
              どこでもClaude Ag123
            </div>
          </div>
        ))}
      </section>

      <section className={s.section}>
        <h3 className={s.sectionTitle}>フォントウェイト</h3>
        {fontWeights.map(([name, value]) => (
          <div key={name} className={s.typeRow}>
            <div className={s.typeMeta}>
              {name} / {value}
            </div>
            <div
              className={s.typeSample}
              style={{
                fontWeight: Number(value),
                fontSize: tokens.fontSize_lg,
              }}
            >
              どこでもClaude Ag123
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const meta: Meta<typeof TypographyView> = {
  title: 'Tokens/Typography',
  component: TypographyView,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof TypographyView>;

export const All: Story = {};
