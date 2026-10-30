'use client';
// 테마 고르기의 작은 화면들: 기본·내 테마는 실제 색 칸으로 그린 작은 화면(MiniScreen), 시그니처 테마는 그 모양을 줄여 그린 그림(SkinMini).
// 시그니처 테마의 모양 CSS(skins.css)는 <html data-skin> 에 붙어서 작은 화면 안에 따로 쓸 수 없다: 여기서 색 칸으로 흉내 낸다.
import type { CSSProperties } from 'react';
import { mix, type Mode } from '@/lib/themes/colors';
import { imageCss, type ModeLook } from '@/lib/themes/css';
import { PATTERN_SIZE } from '@/lib/themes/pattern';
import { buildSkin, type SkinColors, type SkinId } from '@/lib/themes/skins';
import type { ThemeSpec } from '@/lib/themes/spec';
import { cx } from '@/components/ui';

const MODES: Mode[] = ['light', 'dark'];

/** 작은 화면의 화면 빛 (globals.css .kok-aura 를 작은 화면 크기로: 위 두 개·아래 두 개) */
export const MINI_AURA = [
  'radial-gradient(85% 42% at 12% -11%, var(--aura-1), transparent)',
  'radial-gradient(75% 42% at 94% -8%, var(--aura-2), transparent)',
  'radial-gradient(85% 47% at 0% 111%, var(--aura-3), transparent)',
  'radial-gradient(75% 47% at 100% 111%, var(--aura-4), transparent)',
].join(', ');

/** 한 모드 모습의 색 칸(+ 꾸미기 칸)을 CSS 변수로: 미리보기 안에서만 그 테마 색을 쓴다 */
export function lookVars(look: ModeLook): CSSProperties {
  return { ...look.tokens, ...(look.fx ?? {}), ...(look.skin?.vars ?? {}) } as unknown as CSSProperties;
}

/** 작은 화면: 바탕(그림)·화면 빛, 큰 제목, 카드(흐린 글자 두 줄 + 포인트 버튼), + 버튼. 실제 화면과 같은 색 칸으로 그린다 */
export function MiniScreen({ look }: { look: ModeLook }) {
  const t = look.tokens;
  return (
    <span className="kok-mini absolute inset-0 block" style={{ ...lookVars(look), background: t['--bg'] }} aria-hidden="true">
      {look.image ? (
        <>
          <span
            className="absolute inset-0"
            style={{
              backgroundImage: imageCss(look.image),
              backgroundSize: look.image.kind === 'pattern' ? `${PATTERN_SIZE / 5}px` : 'cover',
              backgroundRepeat: look.image.kind === 'pattern' ? 'repeat' : 'no-repeat',
              backgroundPosition: 'center',
            }}
          />
          <span className="absolute inset-0" style={{ background: t['--bg'], opacity: look.dim }} />
        </>
      ) : null}
      {look.fx ? <span className="absolute inset-0" style={{ background: MINI_AURA }} /> : null}
      <span className="absolute left-[11%] top-[9%] h-[6%] w-[44%] rounded-full" style={{ background: t['--ink'] }} />
      <span className="absolute inset-x-[9%] top-[22%] h-[48%] rounded-[12px]" style={{ background: t['--surface'] }}>
        <span className="absolute left-[12%] top-[16%] h-[9%] w-[70%] rounded-full opacity-45" style={{ background: t['--muted'] }} />
        <span className="absolute left-[12%] top-[34%] h-[9%] w-[48%] rounded-full opacity-45" style={{ background: t['--muted'] }} />
        <span
          className="absolute bottom-[13%] left-[12%] h-[22%] w-[58%] rounded-full"
          style={{ background: t['--accent'], backgroundImage: look.fx ? 'linear-gradient(135deg, var(--accent), var(--btn-2))' : undefined }}
        />
      </span>
      <span
        className="absolute bottom-[6%] right-[8%] grid aspect-square w-[28%] place-items-center rounded-full"
        style={{ background: t['--fab'], backgroundImage: look.fx ? 'linear-gradient(140deg, var(--fab), var(--fab-2))' : undefined }}
      >
        <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]" fill="none" stroke={t['--fab-ink']} strokeWidth={3.2} strokeLinecap="round">
          <path d="M12 6v12M6 12h12" />
        </svg>
      </span>
    </span>
  );
}

/** 작은 화면 한 칸 (같게 쓸 때는 대각선으로 나눠 밝을 때·어두울 때를 같이) */
export function MiniTile({ looks, mode }: { looks: Record<Mode, ModeLook>; mode: Mode | 'both' }) {
  return (
    <>
      <MiniScreen look={looks[mode === 'dark' ? 'dark' : 'light']} />
      {mode === 'both' ? (
        // 오른쪽 아래 반은 어두울 때 모습
        <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]" aria-hidden="true">
          <MiniScreen look={looks.dark} />
        </span>
      ) : null}
    </>
  );
}

const PLUS = (
  <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round">
    <path d="M12 6v12M6 12h12" />
  </svg>
);

/**
 * 시그니처 테마의 작은 그림: 그 테마의 바탕 그림·제목·큰 카드·버튼·+ 버튼을 줄여 그린다 (고르는 칸·지금 테마·새 테마)
 */
export function SkinMini({ id, colors, className }: { id: SkinId; colors: SkinColors; className?: string }) {
  const s = buildSkin(id, colors);
  const t = s.tokens;
  const v = s.vars;
  // kok-mini: 지금 쓰는 시그니처 테마(터미널·글리치)의 네모 칸 규칙이 다른 테마의 작은 그림에 번지지 않게 (skins.css)
  const box = cx('kok-mini absolute inset-0 block overflow-hidden', className);
  const base: CSSProperties = { background: t['--bg'], color: t['--ink'] };
  if (id === 'neon') {
    return (
      <span className={box} style={base} aria-hidden="true">
        <span
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(${v['--skin-art-3']} 1px, transparent 1px), linear-gradient(90deg, ${v['--skin-art-3']} 1px, transparent 1px)`,
            backgroundSize: '100% 9px, 18px 18px',
            opacity: 0.9,
          }}
        />
        <span
          className="absolute left-[11%] top-[10%] h-[6%] w-[48%] rounded-full"
          style={{ background: v['--skin-title'], boxShadow: `0 0 6px ${v['--skin-glow-a']}, 0 0 14px ${v['--skin-glow-a']}` }}
        />
        <span
          className="absolute inset-x-[9%] top-[24%] h-[44%] rounded-[12px]"
          style={{
            background: t['--surface'],
            boxShadow: `inset 0 0 0 1.5px ${mix(v['--skin-a'], '#ffffff', 0.42)}, 0 0 10px -1px ${v['--skin-glow-a']}, 0 0 22px -8px ${v['--skin-glow-a']}`,
          }}
        >
          <span className="absolute left-[12%] top-[18%] h-[9%] w-[62%] rounded-full opacity-50" style={{ background: t['--muted'] }} />
          <span
            className="absolute bottom-[14%] left-[12%] right-[12%] h-[24%] rounded-full"
            style={{
              background: mix(t['--surface'], v['--skin-a'], 0.16),
              boxShadow: `inset 0 0 0 1px ${mix(v['--skin-a'], '#ffffff', 0.42)}, 0 0 8px -1px ${v['--skin-glow-a']}`,
            }}
          />
        </span>
        <span
          className="absolute bottom-[7%] right-[8%] grid aspect-square w-[24%] place-items-center rounded-full"
          style={{
            background: mix(t['--surface'], v['--skin-a'], 0.16),
            color: v['--skin-title'],
            boxShadow: `inset 0 0 0 1.5px ${mix(v['--skin-a'], '#ffffff', 0.42)}, 0 0 12px ${v['--skin-glow-a']}`,
          }}
        >
          {PLUS}
        </span>
      </span>
    );
  }
  if (id === 'glitch') {
    return (
      <span className={box} style={base} aria-hidden="true">
        <span
          className="absolute inset-0"
          style={{ backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0 1px, transparent 1px 3px)` }}
        />
        <span
          className="absolute left-[11%] top-[10%] h-[6%] w-[48%] rounded-[2px]"
          style={{ background: t['--ink'], boxShadow: `-3px 0 ${v['--skin-a']}, 3px 0 ${v['--skin-b']}` }}
        />
        <span className="absolute inset-x-[9%] top-[24%] h-[44%] rounded-[3px]" style={{ background: t['--surface'] }}>
          <span
            className="absolute -inset-[3px]"
            style={{
              background: [
                `linear-gradient(${v['--skin-a']}, ${v['--skin-a']}) left top / 22% 2px`,
                `linear-gradient(${v['--skin-a']}, ${v['--skin-a']}) left top / 2px 30%`,
                `linear-gradient(${v['--skin-a']}, ${v['--skin-a']}) right bottom / 22% 2px`,
                `linear-gradient(${v['--skin-a']}, ${v['--skin-a']}) right bottom / 2px 30%`,
                `linear-gradient(${v['--skin-b']}, ${v['--skin-b']}) right top / 22% 2px`,
                `linear-gradient(${v['--skin-b']}, ${v['--skin-b']}) right top / 2px 30%`,
                `linear-gradient(${v['--skin-b']}, ${v['--skin-b']}) left bottom / 22% 2px`,
                `linear-gradient(${v['--skin-b']}, ${v['--skin-b']}) left bottom / 2px 30%`,
              ].join(', '),
              backgroundRepeat: 'no-repeat',
            }}
          />
          <span className="absolute left-[12%] top-[18%] h-[9%] w-[62%] rounded-[2px] opacity-50" style={{ background: t['--muted'] }} />
          <span
            className="absolute bottom-[14%] left-[12%] right-[14%] h-[24%] rounded-[2px]"
            style={{ background: v['--skin-a'], boxShadow: `3px 3px 0 ${v['--skin-b']}` }}
          />
        </span>
        <span
          className="absolute left-0 right-0 top-[76%] h-[3%]"
          style={{ background: `linear-gradient(90deg, transparent, ${v['--skin-glow-a']}, transparent 50%, ${v['--skin-glow-b']})` }}
        />
        <span
          className="absolute bottom-[6%] right-[9%] grid aspect-square w-[22%] place-items-center rounded-[4px]"
          style={{ background: v['--skin-a'], color: v['--skin-a-ink'], boxShadow: `3px 3px 0 ${v['--skin-b']}` }}
        >
          {PLUS}
        </span>
      </span>
    );
  }
  if (id === 'synthwave') {
    const stripes = 'linear-gradient(to bottom, #000 50%, transparent 50% 57%, #000 57% 66%, transparent 66% 72%, #000 72% 80%, transparent 80% 87%, #000 87%)';
    return (
      <span
        className={box}
        style={{ ...base, background: `linear-gradient(to bottom, ${t['--bg']} 0%, ${v['--skin-bg-2']} 46%, ${t['--bg']} 85%)` }}
        aria-hidden="true"
      >
        <span
          className="absolute left-1/2 top-[8%] aspect-square w-[62%] -translate-x-1/2 rounded-full"
          style={{ background: `linear-gradient(to bottom, ${v['--skin-b']}, ${v['--skin-a']})`, opacity: 0.55, WebkitMaskImage: stripes, maskImage: stripes }}
        />
        <span
          className="absolute inset-x-0 bottom-0 top-[46%]"
          style={{
            backgroundImage: `linear-gradient(${v['--skin-art-3']} 1px, transparent 1px), linear-gradient(90deg, ${v['--skin-art-3']} 1px, transparent 1px)`,
            backgroundSize: '100% 10px, 16px 100%',
            transform: 'perspective(60px) rotateX(38deg)',
            transformOrigin: '50% 0',
          }}
        />
        <span
          className="absolute left-[11%] top-[10%] h-[6%] w-[48%] rounded-full"
          style={{ background: `linear-gradient(to right, ${v['--skin-title']}, ${v['--skin-title-2']})` }}
        />
        <span
          className="absolute inset-x-[9%] top-[50%] h-[30%] rounded-[10px]"
          style={{ background: t['--surface'], boxShadow: `inset 0 0 0 1.5px ${v['--skin-line']}, 0 0 14px -4px ${v['--skin-glow-a']}` }}
        >
          <span
            className="absolute bottom-[16%] left-[12%] right-[12%] h-[32%] rounded-full"
            style={{ background: `linear-gradient(180deg, ${v['--skin-b']}, ${v['--skin-a']})`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)' }}
          />
        </span>
      </span>
    );
  }
  if (id === 'terminal') {
    return (
      <span className={box} style={base} aria-hidden="true">
        <span
          className="absolute inset-0"
          style={{ backgroundImage: `repeating-linear-gradient(to bottom, ${v['--skin-art-1']} 0 1px, transparent 1px 3px)` }}
        />
        <span className="absolute left-[10%] top-[10%] flex h-[7%] w-[70%] items-center gap-[4%]">
          <span className="h-full w-[10%]" style={{ background: v['--skin-b'] }} />
          <span className="h-[70%] w-[55%]" style={{ background: v['--skin-title'], boxShadow: `0 0 6px ${v['--skin-glow-a']}` }} />
          <span className="h-full w-[10%]" style={{ background: v['--skin-a'] }} />
        </span>
        <span
          className="absolute inset-x-[9%] top-[25%] h-[44%]"
          style={{ background: t['--surface'], boxShadow: `inset 0 0 0 1px ${v['--skin-a']}, 0 0 0 2px ${t['--bg']}, 0 0 0 3px ${t['--line']}` }}
        >
          <span className="absolute left-[10%] top-[16%] h-[8%] w-[66%] opacity-70" style={{ background: t['--muted'] }} />
          <span className="absolute left-[10%] top-[34%] h-[8%] w-[44%] opacity-70" style={{ background: t['--muted'] }} />
          <span className="absolute bottom-[14%] left-[10%] right-[10%] h-[22%]" style={{ background: v['--skin-a'] }} />
        </span>
        <span
          className="absolute bottom-[7%] right-[9%] grid aspect-square w-[22%] place-items-center"
          style={{ background: v['--skin-a'], color: v['--skin-a-ink'], boxShadow: `0 0 0 2px ${t['--bg']}, 0 0 0 3px ${v['--skin-a']}` }}
        >
          {PLUS}
        </span>
      </span>
    );
  }
  if (id === 'brutal') {
    return (
      <span className={box} style={base} aria-hidden="true">
        <span
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(rgba(0,0,0,0.22) 1px, transparent 1.4px)`,
            backgroundSize: '7px 7px',
            WebkitMaskImage: 'radial-gradient(120% 60% at 100% 0%, #000, transparent 70%)',
            maskImage: 'radial-gradient(120% 60% at 100% 0%, #000, transparent 70%)',
          }}
        />
        <span className="absolute left-[11%] top-[10%] h-[7%] w-[50%]" style={{ background: '#000', boxShadow: `2px 2px 0 ${v['--skin-b']}` }} />
        <span
          className="absolute inset-x-[9%] top-[24%] h-[44%] rounded-[8px]"
          style={{ background: t['--surface'], boxShadow: `inset 0 0 0 2px #000, 4px 4px 0 ${v['--skin-b']}, 4px 4px 0 2px #000` }}
        >
          <span className="absolute left-[12%] top-[18%] h-[9%] w-[62%] rounded-full opacity-60" style={{ background: t['--muted'] }} />
          <span
            className="absolute bottom-[14%] left-[12%] right-[14%] h-[24%] rounded-[6px]"
            style={{ background: v['--skin-a'], boxShadow: 'inset 0 0 0 2px #000, 2px 2px 0 #000' }}
          />
        </span>
        <span
          className="absolute bottom-[7%] right-[9%] grid aspect-square w-[22%] place-items-center rounded-[8px]"
          style={{ background: v['--skin-a'], color: '#000', boxShadow: 'inset 0 0 0 2px #000, 3px 3px 0 #000' }}
        >
          {PLUS}
        </span>
      </span>
    );
  }
  // 스케치북
  return (
    <span
      className={box}
      style={{ ...base, backgroundImage: `linear-gradient(to bottom, transparent 9px, ${v['--skin-art-1']} 9px 10px)`, backgroundSize: '100% 10px' }}
      aria-hidden="true"
    >
      <span className="absolute bottom-0 left-[6%] top-0 w-px" style={{ background: v['--skin-art-2'] }} />
      <span className="absolute left-[12%] top-[10%] h-[7%] w-[50%] rounded-[3px] -rotate-1" style={{ background: v['--skin-b'] }} />
      <span className="absolute left-[14%] top-[11%] h-[4%] w-[44%] rounded-full" style={{ background: t['--ink'] }} />
      <span
        className="absolute inset-x-[9%] top-[25%] h-[44%]"
        style={{
          background: t['--surface'],
          borderRadius: '14px 5px 16px 6px / 6px 15px 5px 14px',
          boxShadow: `inset 0 0 0 1.5px ${v['--skin-line']}, 2px 3px 0 ${v['--skin-shadow']}`,
        }}
      >
        <span
          className="absolute -top-[6%] left-1/2 h-[14%] w-[36%] -translate-x-1/2 -rotate-3 rounded-[2px]"
          style={{ background: v['--skin-b'], opacity: 0.8 }}
        />
        <span className="absolute left-[12%] top-[24%] h-[8%] w-[62%] rounded-full opacity-50" style={{ background: t['--muted'] }} />
        <span
          className="absolute bottom-[14%] left-[12%] right-[14%] h-[24%]"
          style={{ background: v['--skin-a'], borderRadius: '40px 8px 36px 8px / 8px 36px 8px 40px', boxShadow: `inset 0 0 0 1.5px ${v['--skin-line']}` }}
        />
      </span>
      <span
        className="absolute bottom-[7%] right-[9%] grid aspect-square w-[22%] place-items-center"
        style={{
          background: v['--skin-a'],
          color: v['--skin-a-ink'],
          borderRadius: '58% 42% 55% 45% / 45% 55% 42% 58%',
          boxShadow: `inset 0 0 0 1.5px ${v['--skin-line']}`,
        }}
      >
        {PLUS}
      </span>
    </span>
  );
}

/** 두 색 동그라미 (시그니처 테마의 색 짝) */
export function TwoDots({ a, b, size = 22 }: { a: string; b: string; size?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size * 1.55, height: size }} aria-hidden="true">
      <span className="absolute left-0 top-0 rounded-full ring-2 ring-surface" style={{ width: size, height: size, background: a }} />
      <span className="absolute right-0 top-0 rounded-full ring-2 ring-surface" style={{ width: size, height: size, background: b }} />
    </span>
  );
}

/** 작은 미리보기 (밝을 때 | 어두울 때): 내 테마 목록 */
export function ThemeThumb({ spec }: { spec: ThemeSpec }) {
  if (spec.skin) {
    return (
      <span className="relative block h-12 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-line">
        <SkinMini id={spec.skin.id} colors={spec.skin} />
      </span>
    );
  }
  return (
    <span className="grid h-12 w-16 shrink-0 grid-cols-2 overflow-hidden rounded-xl ring-1 ring-line" aria-hidden="true">
      {MODES.map((m) => (
        <span key={m} className="relative grid place-items-center" style={{ background: spec[m].bg }}>
          {spec.image ? (
            <span
              className="absolute inset-0"
              style={{
                backgroundImage: imageCss(spec.image),
                backgroundSize: spec.image.kind === 'pattern' ? `${PATTERN_SIZE / 4}px` : 'cover',
                backgroundPosition: 'center',
                opacity: 1 - spec.dim * 0.7,
              }}
            />
          ) : null}
          <span className="relative h-3.5 w-3.5 rounded-full" style={{ background: spec[m].accent }} />
        </span>
      ))}
    </span>
  );
}
