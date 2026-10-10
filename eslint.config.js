import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
      // Copied from maplibre-gl at build time (apps/web/scripts/copy-maplibre-worker.mjs).
      'apps/web/public/maplibre/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Section 63 — quality rules. `any` erases the domain model; it is the
      // single most damaging shortcut in a codebase whose whole value is that
      // uncertainty is modelled explicitly rather than hand-waved.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-param-reassign': 'error',
      'object-shorthand': 'error',
    },
  },

  // --- Architecture boundaries (section 4: dependencies point inward) ------
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@chronolignee/db',
                '@chronolignee/ui',
                '@chronolignee/engine',
                'next',
                'react',
                'react-dom',
                '@prisma/client',
              ],
              message:
                'packages/domain is the innermost layer: it must not depend on persistence, UI, framework or rendering. Define an interface here and implement it outward.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/genealogy/**/*.ts', 'packages/gedcom/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'react', 'react-dom', '@chronolignee/ui'],
              message:
                'Genealogy logic must stay framework-free so it can run in workers and tests.',
            },
          ],
        },
      ],
    },
  },

  // --- React ---------------------------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // --- Node-side code may log through pino only ----------------------------
  {
    files: ['**/*.config.{ts,js,mjs}', 'infra/**/*', 'packages/testing/**/*', '**/scripts/**/*'],
    languageOptions: {
      // Build scripts run in Node, not in a browser. Without this, `process`
      // and friends read as undefined globals and the only way past is an
      // eslint-disable on every line that touches them.
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.bench.ts', '**/tests/**/*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  prettierConfig,
);
