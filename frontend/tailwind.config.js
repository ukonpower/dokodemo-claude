/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      xs: '475px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        claude: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        // 黒ベースのテーマカラー
        dark: {
          bg: {
            primary: '#0a0a0a',
            secondary: '#141414',
            tertiary: '#1c1c1c',
            hover: '#252525',
          },
          border: {
            DEFAULT: '#2a2a2a',
            light: '#333333',
            focus: '#404040',
          },
          text: {
            primary: '#ffffff',
            secondary: '#a0a0a0',
            muted: '#666666',
          },
          accent: {
            blue: '#3b82f6',
            'blue-hover': '#2563eb',
            green: '#10b981',
            'green-hover': '#059669',
            red: '#ef4444',
            'red-hover': '#dc2626',
            purple: '#a855f7',
            'purple-hover': '#9333ea',
            cyan: '#06b6d4',
            'cyan-hover': '#0891b2',
            orange: '#f59e0b',
            'orange-hover': '#d97706',
          },
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
