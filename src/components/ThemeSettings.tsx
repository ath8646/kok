'use client';
// 설정 > 테마 (Pro): 화면 밝기, 밝을 때·어두울 때 테마, 내가 만든 테마(AI로 만들기·직접 만들기·고치기), 글꼴, 종이 무늬
import { useEffect, useMemo, useState } from 'react';
import type { MeResponse } from '@/lib/types';
import { THEME_COLORS, THEME_FONTS, THEME_MODES, THEME_PAPERS, type ThemeColor, type ThemeFont, type ThemeMode, type ThemePaper } from '@/lib/settings';
import {
  THEME_COLOR_INFO,
  THEME_FONT_INFO,
  THEME_MODE_INFO,
  THEME_PAPER_INFO,
  applyTheme,
  customId,
  forgetCustomTheme,
  knownCustomTheme,
  rememberCustomThemes,
  themeRef,
  type CustomTheme,
  type Theme,
} from '@/lib/theme';
import { deriveTokens, fitPalette, mix, type Mode, type Palette } from '@/lib/themes/colors';
import { BASE_TOKENS } from '@/lib/themes/presets';
import { readSpec, MAX_THEMES, THEME_NAME_MAX, type ThemeImage, type ThemeSpec } from '@/lib/themes/spec';
import { imageCss } from '@/lib/themes/css';
import { CODE_PATTERNS, PATTERN_SIZE, codePatternSvg, svgDataUrl, type CodePattern } from '@/lib/themes/pattern';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { shrinkImage } from '@/lib/image';
import { sb } from '@/lib/data';
import { ApiError, Button, Chip, Field, ICONS, Icon, LinkButton, Segmented, Sheet, Toggle, api, cx, inputClass, useToast } from './ui';

type Ready = { id: string; name: string; spec: ThemeSpec };

const MODES: Mode[] = ['light', 'dark'];
const MODE_LABEL: Record<Mode, string> = { light: '밝을 때', dark: '어두울 때' };
const basePalette = (m: Mode): Palette => ({ bg: BASE_TOKENS[m]['--bg'], surface: BASE_TOKENS[m]['--surface'], accent: BASE_TOKENS[m]['--accent'] });
const DIM_IMAGE = 0.55;
const DIM_PATTERN = 0.3;
const PATTERN_LABEL: Record<CodePattern, string> = { dots: '물방울', grid: '모눈', waves: '물결', diagonal: '빗금', confetti: '색종이', petals: '꽃잎' };
const EXAMPLES = ['비 오는 날 카페', '벚꽃 핀 봄 교정', '밤하늘 별빛', '민트 초코', '바닷가 여름 방학'];

/** 고를 수 있는 테마 하나 (기본 테마·내가 만든 테마) */
type Option = { ref: string; label: string; light: string; dark: string; image: boolean };

function presetOptions(): Option[] {
  return THEME_COLORS.map((c) => ({
    ref: `preset:${c}`,
    label: THEME_COLOR_INFO[c].label,
    light: THEME_COLOR_INFO[c].light,
    dark: THEME_COLOR_INFO[c].dark,
    image: false,
  }));
}

function customOption(t: Ready): Option {
  return { ref: `custom:${t.id}`, label: t.name, light: t.spec.light.accent, dark: t.spec.dark.accent, image: !!t.spec.image };
}

function toReady(rows: CustomTheme[]): Ready[] {
  const out: Ready[] = [];
  for (const r of rows) {
    const spec = readSpec(r.spec);
    if (spec) out.push({ id: r.id, name: r.name, spec });
  }
  return out;
}

export function ThemeSettings({ me, theme, onChange }: { me: MeResponse; theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  const toast = useToast();
  const canTheme = me.canTheme;
  const themesOn = me.features.themes;
  const [customs, setCustoms] = useState<Ready[] | null>(null);
  const [separate, setSeparate] = useState(() => themeRef(theme, 'light') !== themeRef(theme, 'dark'));
  const [editing, setEditing] = useState<Ready | 'new' | null>(null);
  const [making, setMaking] = useState(false);

  // 내가 만든 테마 읽기 (고른 테마를 바로 화면에 붙일 수 있게 theme.ts 에도 기억한다)
  useEffect(() => {
    if (!themesOn || !canTheme) return;
    let alive = true;
    sb()
      .from('user_themes')
      .select('id, name, spec')
      .order('created_at')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setCustoms([]);
          return;
        }
        const rows = (data ?? []) as CustomTheme[];
        rememberCustomThemes(rows);
        setCustoms(toReady(rows));
      });
    return () => {
      alive = false;
    };
  }, [themesOn, canTheme]);

  const options = useMemo(() => [...presetOptions(), ...(customs ?? []).map(customOption)], [customs]);
  const lightRef = themeRef(theme, 'light');
  const darkRef = themeRef(theme, 'dark');

  /** 테마 고르기: 둘 다 같게 또는 한 모드만. 내가 만든 테마가 글꼴·종이를 골라 두었으면 같이 바꾼다 */
  const pick = (which: Mode | 'both', ref: string) => {
    if (!canTheme) return toast('테마는 Pro에서 쓸 수 있어요.');
    const patch: Partial<Theme> = which === 'both' ? { light: ref, dark: ref } : { [which]: ref };
    // 예전 한 가지 테마 색도 맞춰 둔다 (예전 화면이 읽어도 비슷하게)
    if (which === 'both' && ref.startsWith('preset:')) patch.color = ref.slice('preset:'.length) as ThemeColor;
    const id = customId(ref);
    const spec = id ? knownCustomTheme(id)?.spec : null;
    if (spec?.font) patch.font = spec.font;
    if (spec?.paper) patch.paper = spec.paper;
    onChange(patch);
  };

  const setSeparateMode = (on: boolean) => {
    setSeparate(on);
    // 같게 쓰기로 바꾸면 어두울 때도 밝을 때 테마로
    if (!on && lightRef !== darkRef) pick('both', lightRef);
  };

  /** 만들거나 고친 테마를 목록·화면에 반영 (지금 쓰는 테마면 바로 다시 붙인다) */
  const saved = (row: CustomTheme) => {
    rememberCustomThemes([row]);
    const ready = toReady([row])[0];
    if (!ready) return;
    setCustoms((cur) => {
      const list = cur ?? [];
      return list.some((t) => t.id === ready.id) ? list.map((t) => (t.id === ready.id ? ready : t)) : [...list, ready];
    });
    if (customId(lightRef) === ready.id || customId(darkRef) === ready.id) applyTheme(theme, { allowMissing: true });
  };

  const removed = (id: string) => {
    forgetCustomTheme(id);
    setCustoms((cur) => (cur ?? []).filter((t) => t.id !== id));
    const patch: Partial<Theme> = {};
    if (customId(lightRef) === id) patch.light = 'preset:default';
    if (customId(darkRef) === id) patch.dark = 'preset:default';
    if (Object.keys(patch).length) onChange(patch);
  };

  const est = Math.round(estimateSmallTask(clientModel(me, 'fast'), me.usdPerEnergy, 900, 900) * 10) / 10;

  return (
    <div className="grid gap-5">
      {!canTheme ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3.5 py-3">
          <p className="text-sm">테마는 Pro에서 쓸 수 있어요. 밝게·어둡게, 색, 배경 그림, 글꼴을 내 마음대로 바꿔요.</p>
          <LinkButton href="/plan" size="sm" variant="secondary">
            요금제 보기
          </LinkButton>
        </div>
      ) : null}

      <Field label="화면 밝기">
        <div className={cx(!canTheme && 'pointer-events-none opacity-50')}>
          <Segmented<ThemeMode>
            label="화면 밝기"
            value={theme.mode}
            options={THEME_MODES.map((m) => ({ value: m, label: THEME_MODE_INFO[m].label }))}
            onChange={(m) => (canTheme ? onChange({ mode: m }) : toast('테마는 Pro에서 쓸 수 있어요.'))}
          />
        </div>
      </Field>

      <div className="grid gap-2">
        <Toggle label="밝을 때와 어두울 때 테마를 따로 고르기" checked={separate} onChange={setSeparateMode} disabled={!canTheme} />
        {separate ? (
          MODES.map((m) => (
            <Field key={m} label={`${MODE_LABEL[m]} 테마`}>
              <OptionGrid
                label={`${MODE_LABEL[m]} 테마`}
                options={options}
                mode={m}
                selected={m === 'light' ? lightRef : darkRef}
                disabled={!canTheme}
                onPick={(ref) => pick(m, ref)}
              />
            </Field>
          ))
        ) : (
          <OptionGrid label="테마" options={options} mode="both" selected={lightRef} disabled={!canTheme} onPick={(ref) => pick('both', ref)} />
        )}
      </div>

      {themesOn ? (
        <Field label={`내 테마 ${customs ? `(${customs.length}/${MAX_THEMES})` : ''}`}>
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!canTheme || !me.aiEnabled || (customs?.length ?? 0) >= MAX_THEMES} onClick={() => setMaking(true)}>
                <Icon d={ICONS.sparkle} size={16} />
                AI로 만들기 ⚡{est}
              </Button>
              <Button size="sm" variant="secondary" disabled={!canTheme || (customs?.length ?? 0) >= MAX_THEMES} onClick={() => setEditing('new')}>
                <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
                직접 만들기
              </Button>
            </div>
            {customs === null && canTheme ? (
              <div className="kok-skel grid gap-2" aria-busy="true">
                <span className="kok-bone h-16 w-full rounded-2xl" />
              </div>
            ) : (customs ?? []).length ? (
              <ul className="grid gap-2">
                {(customs ?? []).map((t) => (
                  <li key={t.id} className="kok-fill flex items-center gap-3 rounded-2xl border border-line p-2.5">
                    <ThemeThumb spec={t.spec} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{t.name}</span>
                      <span className="text-xs text-muted">
                        {[lightRef, darkRef].includes(`custom:${t.id}`) ? '쓰는 중 · ' : ''}
                        {t.spec.image ? (t.spec.image.kind === 'pattern' ? '무늬' : '배경 그림') : '색만'}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" disabled={!canTheme} onClick={() => setEditing(t)}>
                      고치기
                    </Button>
                  </li>
                ))}
              </ul>
            ) : canTheme ? (
              <p className="text-sm text-muted">&lsquo;비 오는 날 카페&rsquo;처럼 느낌을 적으면 AI가 색과 배경 그림을 골라 줘요.</p>
            ) : null}
          </div>
        </Field>
      ) : me.isAdmin ? (
        <p className="text-xs text-muted">Supabase에서 schema.sql을 다시 실행하면 내 테마(AI 테마·배경 그림)를 만들 수 있어요.</p>
      ) : null}

      <Field label="글꼴">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="테마 글꼴">
          {THEME_FONTS.map((f) => {
            const info = THEME_FONT_INFO[f];
            const on = theme.font === f;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canTheme}
                onClick={() => onChange({ font: f as ThemeFont })}
                className={cx(
                  'press grid gap-0.5 rounded-2xl border-2 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50',
                  on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
                )}
              >
                <span className="text-lg leading-snug" style={{ fontFamily: info.family }}>
                  가나다 공부
                </span>
                <span className={cx('text-xs font-semibold', on ? 'text-accent' : 'text-muted')}>{info.label}</span>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="노트 종이 무늬">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="노트 종이 무늬">
          {THEME_PAPERS.map((p) => {
            const on = theme.paper === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canTheme}
                onClick={() => onChange({ paper: p as ThemePaper })}
                className={cx(
                  'press grid gap-1.5 rounded-2xl p-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50',
                  on ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2',
                )}
              >
                <span
                  className={cx('block h-12 rounded-xl bg-surface ring-1 ring-line', p !== 'none' && `kok-paper-${p}`, on && 'ring-2 ring-accent')}
                  aria-hidden="true"
                />
                {THEME_PAPER_INFO[p].label}
              </button>
            );
          })}
        </div>
      </Field>
      <p className="text-xs text-muted">테마는 이 계정의 모든 기기에 같이 적용돼요. Pro가 끝나면 기본 모양으로 돌아가고, 고른 테마는 남아 있어요.</p>

      <ThemeMaker
        open={making}
        est={est}
        onClose={() => setMaking(false)}
        onMade={(row, message) => {
          setMaking(false);
          saved(row);
          setSeparate(false);
          pick('both', `custom:${row.id}`);
          toast(message, 'ok');
        }}
      />
      <ThemeEditor
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        me={me}
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(row, apply) => {
          saved(row);
          if (apply) pick(separate ? 'light' : 'both', `custom:${row.id}`);
        }}
        onDeleted={(id) => {
          setEditing(null);
          removed(id);
        }}
      />
    </div>
  );
}

/** 테마 고르는 칸 (기본 테마 + 내가 만든 테마) */
function OptionGrid({
  label,
  options,
  mode,
  selected,
  disabled,
  onPick,
}: {
  label: string;
  options: Option[];
  mode: Mode | 'both';
  selected: string;
  disabled: boolean;
  onPick: (ref: string) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.ref === selected;
        const fill = mode === 'light' ? o.light : mode === 'dark' ? o.dark : `linear-gradient(135deg, ${o.light} 0 50%, ${o.dark} 50% 100%)`;
        return (
          <button
            key={o.ref}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onPick(o.ref)}
            className={cx(
              'press grid justify-items-center gap-1.5 rounded-2xl px-1 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2',
            )}
          >
            <span
              className={cx(
                'relative grid h-10 w-10 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-surface',
                on ? 'ring-ink' : 'ring-transparent',
              )}
            >
              <span className="absolute inset-0 rounded-full" style={{ background: fill }} aria-hidden="true" />
              {o.image ? (
                <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface text-ink shadow" aria-hidden="true">
                  <Icon d={ICONS.image} size={10} strokeWidth={2.4} />
                </span>
              ) : null}
              {on ? <Icon d={ICONS.check} size={18} strokeWidth={2.8} className="relative text-white drop-shadow" /> : null}
            </span>
            <span className="w-full truncate text-center">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 작은 미리보기 (밝을 때 | 어두울 때) */
function ThemeThumb({ spec }: { spec: ThemeSpec }) {
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

/** 테마 미리보기: 작은 화면 (바탕·그림·카드·글자·버튼) */
function ThemePreview({ spec, mode }: { spec: ThemeSpec; mode: Mode }) {
  const t = deriveTokens(spec[mode], mode);
  const vars = Object.fromEntries(Object.entries(t)) as React.CSSProperties;
  return (
    <div className="relative overflow-hidden rounded-2xl ring-1 ring-line" style={{ ...vars, background: t['--bg'] }}>
      {spec.image ? (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: imageCss(spec.image),
              backgroundSize: spec.image.kind === 'pattern' ? `${PATTERN_SIZE / 2}px` : 'cover',
              backgroundRepeat: spec.image.kind === 'pattern' ? 'repeat' : 'no-repeat',
              backgroundPosition: 'center',
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0" style={{ background: t['--bg'], opacity: spec.dim }} aria-hidden="true" />
        </>
      ) : null}
      <div className="relative grid gap-2 p-3">
        <p className="text-xs font-semibold" style={{ color: t['--muted'] }}>
          {MODE_LABEL[mode]}
        </p>
        <p className="font-display text-base leading-tight" style={{ color: t['--ink'] }}>
          오늘 복습 12문제
        </p>
        <div className="grid gap-1.5 rounded-xl p-2.5" style={{ background: t['--surface'] }}>
          <p className="text-[11px] leading-snug" style={{ color: t['--muted'] }}>
            광합성은 빛 에너지로 포도당을 만든다.
          </p>
          <span className="justify-self-start rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: t['--accent'], color: t['--accent-ink'] }}>
            5분 콕 시작
          </span>
        </div>
        <span className="text-[11px] font-semibold" style={{ color: t['--accent'] }}>
          자료함 →
        </span>
      </div>
    </div>
  );
}

const newSpec = (): ThemeSpec => ({ light: basePalette('light'), dark: basePalette('dark'), image: null, dim: 0.6, font: null, paper: null });

/** 내가 만든 테마 만들기·고치기 */
function ThemeEditor({
  me,
  target,
  onClose,
  onSaved,
  onDeleted,
}: {
  me: MeResponse;
  target: Ready | 'new' | null;
  onClose: () => void;
  onSaved: (row: CustomTheme, apply: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [id, setId] = useState<string | null>(target && target !== 'new' ? target.id : null);
  const [name, setName] = useState(target && target !== 'new' ? target.name : '');
  const [spec, setSpec] = useState<ThemeSpec>(target && target !== 'new' ? target.spec : newSpec());
  const [kind, setKind] = useState<'none' | 'file' | 'ai' | 'pattern'>(() => {
    const img = target && target !== 'new' ? target.spec.image : null;
    return !img ? 'none' : img.kind === 'pattern' ? 'pattern' : 'file';
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [aiText, setAiText] = useState('');
  const aiEst = Math.round(estimateSmallTask(clientModel(me, 'fast'), me.usdPerEnergy, 500, 150) * 10) / 10;

  const setColor = (m: Mode, k: keyof Palette, v: string) => setSpec((s) => ({ ...s, [m]: fitPalette({ ...s[m], [k]: v }, m, basePalette(m)) }));
  const setImage = (image: ThemeImage | null, dim?: number) => setSpec((s) => ({ ...s, image, dim: dim ?? s.dim }));

  /** 저장 (새 테마면 만든다). 저장한 행 */
  const save = async (next: ThemeSpec = spec): Promise<CustomTheme | null> => {
    const label = name.trim() || '내 테마';
    try {
      const r = id
        ? await api<{ theme: CustomTheme }>(`/api/themes/${id}`, { method: 'PATCH', body: JSON.stringify({ name: label, spec: next }) })
        : await api<{ theme: CustomTheme }>('/api/themes', { method: 'POST', body: JSON.stringify({ name: label, spec: next }) });
      setId(r.theme.id);
      setName(r.theme.name);
      return r.theme;
    } catch (e) {
      toast((e as Error).message, 'bad');
      return null;
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('사진을 올리는 중…');
    try {
      const blob = await shrinkImage(file, 1600, 0.85);
      const res = await fetch('/api/themes/images', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
      const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok || !body?.id) throw new Error(body?.message ?? '사진을 올리지 못했어요.');
      setImage({ kind: 'file', id: body.id }, DIM_IMAGE);
      setKind('file');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const drawAi = async () => {
    setBusy('AI가 그림을 그리는 중… (30초쯤)');
    try {
      // 그림은 저장한 테마에 그린다 (새 테마면 먼저 저장)
      const row = await save();
      if (!row) return;
      const r = await api<{ theme: CustomTheme; note: string | null }>(`/api/themes/${row.id}/image`, {
        method: 'POST',
        body: JSON.stringify(aiText.trim() ? { prompt: aiText.trim() } : {}),
      });
      const ready = toReady([r.theme])[0];
      if (ready) {
        setSpec(ready.spec);
        setKind(ready.spec.image?.kind === 'pattern' ? 'pattern' : 'file');
      }
      onSaved(r.theme, false);
      toast(r.note ?? '그림을 그렸어요.', r.note ? 'bad' : 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
      if (e instanceof ApiError && e.code === 'need_prompt') setKind('ai');
    } finally {
      setBusy(null);
    }
  };

  const open = target !== null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={id ? '테마 고치기' : '새 테마'}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy === '저장하는 중…'}
            disabled={!!busy && busy !== '저장하는 중…'}
            onClick={async () => {
              setBusy('저장하는 중…');
              const row = await save();
              setBusy(null);
              if (!row) return;
              onSaved(row, true);
              toast('테마를 저장하고 썼어요.', 'ok');
              onClose();
            }}
          >
            저장하고 쓰기
          </Button>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          {id ? (
            <Button
              variant="ghost"
              className="ml-auto text-bad"
              disabled={!!busy}
              onClick={async () => {
                if (!confirm(`'${name || '이 테마'}'를 지울까요?`)) return;
                try {
                  await api(`/api/themes/${id}`, { method: 'DELETE' });
                  toast('테마를 지웠어요.');
                  onDeleted(id);
                } catch (e) {
                  toast((e as Error).message, 'bad');
                }
              }}
            >
              지우기
            </Button>
          ) : null}
        </div>
      }
    >
      {open ? (
        <div className="grid gap-5">
          <Field label="이름" htmlFor="theme-name">
            <input
              id="theme-name"
              className={inputClass}
              value={name}
              maxLength={THEME_NAME_MAX}
              placeholder="내 테마"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <ThemePreview key={m} spec={spec} mode={m} />
            ))}
          </div>

          {MODES.map((m) => (
            <Field key={m} label={`${MODE_LABEL[m]} 색`} hint={m === 'dark' ? '글자가 잘 보이게 색을 조금 바꿀 수 있어요.' : undefined}>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['bg', '바탕'],
                    ['surface', '카드'],
                    ['accent', '포인트'],
                  ] as Array<[keyof Palette, string]>
                ).map(([k, label]) => (
                  <label key={k} className="grid gap-1 text-xs font-semibold text-muted">
                    <input
                      type="color"
                      aria-label={`${MODE_LABEL[m]} ${label} 색`}
                      className="h-10 w-full cursor-pointer rounded-xl border border-line bg-surface p-1"
                      value={spec[m][k]}
                      onChange={(e) => setColor(m, k, e.target.value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Field>
          ))}

          <Field label="배경 그림">
            <div className="grid gap-3">
              <Segmented<'none' | 'file' | 'ai' | 'pattern'>
                label="배경 그림"
                value={kind}
                options={[
                  { value: 'none', label: '없음' },
                  { value: 'file', label: '사진' },
                  { value: 'ai', label: 'AI 그림' },
                  { value: 'pattern', label: '무늬' },
                ]}
                onChange={(k) => {
                  setKind(k);
                  if (k === 'none') setImage(null);
                }}
              />
              {kind === 'file' ? (
                <label className="grid gap-1.5 text-sm">
                  <span className="text-muted">사진을 고르면 줄여서 올려요 (3MB 안).</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    aria-label="배경 사진 고르기"
                    disabled={!!busy}
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                </label>
              ) : null}
              {kind === 'ai' ? (
                <div className="grid gap-2">
                  <textarea
                    className={cx(inputClass, 'min-h-20')}
                    maxLength={200}
                    value={aiText}
                    placeholder={spec.image?.kind === 'file' ? '비우고 누르면 지금 그림을 다시 그려요' : '예: 창밖에 비가 내리는 조용한 카페'}
                    aria-label="AI 그림 설명"
                    onChange={(e) => setAiText(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="justify-self-start"
                    busy={busy?.startsWith('AI') ?? false}
                    disabled={!!busy || !me.aiEnabled}
                    onClick={drawAi}
                  >
                    {aiText.trim() ? `그리기 ⚡${aiEst}` : '다시 그리기'}
                  </Button>
                  <p className="text-xs text-muted">사람·글자·캐릭터 없이 풍경·무늬로 그려요. 하루에 몇 번까지만 그릴 수 있어요.</p>
                </div>
              ) : null}
              {kind === 'pattern' ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="무늬">
                  {CODE_PATTERNS.map((p, i) => {
                    const svg = codePatternSvg(p, spec.light.accent, mix(spec.light.accent, '#ffffff', 0.45), i + 1);
                    const on = spec.image?.kind === 'pattern' && spec.image.svg === svg;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setImage({ kind: 'pattern', svg }, DIM_PATTERN)}
                        className={cx('press grid gap-1 rounded-xl p-1 text-xs font-semibold', on ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2')}
                      >
                        <span
                          className={cx('block h-12 rounded-lg ring-1 ring-line', on && 'ring-2 ring-accent')}
                          style={{ background: `${svgDataUrl(svg)} center / ${PATTERN_SIZE / 3}px repeat, ${spec.light.bg}` }}
                          aria-hidden="true"
                        />
                        {PATTERN_LABEL[p]}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {busy && busy !== '저장하는 중…' ? <p className="text-sm text-muted">{busy}</p> : null}
              {spec.image ? (
                <label className="grid gap-1 text-sm">
                  <span className="flex justify-between text-muted">
                    <span>그림 위를 덮는 정도 (글자가 잘 보이게)</span>
                    <span className="tabular-nums">{Math.round(spec.dim * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={92}
                    step={1}
                    value={Math.round(spec.dim * 100)}
                    aria-label="그림 위를 덮는 정도"
                    onChange={(e) => setSpec((s) => ({ ...s, dim: Number(e.target.value) / 100 }))}
                  />
                </label>
              ) : null}
            </div>
          </Field>
          {spec.font || spec.paper ? (
            <p className="text-xs text-muted">
              이 테마를 고르면 {spec.font ? `글꼴 '${THEME_FONT_INFO[spec.font].label}'` : ''}
              {spec.font && spec.paper ? '과 ' : ''}
              {spec.paper ? `종이 '${THEME_PAPER_INFO[spec.paper].label}'` : ''}도 같이 바뀌어요.
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** AI 로 테마 만들기 */
function ThemeMaker({ open, est, onClose, onMade }: { open: boolean; est: number; onClose: () => void; onMade: (row: CustomTheme, message: string) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [image, setImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (text.trim().length < 2) return toast('어떤 느낌인지 두 글자 이상 적어 주세요.');
    setBusy(true);
    try {
      const r = await api<{ theme: CustomTheme; summary: string; note: string | null }>('/api/themes/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt: text.trim(), image }),
      });
      setText('');
      onMade(r.theme, [`'${r.theme.name}' 테마를 만들어 썼어요.`, r.summary, r.note].filter(Boolean).join(' '));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title="AI로 테마 만들기"
      footer={
        <div className="flex gap-2">
          <Button busy={busy} onClick={make}>
            만들기 ⚡{est}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            닫기
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="어떤 느낌의 테마를 만들까요?" htmlFor="theme-prompt">
          <textarea
            id="theme-prompt"
            className={cx(inputClass, 'min-h-24')}
            maxLength={200}
            value={text}
            disabled={busy}
            placeholder="예: 비 오는 날 조용한 카페"
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" disabled={busy} className="press rounded-full bg-surface-2 px-3 py-1 text-sm" onClick={() => setText(x)}>
              {x}
            </button>
          ))}
        </div>
        <Toggle label="배경 그림도 그리기" checked={image} onChange={setImage} disabled={busy} />
        <p className="text-xs text-muted">
          밝을 때·어두울 때 색, 글꼴, 노트 종이{image ? ', 배경 그림' : ''}을 골라 줘요. 글자가 잘 보이게 색은 조금 바뀔 수 있어요.
          {busy ? ' 만드는 중이에요… (그림까지 30초쯤)' : ''}
        </p>
        {busy ? <Chip tone="accent">만드는 중…</Chip> : null}
      </div>
    </Sheet>
  );
}
