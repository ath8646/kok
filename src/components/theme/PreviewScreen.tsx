'use client';
// 테마 만들기의 미리보기 화면 (/theme-preview, ThemeStudio 의 iframe 안).
// 실제 화면과 같은 CSS(카드·큰 카드·버튼·칩·아래 메뉴·+ 버튼·시그니처 모양)로 그린 홈·노트 화면이다. 글은 예시.
// 바깥이 보낸 테마 CSS·<html> 속성으로 그리고(src/lib/theme-preview.ts), 누른 곳을 바깥에 알려 그 부분을 바꾸는 칸으로 가게 한다.
// 바깥이 고르는 칸에 손을 올리면(highlight) 그 부분에 테두리와 이름표를 그린다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { loadSkinFont, loadThemeFont } from '@/lib/theme';
import { readToPreview, type PreviewPart, type PreviewState } from '@/lib/theme-preview';
import { StarButton } from '@/components/note/StarButton';
import { Chip, ICONS, Icon, ProgressRing, buttonClass, cx } from '@/components/ui';

/** 강조할 때 붙는 이름표 */
export const PART_LABEL: Record<PreviewPart, string> = {
  page: '화면 바탕',
  title: '큰 제목',
  hero: '큰 카드',
  button: '시작 버튼',
  chips: '고른 칩',
  cards: '카드',
  star: '별표한 카드',
  tabbar: '아래 메뉴',
  fab: '+ 버튼',
  note: '노트 종이',
};

const TABS = [
  { label: '홈', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { label: '자료함', icon: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z' },
  { label: '복습', icon: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M21 3v6h-6' },
  { label: '오답', icon: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1zM9.5 8.5l5 5M14.5 8.5l-5 5' },
  { label: '설정', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
];

export function PreviewScreen() {
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const s = readToPreview(e);
      if (s) setState(s);
    };
    window.addEventListener('message', onMsg);
    // 다 실렸다고 알린다 (바깥이 테마를 보내 준다)
    if (window.parent !== window) window.parent.postMessage({ kind: 'kok-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // 받은 테마를 이 문서에 붙인다
  useLayoutEffect(() => {
    if (!state) return;
    const d = document.documentElement;
    const set = (name: string, v: string | null) => (v ? d.setAttribute(name, v) : d.removeAttribute(name));
    set('data-mode', state.mode);
    set('data-font', state.font !== 'default' ? state.font : null);
    set('data-paper', state.paper !== 'none' ? state.paper : null);
    set('data-skin', state.skin);
    set('data-motion', state.motion ? null : 'off');
    set('data-bg', state.bg ? '1' : null);
    let style = document.getElementById('kok-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'kok-theme';
      document.head.appendChild(style);
    }
    if (style.textContent !== state.css) style.textContent = state.css;
    loadThemeFont(state.font);
    loadSkinFont(state.skin);
  }, [state]);

  const pick = useCallback((part: PreviewPart) => {
    if (window.parent !== window) window.parent.postMessage({ kind: 'kok-preview-pick', part }, window.location.origin);
  }, []);

  // 누른 곳: 가장 안쪽의 data-part (아무 데도 아니면 화면 바탕)
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-part]');
    const part = el?.dataset.part as PreviewPart | undefined;
    pick(part ?? 'page');
  };

  if (!state) return <div className="min-h-dvh" aria-busy="true" />;
  return (
    <div className="kok-preview relative min-h-dvh cursor-pointer select-none" onClickCapture={onClick} data-part="page">
      <style>{PREVIEW_CSS}</style>
      <div className="kok-skin-art" aria-hidden="true" />
      <div className="kok-aura" aria-hidden="true" />
      <div className="kok-skin-fx" aria-hidden="true" />
      {state.screen === 'note' ? <NoteMock /> : <HomeMock />}
      <nav data-part="tabbar" className="kok-tabbar fixed z-40 grid grid-cols-5 px-1 pt-1" aria-hidden="true">
        {TABS.map((t, i) => (
          <span key={t.label} className={cx('flex flex-col items-center gap-0.5 pb-1.5 pt-1 text-[11px] font-semibold', i === 0 ? 'text-ink' : 'text-muted')}>
            <span className={cx('kok-tab-pill grid h-8 w-14 place-items-center rounded-full', i === (state.screen === 'note' ? 1 : 0) && 'is-on text-accent')}>
              <Icon d={t.icon} size={21} />
            </span>
            {t.label}
          </span>
        ))}
      </nav>
      <span
        data-part="fab"
        className="kok-fab fixed bottom-[calc(80px+var(--tab-float)*10px)] right-4 z-40 grid h-[58px] w-[58px] place-items-center rounded-full bg-fab text-fab-ink"
        aria-hidden="true"
      >
        <Icon d={ICONS.plus} size={28} strokeWidth={2.4} />
      </span>
      <Highlight part={state.highlight} />
    </div>
  );
}

/** 미리보기만의 모양: 누를 수 있는 곳에 손을 올리면 옅은 점선 */
const PREVIEW_CSS = `
.kok-preview [data-part]:not([data-part='page']):hover { outline: 2px dashed color-mix(in srgb, var(--ink) 35%, transparent); outline-offset: 3px; }
@keyframes kok-hl-in { from { opacity: 0; transform: scale(1.04); } }
.kok-hl { animation: kok-hl-in 200ms var(--ease-out) backwards; }
@media (prefers-reduced-motion: reduce) { .kok-hl { animation: none; } }
`;

/** 강조: 그 부분 위에 테두리와 이름표 (부분의 모양·그림자를 건드리지 않게 따로 그린다) */
function Highlight({ part }: { part: PreviewPart | null }) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!part) return;
    const el = part === 'page' ? null : document.querySelector<HTMLElement>(`[data-part='${part}']`);
    const measure = () => {
      if (part === 'page') {
        setBox({ x: 6, y: 6, w: window.innerWidth - 12, h: window.innerHeight - 12 });
        return;
      }
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      setBox({ x: r.left - 5, y: r.top - 5, w: r.width + 10, h: r.height + 10 });
    };
    // 화면 밖이면 보이게 (아래 메뉴·+ 버튼은 늘 보인다)
    if (el && part !== 'tabbar' && part !== 'fab') {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight - 90) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    }
    measure();
    const onScroll = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [part]);
  if (!part || !box) return null;
  const below = box.y < 40;
  return (
    <div
      key={part}
      className="kok-hl pointer-events-none fixed z-[60] rounded-[20px]"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        boxShadow: '0 0 0 2.5px #0062d6, 0 0 0 5px rgba(255,255,255,0.85), 0 0 0 7px rgba(0,98,214,0.35)',
      }}
      aria-hidden="true"
    >
      <span
        className="absolute left-2 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold text-white shadow-lg"
        style={{ background: '#0062d6', [below ? 'bottom' : 'top']: -30 }}
      >
        {PART_LABEL[part]}
      </span>
    </div>
  );
}

/** 홈 화면 (오늘의 KOK, 칩, 작은 카드, 별표한 노트) */
function HomeMock() {
  const [starred, setStarred] = useState(true);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-[170px]">
      <Header title="오늘 복습 6문제" sub="학생님, 잊어버리기 직전인 문제가 기다려요" />
      <div className="grid gap-4">
        <section data-part="hero" className="kok-card kok-hero grid gap-4 p-5">
          <div className="flex items-center gap-4">
            <ProgressRing value={33} size={76} stroke={7} label="오늘 복습 진행">
              <span className="text-center leading-none">
                <span className="block font-display text-[22px] tabular-nums">2</span>
                <span className="text-[11px] font-semibold text-muted">/ 6</span>
              </span>
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted">오늘의 KOK</p>
              <p className="font-display text-xl leading-snug">4문제 남았어요</p>
              <p className="text-sm text-muted">하루 5분이면 충분해요</p>
            </div>
          </div>
          {/* 진짜 버튼처럼 (두 색 버튼·시그니처 버튼 모양은 button·a 에만 붙는다). 미리보기라 누를 수는 없다 */}
          <button type="button" tabIndex={-1} data-part="button" className={buttonClass('primary', 'lg', 'kok-cta w-full')}>
            5분 KOK 시작
          </button>
        </section>
        <div data-part="chips" className="flex gap-2">
          <span className="kok-chip-on inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold">전체</span>
          <span className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-sm font-semibold shadow-[0_1px_2px_var(--shadow)]">과학</span>
          <span className="inline-flex h-9 items-center rounded-full bg-surface px-4 text-sm font-semibold shadow-[0_1px_2px_var(--shadow)]">영어</span>
        </div>
        <div data-part="cards" className="grid grid-cols-2 gap-3">
          <section className="kok-card grid gap-2 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-muted">연속 공부</span>
              <span className="font-display text-2xl tabular-nums">
                3<span className="ml-0.5 text-sm text-muted">일</span>
              </span>
            </div>
            <ol className="flex justify-between">
              {['월', '화', '수', '목', '금'].map((d, i) => (
                <li key={d} className="grid justify-items-center gap-1">
                  <span className={cx('grid h-[18px] w-[18px] place-items-center rounded-full', i < 3 ? 'kok-dot-on bg-fab text-fab-ink' : 'bg-surface-2')}>
                    {i < 3 ? <Icon d={ICONS.check} size={11} strokeWidth={3.2} /> : null}
                  </span>
                  <span className={cx('text-[11px]', i === 2 ? 'font-bold text-ink' : 'text-muted')}>{d}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="kok-card grid content-between gap-1 p-4">
            <span className="text-sm font-semibold text-muted">이번 달 AI 에너지</span>
            <span className="font-display text-[28px] leading-tight tabular-nums">293</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className="kok-bar block h-full w-2/3 rounded-full bg-fab" />
            </span>
          </section>
        </div>
        <div className="mb-1 mt-2 flex items-center justify-between gap-3 px-1">
          <h2 className="kok-section-title font-display text-lg">최근 노트</h2>
          <Chip tone="accent">자료함</Chip>
        </div>
        <div data-part="star" className={cx('kok-card kok-glow relative grid gap-1 p-4 pr-12', starred && 'is-starred')}>
          <p className="text-[15px] font-bold">광합성</p>
          <p className="text-sm text-muted">빛 에너지로 물과 이산화탄소에서 포도당을 만들어요</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
            과학
          </p>
          <StarButton small className="absolute right-1.5 top-1.5" on={starred} label="별표" onToggle={() => setStarred((v) => !v)} />
        </div>
      </div>
    </main>
  );
}

/** 노트 화면 (종이 무늬 카드, 핵심 개념, 문제) */
function NoteMock() {
  const [starred, setStarred] = useState(true);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-[170px]">
      <Header title="광합성" sub="과학 · 개념 3 · 문제 6" compact />
      <div className="grid gap-4">
        <div data-part="chips" className="kok-seg inline-flex w-fit gap-1 rounded-full bg-surface-2 p-1">
          {['정리', '그림', '문제'].map((t, i) => (
            <span
              key={t}
              className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold', i === 0 ? 'kok-seg-on bg-raised text-ink shadow-sm' : 'text-muted')}
            >
              {t}
            </span>
          ))}
        </div>
        <section data-part="note" className="kok-card kok-paper p-4">
          <h3 className="mb-1 text-sm font-bold text-muted">한 줄 요약</h3>
          <p className="text-[17px] font-semibold leading-relaxed">
            <span className="hl-mark">식물은 빛으로 포도당과 산소를 만든다</span>
          </p>
        </section>
        <div className="mb-1 mt-1 flex items-center justify-between px-1">
          <h2 className="kok-section-title font-display text-lg">핵심 개념</h2>
        </div>
        <ConceptCard
          n={1}
          title="광합성의 재료"
          body="물과 이산화탄소가 재료예요. 기공으로 이산화탄소가 들어와요."
          starred={starred}
          onStar={() => setStarred((v) => !v)}
          part="star"
        />
        <ConceptCard n={2} title="엽록체" body="광합성이 일어나는 곳이에요. 엽록소가 빛을 흡수해요." />
        <section data-part="hero" className="kok-card kok-hero grid gap-3 p-5">
          <p className="text-sm font-semibold text-muted">문제 풀기</p>
          <p className="font-display text-lg leading-snug">광합성이 일어나는 곳은?</p>
          <div className="grid gap-2">
            {['미토콘드리아', '엽록체', '핵'].map((c, i) => (
              <span
                key={c}
                className={cx('rounded-2xl border-2 px-4 py-2.5 text-[15px] font-semibold', i === 1 ? 'border-ok bg-ok-soft text-ok' : 'border-line')}
              >
                {c}
              </span>
            ))}
          </div>
          <button type="button" tabIndex={-1} data-part="button" className={buttonClass('primary', 'lg', 'kok-cta w-full')}>
            다음 문제
          </button>
        </section>
      </div>
    </main>
  );
}

function ConceptCard({
  n,
  title,
  body,
  starred = false,
  onStar,
  part = 'note',
}: {
  n: number;
  title: string;
  body: string;
  starred?: boolean;
  onStar?: () => void;
  part?: PreviewPart;
}) {
  return (
    <article data-part={part} className={cx('kok-card kok-paper kok-glow relative p-4', starred && 'is-starred')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums',
            starred ? 'kok-star-badge' : 'bg-accent text-accent-ink',
          )}
        >
          {n}
        </span>
        <div className="min-w-0 flex-1 pr-9">
          <h4 className="text-[16px] font-bold">{title}</h4>
          <p className="mt-1 text-[15px] leading-relaxed">{body}</p>
        </div>
      </div>
      {onStar ? <StarButton small className="absolute right-1.5 top-1.5" on={starred} label="별표" onToggle={onStar} /> : null}
    </article>
  );
}

function Header({ title, sub, compact = false }: { title: string; sub: ReactNode; compact?: boolean }) {
  return (
    <div data-part="title" className={cx('flex flex-col justify-end px-1', compact ? 'pb-4 pt-14' : 'min-h-[18vh] pb-5 pt-14')}>
      <h1 className={cx('kok-title font-display leading-tight', compact ? 'text-[26px]' : 'text-[30px]')}>
        <span className="kok-title-text" data-text={title}>
          {title}
        </span>
      </h1>
      <div className="mt-1 text-[15px] text-muted">{sub}</div>
    </div>
  );
}
