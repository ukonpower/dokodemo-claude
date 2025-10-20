/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    borderColor: (theme) => ({
      ...theme('colors'),
      DEFAULT: '#1f1f1f',
    }),
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
        // 純粋なニュートラルグレー（青みなし）
        gray: {
          50: '#fafafa',
          100: '#f5f5f5',
          200: '#e5e5e5',
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
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
            DEFAULT: '#1f1f1f',
            light: '#2a2a2a',
            focus: '#333333',
          },
          text: {
            primary: '#ffffff',
            secondary: '#a0a0a0',
            muted: '#666666',
          },
          accent: {
            blue: '#6b7280',
            'blue-hover': '#4b5563',
            green: '#10b981',
            'green-hover': '#059669',
            red: '#ef4444',
            'red-hover': '#dc2626',
            purple: '#9ca3af',
            'purple-hover': '#6b7280',
            cyan: '#6b7280',
            'cyan-hover': '#4b5563',
            orange: '#9ca3af',
            'orange-hover': '#6b7280',
          },
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [
    function ({ addUtilities, theme }) {
      const borderColors = theme('colors.dark.border');
      const newUtilities = {
        '.border-dark-border-DEFAULT': {
          borderColor: borderColors.DEFAULT,
        },
        '.border-dark-border-light': {
          borderColor: borderColors.light,
        },
        '.border-dark-border-focus': {
          borderColor: borderColors.focus,
        },
      };
      addUtilities(newUtilities);
    },
  ],
};
