import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

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
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ),
  {
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      globals: {
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',

      parserOptions: {
        project: './tsconfig.eslint.json',
      },
    },

    settings: {
      'import/resolver': {
        typescript: {},
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
      'packages/emmett-fastify/**',
      'packages/emmett-sqlite/**',
      'packages/emmett-testcontainers/**',
      'packages/emmett-tests/**',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  eslintConfigPrettier,
];
