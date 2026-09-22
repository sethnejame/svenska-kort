import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // src/lib is pure: no React, no DOM, no clock.
    files: ['src/lib/**/*.ts'],
    ignores: ['src/lib/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/lib must stay framework-free and DOM-free.' },
        { name: 'document', message: 'src/lib must stay framework-free and DOM-free.' },
        { name: 'localStorage', message: 'src/lib must stay framework-free and DOM-free.' },
      ],
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', 'zustand'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'src/lib must take time as an argument, never read the clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'src/lib must take time as an argument, never read the clock.',
        },
      ],
    },
  },
  {
    // shared/ is compiled into the app AND the Worker, so it inherits src/lib's
    // purity and adds a hard boundary: reaching into either consumer would make
    // one of the two builds impossible.
    files: ['shared/**/*.ts'],
    ignores: ['shared/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'shared/ runs in a Worker too; it must stay DOM-free.' },
        { name: 'document', message: 'shared/ runs in a Worker too; it must stay DOM-free.' },
        { name: 'localStorage', message: 'shared/ runs in a Worker too; it must stay DOM-free.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'zustand'],
              message: 'shared/ must stay framework-free.',
            },
            {
              group: ['**/src/**', '**/worker/**'],
              message: 'shared/ is imported BY src and worker, and must never import from them.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'shared/ must take time as an argument, never read the clock.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'shared/ must take time as an argument, never read the clock.',
        },
      ],
    },
  },
  {
    // The Worker has no DOM and no React, and reaches the app only via shared/.
    files: ['worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/**'],
              message: 'The Worker shares code through shared/, never through the app.',
            },
            { group: ['react', 'react-dom', 'zustand'], message: 'The Worker is not a UI.' },
          ],
        },
      ],
    },
  },
  {
    // Only the storage module may touch localStorage.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/store/storage.ts', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'localStorage',
          message: 'Persistence goes through src/store/storage.ts, never localStorage directly.',
        },
        {
          object: 'window',
          property: 'localStorage',
          message: 'Persistence goes through src/store/storage.ts, never localStorage directly.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**', 'scripts/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
