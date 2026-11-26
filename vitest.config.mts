// Browser-like (jsdom) behaviour tests for upload screens, reactions, comment logic, offline/loading UI.
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [{ find: /^@\/src/, replacement: path.resolve(__dirname, 'src') }] },
  test: { environment: 'jsdom', include: ['tests/ui-dom/**/*.test.tsx'] },
});
