import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mycity:mycity@localhost:5432/mycity_test',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
