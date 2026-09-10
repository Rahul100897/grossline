// Grossline Tailwind theme — mirrors docs/design/design-tokens.css exactly.
// Every value here must match a token. If you need a value that isn't here,
// add it to design-tokens.css first, then mirror it here.
//
// Enforce with an eslint/tailwind rule banning arbitrary values:
//   no `text-[#123456]`, no `p-[13px]`, no `rounded-[14px]`.
// If a utility needs a value that doesn't exist in this theme, that is a
// signal the design is drifting — stop and add the token deliberately.

export const grosslineTheme = {
  extend: {
    colors: {
      green: {
        DEFAULT: '#0F6F5C',
        deep:    '#0A4A3E',
        dark:    '#0B3A31',
        darker:  '#072922',
        soft:    '#E7F0EC',
        line:    '#1B4A3F',
        accent:  '#7FD3BC',
        muted:   '#9DC4B8',
        dim:     '#5C7D74',
      },
      cream: {
        DEFAULT: '#F8F5ED',
        2:       '#F1EDE1',
        3:       '#FCFBF6',
        report:  '#FDFCF8',
      },
      line: {
        DEFAULT: '#E2DCCC',
        soft:    '#EDE8DA',
      },
      ink:   '#131A18',
      slate: { DEFAULT: '#5E6B66', 2: '#8A948F' },
      rust:  { DEFAULT: '#B4472B', soft: '#FAF0EC' },
      gold:  { DEFAULT: '#9A6B12', display: '#C08A2E', soft: '#FBF3E3' },
      chart: { primary: '#0F6F5C', neutral: '#CFC7B0' },
      cohort: {
        0: '#FCFBF6', 1: '#EFF6F3', 2: '#E1EFE9', 3: '#CFE5DC', 4: '#B8D9CC',
      },
    },

    fontFamily: {
      display: ['"Instrument Serif"', 'Georgia', 'serif'],
      body: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
    },

    // Display sizes carry their line-height and tracking so they can't be
    // applied inconsistently.
    fontSize: {
      'd-hero':     ['60px', { lineHeight: '1.04', letterSpacing: '-0.02em' }],
      'd-section':  ['42px', { lineHeight: '1.12', letterSpacing: '-0.02em' }],
      'd-headline': ['38px', { lineHeight: '1.20', letterSpacing: '-0.015em' }],
      'd-title':    ['31px', { lineHeight: '1.10', letterSpacing: '-0.015em' }],
      'd-verdict':  ['31px', { lineHeight: '1.30', letterSpacing: '-0.01em' }],
      'd-figure':   ['37px', { lineHeight: '1.00' }],
      'd-figure-l': ['44px', { lineHeight: '1.00' }],
      'd-finding':  ['21px', { lineHeight: '1.25', letterSpacing: '-0.01em' }],
      'd-stake':    ['23px', { lineHeight: '1.00' }],
      'd-admin-h1': ['24px', { lineHeight: '1.00', letterSpacing: '-0.01em' }],
      'd-mer':      ['19px', { lineHeight: '1.00' }],
    },

    borderRadius: {
      tag:    '6px',
      ctrl:   '8px',
      panel:  '14px',
      card:   '16px',
    },

    boxShadow: {
      card:  '0 24px 60px -30px rgba(7,46,39,.28)',
      image: '0 30px 70px -34px rgba(7,46,39,.45)',
      page:  '0 20px 50px -26px rgba(11,58,49,.40)',
      nav:   '0 8px 44px rgba(0,0,0,.30)',
    },
  },
};

export default grosslineTheme;
