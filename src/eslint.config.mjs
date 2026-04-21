import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default [
  {
    ignores: [
      'vitest.config.ts',
      '**/dist/',
      '**/lib/',
      '**/cache/',
      'node_modules/*',
      '**/node_modules',
      'dist/*coverage/*',
      'dist/*',
      'lib/*',
      '**/dist/*',
      '**/dist',
      '**/*.d.ts',
      'src/types/',
      '!**/.eslintrc.js',
      'eslint.config.mjs',
      'e2e/*',
    ],
  },
  js.configs.recommended,
  ...typescriptEslint.configs['flat/recommended'],
  ...typescriptEslint.configs['flat/recommended-type-checked'],
  prettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },

      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },

    rules: {
      'no-unused-vars': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',

      '@typescript-eslint/no-misused-promises': ['off'],
      '@typescript-eslint/prefer-namespace-keyword': 'off',

      'no-restricted-imports': [
        'error',
        {
          paths: ['**.spec.ts'],
          patterns: ['node:*'],
        },
      ],
    },
  },
  {
    files: [
      '**/**.spec.ts',
      'packages/**/src/testing/**',
      'docs/**',
      'packages/emmett-postgresql/**',
      'packages/emmett-mongodb/**',
      'packages/emmett-esdb/**',
      'packages/emmett-expressjs/**',
      'packages/emmett-honojs/**',
      'packages/emmett-fastify/**',
      'packages/emmett-sqlite/**',
      'packages/emmett-testcontainers/**',
      'packages/emmett-tests/**',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
