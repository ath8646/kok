import Link from 'next/link';
import { LoginButton } from '@/components/LoginButton';
import { ICONS } from '@/lib/icons';

const FEATURES = [
  { icon: ICONS.file, title: '넣기만 하세요', body: '교과서 사진, 학습지 PDF, 내가 쓴 필기. AI가 핵심만 골라 정리 노트로 바꿔요.' },
  { icon: ICONS.mindmap, title: '한눈에 보는 마인드맵', body: '개념끼리의 연결을 그림으로. 가지를 가리고 떠올려 보는 가리기 모드도 있어요.' },
  { icon: ICONS.target, title: '핵심만 콕 찌르는 문제', body: '시험에 나올 개념만 묻는 문제를 AI가 만들고 스스로 한 번 더 검사해요.' },
  { icon: ICONS.clock, title: '하루 5분 복습', body: '잊어버리기 직전에 다시 나와요. 오늘 할 만큼만 풀고 끝내요.' },
];

function safeNext(v: string | string[] | undefined): string {
  const n = typeof v === 'string' ? v : '';
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/home';
}

export default async function Landing({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const authError = sp.error === 'auth';
  return (
    <main className="mx-auto grid min-h-dvh max-w-3xl content-center gap-10 px-5 pb-12 pt-[calc(48px+env(safe-area-inset-top))]">
      <section className="kok-rise grid justify-items-center gap-5 text-center">
        <p className="font-brand text-7xl text-accent sm:text-8xl">
          <span className="hl-mark">콕</span>
        </p>
        <h1 className="font-display text-[32px] leading-snug sm:text-[40px]">
          준비는 AI가,
          <br />
          외우기는 내가
        </h1>
        <p className="max-w-md text-[17px] text-muted">
          공부 자료를 넣으면 AI가 정리 노트·마인드맵·핵심 문제·복습 일정을 알아서 만들어요. 나는 5분씩 풀기만 하면 돼요.
        </p>
        <LoginButton next={next} authError={authError} />
        <p className="text-xs text-muted">
          시작하면{' '}
          <Link href="/terms" className="underline">
            이용약관
          </Link>
          ,{' '}
          <Link href="/privacy" className="underline">
            개인정보처리방침
          </Link>
          ,{' '}
          <Link href="/ai-guide" className="underline">
            AI 사용 안내
          </Link>
          를 확인하게 돼요.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="kok-card kok-rise grid content-start gap-2 p-4 sm:p-5" style={{ ['--i' as string]: i + 1 }}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true">
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                <path d={f.icon} />
              </svg>
            </span>
            <h2 className="font-display text-lg leading-snug sm:text-xl">{f.title}</h2>
            <p className="text-sm text-muted sm:text-[15px]">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="kok-rise rounded-[22px] bg-surface-2 p-5 text-sm text-muted" style={{ ['--i' as string]: 5 }}>
        <p>
          <b className="text-ink">콕은 오래 붙잡는 앱이 아니에요.</b> 끝없는 피드, 광고, 랭킹이 없어요. 오늘 할 공부를 빨리 끝내도록 돕고, 끝나면 놓아 줘요.
        </p>
        <p className="mt-2">AI는 틀릴 수 있어요. 정리와 문제에는 늘 AI 표시와 출처 쪽이 붙어요.</p>
      </section>

      <footer className="flex flex-wrap justify-center gap-4 text-sm text-muted">
        <Link href="/terms">이용약관</Link>
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/ai-guide">AI 사용 안내</Link>
      </footer>
    </main>
  );
}
