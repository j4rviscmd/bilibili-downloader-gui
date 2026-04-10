/**
 * Shared ESLint flat configuration for the frontend application.
 *
 * Extends the recommended TypeScript, React Hooks, and React Refresh
 * rule sets. The `react-hooks/exhaustive-deps` rule is intentionally
 * disabled to allow custom dependency management across the project.
 *
 * @remarks
 * The `e2e-tests` directory is excluded from this configuration because
 * it uses its own ESLint setup via the E2E test package.
 */
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config([
  globalIgnores(['dist', 'src-tauri/target', 'e2e-tests']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow custom dependency management in hooks across the project
      'react-hooks/exhaustive-deps': 'off',
      // Keep core hooks rules enabled for safety
      'react-hooks/rules-of-hooks': 'error',
      'react-refresh/only-export-components': 'off',
    },
  },
])
