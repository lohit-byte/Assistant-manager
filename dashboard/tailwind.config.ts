import type { Config } from 'tailwindcss'

/**
 * The war board theme.
 *
 * The app used Tailwind's default indigo/slate scales. They are remapped here to the board
 * palette so every existing page inherits the system without a risky rewrite:
 *   slate  -> warm bone greys
 *   indigo -> signal orange, the one accent
 *   ink    -> matte board surfaces
 *
 * Every value is a CSS variable defined in app/globals.css, so the same utility classes render
 * the dark board and the warm-paper light theme (`[data-theme="light"]`). The variables keep the
 * alpha channel working, which is what the `white/[0.08]` hairlines across the app rely on.
 * The DESIGN.md file has the role names and contrast notes.
 */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    // lib/ holds shared UI (the toast viewport) whose utility classes must be generated too.
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: token('--c-ink-950'),
          900: token('--c-ink-900'),
          800: token('--c-ink-800'),
          700: token('--c-ink-700'),
          600: token('--c-ink-600'),
        },
        accent: {
          100: token('--c-accent-100'),
          200: token('--c-accent-200'),
          300: token('--c-accent-300'),
          400: token('--c-accent-400'),
          500: token('--c-accent-500'),
          600: token('--c-accent-600'),
          700: token('--c-accent-700'),
          800: token('--c-accent-800'),
        },
        // Text colour for anything sitting on a solid accent/danger/sage fill. It stays dark in
        // both themes because the fill (the signal orange) stays bright in both.
        'accent-ink': token('--c-accent-ink'),
        // Small solid elements that must stay light in both themes (toggle knob, logo ticks).
        paper: token('--c-paper'),
        steel: {
          200: token('--c-steel-200'),
          300: token('--c-steel-300'),
          400: token('--c-steel-400'),
          500: token('--c-steel-500'),
          600: token('--c-steel-600'),
        },
        sage: {
          300: token('--c-sage-300'),
          400: token('--c-sage-400'),
          500: token('--c-sage-500'),
        },
        danger: {
          300: token('--c-danger-300'),
          400: token('--c-danger-400'),
          500: token('--c-danger-500'),
          600: token('--c-danger-600'),
        },
        warn: {
          300: token('--c-warn-300'),
          400: token('--c-warn-400'),
          500: token('--c-warn-500'),
        },
        // The alpha hairlines (`border-white/[0.1]`) flip to warm ink on paper in light mode.
        white: token('--c-white'),
        // Warm replacements for Tailwind's cool slate scale.
        slate: {
          50: token('--c-slate-50'),
          100: token('--c-slate-100'),
          200: token('--c-slate-200'),
          300: token('--c-slate-300'),
          400: token('--c-slate-400'),
          500: token('--c-slate-500'),
          600: token('--c-slate-600'),
          700: token('--c-slate-700'),
          800: token('--c-slate-800'),
          900: token('--c-slate-900'),
          950: token('--c-slate-950'),
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
