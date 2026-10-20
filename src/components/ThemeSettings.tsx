'use client';
// 설정 > 테마 (Pro): 화면 밝기, 밝을 때·어두울 때 테마(작은 화면 미리보기로 고른다), 내가 만든 테마(AI로 만들기·직접 만들기·고치기),
// 별표 빛(색·세기, 밝을 때·어두울 때 미리보기), 글꼴, 종이 무늬
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { MeResponse } from '@/lib/types';
import {
  DEFAULT_GLOW,
  GLOW_TONES,
  THEME_COLORS,
  THEME_FONTS,
  THEME_MODES,
  THEME_PAPERS,
  type Glow,
  type ThemeColor,
  type ThemeFont,
  type ThemeMode,
  type ThemePaper,
} from '@/lib/settings';
import {
  THEME_COLOR_INFO,
  THEME_FONT_INFO,
  THEME_MODE_INFO,
  THEME_PAPER_INFO,
  applyTheme,
  currentMode,
  customId,
  customIds,
  forgetCustomTheme,
  knownCustomTheme,
  lookFor,
  rememberCustomThemes,
  subscribeTheme,
  themeRef,
  themeSnapshot,
  type CustomTheme,
  type Theme,
} from '@/lib/theme';
import { contrast, fitPalette, mix, type Mode, type Palette } from '@/lib/themes/colors';
import { specLook } from '@/lib/themes/backdrop';
import { BASE_TOKENS, presetTokens } from '@/lib/themes/presets';
import { readSpec, MAX_THEMES, THEME_NAME_MAX, type ThemeImage, type ThemeSpec } from '@/lib/themes/spec';
import { imageCss, type ModeLook } from '@/lib/themes/css';
import { GLOW_TONE_INFO, glowPair, glowTokens } from '@/lib/themes/glow';
import { StarButton } from './note/StarButton';
import { CODE_PATTERNS, PATTERN_SIZE, codePatternSvg, svgDataUrl, type CodePattern } from '@/lib/themes/pattern';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { shrinkImage } from '@/lib/image';
import { sb } from '@/lib/data';
import { ApiError, Button, Chip, Energy, Field, ICONS, Icon, LinkButton, Segmented, Sheet, Toggle, api, cx, inputClass, radioKeys, useToast } from './ui';

/** user_themes 행 (updated_at: 고칠 때 '읽은 그대로인지' 확인한다) */
type ThemeRow = CustomTheme & { updated_at?: string | null };
type Ready = { id: string; name: string; spec: ThemeSpec; updatedAt: string | null };

const MODES: Mode[] = ['light', 'dark'];
const MODE_LABEL: Record<Mode, string> = { light: '밝을 때', dark: '어두울 때' };
const basePalette = (m: Mode): Palette => ({ bg: BASE_TOKENS[m]['--bg'], surface: BASE_TOKENS[m]['--surface'], accent: BASE_TOKENS[m]['--accent'] });
// 덮는 정도 기본값 (서버 DIM_IMAGE·DIM_PATTERN 과 같게). 사진은 무엇이 그려졌는지 몰라서 진하게 덮는다
const DIM_IMAGE = 0.8;
const DIM_PATTERN = 0.3;
const PATTERN_LABEL: Record<CodePattern, string> = { dots: '물방울', grid: '모눈', waves: '물결', diagonal: '빗금', confetti: '색종이', petals: '꽃잎' };
const EXAMPLES = ['비 오는 날 카페', '벚꽃 핀 봄 교정', '밤하늘 별빛', '민트 초코', '바닷가 여름 방학'];

/** 고를 수 있는 테마 하나 (기본 테마·내가 만든 테마): 밝을 때·어두울 때 실제 화면 색으로 작은 화면을 그린다 */
type Option = { ref: string; label: string; looks: Record<Mode, ModeLook>; image: boolean };

function presetOptions(): Option[] {
  return THEME_COLORS.map((c) => ({
    ref: `preset:${c}`,
    label: THEME_COLOR_INFO[c].label,
    looks: { light: { tokens: presetTokens(c, 'light'), image: null, dim: 0.6 }, dark: { tokens: presetTokens(c, 'dark'), image: null, dim: 0.6 } },
    image: false,
  }));
}

function customOption(t: Ready): Option {
  return { ref: `custom:${t.id}`, label: t.name, looks: { light: specLook(t.spec, 'light'), dark: specLook(t.spec, 'dark') }, image: !!t.spec.image };
}

function toReady(rows: ThemeRow[]): Ready[] {
  const out: Ready[] = [];
  for (const r of rows) {
    const spec = readSpec(r.spec);
    if (spec) out.push({ id: r.id, name: r.name, spec, updatedAt: r.updated_at ?? null });
  }
  return out;
}

const PRO_ONLY = '테마는 Pro에서 쓸 수 있어요.';

export function ThemeSettings({ me, theme, onChange }: { me: MeResponse; theme: Theme; onChange: (patch: Partial<Theme>) => void }) {
  const toast = useToast();
  const canTheme = me.canTheme;
  const themesOn = me.features.themes;
  const [customs, setCustomsState] = useState<Ready[] | null>(null);
  // 목록의 지금 값 (차례로 저장할 때 바로 앞 저장의 updated_at 을 써야 해서 화면이 다시 그려지기 전에도 읽는다)
  const customsRef = useRef<Ready[] | null>(null);
  const setCustoms = (next: Ready[] | ((cur: Ready[]) => Ready[])) => {
    const value = typeof next === 'function' ? next(customsRef.current ?? []) : next;
    customsRef.current = value;
    setCustomsState(value);
  };
  const lookChain = useRef<Promise<void>>(Promise.resolve());
  const [separate, setSeparate] = useState(() => themeRef(theme, 'light') !== themeRef(theme, 'dark'));
  const [editing, setEditing] = useState<Ready | 'new' | null>(null);
  const [making, setMaking] = useState(false);
  // 시간이 걸리는 일(AI 만들기·그리기)이 끝난 뒤에도 그때의 옛 값이 아니라 지금 값을 쓰게
  const latest = useRef({ theme, separate, onChange });
  useEffect(() => {
    latest.current = { theme, separate, onChange };
  });

  // 내가 만든 테마 읽기 (고른 테마를 바로 화면에 붙일 수 있게 theme.ts 에도 기억한다).
  // Pro 가 끝나도 읽는다: 고칠 수는 없지만 지울 수 있게
  useEffect(() => {
    if (!themesOn) return;
    let alive = true;
    sb()
      .from('user_themes')
      .select('id, name, spec, updated_at')
      .order('created_at')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setCustoms([]);
          return;
        }
        const rows = (data ?? []) as ThemeRow[];
        rememberCustomThemes(rows);
        setCustoms(toReady(rows));
      });
    return () => {
      alive = false;
    };
  }, [themesOn]);

  const options = useMemo(() => [...presetOptions(), ...(customs ?? []).map(customOption)], [customs]);
  const lightRef = themeRef(theme, 'light');
  const darkRef = themeRef(theme, 'dark');

  /** 테마 고르기: 둘 다 같게 또는 한 모드만. 내가 만든 테마를 새로 고르면 그 테마의 글꼴·종이로도 바꾼다 */
  const pick = (which: Mode | 'both', ref: string) => {
    if (!canTheme) return toast(PRO_ONLY);
    const t = latest.current.theme;
    const now = { light: themeRef(t, 'light'), dark: themeRef(t, 'dark') };
    const fresh = which === 'both' ? now.light !== ref || now.dark !== ref : now[which] !== ref;
    const patch: Partial<Theme> = which === 'both' ? { light: ref, dark: ref } : { [which]: ref };
    // 예전 한 가지 테마 색도 맞춰 둔다 (예전 화면이 읽어도 비슷하게)
    if (which === 'both' && ref.startsWith('preset:')) patch.color = ref.slice('preset:'.length) as ThemeColor;
    // 이미 쓰는 테마를 다시 고를 때는 내가 따로 고른 글꼴·종이를 되돌리지 않는다
    if (fresh) {
      const id = customId(ref);
      const spec = id ? knownCustomTheme(id)?.spec : null;
      if (spec?.font) patch.font = spec.font;
      if (spec?.paper) patch.paper = spec.paper;
    }
    latest.current.onChange(patch);
  };

  const setSeparateMode = (on: boolean) => {
    setSeparate(on);
    // 같게 쓰기로 바꾸면 어두울 때도 밝을 때 테마로
    if (!on && lightRef !== darkRef) pick('both', lightRef);
  };

  /** 만들거나 고친 테마를 목록·화면에 반영 (지금 쓰는 테마면 바로 다시 붙인다) */
  const saved = (row: ThemeRow) => {
    rememberCustomThemes([row]);
    const ready = toReady([row])[0];
    if (!ready) return;
    setCustoms((list) => (list.some((t) => t.id === ready.id) ? list.map((t) => (t.id === ready.id ? ready : t)) : [...list, ready]));
    const t = latest.current.theme;
    if (customId(themeRef(t, 'light')) === ready.id || customId(themeRef(t, 'dark')) === ready.id) applyTheme(t, { allowMissing: true });
  };

  const removed = (id: string) => {
    forgetCustomTheme(id);
    setCustoms((list) => list.filter((t) => t.id !== id));
    // Pro 가 끝났으면 설정은 그대로 둔다 (다시 Pro 가 되면 없는 테마는 기본 색으로 보인다)
    if (!canTheme) return;
    const t = latest.current.theme;
    const patch: Partial<Theme> = {};
    if (customId(themeRef(t, 'light')) === id) patch.light = 'preset:default';
    if (customId(themeRef(t, 'dark')) === id) patch.dark = 'preset:default';
    if (Object.keys(patch).length) latest.current.onChange(patch);
  };

  /**
   * 글꼴·종이 바꾸기. 내가 만든 테마를 쓰는 중이면 그 테마에도 저장한다
   * (다른 테마에 갔다가 돌아와도 그 테마는 바꾼 글꼴·종이로). 화살표로 여러 번 바꿔도 잠깐 멈춘 뒤 마지막 것만 한 번 저장하고,
   * 저장은 한 줄로 세워 앞 저장의 updated_at 을 쓴다
   */
  const lookPending = useRef<{ ids: string[]; patch: { font?: ThemeFont; paper?: ThemePaper } } | null>(null);
  const lookTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushLook = useRef<() => void>(() => {});
  // 설정 화면을 바로 떠나도 기다리던 저장은 보낸다
  useEffect(
    () => () => {
      if (lookTimer.current) {
        clearTimeout(lookTimer.current);
        lookTimer.current = null;
        flushLook.current();
      }
    },
    [],
  );
  const changeLook = (patch: { font?: ThemeFont; paper?: ThemePaper }) => {
    if (!canTheme) return toast(PRO_ONLY);
    latest.current.onChange(patch);
    const ids = themesOn ? customIds(latest.current.theme) : [];
    if (!ids.length) return;
    lookPending.current = { ids, patch: { ...(lookPending.current?.patch ?? {}), ...patch } };
    if (lookTimer.current) clearTimeout(lookTimer.current);
    flushLook.current = () => {
      const pending = lookPending.current;
      lookPending.current = null;
      if (!pending) return;
      const want = pending.patch;
      lookChain.current = lookChain.current.then(async () => {
        for (const id of pending.ids) {
          for (let attempt = 0; attempt < 2; attempt++) {
            const cur = customsRef.current?.find((t) => t.id === id);
            if (!cur) break;
            const spec = { ...cur.spec, ...want };
            if (spec.font === cur.spec.font && spec.paper === cur.spec.paper) break;
            try {
              const r = await api<{ theme: ThemeRow }>(`/api/themes/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ spec, ...(cur.updatedAt ? { updatedAt: cur.updatedAt } : {}) }),
              });
              saved(r.theme);
              break;
            } catch (e) {
              // 다른 곳에서 먼저 바뀌었으면 새로 읽어 한 번 더
              if (attempt === 0 && e instanceof ApiError && e.code === 'theme_changed') {
                const { data } = await sb().from('user_themes').select('id, name, spec, updated_at').eq('id', id).maybeSingle();
                if (data) {
                  saved(data as ThemeRow);
                  continue;
                }
              }
              toast(
                e instanceof ApiError && e.code === 'theme_changed'
                  ? '다른 곳에서 테마가 바뀌어서 글꼴·종이를 테마에 저장하지 못했어요. 한 번 더 골라 주세요.'
                  : (e as Error).message,
                'bad',
              );
              break;
            }
          }
        }
      });
    };
    lookTimer.current = setTimeout(() => {
      lookTimer.current = null;
      flushLook.current();
    }, 600);
  };

  const removeTheme = async (t: Ready) => {
    if (!confirm(`'${t.name}'를 지울까요?`)) return;
    try {
      await api(`/api/themes/${t.id}`, { method: 'DELETE' });
      toast('테마를 지웠어요.');
      removed(t.id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  /** 별표 빛 바꾸기 (색·세기). 화면에 바로 보이고 설정에 저장한다 */
  const glow = theme.glow ?? DEFAULT_GLOW;
  const changeGlow = (patch: Partial<Glow>) => {
    if (!canTheme) return toast(PRO_ONLY);
    latest.current.onChange({ glow: { ...(latest.current.theme.glow ?? DEFAULT_GLOW), ...patch } });
  };

  const est = Math.round(estimateSmallTask(clientModel(me, 'fast'), me.usdPerEnergy, 900, 900) * 10) / 10;
  const showMine = themesOn && (canTheme || (customs?.length ?? 0) > 0);
  const nameOf = (ref: string) => options.find((o) => o.ref === ref)?.label ?? THEME_COLOR_INFO.default.label;

  return (
    <div className="grid gap-6">
      {!canTheme ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3.5 py-3">
          <p className="min-w-0 flex-1 text-sm">테마는 Pro에서 쓸 수 있어요. 밝게·어둡게, 색, 별표 빛, 배경 그림, 글꼴을 내 마음대로 바꿔요.</p>
          <LinkButton href="/plan" size="sm" variant="secondary">
            요금제 보기
          </LinkButton>
        </div>
      ) : null}

      <Field label="화면 밝기">
        <div>
          <Segmented<ThemeMode>
            label="화면 밝기"
            value={theme.mode}
            disabled={!canTheme}
            options={THEME_MODES.map((m) => ({ value: m, label: THEME_MODE_INFO[m].label }))}
            onChange={(m) => (canTheme ? latest.current.onChange({ mode: m }) : toast(PRO_ONLY))}
          />
        </div>
      </Field>

      {/* 테마: 작은 화면으로 바탕·카드·글자·버튼 색을 한눈에 보고 고른다 */}
      <section className="grid gap-3" aria-labelledby="theme-pick-title">
        <GroupHead id="theme-pick-title" title="테마" value={separate ? `${nameOf(lightRef)} · ${nameOf(darkRef)}` : nameOf(lightRef)} />
        {separate ? (
          MODES.map((m) => (
            <div key={m} className="grid gap-2">
              <p className="text-xs font-bold text-muted">{MODE_LABEL[m]}</p>
              <OptionGrid
                label={`${MODE_LABEL[m]} 테마`}
                options={options}
                mode={m}
                selected={m === 'light' ? lightRef : darkRef}
                disabled={!canTheme}
                onPick={(ref) => pick(m, ref)}
              />
            </div>
          ))
        ) : (
          <OptionGrid label="테마" options={options} mode="both" selected={lightRef} disabled={!canTheme} onPick={(ref) => pick('both', ref)} />
        )}
        <Toggle label="밝을 때와 어두울 때 테마를 따로 고르기" checked={separate} onChange={setSeparateMode} disabled={!canTheme} />
      </section>

      {showMine ? (
        <section className="grid gap-3" aria-labelledby="theme-mine-title">
          <GroupHead id="theme-mine-title" title="내 테마" value={customs ? `${customs.length}/${MAX_THEMES}` : undefined} />
          <div className="grid gap-2">
            {canTheme ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!me.aiEnabled || (customs?.length ?? 0) >= MAX_THEMES} onClick={() => setMaking(true)}>
                  <Icon d={ICONS.sparkle} size={16} />
                  AI로 만들기 <Energy n={est} />
                </Button>
                <Button size="sm" variant="secondary" disabled={(customs?.length ?? 0) >= MAX_THEMES} onClick={() => setEditing('new')}>
                  <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />
                  직접 만들기
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">Pro가 끝나서 테마를 고칠 수는 없어요. 안 쓰는 테마는 지울 수 있어요.</p>
            )}
            {customs === null ? (
              <div className="kok-skel grid gap-2" aria-busy="true">
                <span className="kok-bone h-16 w-full rounded-2xl" />
              </div>
            ) : customs.length ? (
              <ul className="grid gap-2">
                {customs.map((t) => (
                  <li key={t.id} className="kok-fill flex items-center gap-3 rounded-2xl border border-line p-2.5">
                    <ThemeThumb spec={t.spec} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{t.name}</span>
                      <span className="text-xs text-muted">
                        {[lightRef, darkRef].includes(`custom:${t.id}`) ? '쓰는 중 · ' : ''}
                        {t.spec.image ? (t.spec.image.kind === 'pattern' ? '무늬' : '배경 그림') : '색만'}
                      </span>
                    </span>
                    {canTheme ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                        고치기
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-bad" onClick={() => removeTheme(t)}>
                        지우기
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">&lsquo;비 오는 날 카페&rsquo;처럼 느낌을 적으면 AI가 색과 배경 그림을 골라 줘요.</p>
            )}
          </div>
        </section>
      ) : !themesOn && me.isAdmin ? (
        <p className="text-xs text-muted">Supabase에서 schema.sql을 다시 실행하면 내 테마(AI 테마·배경 그림)를 만들 수 있어요.</p>
      ) : null}

      <GlowSettings glow={glow} refs={{ light: lightRef, dark: darkRef }} disabled={!canTheme} onChange={changeGlow} />

      <Field label="글꼴">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="테마 글꼴">
          {THEME_FONTS.map((f, i) => {
            const info = THEME_FONT_INFO[f];
            const on = theme.font === f;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canTheme}
                tabIndex={on ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, THEME_FONTS.length, (n) => changeLook({ font: THEME_FONTS[n] as ThemeFont }))}
                onClick={() => changeLook({ font: f as ThemeFont })}
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
          {THEME_PAPERS.map((p, i) => {
            const on = theme.paper === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!canTheme}
                tabIndex={on ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, THEME_PAPERS.length, (n) => changeLook({ paper: THEME_PAPERS[n] as ThemePaper }))}
                onClick={() => changeLook({ paper: p as ThemePaper })}
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
        pictures={me.themePictures}
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
          if (!apply) return;
          const ref = `custom:${row.id}`;
          const t = latest.current.theme;
          // 이미 쓰는 테마면 밝을 때·어두울 때 자리는 그대로 (saved 가 새 색을 바로 붙였다)
          if (themeRef(t, 'light') === ref || themeRef(t, 'dark') === ref) return;
          // 따로 고르는 중이면 지금 보이는 쪽(밝게·어둡게)에 쓴다
          pick(latest.current.separate ? currentMode() : 'both', ref);
        }}
        onDeleted={(id) => {
          setEditing(null);
          removed(id);
        }}
      />
    </div>
  );
}

/** 묶음 제목: 왼쪽 이름, 오른쪽 지금 고른 것 (긴 이름은 말줄임) */
function GroupHead({ id, title, value }: { id: string; title: string; value?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <h3 id={id} className="shrink-0 text-sm font-semibold">
        {title}
      </h3>
      {value ? <span className="min-w-0 truncate text-xs font-semibold text-muted">{value}</span> : null}
    </div>
  );
}

/** 작은 화면: 바탕(그림), 큰 제목, 카드(흐린 글자 두 줄 + 포인트 버튼), + 버튼. 실제 화면과 같은 색 칸으로 그린다 */
function MiniScreen({ look }: { look: ModeLook }) {
  const t = look.tokens;
  return (
    <span className="absolute inset-0 block" style={{ background: t['--bg'] }} aria-hidden="true">
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
      <span className="absolute left-[11%] top-[9%] h-[6%] w-[44%] rounded-full" style={{ background: t['--ink'] }} />
      <span className="absolute inset-x-[9%] top-[22%] h-[48%] rounded-[12px]" style={{ background: t['--surface'] }}>
        <span className="absolute left-[12%] top-[16%] h-[9%] w-[70%] rounded-full opacity-45" style={{ background: t['--muted'] }} />
        <span className="absolute left-[12%] top-[34%] h-[9%] w-[48%] rounded-full opacity-45" style={{ background: t['--muted'] }} />
        <span className="absolute bottom-[13%] left-[12%] h-[22%] w-[58%] rounded-full" style={{ background: t['--accent'] }} />
      </span>
      <span className="absolute bottom-[6%] right-[8%] grid aspect-square w-[28%] place-items-center rounded-full" style={{ background: t['--fab'] }}>
        <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]" fill="none" stroke={t['--fab-ink']} strokeWidth={3.2} strokeLinecap="round">
          <path d="M12 6v12M6 12h12" />
        </svg>
      </span>
    </span>
  );
}

/** 테마 고르는 칸 (기본 테마 + 내가 만든 테마). 같게 쓸 때는 작은 화면을 대각선으로 나눠 밝을 때·어두울 때를 같이 보여 준다. 화살표로도 고른다 */
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
  const index = Math.max(
    0,
    options.findIndex((o) => o.ref === selected),
  );
  return (
    <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.ref === selected;
        return (
          <button
            key={o.ref}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            tabIndex={i === index ? 0 : -1}
            onKeyDown={(e) => radioKeys(e, i, options.length, (n) => onPick(options[n].ref))}
            onClick={() => onPick(o.ref)}
            className="press group grid min-w-0 gap-1.5 rounded-[18px] text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={cx(
                'relative block aspect-[3/4] w-full overflow-hidden rounded-[16px] transition-shadow duration-200',
                on
                  ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]'
                  : 'shadow-[0_0_0_1px_var(--line)] group-hover:shadow-[0_0_0_1px_var(--line),0_6px_16px_var(--shadow-strong)]',
              )}
            >
              <MiniScreen look={o.looks[mode === 'dark' ? 'dark' : 'light']} />
              {mode === 'both' ? (
                // 오른쪽 아래 반은 어두울 때 모습
                <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]" aria-hidden="true">
                  <MiniScreen look={o.looks.dark} />
                </span>
              ) : null}
              {o.image ? (
                <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-surface text-ink shadow" aria-hidden="true">
                  <Icon d={ICONS.image} size={11} strokeWidth={2.4} />
                </span>
              ) : null}
              {on ? (
                <span className="kok-check-in absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-surface" aria-hidden="true">
                  <Icon d={ICONS.check} size={12} strokeWidth={3.2} />
                </span>
              ) : null}
            </span>
            <span className={cx('w-full truncate text-center', on ? 'text-ink' : 'text-muted group-hover:text-ink')}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 별표 빛 (Pro): 색 6가지와 세기. 밝을 때·어두울 때 작은 카드로 바로 보여 주고, 미리보기의 별을 눌러 켜고 끄는 움직임도 볼 수 있다.
 * 카드 안 빛은 글자가 읽히는 만큼만 옅게(themes/glow.ts), 테두리와 카드 밖 빛은 고른 세기 그대로.
 */
function GlowSettings({
  glow,
  refs,
  disabled,
  onChange,
}: {
  glow: Glow;
  refs: Record<Mode, string>;
  disabled: boolean;
  onChange: (patch: Partial<Glow>) => void;
}) {
  const looks = { light: lookFor(refs.light, 'light'), dark: lookFor(refs.dark, 'dark') };
  const index = Math.max(0, GLOW_TONES.indexOf(glow.tone));
  // 색 동그라미는 지금 화면 밝기의 테마 색으로 ('테마 색' 빛은 모드마다 다르다)
  const scheme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'light:0');
  const nowMode: Mode = scheme.startsWith('dark') ? 'dark' : 'light';
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
      <div className="grid grid-cols-2 gap-2">
        {MODES.map((m) => (
          <GlowPreview key={m} mode={m} look={looks[m]} glow={shown} />
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="별표 빛 색">
        {GLOW_TONES.map((tone, i) => {
          const on = glow.tone === tone;
          const [c1, c2] = glowPair(tone, looks[nowMode].tokens);
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

/** 그라데이션 동그라미 위 체크 색: 두 색 모두에서 더 잘 보이는 쪽 */
function onTone(c1: string, c2: string): string {
  const dark = Math.min(contrast('#111111', c1), contrast('#111111', c2));
  const light = Math.min(contrast('#ffffff', c1), contrast('#ffffff', c2));
  return dark >= light ? '#111111' : '#ffffff';
}

/** 별표 빛 미리보기: 그 모드의 바탕 위 작은 카드. 별을 누르면 빛이 번지고 오므라드는 것을 볼 수 있다 */
function GlowPreview({ mode, look, glow }: { mode: Mode; look: ModeLook; glow: Glow }) {
  const [on, setOn] = useState(true);
  const t = look.tokens;
  // 이 미리보기 안에서만 그 모드의 색 칸을 쓴다 (화면 밝기와 상관없이 두 모드를 같이 보여 준다)
  const vars = { ...t, ...glowTokens(t, glow, mode) } as unknown as CSSProperties;
  return (
    <div
      className="relative grid gap-2 overflow-hidden rounded-2xl p-2.5 pb-3.5 ring-1 ring-line"
      style={{ ...vars, background: t['--bg'], color: t['--ink'] }}
    >
      <p className="text-[11px] font-semibold" style={{ color: t['--muted'] }}>
        {MODE_LABEL[mode]}
      </p>
      <div className={cx('kok-card kok-glow grid gap-0.5 py-2.5 pl-3 pr-9', on && 'is-starred')} style={{ background: t['--surface'] }}>
        <p className="truncate text-[13px] font-bold leading-snug">광합성</p>
        <p className="line-clamp-2 text-[11px] leading-snug break-keep" style={{ color: t['--muted'] }}>
          빛 에너지로 포도당을 만들어요
        </p>
        <StarButton small className="absolute right-0.5 top-0.5" on={on} label={`${MODE_LABEL[mode]} 미리보기 별표`} onToggle={() => setOn((v) => !v)} />
      </div>
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

/** 테마 미리보기: 작은 화면 (바탕·그림·카드·글자·버튼). 글자 색과 덮는 정도는 실제 화면과 같은 계산(specLook) */
function ThemePreview({ spec, mode }: { spec: ThemeSpec; mode: Mode }) {
  const look = specLook(spec, mode);
  const t = look.tokens;
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
          <div className="absolute inset-0" style={{ background: t['--bg'], opacity: look.dim }} aria-hidden="true" />
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
            5분 KOK 시작
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
  onSaved: (row: ThemeRow, apply: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [id, setId] = useState<string | null>(target && target !== 'new' ? target.id : null);
  const [name, setName] = useState(target && target !== 'new' ? target.name : '');
  const [spec, setSpec] = useState<ThemeSpec>(target && target !== 'new' ? target.spec : newSpec());
  // 마지막으로 읽거나 저장한 테마의 updated_at (다른 곳에서 바뀌었으면 덮어쓰지 않게 서버가 확인한다)
  const [updatedAt, setUpdatedAt] = useState<string | null>(target && target !== 'new' ? target.updatedAt : null);
  const [kind, setKind] = useState<'none' | 'file' | 'ai' | 'pattern'>(() => {
    const img = target && target !== 'new' ? target.spec.image : null;
    return !img ? 'none' : img.kind === 'pattern' ? 'pattern' : 'file';
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [aiText, setAiText] = useState('');
  const aiEst = Math.round(estimateSmallTask(clientModel(me, 'fast'), me.usdPerEnergy, 500, 150) * 10) / 10;
  // 설명 없이 '다시 그리기'는 AI 가 그린 그림일 때만 (그 그림의 설명으로 다시 그린다)
  const canRedraw = spec.image?.kind === 'file' && spec.image.ai === true;
  // 실제 화면에서 덮는 정도 (글자가 잘 보이게 고른 값보다 올라갈 수 있다)
  const realDims = MODES.map((m) => specLook(spec, m).dim);
  const raised = !!spec.image && realDims.some((d) => d > spec.dim + 0.005);

  const setColor = (m: Mode, k: keyof Palette, v: string) => setSpec((s) => ({ ...s, [m]: fitPalette({ ...s[m], [k]: v }, m, basePalette(m)) }));
  const setImage = (image: ThemeImage | null, dim?: number) => setSpec((s) => ({ ...s, image, dim: dim ?? s.dim }));

  /** 저장 (새 테마면 만든다). 저장한 행 */
  const save = async (next: ThemeSpec = spec): Promise<ThemeRow | null> => {
    const label = name.trim() || '내 테마';
    try {
      const r = id
        ? await api<{ theme: ThemeRow }>(`/api/themes/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: label, spec: next, ...(updatedAt ? { updatedAt } : {}) }),
          })
        : await api<{ theme: ThemeRow }>('/api/themes', { method: 'POST', body: JSON.stringify({ name: label, spec: next }) });
      setId(r.theme.id);
      setName(r.theme.name);
      setUpdatedAt(r.theme.updated_at ?? null);
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
      setImage({ kind: 'file', id: body.id }, Math.max(spec.dim, DIM_IMAGE));
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
      // 그림은 저장한 테마에 그린다 (새 테마면 먼저 저장하고 목록에도 바로 넣는다: 그리기가 실패해도 테마가 보이게)
      const row = await save();
      if (!row) return;
      onSaved(row, false);
      const r = await api<{ theme: ThemeRow; note: string | null }>(`/api/themes/${row.id}/image`, {
        method: 'POST',
        body: JSON.stringify(aiText.trim() ? { prompt: aiText.trim() } : {}),
      });
      const ready = toReady([r.theme])[0];
      if (ready) {
        setSpec(ready.spec);
        setUpdatedAt(ready.updatedAt);
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
  const kinds: Array<{ value: 'none' | 'file' | 'ai' | 'pattern'; label: string }> = [
    { value: 'none', label: '없음' },
    { value: 'file', label: '사진' },
    ...(me.themePictures ? [{ value: 'ai' as const, label: 'AI 그림' }] : []),
    { value: 'pattern', label: '무늬' },
  ];
  return (
    <Sheet
      open={open}
      // 그리거나 올리는 중에는 닫지 않는다 (끝난 뒤 옛 화면 값으로 테마를 다시 붙이지 않게)
      onClose={busy ? () => {} : onClose}
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
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
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
                options={kinds}
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
                    placeholder={canRedraw ? '비우고 누르면 지금 그림을 다시 그려요' : '예: 창밖에 비가 내리는 조용한 카페'}
                    aria-label="AI 그림 설명"
                    onChange={(e) => setAiText(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="justify-self-start"
                    busy={busy?.startsWith('AI') ?? false}
                    disabled={!!busy || !me.aiEnabled || (!aiText.trim() && !canRedraw)}
                    onClick={drawAi}
                  >
                    {aiText.trim() || !canRedraw ? (
                      <>
                        그리기 <Energy n={aiEst} />
                      </>
                    ) : (
                      '다시 그리기'
                    )}
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
              {busy && busy !== '저장하는 중…' ? (
                <p className="text-sm text-muted" role="status" aria-live="polite">
                  {busy}
                </p>
              ) : null}
              {spec.image ? (
                <label className="grid gap-1 text-sm">
                  <span className="flex justify-between text-muted">
                    <span>그림 위를 덮는 정도 (글자가 잘 보이게)</span>
                    <span className="tabular-nums">{Math.round(spec.dim * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={spec.image.kind === 'file' ? 70 : 20}
                    max={92}
                    step={1}
                    value={Math.round(spec.dim * 100)}
                    aria-label="그림 위를 덮는 정도"
                    onChange={(e) => setSpec((s) => ({ ...s, dim: Number(e.target.value) / 100 }))}
                  />
                  {raised ? (
                    <span className="text-xs text-muted">
                      글자가 잘 보이게 {MODES.map((m, i) => `${MODE_LABEL[m]} ${Math.round(realDims[i] * 100)}%`).join(', ')}로 덮어요.
                    </span>
                  ) : null}
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
function ThemeMaker({
  open,
  est,
  pictures,
  onClose,
  onMade,
}: {
  open: boolean;
  est: number;
  /** Cloudflare 로 그림을 그릴 수 있는지 (없으면 AI 가 무늬를 그린다) */
  pictures: boolean;
  onClose: () => void;
  onMade: (row: ThemeRow, message: string) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [image, setImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (text.trim().length < 2) return toast('어떤 느낌인지 두 글자 이상 적어 주세요.');
    setBusy(true);
    try {
      const r = await api<{ theme: ThemeRow; summary: string; note: string | null }>('/api/themes/generate', {
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
  const what = pictures ? '배경 그림' : '배경 무늬';
  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title="AI로 테마 만들기"
      footer={
        <div className="flex gap-2">
          <Button busy={busy} onClick={make}>
            만들기 <Energy n={est} />
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
        <Toggle label={`${what}도 그리기`} checked={image} onChange={setImage} disabled={busy} />
        <p className="text-xs text-muted" role="status" aria-live="polite">
          밝을 때·어두울 때 색, 글꼴, 노트 종이{image ? `, ${what}` : ''}을 골라 줘요. 글자가 잘 보이게 색은 조금 바뀔 수 있어요.
          {busy ? ' 만드는 중이에요… (그림까지 30초쯤)' : ''}
        </p>
        {busy ? <Chip tone="accent">만드는 중…</Chip> : null}
      </div>
    </Sheet>
  );
}
