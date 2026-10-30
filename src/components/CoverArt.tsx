'use client';
// 표지 그림 (lib/cover.ts).
// v2: 담는 칸의 실제 크기(px)를 재서 lib/cover-layout.ts 가 정한 자리에 그린다 (글자 크기·배치가 카드 크기를 따른다).
//     색은 과목 색(tint) 하나 + 글자 색, 비교의 오른쪽만 짝 색. 공식은 KaTeX 로 교과서처럼, 그래프·도형은 문제 그림과 같은 그림체로.
// v1(예전 표지): 문제 그림과 같은 그림체(FigureView)에 요소마다 색, 칸을 꽉 채운다.
// 카드에서는 옆에 제목이 있어서 꾸미는 그림(화면 읽기 프로그램이 건너뜀), 표지 그림 창에서는 설명(alt)을 읽어 준다
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { COVER_FRAME, type Cover, type CoverV2 } from '@/lib/cover';
import { coverFont, FONT_SAMPLE, layoutCover, type CoverFont, type CoverSize, type FormulaPlan, type Ink, type Prim } from '@/lib/cover-layout';
import { partnerVar, subjectVar } from '@/lib/colors';
import { FigureView } from './figure/FigureView';
import { renderTex } from './RichText';

/** 그림 글도 설정의 글꼴을 따른다 (FigureView 와 같이) */
const FONT = 'var(--font-sans, Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif)';

type Props = {
  cover: Cover;
  /** 과목 색 이름 (없으면 파랑) */
  tint?: string | null;
  /** 오른쪽 위 비워 둘 곳 (카드의 별·⋯ 단추). 없으면 기본 크기, 표지 그림 창처럼 단추가 없으면 {w: 0, h: 0} */
  reserve?: { w: number; h: number };
  /** 크기를 재지 않고 이 크기로 (눈으로 보기 도구) */
  size?: { w: number; h: number };
  className?: string;
  describe?: boolean;
};

export function CoverArt(props: Props) {
  const { cover, className, describe = false } = props;
  if (cover.v === 2) return <CoverV2Art {...props} cover={cover} />;
  return (
    <FigureView
      figure={cover.figure}
      tones={cover.tones}
      frame={COVER_FRAME}
      fill
      className={className}
      title={describe ? `표지 그림: ${cover.alt || '노트 내용 그림'}` : undefined}
      decorative={!describe}
    />
  );
}

function CoverV2Art({ cover, tint, reserve, size: fixed, className, describe = false }: Props & { cover: CoverV2 }) {
  const box = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  // 칸 크기를 그리기 전에 재고(첫 그림부터 맞는 크기), 칸이 바뀌면 다시 (화면 돌리기·창 크기)
  useLayoutEffect(() => {
    if (fixed) return;
    const el = box.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setMeasured((prev) => (prev && prev.w === w && prev.h === h ? prev : w > 40 && h > 40 ? { w, h } : null));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixed]);
  const size = fixed ?? measured;
  const font = useCoverFont(box);
  const rw = reserve?.w;
  const rh = reserve?.h;
  const plan = useMemo(() => {
    if (!size) return null;
    const s: CoverSize = { w: size.w, h: size.h, font, ...(rw !== undefined && rh !== undefined ? { reserve: { w: rw, h: rh } } : {}) };
    return layoutCover(cover, s);
  }, [cover, size, rw, rh, font]);
  const P = subjectVar(tint);
  const colors: Record<Ink, string> = { p: P, p2: partnerVar(tint), ink: 'var(--ink)', muted: 'var(--muted)', on: 'var(--surface)', paper: 'var(--surface)' };
  const label = describe ? `표지 그림: ${cover.alt || '노트 내용 그림'}` : undefined;
  const fig = plan?.figure && cover.figure ? plan.figure : null;
  // 그래프·도형은 문제 그림의 크기 그대로면 글이 커서 조금 크게 그린 뒤 줄여 담는다 (글 약 11px)
  const K = 1.22;
  // 바깥 칸은 className(자리·여백)을, 안쪽 칸이 재는 크기를 맡는다 (여백을 뺀 크기로 배치한다)
  return (
    <div
      className={className}
      style={fixed ? { width: fixed.w, height: fixed.h } : undefined}
      role={describe ? 'img' : undefined}
      aria-label={label}
      aria-hidden={describe ? undefined : true}
    >
      <div ref={box} style={{ position: 'relative', width: '100%', height: '100%', fontFamily: FONT }}>
        {plan && size && plan.prims.length ? (
          <svg
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            aria-hidden="true"
            focusable="false"
            style={{ display: 'block', position: 'absolute', inset: 0, overflow: 'visible' }}
          >
            {plan.prims.map((p, i) => (
              <PrimView key={i} p={p} colors={colors} />
            ))}
          </svg>
        ) : null}
        {fig && cover.figure ? (
          <div
            style={
              {
                position: 'absolute',
                left: fig.x,
                top: fig.y,
                width: fig.w,
                height: fig.h,
                ['--accent' as string]: P,
                ['--accent-soft' as string]: `color-mix(in srgb, ${P} 14%, var(--surface))`,
                ['--fig-curve' as string]: P,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <FigureView figure={cover.figure} frame={{ w: fig.w * K, h: fig.h * K, pad: 12 }} fill decorative bare className="h-full w-full" />
          </div>
        ) : null}
        {plan?.formula ? <FormulaCover plan={plan.formula} cover={cover} color={P} /> : null}
      </div>
    </div>
  );
}

/**
 * 표지 글의 실제 글꼴이 배치 표보다 넓으면 그 배율 (터미널 테마의 고정폭 글꼴 등). 글꼴(--font-sans)마다 한 번 재고,
 * 글꼴 파일이 늦게 오면(설정 글꼴·시그니처 테마 글꼴) 다시 잰다. 서버 그림·잴 수 없는 곳은 표 그대로
 */
function useCoverFont(ref: RefObject<HTMLElement | null>): CoverFont | undefined {
  const [font, setFont] = useState<CoverFont>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const f = fontOf(getComputedStyle(el).fontFamily);
      setFont((prev) => (prev?.hangul === f.hangul && prev.latin === f.latin ? prev : f));
    };
    read();
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', read);
    return () => fonts?.removeEventListener?.('loadingdone', read);
  }, [ref]);
  return font;
}

const fontCache = new Map<string, CoverFont>();
let fontCanvas: CanvasRenderingContext2D | null | undefined;
function fontOf(family: string): CoverFont {
  const hit = fontCache.get(family);
  if (hit) return hit;
  if (fontCanvas === undefined) {
    fontCanvas = document.createElement('canvas').getContext('2d');
    // 글꼴 파일이 오면 잰 값을 버린다 (먼저 등록해서, 카드들이 다시 잴 때는 이미 비어 있다)
    document.fonts?.addEventListener?.('loadingdone', () => fontCache.clear());
  }
  const ctx = fontCanvas;
  if (!ctx) return { hangul: 1, latin: 1 };
  ctx.font = `700 100px ${family}`;
  const f = coverFont({ hangul: ctx.measureText(FONT_SAMPLE.hangul).width / 100, latin: ctx.measureText(FONT_SAMPLE.latin).width / 100 });
  fontCache.set(family, f);
  return f;
}

/** 공식 표지: KaTeX 로 그린 큰 공식(넘치면 글자를 줄인다) + 기호 뜻 알약 (한 줄에 들어가는 만큼) */
function FormulaCover({ plan, cover, color }: { plan: FormulaPlan; cover: CoverV2; color: string }) {
  const tex = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderTex(`\\displaystyle ${cover.title}`, false), [cover.title]);
  // 그려 보고 넘치면 줄인다 (KaTeX 는 글자 크기에 비례해서 한 번 재면 된다). 수식 글꼴이 늦게 오면 한 번 더
  useLayoutEffect(() => {
    const el = tex.current;
    if (!el) return;
    let alive = true;
    const fit = () => {
      if (alive) fitCoverTex(el);
    };
    fit();
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      alive = false;
    };
  }, [plan, html]);
  const fitData = { 'data-size': plan.size, 'data-min': plan.min, 'data-roomw': plan.w - 8, 'data-roomh': plan.h - plan.chipH - plan.gap };
  const chipStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: plan.chipH,
    padding: '0 8px',
    borderRadius: 999,
    background: 'var(--surface)',
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)`,
    fontSize: plan.chip,
    fontWeight: 650,
    color: 'var(--ink)',
    whiteSpace: 'nowrap',
  };
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: plan.x,
        top: plan.y,
        width: plan.w,
        height: plan.h,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: plan.gap,
        overflow: 'hidden',
        fontFamily: FONT,
      }}
    >
      {html ? (
        <div
          ref={tex}
          {...fitData}
          style={{ fontSize: plan.size, color, lineHeight: 1.15, whiteSpace: 'nowrap', width: 'max-content', flex: 'none' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div ref={tex} {...fitData} style={{ fontSize: plan.size, color, fontWeight: 700, whiteSpace: 'nowrap', width: 'max-content', flex: 'none' }}>
          {cover.title}
        </div>
      )}
      {cover.items.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 5, maxWidth: '100%', maxHeight: plan.chipH, overflow: 'hidden' }}>
          {cover.items.map((it, i) => (
            <span key={i} style={chipStyle}>
              <Sym tex={it.text} color={color} />
              {it.sub ? <span>{it.sub}</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 공식 글자 크기 맞추기: data-size 로 그려 보고 칸(data-roomw × data-roomh)을 넘치면 비율대로 줄인다 (data-min 까지).
 * 눈으로 보기 도구(tools/cover-lab)도 이 함수를 그대로 쓴다
 */
export function fitCoverTex(el: HTMLElement) {
  const size = Number(el.dataset.size);
  const min = Number(el.dataset.min);
  el.style.fontSize = `${size}px`;
  const r = el.getBoundingClientRect();
  const k = Math.min(1, Number(el.dataset.roomw) / Math.max(1, r.width), Number(el.dataset.roomh) / Math.max(1, r.height));
  if (k < 1) el.style.fontSize = `${Math.max(min, Math.floor(size * k * 2) / 2)}px`;
}

/** 기호 (KaTeX, 못 읽으면 글 그대로) */
function Sym({ tex, color }: { tex: string; color: string }) {
  const html = useMemo(() => renderTex(tex, false), [tex]);
  // KaTeX 가 입력을 이스케이프하고 trust:false 라서 안전한 HTML 이다
  if (html) return <span style={{ color, fontWeight: 800 }} dangerouslySetInnerHTML={{ __html: html }} />;
  return <span style={{ color, fontWeight: 800 }}>{tex}</span>;
}

function PrimView({ p, colors }: { p: Prim; colors: Record<Ink, string> }) {
  const c = (k?: Ink) => (k ? colors[k] : 'none');
  switch (p.t) {
    case 'path':
      return (
        <path
          d={p.d}
          style={{
            fill: c(p.fill),
            fillOpacity: p.fillOp,
            stroke: c(p.stroke),
            strokeWidth: p.w,
            strokeOpacity: p.op,
            strokeDasharray: p.dash,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }}
        />
      );
    case 'circle':
      return (
        <circle cx={p.cx} cy={p.cy} r={p.r} style={{ fill: c(p.fill), fillOpacity: p.fillOp, stroke: c(p.stroke), strokeWidth: p.w, strokeOpacity: p.op }} />
      );
    case 'rect':
      return (
        <rect
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          rx={p.r}
          style={{ fill: c(p.fill), fillOpacity: p.fillOp, stroke: c(p.stroke), strokeWidth: p.sw, strokeOpacity: p.op }}
        />
      );
    case 'text': {
      const n = p.lines.length;
      return (
        <g style={{ fill: colors[p.fill], fontSize: p.size, fontWeight: p.weight }}>
          {p.lines.map((ln, k) => (
            <text key={k} x={p.x} y={r2(p.y + (k - (n - 1) / 2) * p.lh)} textAnchor={p.anchor} dominantBaseline="central">
              {ln}
            </text>
          ))}
        </g>
      );
    }
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;
