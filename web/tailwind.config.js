/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // `dark:` follows the app's own switch (the `dark` class the theme store puts
  // on <html>), not the OS — otherwise a trader on light with a dark OS gets
  // both halves at once
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /*
         * Every surface colour is a channel triplet on the root element, so one
         * palette drives both themes and `bg-ink-800/60` keeps working. The
         * values live in index.css: dark on `:root`, light under
         * `[data-theme='light']`. `ink-900` is the page, `ink-400` the faintest
         * line — in the light theme that ramp runs the other way (900 is the
         * lightest), because the names describe depth in the stack, not darkness.
         */
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
        },
        // `DEFAULT` stays bright for use as foreground text/icons/borders on
        // dark surfaces (it already clears 4.5:1 there). `solid` is a darker
        // shade for the opposite case — this color as a filled background
        // behind *white* text (buttons, active toggle pills, badges) — where
        // the bright DEFAULT only reaches ~2.5–3.8:1 with white and fails
        // WCAG AA. One token can't satisfy both directions at once.
        up: {
          DEFAULT: 'rgb(var(--up) / <alpha-value>)',
          soft: 'rgb(var(--up-soft) / 0.12)',
          solid: 'rgb(var(--up-solid) / <alpha-value>)',
        },
        // brightened the same way as accent above: `text-down` on a
        // `bg-down-soft` chip measured 4.47:1 on one composited background
        down: {
          DEFAULT: 'rgb(var(--down) / <alpha-value>)',
          soft: 'rgb(var(--down-soft) / 0.12)',
          solid: 'rgb(var(--down-solid) / <alpha-value>)',
        },
        // brightened so this color, used as foreground text/icons on any of
        // this app's dark surfaces — including a `bg-accent-soft` chip's
        // translucent tint composited over a lighter card, which shifts the
        // effective background per page — clears 4.5:1 with real margin
        // rather than sitting near the edge on every one of them in turn
        // (the original #3d7bff measured as low as 4.46:1; #4d88ff, chosen
        // for one such case, still measured 4.14:1 on another)
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / 0.12)',
          solid: 'rgb(var(--accent-solid) / <alpha-value>)',
        },
        // Tailwind's stock slate-500 (#64748b), used all over this app for
        // de-emphasised captions, tops out around 3.9–4.05:1 against any of
        // this app's near-black surfaces — never the required 4.5:1. Nudged
        // just bright enough to clear it everywhere at once, rather than
        // hunting down every caption that uses `text-slate-500` by hand.
        // the app's caption colour; the light theme needs a much darker one to
        // clear 4.5:1 on white, so it moves with the theme like everything else
        selected: {
          DEFAULT: 'rgb(var(--selected) / <alpha-value>)',
          fg: 'rgb(var(--selected-fg) / <alpha-value>)',
        },
        slate: {
          500: 'rgb(var(--muted) / <alpha-value>)',
          400: 'rgb(var(--muted-strong) / <alpha-value>)',
          300: 'rgb(var(--text-soft) / <alpha-value>)',
          200: 'rgb(var(--text) / <alpha-value>)',
          100: 'rgb(var(--text-strong) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(61,123,255,0.45)' },
          '100%': { boxShadow: '0 0 0 12px rgba(61,123,255,0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
        ring: 'pulseRing 1.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};
