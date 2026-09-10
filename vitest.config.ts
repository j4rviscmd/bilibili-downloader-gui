import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Vendored UI kits (installed via npx shadcn, never hand-edited)
        'src/components/**',
        'src/shared/animate-ui/**',
        'src/hooks/**',
        'src/lib/**',
        // Splash WebGL — happy-dom has no WebGL context
        'src/features/splash/lib/createScene.ts',
        'src/features/splash/hooks/useThreeScene.ts',
        // App bootstrap / config (exercised via E2E)
        'src/main.tsx',
        'src/i18n/**',
        // Tests themselves + vitest defaults (include/exclude are not
        // merged when overridden, so defaults must be restated)
        'src/**/*.test.*',
        'src/test/**',
        '**/node_modules/**',
        'dist/**',
        'coverage/**',
        '**/*.d.ts',
      ],
      // Ratchet baseline; bump per PR, 100 at the end of the F-series.
      // Lines only: v8 branch/function metrics on TSX are noisy.
      // Why 95: F-series target (issue #616), measured at 95.81% after the
      // home-page pagination/dialog tests (macOS). ~0.8pt (~33 lines) of
      // margin absorbs v8 cross-platform drift (macOS vs Ubuntu CI); on a
      // mismatch re-measure rather than lowering.
      thresholds: { lines: 95 },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    global: 'globalThis',
  },
})
