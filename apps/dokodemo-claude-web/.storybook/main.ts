import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  // react-vite は既存 vite.config.ts（SCSS additionalData・`@` エイリアス）を
  // 自動でマージする。ただし VitePWA は Storybook のビルドに不要で
  // service worker 生成が build を落とすため viteFinal で取り除く。
  // VitePWA は配列（ネストした複数プラグイン）を返すので flat してから除外する。
  viteFinal: async (viteConfig) => {
    const flat = (viteConfig.plugins ?? []).flat(Infinity);
    viteConfig.plugins = flat.filter((plugin) => {
      if (!plugin || typeof plugin !== 'object') return Boolean(plugin);
      const name = 'name' in plugin ? String((plugin as { name?: unknown }).name ?? '') : '';
      return !name.includes('pwa');
    });
    return viteConfig;
  },
};

export default config;
