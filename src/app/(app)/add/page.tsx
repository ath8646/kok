// 예전 '자료 넣기' 주소: 자료함으로 보내고 입력창을 연다 (지금은 + 버튼과 끌어다 놓기로 넣는다)
import { redirect } from 'next/navigation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AddPage({ searchParams }: PageProps<'/add'>) {
  const sp = await searchParams;
  const subject = typeof sp.subject === 'string' && UUID.test(sp.subject) ? sp.subject : null;
  redirect(subject ? `/library/${subject}?compose=1` : '/library?compose=1');
}
