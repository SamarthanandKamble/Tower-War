import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under github.io/Tower-War/ and locally.
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        baseline: 'baseline/index.html',
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
