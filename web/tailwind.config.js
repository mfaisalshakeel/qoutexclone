/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0a0e17',
          800: '#0f1421',
          700: '#151c2c',
          600: '#1c2436',
          500: '#273149',
          400: '#3a4763',
        },
        // `DEFAULT` stays bright for use as foreground text/icons/borders on
        // dark surfaces (it already clears 4.5:1 there). `solid` is a darker
        // shade for the opposite case — this color as a filled background
        // behind *white* text (buttons, active toggle pills, badges) — where
        // the bright DEFAULT only reaches ~2.5–3.8:1 with white and fails
        // WCAG AA. One token can't satisfy both directions at once.
        up: { DEFAULT: '#12b886', soft: 'rgba(18,184,134,0.12)', solid: '#047857' },
        // brightened the same way as accent above: `text-down` on a
        // `bg-down-soft` chip measured 4.47:1 on one composited background
        down: { DEFAULT: '#ff5c73', soft: 'rgba(240,69,94,0.12)', solid: '#be123c' },
        // brightened so this color, used as foreground text/icons on any of
        // this app's dark surfaces — including a `bg-accent-soft` chip's
        // translucent tint composited over a lighter card, which shifts the
        // effective background per page — clears 4.5:1 with real margin
        // rather than sitting near the edge on every one of them in turn
        // (the original #3d7bff measured as low as 4.46:1; #4d88ff, chosen
        // for one such case, still measured 4.14:1 on another)
        accent: { DEFAULT: '#6b9fff', soft: 'rgba(61,123,255,0.12)', solid: '#2563eb' },
        // Tailwind's stock slate-500 (#64748b), used all over this app for
        // de-emphasised captions, tops out around 3.9–4.05:1 against any of
        // this app's near-black surfaces — never the required 4.5:1. Nudged
        // just bright enough to clear it everywhere at once, rather than
        // hunting down every caption that uses `text-slate-500` by hand.
        slate: { 500: '#7c8db0' },
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
