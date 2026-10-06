import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** One config for the workspace: TypeScript everywhere, React hooks rules for the web app and extension UI. */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/release/**', '**/node_modules/**', '**/coverage/**', 'apps/api/drizzle/**', '**/*.d.ts', '.screens/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: {
      // `_`-prefixed names are deliberately unused (destructuring to drop a field, ignored params).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Non-breaking and other Unicode spaces are matched on purpose in page-text and resume parsing.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/extension/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['**/test/**', '**/*.test.ts', '**/*.test.tsx', '**/scripts/**', '**/*.mjs'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
