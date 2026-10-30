import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// 표지 그림 미리보기만 돌린다 (npm test 와 따로)
export default defineConfig({
  root: path.resolve(dirname, '../..'),
  resolve: { alias: { '@': path.resolve(dirname, '../../src') } },
  test: { include: ['tools/cover-lab/*.test.ts'], environment: 'node' },
});
