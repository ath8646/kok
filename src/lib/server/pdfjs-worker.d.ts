// pdf.js 일꾼(worker) 모듈은 타입 파일이 없다. 그림 자르기(figure-image.ts)가 같은 스레드에서 쓰려고 직접 읽는다
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
