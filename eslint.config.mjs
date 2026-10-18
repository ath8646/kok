import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // 로컬 끝-끝 시험 도구 (앱 코드가 아님)
    'tools/**',
    // Claude 작업 폴더 (worktree 등)
    '.claude/**',
  ]),
]);

export default eslintConfig;
