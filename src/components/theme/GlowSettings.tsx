'use client';
/**
 * 별표 빛 (Pro): 색 6가지와 세기. 작은 카드로 바로 보여 주고(밝을 때·어두울 때, 시그니처 테마면 그 테마 하나), 미리보기의 별을 눌러
 * 켜고 끄는 움직임도 볼 수 있다. 카드 안 빛은 글자가 읽히는 만큼만 옅게(themes/glow.ts), 테두리와 카드 밖 빛은 고른 세기 그대로.
 */
import { useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { GLOW_TONES, type Glow } from '@/lib/settings';
import { subscribeTheme, themeSnapshot } from '@/lib/theme';
import { contrast } from '@/lib/themes/colors';
import type { ModeLook } from '@/lib/themes/css';
import { GLOW_TONE_INFO, glowPair, glowTokens } from '@/lib/themes/glow';
import type { Mode } from '@/lib/themes/colors';
import { StarButton } from '@/components/note/StarButton';
import { ICONS, Icon, cx, radioKeys } from '@/components/ui';
import { lookVars } from './minis';

/** 미리보기 한 칸: 이름(밝을 때·어두울 때·시그니처 테마 이름)과 그 모습 */
export type GlowLook = { key: string; label: string; mode: Mode; look: ModeLook };

/** 묶음 제목: 왼쪽 이름, 오른쪽 지금 고른 것 (긴 이름은 말줄임) */
export function GroupHead({ id, title, value }: { id: string; title: string; value?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <h3 id={id} className="shrink-0 text-sm font-semibold">
        {title}
      </h3>
      {value ? <span className="min-w-0 truncate text-xs font-semibold text-muted">{value}</span> : null}
    </div>
  );
}

/** 그라데이션 동그라미 위 체크 색: 두 색 모두에서 더 잘 보이는 쪽 */
export function onTone(c1: string, c2: string): string {
  const dark = Math.min(contrast('#111111', c1), contrast('#111111', c2));
  const light = Math.min(contrast('#ffffff', c1), contrast('#ffffff', c2));
  return dark >= light ? '#111111' : '#ffffff';
}

export function GlowSettings({
  glow,
  looks,
  disabled,
  onChange,
}: {
  glow: Glow;
  looks: GlowLook[];
  disabled: boolean;
  onChange: (patch: Partial<Glow>) => void;
}) {
  const index = Math.max(0, GLOW_TONES.indexOf(glow.tone));
  // 색 동그라미는 지금 화면 밝기의 테마 색으로 ('테마 색' 빛은 모드마다 다르다)
  const scheme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'light:0');
  const nowMode: Mode = scheme.startsWith('dark') ? 'dark' : 'light';
  const toneLook = (looks.find((l) => l.mode === nowMode) ?? looks[0]).look;
  // 세기: 끄는 동안에는 미리보기만 바꾸고(설정 화면 전체를 다시 그리지 않게) 손을 떼면 한 번 저장한다. 키보드로 바꾸면 바로 저장
  const [dragging, setDragging] = useState<number | null>(null);
  const drag = useRef<{ value: number; start: number } | null>(null);
  const startDrag = () => {
    if (disabled || drag.current) return;
    drag.current = { value: glow.strength, start: glow.strength };
    const stop = new AbortController();
    const done = () => {
      stop.abort();
      const d = drag.current;
      drag.current = null;
      setDragging(null);
      if (d && d.value !== d.start) onChange({ strength: d.value });
    };
    window.addEventListener('pointerup', done, { signal: stop.signal });
    window.addEventListener('pointercancel', done, { signal: stop.signal });
  };
  const strength = dragging ?? glow.strength;
  const shown = { ...glow, strength };
  return (
    <section className="grid gap-3" aria-labelledby="glow-title">
      <GroupHead id="glow-title" title="별표 빛" value={`${GLOW_TONE_INFO[glow.tone].label} · ${strength === 0 ? '빛 끔' : `${strength}%`}`} />
      <p className="-mt-1.5 text-xs text-muted">별표한 개념과 자료가 이 빛으로 물들어요. 미리보기의 별을 눌러 보세요.</p>
      <div className={cx('grid gap-2', looks.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {looks.map((l) => (
          <GlowPreview key={l.key} label={l.label} mode={l.mode} look={l.look} glow={shown} />
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="별표 빛 색">
        {GLOW_TONES.map((tone, i) => {
          const on = glow.tone === tone;
          const [c1, c2] = glowPair(tone, toneLook.tokens);
          return (
            <button
              key={tone}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              tabIndex={i === index ? 0 : -1}
              onKeyDown={(e) => radioKeys(e, i, GLOW_TONES.length, (n) => onChange({ tone: GLOW_TONES[n] }))}
              onClick={() => onChange({ tone })}
              className="press group grid min-w-0 justify-items-center gap-1.5 rounded-2xl py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={cx(
                  'grid h-9 w-9 place-items-center rounded-full transition-shadow duration-200',
                  on ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]' : 'shadow-[0_0_0_1px_var(--line)]',
                )}
                style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                aria-hidden="true"
              >
                {on ? (
                  <span className="kok-check-in grid place-items-center" style={{ color: onTone(c1, c2) }}>
                    <Icon d={ICONS.check} size={15} strokeWidth={3} />
                  </span>
                ) : null}
              </span>
              <span className={cx('w-full truncate text-center', on ? 'text-ink' : 'text-muted group-hover:text-ink')}>{GLOW_TONE_INFO[tone].label}</span>
            </button>
          );
        })}
      </div>
      <label className="grid gap-1.5">
        <span className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold">세기</span>
          <span className="text-xs font-semibold tabular-nums text-muted">{strength === 0 ? '빛 없이 별만' : `${strength}%`}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={strength}
          disabled={disabled}
          aria-label="별표 빛 세기"
          aria-valuetext={strength === 0 ? '빛 없이 별만' : `${strength}퍼센트`}
          className="w-full accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          onPointerDown={startDrag}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (drag.current) {
              drag.current.value = v;
              setDragging(v);
            } else onChange({ strength: v });
          }}
        />
        <span className="flex justify-between text-xs text-muted" aria-hidden="true">
          <span>은은하게</span>
          <span>선명하게</span>
        </span>
      </label>
    </section>
  );
}

/** 별표 빛 미리보기: 그 모드의 바탕 위 작은 카드. 별을 누르면 빛이 번지고 오므라드는 것을 볼 수 있다 */
function GlowPreview({ label, mode, look, glow }: { label: string; mode: Mode; look: ModeLook; glow: Glow }) {
  const [on, setOn] = useState(true);
  const t = look.tokens;
  // 이 미리보기 안에서만 그 모드의 색 칸을 쓴다 (화면 밝기와 상관없이 두 모드를 같이 보여 준다)
  const vars = { ...lookVars(look), ...glowTokens(t, glow, mode) } as unknown as CSSProperties;
  return (
    <div
      className="relative grid gap-2 overflow-hidden rounded-2xl p-2.5 pb-3.5 ring-1 ring-line"
      style={{ ...vars, background: t['--bg'], color: t['--ink'] }}
    >
      <p className="text-[11px] font-semibold" style={{ color: t['--muted'] }}>
        {label}
      </p>
      <div className={cx('kok-card kok-glow grid gap-0.5 py-2.5 pl-3 pr-9', on && 'is-starred')} style={{ background: t['--surface'] }}>
        <p className="truncate text-[13px] font-bold leading-snug">광합성</p>
        <p className="line-clamp-2 text-[11px] leading-snug break-keep" style={{ color: t['--muted'] }}>
          빛 에너지로 포도당을 만들어요
        </p>
        <StarButton small className="absolute right-0.5 top-0.5" on={on} label={`${label} 미리보기 별표`} onToggle={() => setOn((v) => !v)} />
      </div>
    </div>
  );
}
