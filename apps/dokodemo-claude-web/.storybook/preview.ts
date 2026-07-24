import type { Preview, Decorator } from '@storybook/react-vite';
import React from 'react';
// アプリのベーススタイル（リセット・フォント・ダーク背景）を Storybook にも適用する
import '../src/index.scss';

// 各ストーリーをダーク背景（$dark-bg-primary = #0a0a0a）のコンテナで囲む
const withDarkBackground: Decorator = (Story) =>
  React.createElement(
    'div',
    {
      style: {
        backgroundColor: '#0a0a0a',
        color: '#ffffff',
        minHeight: '100vh',
        padding: '1.5rem',
        fontFamily: "'Inter', system-ui, sans-serif",
      },
    },
    React.createElement(Story)
  );

const preview: Preview = {
  decorators: [withDarkBackground],
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [{ name: 'dark', value: '#0a0a0a' }],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
