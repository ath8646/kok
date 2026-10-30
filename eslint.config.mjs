import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 브라우저의 회색 확인·경고·입력 창은 쓰지 않는다: 앱 디자인의 창(src/components/Confirm.tsx 의 useConfirm·useAskText)으로
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: '브라우저 창 대신 useConfirm() (components/Confirm.tsx) 을 써요.' },
        { name: 'alert', message: '브라우저 창 대신 알림(useToast) 이나 useConfirm() 을 써요.' },
        { name: 'prompt', message: '브라우저 창 대신 useAskText() (components/Confirm.tsx) 를 써요.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: '브라우저 창 대신 useConfirm() 을 써요.' },
        { object: 'window', property: 'alert', message: '브라우저 창 대신 알림(useToast) 을 써요.' },
        { object: 'window', property: 'prompt', message: '브라우저 창 대신 useAskText() 를 써요.' },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // 로컬 끝-끝 시험 도구 (앱 코드가 아님)
    'tools/**',
    // pdf.js 일꾼 (설치·빌드 때 복사한 파일)
    'public/pdfjs/**',
    // Claude 작업 폴더 (worktree 등)
    '.claude/**',
  ]),
]);

export default eslintConfig;
