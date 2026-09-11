import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Direct database client access is only allowed inside packages/db — everything
// else must go through its tenant-scoped helpers (CLAUDE.md non-negotiable #1).
const restrictedDbImports = [
  {
    name: 'pg',
    message: 'Database access only through @grossline/db tenant-scoped helpers.',
  },
  {
    name: 'pg-pool',
    message: 'Database access only through @grossline/db tenant-scoped helpers.',
  },
  {
    name: 'postgres',
    message: 'Database access only through @grossline/db tenant-scoped helpers.',
  },
  {
    name: 'drizzle-orm/node-postgres',
    message: 'Database access only through @grossline/db tenant-scoped helpers.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.astro/**',
      '**/out/**',
      '**/coverage/**',
      '**/drizzle/**',
      '**/*.astro',
      'pgdata/**',
      'redisdata/**',
      'apps/admin/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': ['error', { paths: restrictedDbImports }],
    },
  },
  {
    files: ['packages/db/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Design-port lock-in (docs/design): the admin console must not use Tailwind
  // arbitrary values (e.g. text-[13px], p-[13px], rounded-[14px]). Every design
  // value comes from a --gl-* token, an @theme utility, or a gl-* primitive
  // class. A hyphen immediately before `[` is the Tailwind arbitrary-value
  // syntax; match it in both plain and template-literal class strings.
  {
    files: ['apps/admin/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/-\\[[^\\]]+\\]/]',
          message:
            'No Tailwind arbitrary values. Add a token to design-tokens.css/@theme or use a gl-* primitive.',
        },
        {
          selector: 'TemplateElement[value.raw=/-\\[[^\\]]+\\]/]',
          message:
            'No Tailwind arbitrary values. Add a token to design-tokens.css/@theme or use a gl-* primitive.',
        },
      ],
    },
  },
);
