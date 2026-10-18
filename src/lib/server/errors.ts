// 사용자에게 그대로 보여 줄 수 있는 오류 (한국어 메시지)
export class UserFacingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof UserFacingError) {
    return Response.json({ error: e.code, message: e.message }, { status: e.status });
  }
  console.error('[kok] unexpected error', e);
  return Response.json({ error: 'server_error', message: '잠깐 문제가 생겼어요. 조금 뒤에 다시 해 주세요.' }, { status: 500 });
}
