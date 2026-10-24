// PDF 보기(앱 안에서 PDF 요약 정리 읽기)에 쓰는 pdf.js 일꾼 파일을 public/pdfjs/ 로 복사한다.
// 앱의 pdfjs-dist 와 같은 버전이어야 해서(버전이 다르면 pdf.js 가 멈춘다) 설치할 때 복사한다 (package.json postinstall). next.config.ts 도 설정을 읽을 때 같은 일을 한다.
// public/pdfjs/ 는 git 에 넣지 않는다
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
// legacy 빌드: 새 자바스크립트 기능(Map.getOrInsertComputed 등)을 안 쓰는 쪽. 보통 빌드는 조금 오래된 폰 브라우저에서 멈춘다
const src = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const outDir = path.join(root, 'public', 'pdfjs');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, path.join(outDir, 'pdf.worker.min.mjs'));
console.log('pdf.js worker copied to public/pdfjs/');
