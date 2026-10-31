import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// 코딩 자료 시뮬레이션만 돌린다 (npm test 와 따로): AI 역할을 한 답(fixtures)을 앱의 코드 길로 돌려 문제를 센다
export default defineConfig({
  root: path.resolve(dirname, '../..'),
  resolve: { alias: { '@': path.resolve(dirname, '../../src') } },
  test: { include: ['tools/coding-sim/*.test.ts'], environment: 'node', testTimeout: 120_000 },
});
