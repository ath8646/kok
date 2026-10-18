// 탈퇴 기록에 쓸 값: 이메일, 그리고 로그인 회사의 계정 번호(카카오는 이메일이 없을 수 있어서).
// 다시 가입한 계정이 이 가운데 하나라도 같으면 같은 사람으로 본다.

export type IdentityLike = { provider?: string | null; id?: string | null };

export function tombstoneKeys(email: string | null | undefined, identities: IdentityLike[] | null | undefined = []): string[] {
  const keys = new Set<string>();
  const mail = (email ?? '').trim().toLowerCase();
  if (mail) keys.add(mail);
  for (const i of identities ?? []) {
    const provider = (i?.provider ?? '').trim().toLowerCase();
    const id = (i?.id ?? '').trim();
    // 'id:' 로 시작해서 이메일과 겹치지 않는다
    if (provider && id) keys.add(`id:${provider}:${id}`);
  }
  return [...keys];
}
