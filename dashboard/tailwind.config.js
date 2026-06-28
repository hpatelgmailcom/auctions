/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Base surfaces
        surface:  { DEFAULT: '#0f172a', card: '#1e293b', hover: '#263348', border: '#334155' },
        // Brand
        brand:    { DEFAULT: '#6366f1', light: '#818cf8', dark: '#4f46e5' },
        // Semantic
        bid:      { DEFAULT: '#10b981', light: '#34d399', bg: '#064e3b' },
        nobid:    { DEFAULT: '#ef4444', light: '#f87171', bg: '#7f1d1d' },
        conditional: { DEFAULT: '#f59e0b', light: '#fcd34d', bg: '#78350f' },
        // Text
        ink:      { DEFAULT: '#f1f5f9', muted: '#94a3b8', subtle: '#64748b' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
