import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const edgeWorkerRuntime = fileURLToPath(new URL('./test/fixtures/akamai-runtime.js', import.meta.url));

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ['http-request', 'create-response', 'streams', 'log', 'encoding']
        .map((name) => [name, edgeWorkerRuntime]),
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    restoreMocks: true,
    passWithNoTests: true,
  },
});
