import type { Meta, StoryObj } from '@storybook/react-vite';
import ModalShell from '@/shared/components/ModalShell';
import Button from '@/shared/components/Button';

const meta: Meta<typeof ModalShell> = {
  title: 'Components/ModalShell',
  component: ModalShell,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof ModalShell>;

// オーバーレイは position:fixed で画面全体を覆うため、開いた状態がそのまま見える
export const Open: Story = {
  render: () => (
    <ModalShell
      title="ワークツリーを作成"
      onClose={() => {}}
      footer={
        <>
          <Button variant="ghost" onClick={() => {}}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={() => {}}>
            作成
          </Button>
        </>
      }
    >
      <p style={{ color: '#a0a0a0', fontSize: '0.875rem', lineHeight: 1.6 }}>
        ModalShell はオーバーレイ・パネル・ヘッダー（タイトル + 閉じるボタン）・
        コンテンツ領域・任意フッターの骨組みを提供します。オーバーレイのクリックと
        Escape キーで onClose が呼ばれます。
      </p>
    </ModalShell>
  ),
};

export const WithoutFooter: Story = {
  render: () => (
    <ModalShell title="お知らせ" onClose={() => {}}>
      <p style={{ color: '#a0a0a0', fontSize: '0.875rem' }}>
        フッターを省略した場合はコンテンツ領域のみが表示されます。
      </p>
    </ModalShell>
  ),
};
