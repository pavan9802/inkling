// Flat ESLint config. The key rule here enforces ADR-0001:
// `core` and `eval` must never import `vscode`.
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['packages/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {},
  },
  {
    // ADR-0001: the pure packages may not depend on the VS Code API.
    files: ['packages/core/**/*.ts', 'packages/eval/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'vscode', message: 'core/eval must not import vscode (see ADR-0001).' }] },
      ],
    },
  },
];
