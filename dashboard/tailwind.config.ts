import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#04050a',
          900: '#070911',
          800: '#0b0e17',
          700: '#111524',
          600: '#1a1f33',
        },
        accent: {
          DEFAULT: '#6366f1',
          soft: '#818cf8',
          violet: '#8b5cf6',
          cyan: '#22d3ee',
        },
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 24px 48px -32px rgba(0,0,0,0.9)',
        glow: '0 0 0 1px rgba(99,102,241,0.25), 0 20px 60px -20px rgba(99,102,241,0.45)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
export default config
