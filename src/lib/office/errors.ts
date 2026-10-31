/** 문서를 읽지 못한 까닭 (학생에게 그대로 보이는 한국어 글) */
export class OfficeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfficeError';
  }
}
