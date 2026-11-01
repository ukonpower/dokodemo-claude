import type { Meta, StoryObj } from '@storybook/react-vite';
import Button from '@/shared/components/Button';
import s from './story-layout.module.scss';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  args: {
    children: 'ボタン',
    variant: 'ghost',
    size: 'md',
    disabled: false,
  },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'danger', 'ghost'],
    },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

// Controls で単体を操作する用
export const Playground: Story = {};

// variant × size × disabled の総当たり
export const Matrix: Story = {
  render: () => {
    const variants = ['primary', 'danger', 'ghost'] as const;
    const sizes = ['md', 'sm'] as const;
    return (
      <div className={s.componentGrid}>
        {variants.map((variant) => (
          <div key={variant}>
            <div className={s.rowLabel}>{variant}</div>
            <div className={s.componentRow}>
              {sizes.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {size} / {variant}
                </Button>
              ))}
              {sizes.map((size) => (
                <Button key={`${size}-d`} variant={variant} size={size} disabled>
                  disabled
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
};
