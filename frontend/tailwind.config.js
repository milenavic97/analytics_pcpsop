export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy:    { 900:'#0B1120', 800:'#111827', 700:'#1a2235', 600:'#1e293b', 500:'#253348' },
        brand:   { 500:'#2563EB', 400:'#3B82F6', 300:'#60A5FA' },
        success: '#10B981',
        warning: '#F59E0B',
        danger:  '#EF4444',
        muted:   '#64748B',
      },
      fontFamily: {
        sans:    ['"DM Sans"', 'sans-serif'],
        display: ['"Syne"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
