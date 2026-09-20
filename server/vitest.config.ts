import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * One file at a time.
     *
     * The integration suites share a database *and* the runtime settings table
     * in it. A suite that turns a feature off to prove it goes quiet would,
     * running in parallel, turn it off underneath another suite mid-assertion —
     * which is exactly the flake that sent us looking. The whole suite runs in
     * a few seconds either way.
     */
    fileParallelism: false,
  },
});
