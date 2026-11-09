import type { Config } from 'tailwindcss'

/**
 * The war board theme.
 *
 * The app used Tailwind's default indigo/slate scales. They are remapped here to the board
 * palette so every existing page inherits the new system without a risky rewrite:
 *   slate  -> warm bone greys (AA checked on the #0c0d0a ground)
 *   indigo -> signal orange, the one accent
 *   ink    -> matte board surfaces
 * The DESIGN.md file has the role names and contrast notes.
 */
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
          950: '#0c0d0a',
          900: '#10110c',
          800: '#12130e',
          700: '#181a13',
          600: '#23251c',
        },
        accent: {
          100: '#ffe4d5',
          200: '#ffc6ac',
          300: '#ffa07a',
          400: '#ff8148',
          500: '#ff6b2c',
          600: '#e2500f',
          700: '#b23d0b',
          800: '#7d2a07',
        },
        steel: {
          200: '#d3dee8',
          300: '#c1d0dd',
          400: '#a9bccf',
          500: '#8ba1b6',
          600: '#6d8499',
        },
        sage: {
          300: '#b7ceb0',
          400: '#a3c19a',
          500: '#93b48a',
        },
        danger: {
          300: '#f0a294',
          400: '#e88a78',
          500: '#e2604a',
          600: '#c14432',
        },
        warn: {
          300: '#efd39a',
          400: '#e8bf6e',
          500: '#d9a94e',
        },
        // Warm replacements for Tailwind's cool slate scale.
        slate: {
          50: '#f7f3ea',
          100: '#f3eee2',
          200: '#e4ded0',
          300: '#cec7b7',
          400: '#b3ac9d',
          500: '#a29c8e',
          600: '#8f897b',
          700: '#5f5a50',
          800: '#3a372f',
          900: '#23211b',
          950: '#12130f',
        },
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-archivo)', 'ui-sans-serif', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // One radius rule: the board is cut, not rounded.
      borderRadius: {
        DEFAULT: '3px',
        sm: '2px',
        md: '3px',
        lg: '4px',
        xl: '4px',
        '2xl': '6px',
        '3xl': '8px',
      },
      boxShadow: {
        panel: '0 1px 0 rgba(241, 236, 224, 0.05) inset',
        glow: '0 0 0 1px rgba(255, 107, 44, 0.35)',
      },
      letterSpacing: {
        stamp: '0.16em',
      },
    },
  },
  plugins: [],
}
export default config
