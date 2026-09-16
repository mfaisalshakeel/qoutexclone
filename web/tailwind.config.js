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
        up: { DEFAULT: '#12b886', soft: 'rgba(18,184,134,0.12)' },
        down: { DEFAULT: '#f0455e', soft: 'rgba(240,69,94,0.12)' },
        accent: { DEFAULT: '#3d7bff', soft: 'rgba(61,123,255,0.12)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(61,123,255,0.45)' }, '100%': { boxShadow: '0 0 0 12px rgba(61,123,255,0)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
        ring: 'pulseRing 1.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};
