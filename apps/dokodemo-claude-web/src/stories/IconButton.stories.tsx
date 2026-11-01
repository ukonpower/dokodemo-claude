import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, X, Settings, Trash2 } from 'lucide-react';
import IconButton from '@/shared/components/IconButton';
import s from './story-layout.module.scss';

const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  args: {
    size: 'md',
    label: '追加',
    disabled: false,
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['md', 'xs'] },
  },
  render: (args) => (
    <IconButton {...args}>
      <Plus />
    </IconButton>
  ),
};

export default meta;
type Story = StoryObj<typeof IconButton>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className={s.componentGrid}>
      {(['md', 'xs'] as const).map((size) => (
        <div key={size}>
          <div className={s.rowLabel}>size = {size}</div>
          <div className={s.componentRow}>
            <IconButton size={size} label="追加">
              <Plus />
            </IconButton>
            <IconButton size={size} label="設定">
              <Settings />
            </IconButton>
            <IconButton size={size} label="削除">
              <Trash2 />
            </IconButton>
            <IconButton size={size} label="閉じる">
              <X />
            </IconButton>
            <IconButton size={size} label="無効" disabled>
              <Plus />
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  ),
};
