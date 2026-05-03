/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper:   { DEFAULT: 'var(--paper)', 2: 'var(--paper-2)', 3: 'var(--paper-3)' },
        ink:     { DEFAULT: 'var(--ink)',   2: 'var(--ink-2)',   3: 'var(--ink-3)',   4: 'var(--ink-4)' },
        // Friendlier alias: bg-fg / text-fg-2 / etc.
        fg:      { DEFAULT: 'var(--ink)',   2: 'var(--ink-2)',   3: 'var(--ink-3)',   4: 'var(--ink-4)' },
        bg:      { DEFAULT: 'var(--paper)', 2: 'var(--paper-2)', 3: 'var(--paper-3)' },
        rule:    { DEFAULT: 'var(--rule)',  2: 'var(--rule-2)' },

        accent:  { DEFAULT: 'var(--accent)', soft: 'var(--accent-soft)', ink: 'var(--accent-ink)' },
        cloud:   { DEFAULT: 'var(--cloud)',  soft: 'var(--cloud-soft)' },
        local:   { DEFAULT: 'var(--local)',  soft: 'var(--local-soft)' },
        live:    { DEFAULT: 'var(--live)',   soft: 'var(--live-soft)' },
        warn:    { DEFAULT: 'var(--warn)',   soft: 'var(--warn-soft)' },
        error:   { DEFAULT: 'var(--error)',  soft: 'var(--error-soft)' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Compact size scale — UI is information-dense.
        '2xs': ['9.5px', { lineHeight: '12px' }],
        xs:   ['10.5px', { lineHeight: '14px' }],
        sm:   ['11.5px', { lineHeight: '16px' }],
        base: ['13px',   { lineHeight: '1.5' }],
        md:   ['13.5px', { lineHeight: '1.45' }],
        lg:   ['15px',   { lineHeight: '1.4' }],
        xl:   ['17px',   { lineHeight: '1.35' }],
        '2xl':['22px',   { lineHeight: '1.25' }],
        '3xl':['28px',   { lineHeight: '1.15' }],
      },
      letterSpacing: {
        tightish: '-0.005em',
        head:     '-0.015em',
        head2:    '-0.02em',
        caps:     '0.06em',
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '10px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
};
