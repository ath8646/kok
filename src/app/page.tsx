import Link from 'next/link';
import { LoginButton } from '@/components/LoginButton';
import { BrandMark } from '@/components/Brand';

// 첫 화면 (로그인 전). 꾸밈(카드·그라데이션·빛·나타나는 움직임) 없이 왼쪽 정렬, 실제 앱 화면을 보여 준다.
// 그림은 public/landing/ 의 앱 화면 캡처 (밝을 때·어두울 때 두 장씩, 2배 해상도): tools/local-e2e/landing_shots.py 로 다시 찍는다.
// 크기(CSS px)는 그 스크립트가 알려 주는 값: 다시 찍어 크기가 바뀌면 SHOTS 도 고친다.
const SHOTS = {
  exam: { w: 358, h: 481, alt: 'KOK이 과학 학습지로 만든 서술형 문제 화면' },
  note: { w: 390, h: 720, alt: 'KOK이 만든 광합성 정리 노트 화면' },
} as const;

const STEPS: Array<{ label: string; body: string; shot?: keyof typeof SHOTS }> = [
  { label: '넣어요', body: '교과서 사진, 학습지 PDF, 내가 쓴 필기를 그대로요.' },
  { label: '정리돼요', body: '핵심 개념과 한 줄 요약, 개념끼리 이어 본 마인드맵이 생겨요.', shot: 'note' },
  { label: '풀어요', body: '시험지처럼 생긴 문제로요. 틀리면 해설과 출처 쪽을 바로 보여 줘요.' },
  { label: '다시 나와요', body: '잊어버릴 때쯤 그 문제가 다시 나와요. 하루 5분이면 충분해요.' },
];

/** 앱 화면 캡처: 지금 화면 밝기에 맞는 한 장만 보인다 (Tailwind dark 는 data-mode, 없으면 기기 설정을 따른다).
 *  숨은 쪽은 lazy 라 받지 않는다 */
function Shot({ name, className }: { name: keyof typeof SHOTS; className: string }) {
  const s = SHOTS[name];
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- 이미 2배 크기 WebP 로 줄여 둔 그림이라 Next 이미지 최적화를 거치지 않는다 */}
      <img src={`/landing/${name}-light.webp`} alt={s.alt} width={s.w} height={s.h} loading="lazy" decoding="async" className={`block h-auto dark:hidden ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- 위와 같음 */}
      <img src={`/landing/${name}-dark.webp`} alt={s.alt} width={s.w} height={s.h} loading="lazy" decoding="async" className={`hidden h-auto dark:block ${className}`} />
    </>
  );
}

function safeNext(v: string | string[] | undefined): string {
  const n = typeof v === 'string' ? v : '';
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/home';
}

export default async function Landing({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const authError = sp.error === 'auth';
  return (
    <main className="mx-auto w-full max-w-5xl px-6 pb-12 pt-[calc(20px+env(safe-area-inset-top))] md:px-10">
      <header className="flex items-center gap-2.5">
        <BrandMark size={32} />
        <span className="text-[22px] font-black leading-none tracking-[-0.03em]">KOK</span>
      </header>

      <section className="mt-12 grid gap-12 md:mt-20 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)] md:items-center md:gap-16">
        <div className="grid content-start gap-[18px]">
          <h1 className="font-display text-[36px] font-black leading-[1.25] tracking-[-0.035em] md:text-[52px] md:leading-[1.15]">
            준비는 AI가,
            <br />
            외우기는 내가
          </h1>
          <p className="max-w-md text-[17px] leading-relaxed text-muted">
            공부 자료를 넣으면 정리 노트와 문제, 복습 일정을 만들어 줘요. 하루 5분씩 풀기만 하면 돼요.
          </p>
          <div className="mt-2 w-full max-w-sm">
            <LoginButton next={next} authError={authError} />
          </div>
          <p className="text-xs leading-relaxed text-muted">
            시작하면{' '}
            <Link href="/terms" className="text-accent underline">
              이용약관
            </Link>
            ,{' '}
            <Link href="/privacy" className="text-accent underline">
              개인정보처리방침
            </Link>
            ,{' '}
            <Link href="/ai-guide" className="text-accent underline">
              AI 사용 안내
            </Link>
            를 확인하게 돼요.
          </p>
        </div>
        <figure className="grid gap-3">
          <Shot name="exam" className="w-full rounded-[28px] ring-1 ring-line" />
          <figcaption className="text-sm text-muted">과학 학습지 한 장으로 만든 서술형 문제예요.</figcaption>
        </figure>
      </section>

      <section className="mt-16 max-w-2xl md:mt-24">
        <h2 className="font-display text-2xl font-black tracking-[-0.03em]">이렇게 공부해요</h2>
        <ol className="mt-7 grid gap-7">
          {STEPS.map((s) => (
            <li key={s.label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-4 md:grid-cols-[120px_minmax(0,1fr)]">
              <p className="font-bold text-accent">{s.label}</p>
              <p className="leading-relaxed">{s.body}</p>
              {s.shot ? <Shot name={s.shot} className="col-start-2 w-full max-w-[254px] rounded-2xl ring-1 ring-line md:max-w-[300px]" /> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 max-w-2xl border-t border-line pt-6 md:mt-24">
        <p className="leading-relaxed">
          <b>KOK은 오래 붙잡는 앱이 아니에요.</b> 광고, 랭킹, 끝없는 피드가 없어요. 오늘 할 공부를 끝내면 놓아 줘요.
        </p>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">AI는 틀릴 수 있어요. 정리와 문제마다 AI 표시와 출처 쪽이 붙어요.</p>
      </section>

      <footer className="mt-12 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href="/terms" className="text-accent">
          이용약관
        </Link>
        <Link href="/privacy" className="text-accent">
          개인정보처리방침
        </Link>
        <Link href="/ai-guide" className="text-accent">
          AI 사용 안내
        </Link>
      </footer>
    </main>
  );
}
