import type { Meta, StoryObj } from '@storybook/react-vite';
import tokens from './tokens.module.scss';
import s from './story-layout.module.scss';

const spaces: [string, string][] = [
  ['$space-3xs', tokens.space_3xs],
  ['$space-2xs', tokens.space_2xs],
  ['$space-xs', tokens.space_xs],
  ['$space-sm', tokens.space_sm],
  ['$space-md', tokens.space_md],
  ['$space-lg', tokens.space_lg],
  ['$space-xl', tokens.space_xl],
  ['$space-2xl', tokens.space_2xl],
  ['$space-3xl', tokens.space_3xl],
];

function SpacingView() {
  return (
    <section className={s.section}>
      <h3 className={s.sectionTitle}>スペーシングスケール</h3>
      <p className={s.sectionDesc}>
        margin / padding / gap はこのスケールから選ぶ。
      </p>
      {spaces.map(([name, value]) => (
        <div key={name} className={s.spaceRow}>
          <div className={s.spaceMeta}>
            {name} / {value}
          </div>
          <div className={s.spaceBar} style={{ width: value }} />
        </div>
      ))}
    </section>
  );
}

const meta: Meta<typeof SpacingView> = {
  title: 'Tokens/Spacing',
  component: SpacingView,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof SpacingView>;

export const All: Story = {};
