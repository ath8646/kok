'use client';
// 설정 > 테마 (Pro).
// - 지금 테마: 큰 미리보기와 이름, 그 테마를 고치거나 그 테마로 내 테마를 만드는 단추
// - 화면 밝기 (시그니처 테마는 그 테마가 정한다)
// - 시그니처 테마 6가지 (모양까지 바뀐다: themes/skins.ts·skins.css), 움직임 스위치. 평소에는 접어 두고(작은 그림 여섯 장만),
//   눌러서 펼친다. 다른 화면에서 /settings#skins 로 오면 펼친 채로 그 자리까지 내려간다
// - 기본 테마 9가지·내 테마 (밝을 때·어두울 때 따로 고를 수도 있다). 내 테마의 '+' → 새 테마, 고른 내 테마의 연필 → 테마 만들기 화면(ThemeStudio)
// - 별표 빛, 글꼴, 노트 종이
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse } from '@/lib/types';
import {
  DEFAULT_GLOW,
  SKIN_IDS,
  THEME_COLORS,
  THEME_FONTS,
  THEME_MODES,
  THEME_PAPERS,
  type Glow,
  type SkinId,
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
  activeSkin,
  applyTheme,
  baseLook,
  currentMode,
  customId,
  customIds,
  forgetCustomTheme,
  knownCustomTheme,
  lookFor,
  presetLookFx,
  rememberCustomThemes,
  settleLook,
  skinPickLook,
  specLookFx,
  themeRef,
  type CustomTheme,
  type Theme,
} from '@/lib/theme';
import type { Mode } from '@/lib/themes/colors';
import type { ModeLook } from '@/lib/themes/css';
import { ACCENT_SWATCHES } from '@/lib/themes/palette-from';
import { SKINS, skinDefaults, topic } from '@/lib/themes/skins';
import { readSpec, MAX_THEMES, type ThemeSpec } from '@/lib/themes/spec';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { ApiError, Button, Chip, Energy, Field, ICONS, Icon, LinkButton, Segmented, Sheet, Toggle, api, cx, inputClass, radioKeys, useToast, DONE } from './ui';
import { MiniTile, SkinMini, ThemeThumb } from './theme/minis';
import { useConfirm } from './Confirm';
import { josa } from '@/lib/josa';
import { GlowSettings, GroupHead, type GlowLook } from './theme/GlowSettings';
import { ThemeStudio, type Ready, type StudioStart, type ThemeRow } from './theme/ThemeStudio';

const MODES: Mode[] = ['light', 'dark'];
const MODE_LABEL: Record<Mode, string> = { light: '밝을 때', dark: '어두울 때' };
const EXAMPLES = ['비 오는 날 카페', '벚꽃 핀 봄 교정', '밤하늘 별빛', '민트 초코', '바닷가 여름 방학'];

/** 고를 수 있는 테마 하나 (기본 테마·내가 만든 테마): 밝을 때·어두울 때 실제 화면 색으로 작은 화면을 그린다 */
type Option = { ref: string; label: string; looks: Record<Mode, ModeLook>; image: boolean; spec?: ThemeSpec };

function presetOptions(): Option[] {
  return THEME_COLORS.map((c) => ({
    ref: `preset:${c}`,
    label: THEME_COLOR_INFO[c].label,
    looks: { light: presetLookFx(c, 'light'), dark: presetLookFx(c, 'dark') },
    image: false,
  }));
}

function customOption(t: Ready): Option {
  return {
    ref: `custom:${t.id}`,
    label: t.name,
    looks: { light: specLookFx(t.spec, 'light'), dark: specLookFx(t.spec, 'dark') },
    image: !!t.spec.image,
    spec: t.spec,
  };
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
  const ask = useConfirm();
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
  const [studio, setStudio] = useState<StudioStart | null>(null);
  // 새 테마 고르는 창 ('+' 칸). 따로 고르는 중이면 누른 쪽(밝을 때·어두울 때)에 새 테마를 쓴다
  const [adding, setAdding] = useState(false);
  const [useFor, setUseFor] = useState<Mode | 'both'>('both');
  const [making, setMaking] = useState(false);
  // 시그니처 테마 칸: 평소에는 접어 둔다. #skins 로 들어오면(설정 화면에 있다가 주소만 바뀌어도) 펼치고 그 자리로.
  // 주소는 effect 안에서만 읽는다
  const [skinsOpen, setSkinsOpen] = useState(false);
  useEffect(() => {
    let go = 0;
    const openFromHash = () => {
      if (window.location.hash !== '#skins') return;
      setSkinsOpen(true);
      window.clearTimeout(go);
      go = window.setTimeout(() => document.getElementById('skins')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    };
    const first = window.setTimeout(openFromHash, 0);
    window.addEventListener('hashchange', openFromHash);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(go);
      window.removeEventListener('hashchange', openFromHash);
    };
  }, []);
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
        rememberCustomThemes(rows as CustomTheme[]);
        setCustoms(toReady(rows));
      });
    return () => {
      alive = false;
    };
  }, [themesOn]);

  const presets = useMemo(() => presetOptions(), []);
  const mine = useMemo(() => (customs ?? []).map(customOption), [customs]);
  const lightRef = themeRef(theme, 'light');
  const darkRef = themeRef(theme, 'dark');
  // 지금 쓰는 시그니처 테마 (두 모드에 같이 쓸 때만). customs 가 바뀌면 다시 본다 (내 테마를 읽은 뒤)
  const skinNow = useMemo(() => activeSkin(theme), [theme, customs]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 테마 고르기: 둘 다 같게 또는 한 모드만. 글꼴·종이는 새로 고른 내 테마가 정한 것으로, 정하지 않았거나 기본·시그니처 테마면
   * 내 글꼴·종이(base)로 돌아온다 (그래서 내 테마의 글꼴이 기본 테마에 남지 않는다)
   */
  const pick = (which: Mode | 'both', ref: string) => {
    if (!canTheme) return toast(PRO_ONLY);
    const t = latest.current.theme;
    const now = { light: themeRef(t, 'light'), dark: themeRef(t, 'dark') };
    const fresh = which === 'both' ? now.light !== ref || now.dark !== ref : now[which] !== ref;
    const patch: Partial<Theme> = which === 'both' ? { light: ref, dark: ref } : { [which]: ref };
    // 예전 한 가지 테마 색도 맞춰 둔다 (예전 화면이 읽어도 비슷하게: 시그니처 테마는 비슷한 기본 테마)
    if (which === 'both' && ref.startsWith('preset:')) patch.color = ref.slice('preset:'.length) as ThemeColor;
    if (which === 'both' && ref.startsWith('skin:')) patch.color = SKINS[ref.slice('skin:'.length) as SkinId].legacy;
    // 이미 쓰는 테마를 다시 고를 때는 내가 따로 고른 글꼴·종이를 되돌리지 않는다
    if (fresh) {
      const base = baseLook(t);
      const look = settleLook({ ...t, ...patch }, which === 'both' ? 'light' : which, base);
      patch.font = look.font;
      patch.paper = look.paper;
      patch.base = base;
    }
    latest.current.onChange(patch);
  };

  /** 시그니처 테마 고르기: 두 모드에 같이 (따로 고르던 중이면 같게로) */
  const pickSkin = (id: SkinId) => {
    if (!canTheme) return toast(PRO_ONLY);
    setSeparate(false);
    pick('both', `skin:${id}`);
  };

  const setSeparateMode = (on: boolean) => {
    setSeparate(on);
    // 따로 고르기로 바꾸면 시그니처 테마는 비슷한 기본 테마로 (시그니처 테마는 두 모드에 같이 쓴다)
    if (on && skinNow) {
      const legacy = `preset:${SKINS[skinNow.id].legacy}`;
      if (lightRef.startsWith('skin:')) pick('both', legacy);
      return;
    }
    // 같게 쓰기로 바꾸면 어두울 때도 밝을 때 테마로
    if (!on && lightRef !== darkRef) pick('both', lightRef);
  };

  /** 만들거나 고친 테마를 목록·화면에 반영 (지금 쓰는 테마면 바로 다시 붙인다) */
  const saved = (row: ThemeRow) => {
    rememberCustomThemes([row as CustomTheme]);
    const ready = toReady([row])[0];
    if (!ready) return;
    setCustoms((list) => (list.some((t) => t.id === ready.id) ? list.map((t) => (t.id === ready.id ? ready : t)) : [...list, ready]));
    const t = latest.current.theme;
    if (customId(themeRef(t, 'light')) === ready.id || customId(themeRef(t, 'dark')) === ready.id) applyTheme(t, { allowMissing: true });
  };

  const removed = (id: string) => {
    const gone = customsRef.current?.find((t) => t.id === id)?.spec ?? null;
    // 지우기 전에 내 글꼴·종이를 정한다 (지운 테마가 정한 글꼴을 내 것으로 착각하지 않게)
    const base = baseLook(latest.current.theme, (x) => (x === id ? gone : knownCustomTheme(x)?.spec));
    forgetCustomTheme(id);
    setCustoms((list) => list.filter((t) => t.id !== id));
    // Pro 가 끝났으면 설정은 그대로 둔다 (다시 Pro 가 되면 없는 테마는 기본 색으로 보인다)
    if (!canTheme) return;
    const t = latest.current.theme;
    const patch: Partial<Theme> = {};
    if (customId(themeRef(t, 'light')) === id) patch.light = 'preset:default';
    if (customId(themeRef(t, 'dark')) === id) patch.dark = 'preset:default';
    // 쓰던 테마를 지우면 그 테마가 정한 글꼴·종이도 두고 내 글꼴·종이로 (남은 다른 쪽 내 테마가 정했으면 그것으로)
    if (patch.light || patch.dark) {
      const look = settleLook({ ...t, ...patch }, 'light', base);
      patch.font = look.font;
      patch.paper = look.paper;
      patch.base = base;
    }
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
    const t = latest.current.theme;
    const ids = themesOn ? customIds(t) : [];
    // 바꾸기 전의 내 글꼴·종이 (내 테마를 쓰는 중이면 바꾼 것은 그 테마에 저장하고 내 것은 그대로, 아니면 내 것을 바꾼다)
    const base = baseLook(t);
    latest.current.onChange(ids.length ? { ...patch, base } : { ...patch, base: { ...base, ...patch } });
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
    if (!(await ask({ title: '테마 지우기', body: `${josa(`'${t.name}'`, '을')} 지울까요?`, note: '되돌릴 수 없어요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/themes/${t.id}`, { method: 'DELETE' });
      toast('테마를 지웠어요.', 'plain', DONE);
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
  const glowLooks: GlowLook[] = skinNow
    ? [{ key: 'skin', label: SKINS[skinNow.id].label, mode: SKINS[skinNow.id].mode, look: skinPickLook(skinNow) }]
    : MODES.map((m) => ({ key: m, label: MODE_LABEL[m], mode: m, look: lookFor(m === 'light' ? lightRef : darkRef, m) }));

  const est = Math.round(estimateSmallTask(clientModel(me, 'fast'), me.usdPerEnergy, 900, 900) * 10) / 10;
  // Pro 가 끝났으면 내 테마는 지우기만 (목록으로)
  const leftovers = themesOn && !canTheme && (customs?.length ?? 0) > 0;
  const nameOf = (ref: string) => {
    if (ref.startsWith('skin:')) return SKINS[ref.slice(5) as SkinId]?.label ?? THEME_COLOR_INFO.default.label;
    return [...presets, ...mine].find((o) => o.ref === ref)?.label ?? THEME_COLOR_INFO.default.label;
  };
  const full = (customs?.length ?? 0) >= MAX_THEMES;
  const mineOn = canTheme && themesOn && customs !== null;
  /** 고른 내 테마의 연필 → 그 테마 고치기 */
  const editRef = (which: Mode | 'both') => (ref: string) => {
    const t = customs?.find((x) => `custom:${x.id}` === ref);
    if (!t) return;
    setUseFor(which);
    setStudio({ kind: 'edit', theme: t });
  };
  /** '+' 칸 → 새 테마 고르는 창 */
  const addFrom = (which: Mode | 'both') => () => {
    if (full) return toast(`테마는 ${MAX_THEMES}개까지 만들 수 있어요. 안 쓰는 테마를 골라 연필을 누르면 지울 수 있어요.`);
    setUseFor(which);
    setAdding(true);
  };
  /** 지금 테마 카드에서 테마 만들기 열기 */
  const openStudio = (s: StudioStart) => {
    if (!canTheme) return toast(PRO_ONLY);
    if (!mineOn) return toast('내 테마를 읽는 중이에요. 잠깐 뒤에 다시 눌러 주세요.');
    if (s.kind !== 'edit' && full) return toast(`테마는 ${MAX_THEMES}개까지 만들 수 있어요. 안 쓰는 테마를 골라 연필을 누르면 지울 수 있어요.`);
    setUseFor('both');
    setStudio(s);
  };
  /** 새로 만든 테마를 쓴다: 같게 쓰는 중이면 둘 다, 따로 고르는 중이면 '+'를 누른 쪽에 */
  const applyNew = (ref: string) => pick(latest.current.separate && useFor !== 'both' ? useFor : 'both', ref);

  // 지금 테마 카드
  const nowCustom = customs?.find((x) => `custom:${x.id}` === lightRef) ?? null;
  const now = (() => {
    if (separate) return null;
    if (skinNow && lightRef.startsWith('skin:')) {
      const info = SKINS[skinNow.id];
      return {
        name: info.label,
        kind: `시그니처 테마 · 늘 ${info.mode === 'dark' ? '어두운' : '밝은'} 화면`,
        desc: info.tagline,
        art: <SkinMini id={skinNow.id} colors={skinNow.colors} />,
        action: { label: '색 바꿔 내 테마로', start: { kind: 'skin', id: skinNow.id } as StudioStart },
      };
    }
    if (nowCustom) {
      const sk = nowCustom.spec.skin;
      return {
        name: nowCustom.name,
        kind: sk ? `내 테마 · ${SKINS[sk.id].label} 스타일` : '내 테마',
        desc: sk
          ? SKINS[sk.id].tagline
          : nowCustom.spec.image
            ? nowCustom.spec.image.kind === 'pattern'
              ? '무늬가 깔린 테마'
              : '배경 그림이 있는 테마'
            : '색으로 만든 테마',
        art: sk ? <SkinMini id={sk.id} colors={sk} /> : <MiniTile looks={customOption(nowCustom).looks} mode="both" />,
        action: { label: '고치기', start: { kind: 'edit', theme: nowCustom } as StudioStart },
      };
    }
    const color = (lightRef.startsWith('preset:') ? lightRef.slice(7) : 'default') as ThemeColor;
    const opt = presets.find((o) => o.ref === `preset:${color}`) ?? presets[0];
    return {
      name: opt.label,
      kind: '기본 테마',
      desc: '밝을 때·어두울 때 모두 맞춘 색',
      art: <MiniTile looks={opt.looks} mode="both" />,
      action: { label: '이 테마로 내 테마 만들기', start: { kind: 'preset', color } as StudioStart },
    };
  })();

  return (
    <div className="grid gap-7">
      {!canTheme ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3.5 py-3">
          <p className="min-w-0 flex-1 text-sm">
            테마는 Pro에서 쓸 수 있어요. 네온·글리치 같은 시그니처 테마, 색, 별표 빛, 배경 그림, 글꼴을 내 마음대로 바꿔요.
          </p>
          <LinkButton href="/plan" size="sm" variant="secondary">
            요금제 보기
          </LinkButton>
        </div>
      ) : null}

      {/* 지금 테마 */}
      {now ? (
        <section className="flex items-center gap-4" aria-labelledby="theme-now-title">
          <span
            className="relative block aspect-[3/4] w-[92px] shrink-0 overflow-hidden rounded-[18px] shadow-[0_0_0_1px_var(--line),0_10px_24px_-14px_var(--shadow-strong)]"
            aria-hidden="true"
          >
            {now.art}
          </span>
          <div className="grid min-w-0 gap-1">
            <p className="text-xs font-semibold text-muted">지금 테마</p>
            <h3 id="theme-now-title" className="truncate font-display text-xl leading-tight">
              {now.name}
            </h3>
            <p className="text-xs text-muted">
              {now.kind} · {now.desc}
            </p>
            {mineOn ? (
              <Button size="sm" variant="secondary" className="mt-1 justify-self-start" onClick={() => openStudio(now.action.start)}>
                <Icon d={now.action.start.kind === 'edit' ? ICONS.pen : ICONS.sparkle} size={15} />
                {now.action.label}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <Field label="화면 밝기">
        <div className="grid gap-1.5">
          <div>
            <Segmented<ThemeMode>
              label="화면 밝기"
              value={skinNow ? SKINS[skinNow.id].mode : theme.mode}
              disabled={!canTheme || !!skinNow}
              options={THEME_MODES.map((m) => ({ value: m, label: THEME_MODE_INFO[m].label }))}
              onChange={(m) => (canTheme ? latest.current.onChange({ mode: m }) : toast(PRO_ONLY))}
            />
          </div>
          {skinNow ? (
            <p className="text-xs text-muted">
              {topic(SKINS[skinNow.id].label)} 늘 {SKINS[skinNow.id].mode === 'dark' ? '어두운' : '밝은'} 화면이에요. 다른 테마를 고르면 다시 고를 수 있어요.
            </p>
          ) : null}
        </div>
      </Field>

      {/* 시그니처 테마: 평소에는 접어 두고 작은 그림 여섯 장만, 누르면 펼친다 */}
      <section id="skins" className="grid scroll-mt-24 gap-3" aria-labelledby="theme-skin-title">
        <h3 id="theme-skin-title" className="text-sm font-semibold">
          <button
            type="button"
            aria-expanded={skinsOpen}
            aria-controls="theme-skin-panel"
            onClick={() => setSkinsOpen((v) => !v)}
            className="press flex w-full items-center gap-3 rounded-2xl bg-surface-2 py-2.5 pl-3.5 pr-3 text-left hover:bg-surface-3"
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span>시그니처 테마</span>
              <span className="truncate text-xs font-normal text-muted">
                {skinNow && lightRef.startsWith('skin:') ? `${SKINS[skinNow.id].label} 쓰는 중` : '카드·버튼·글꼴까지 바뀌는 테마'}
              </span>
            </span>
            {!skinsOpen ? <SkinStack /> : null}
            <Icon
              d={ICONS.chevronDown}
              size={18}
              strokeWidth={2.4}
              className={cx('shrink-0 text-muted transition-transform duration-200', skinsOpen && 'rotate-180')}
            />
          </button>
        </h3>
        {skinsOpen ? (
          <div id="theme-skin-panel" className="kok-unfold grid gap-3">
            <p className="text-xs text-muted">색만이 아니라 카드·버튼·글꼴·바탕 그림까지 통째로 바뀌는 테마예요. 밝기는 테마가 정해요.</p>
            <SkinGrid
              selected={!separate && lightRef === darkRef && lightRef.startsWith('skin:') ? (lightRef.slice(5) as SkinId) : null}
              disabled={!canTheme}
              onPick={pickSkin}
            />
            {SKIN_IDS.some((id) => SKINS[id].motion) ? (
              <Toggle
                label="시그니처 테마 움직임"
                hint="네온관 깜빡임·글리치 지직거림·터미널 커서처럼 가끔 살짝 움직여요. 기기에서 ‘동작 줄이기’를 켜면 늘 멈춰요."
                checked={theme.motion !== false}
                disabled={!canTheme}
                onChange={(v) => (canTheme ? latest.current.onChange({ motion: v }) : toast(PRO_ONLY))}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 기본 테마·내 테마 */}
      <section className="grid gap-3" aria-labelledby="theme-pick-title">
        <GroupHead id="theme-pick-title" title="기본 테마·내 테마" value={separate ? `${nameOf(lightRef)} · ${nameOf(darkRef)}` : undefined} />
        {(separate ? MODES : (['both'] as const)).map((m) => (
          <div key={m} className="grid gap-4">
            {m !== 'both' ? <p className="-mb-2 text-xs font-bold text-muted">{MODE_LABEL[m]}</p> : null}
            <OptionGroup
              title="기본 테마"
              label={m === 'both' ? '기본 테마' : `${MODE_LABEL[m]} 기본 테마`}
              options={presets}
              mode={m}
              selected={m === 'dark' ? darkRef : lightRef}
              disabled={!canTheme}
              onPick={(ref) => pick(m, ref)}
            />
            {themesOn ? (
              <OptionGroup
                title={`내 테마 ${customs?.length ?? 0}/${MAX_THEMES}`}
                label={m === 'both' ? '내 테마' : `${MODE_LABEL[m]} 내 테마`}
                options={mine}
                mode={m}
                selected={m === 'dark' ? darkRef : lightRef}
                disabled={!canTheme}
                onPick={(ref) => pick(m, ref)}
                onEdit={mineOn ? editRef(m) : undefined}
                onAdd={mineOn ? addFrom(m) : undefined}
              />
            ) : null}
          </div>
        ))}
        {mineOn && !customs?.length ? (
          <p className="text-xs text-muted">
            +를 눌러 나만의 테마를 만들어 보세요. AI가 만들어 주거나, 시그니처 테마·기본 테마·색 하나에서 시작해 직접 바꿀 수 있어요.
          </p>
        ) : null}
        <Toggle
          label="밝을 때와 어두울 때 테마를 따로 고르기"
          hint={skinNow ? '시그니처 테마는 밝을 때·어두울 때 같이 써요.' : undefined}
          checked={separate}
          onChange={setSeparateMode}
          disabled={!canTheme}
        />
      </section>

      {leftovers ? (
        <section className="grid gap-3" aria-labelledby="theme-mine-title">
          <GroupHead id="theme-mine-title" title="내 테마" value={`${customs?.length ?? 0}/${MAX_THEMES}`} />
          <p className="text-sm text-muted">Pro가 끝나서 테마를 고칠 수는 없어요. 안 쓰는 테마는 지울 수 있어요.</p>
          <ul className="grid gap-2">
            {(customs ?? []).map((t) => (
              <li key={t.id} className="kok-fill flex items-center gap-3 rounded-2xl border border-line p-2.5">
                <ThemeThumb spec={t.spec} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.name}</span>
                  <span className="text-xs text-muted">
                    {t.spec.skin ? `${SKINS[t.spec.skin.id].label} 스타일` : t.spec.image ? (t.spec.image.kind === 'pattern' ? '무늬' : '배경 그림') : '색만'}
                  </span>
                </span>
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => removeTheme(t)}>
                  지우기
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : !themesOn && me.isAdmin ? (
        <p className="text-xs text-muted">Supabase에서 schema.sql을 다시 실행하면 내 테마(AI 테마·배경 그림)를 만들 수 있어요.</p>
      ) : null}

      <GlowSettings glow={glow} looks={glowLooks} disabled={!canTheme} onChange={changeGlow} />

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
        {skinNow ? (
          <p className="text-xs text-muted">
            큰 제목은 {SKINS[skinNow.id].label}에 맞춘 {SKINS[skinNow.id].font} 글꼴이에요. 여기서는 본문 글꼴을 골라요.
          </p>
        ) : null}
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
        {/* 내 테마를 쓰는 중이면 바꾼 글꼴·종이는 그 테마에 저장된다 (changeLook): 다른 테마로 가면 바뀌는 까닭을 미리 알린다 */}
        {themesOn && customIds(theme).length > 0 ? (
          <p className="text-xs text-muted">
            내 테마를 쓰는 동안 바꾼 글꼴·종이는 그 테마에만 저장돼요. 기본 테마로 바꾸면 기본 테마에서 쓰던 글꼴·종이로 돌아와요.
          </p>
        ) : null}
      </Field>
      <p className="text-xs text-muted">테마는 이 계정의 모든 기기에 같이 적용돼요. Pro가 끝나면 기본 모양으로 돌아가고, 고른 테마는 남아 있어요.</p>

      <NewThemeSheet
        open={adding}
        est={est}
        aiEnabled={me.aiEnabled}
        onClose={() => setAdding(false)}
        onAi={() => {
          setAdding(false);
          setMaking(true);
        }}
        onStart={(s) => {
          setAdding(false);
          setStudio(s);
        }}
      />
      <ThemeMaker
        open={making}
        est={est}
        pictures={me.themePictures}
        onClose={() => setMaking(false)}
        onMade={(row, message, notice) => {
          setMaking(false);
          saved(row);
          applyNew(`custom:${row.id}`);
          // 그림 대신 무늬를 넣었다는 등 알아야 할 말이 있으면 늘, 아니면 완료 알림으로
          toast(message, 'ok', notice ? undefined : DONE);
        }}
      />
      {studio ? (
        <ThemeStudio
          key={studio.kind === 'edit' ? studio.theme.id : `${studio.kind}-${JSON.stringify(studio)}`}
          me={me}
          start={studio}
          glow={glow}
          // '그대로'(테마가 정하지 않음) = 내 글꼴·종이
          userFont={baseLook(theme).font}
          userPaper={baseLook(theme).paper}
          motion={theme.motion !== false}
          onClose={() => setStudio(null)}
          onSaved={(row, apply) => {
            // 내 글꼴·종이는 고치기 전 테마로 정한다 (저장한 테마의 새 글꼴을 내 것으로 착각하지 않게)
            const base = baseLook(latest.current.theme);
            saved(row);
            if (!apply) return;
            const ref = `custom:${row.id}`;
            const t = latest.current.theme;
            // 이미 쓰는 테마면 밝을 때·어두울 때 자리는 그대로 (saved 가 새 색을 바로 붙였다). 글꼴·종이를 고쳤으면 바로 그것으로
            if (themeRef(t, 'light') === ref || themeRef(t, 'dark') === ref) {
              const look = settleLook(t, themeRef(t, 'light') === ref ? 'light' : 'dark', base);
              if (look.font !== t.font || look.paper !== t.paper) latest.current.onChange({ ...look, base });
              return;
            }
            // 시그니처 스타일로 만든 테마는 두 모드에 같이. 따로 고르는 중이면 '+'·연필을 누른 쪽에 (모르면 지금 보이는 쪽)
            const skinTheme = !!readSpec(row.spec)?.skin;
            if (skinTheme) {
              setSeparate(false);
              pick('both', ref);
              return;
            }
            pick(latest.current.separate ? (useFor !== 'both' ? useFor : currentMode()) : 'both', ref);
          }}
          onDeleted={(id) => {
            setStudio(null);
            removed(id);
          }}
        />
      ) : null}
    </div>
  );
}

/** 접힌 시그니처 테마 칸의 작은 그림 여섯 장 (겹쳐 놓은 카드처럼). 꾸미는 그림이라 화면 읽기 프로그램은 건너뛴다 */
function SkinStack() {
  return (
    <span className="flex shrink-0 items-center pl-2" aria-hidden="true">
      {SKIN_IDS.map((id) => (
        <span
          key={id}
          className="relative -ml-2 block h-[30px] w-[23px] overflow-hidden rounded-[7px] shadow-[0_0_0_2px_var(--surface-2),0_2px_6px_-2px_var(--shadow-strong)]"
        >
          <SkinMini id={id} colors={skinDefaults(id)} />
        </span>
      ))}
    </span>
  );
}

/** 시그니처 테마 고르는 칸: 그 모양을 줄여 그린 그림 + 이름 + 한 줄 설명 */
function SkinGrid({ selected, disabled, onPick }: { selected: SkinId | null; disabled: boolean; onPick: (id: SkinId) => void }) {
  const index = Math.max(0, selected ? SKIN_IDS.indexOf(selected) : 0);
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3" role="radiogroup" aria-label="시그니처 테마">
      {SKIN_IDS.map((id, i) => {
        const on = selected === id;
        const info = SKINS[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={info.label}
            aria-describedby={`skin-tag-${id}`}
            disabled={disabled}
            tabIndex={i === index ? 0 : -1}
            onKeyDown={(e) => radioKeys(e, i, SKIN_IDS.length, (n) => onPick(SKIN_IDS[n]))}
            onClick={() => onPick(id)}
            className="press group grid min-w-0 gap-1.5 rounded-[20px] text-left disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={cx(
                'relative block aspect-[4/3] w-full overflow-hidden rounded-[18px] transition-shadow duration-200',
                on
                  ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]'
                  : 'shadow-[0_0_0_1px_var(--line)] group-hover:shadow-[0_0_0_1px_var(--line),0_8px_20px_var(--shadow-strong)]',
              )}
            >
              <SkinMini id={id} colors={skinDefaults(id)} />
              {on ? (
                <span className="kok-check-in absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink text-surface" aria-hidden="true">
                  <Icon d={ICONS.check} size={13} strokeWidth={3.2} />
                </span>
              ) : null}
            </span>
            <span className="px-0.5">
              <span className={cx('block truncate text-sm font-bold', on ? 'text-ink' : 'text-ink/90')}>{info.label}</span>
              <span id={`skin-tag-${id}`} className="line-clamp-2 text-[11px] leading-snug text-muted">
                {info.tagline}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 테마 고르는 칸 (기본 테마 또는 내 테마). 같게 쓸 때는 작은 화면을 대각선으로 나눠 밝을 때·어두울 때를 같이 보여 준다. 화살표로도 고른다.
 * 고르기 칸(radiogroup)은 display: contents 라서 칸만 격자에 놓이고, 그 뒤에 '+'(새 테마) 칸이 이어진다.
 * 고른 칸이 내 테마면 그 칸 왼쪽 위에 연필(고치기)을 겹쳐 둔다: 고르기 칸 밖의 버튼이라 격자 칸 자리(grid-area)에 absolute 로 놓는다.
 */
function OptionGroup({
  title,
  label,
  options,
  mode,
  selected,
  disabled,
  onPick,
  onEdit,
  onAdd,
}: {
  title: string;
  label: string;
  options: Option[];
  mode: Mode | 'both';
  selected: string;
  disabled: boolean;
  onPick: (ref: string) => void;
  /** 고른 내 테마 고치기 (없으면 연필이 없다) */
  onEdit?: (ref: string) => void;
  /** 새 테마 만들기 (없으면 '+' 칸이 없다) */
  onAdd?: () => void;
}) {
  const sel = options.findIndex((o) => o.ref === selected);
  const index = Math.max(0, sel);
  const editable = !!onEdit && sel >= 0;
  // 연필 자리: 폰은 4칸, 넓은 화면은 6칸 격자
  const at = { '--c4': (sel % 4) + 1, '--r4': Math.floor(sel / 4) + 1, '--c6': (sel % 6) + 1, '--r6': Math.floor(sel / 6) + 1 } as React.CSSProperties;
  if (!options.length && !onAdd) return null;
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold text-muted">{title}</p>
      <div className="relative grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6">
        <div className="contents" role="radiogroup" aria-label={label}>
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
                  {o.spec?.skin ? <SkinMini id={o.spec.skin.id} colors={o.spec.skin} /> : <MiniTile looks={o.looks} mode={mode} />}
                  {o.image ? (
                    <span className="absolute bottom-1.5 left-1.5 grid h-5 w-5 place-items-center rounded-full bg-surface text-ink shadow" aria-hidden="true">
                      <Icon d={ICONS.image} size={11} strokeWidth={2.4} />
                    </span>
                  ) : null}
                  {on ? (
                    <span
                      className="kok-check-in absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-surface"
                      aria-hidden="true"
                    >
                      <Icon d={ICONS.check} size={12} strokeWidth={3.2} />
                    </span>
                  ) : null}
                </span>
                <span className={cx('w-full truncate text-center', on ? 'text-ink' : 'text-muted group-hover:text-ink')}>{o.label}</span>
              </button>
            );
          })}
        </div>
        {editable ? (
          <button
            key={`edit-${options[sel].ref}`}
            type="button"
            aria-label={`'${options[sel].label}' 테마 고치기`}
            title="테마 고치기"
            onClick={() => onEdit(options[sel].ref)}
            style={at}
            className="press kok-check-in absolute left-1 top-1 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface text-ink shadow-[0_2px_10px_var(--shadow-strong)] ring-1 ring-line [grid-column:var(--c4)] [grid-row:var(--r4)] hover:bg-surface-2 sm:[grid-column:var(--c6)] sm:[grid-row:var(--r6)]"
          >
            <Icon d={ICONS.pen} size={15} strokeWidth={2.2} />
          </button>
        ) : null}
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            aria-label="새 테마 만들기"
            className="press group grid min-w-0 gap-1.5 rounded-[18px] text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="grid aspect-[3/4] w-full place-items-center rounded-[16px] border-2 border-dashed border-line text-muted transition-colors duration-200 group-hover:border-accent group-hover:text-accent">
              <Icon d={ICONS.plus} size={24} strokeWidth={2.2} />
            </span>
            <span className="w-full truncate text-center text-muted group-hover:text-ink">새 테마</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** '+' 칸: 새 테마를 AI로 만들거나, 시그니처 테마·색 하나·기본 테마에서 시작해 직접 만든다 */
function NewThemeSheet({
  open,
  est,
  aiEnabled,
  onClose,
  onAi,
  onStart,
}: {
  open: boolean;
  est: number;
  aiEnabled: boolean;
  onClose: () => void;
  onAi: () => void;
  onStart: (s: StudioStart) => void;
}) {
  const looks = useMemo(() => THEME_COLORS.map((c) => ({ c, looks: { light: presetLookFx(c, 'light'), dark: presetLookFx(c, 'dark') } })), []);
  return (
    <Sheet open={open} onClose={onClose} title="새 테마 만들기">
      <div className="grid gap-6">
        <button
          type="button"
          disabled={!aiEnabled}
          onClick={onAi}
          // 빛나는 카드의 안쪽 빛은 카드 색(--surface) 위 글자에 맞춘 값이라 카드 색 바탕에 둔다
          className="press kok-hero grid gap-1 rounded-[22px] bg-surface p-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex flex-wrap items-center gap-2 font-display text-lg">
            <Icon d={ICONS.sparkle} size={20} className="text-accent" />
            AI로 만들기
            <span className="text-sm font-semibold text-muted">
              <Energy n={est} />
            </span>
          </span>
          <span className="text-sm text-muted">
            {aiEnabled
              ? '‘비 오는 날 카페’처럼 느낌을 적으면 AI가 색과 배경 그림을 골라 줘요.'
              : '지금은 AI 기능을 잠깐 쉬고 있어요. 직접 만들기는 할 수 있어요.'}
          </span>
        </button>
        <StartGroup id="new-theme-skin" title="시그니처 테마에서 시작" hint="모양은 그대로, 두 가지 색만 내 마음대로 바꿔요.">
          <div className="grid grid-cols-3 gap-x-2 gap-y-3">
            {SKIN_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onStart({ kind: 'skin', id })}
                aria-label={`${SKINS[id].label}에서 시작하기`}
                className="press group grid min-w-0 gap-1.5 rounded-[18px] text-xs font-semibold"
              >
                <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-[14px] shadow-[0_0_0_1px_var(--line)] transition-shadow duration-200 group-hover:shadow-[0_0_0_1px_var(--line),0_6px_16px_var(--shadow-strong)]">
                  <SkinMini id={id} colors={skinDefaults(id)} />
                </span>
                <span className="w-full truncate text-center text-muted group-hover:text-ink">{SKINS[id].label}</span>
              </button>
            ))}
          </div>
        </StartGroup>
        <StartGroup id="new-theme-color" title="색 하나로 시작" hint="좋아하는 색을 고르면 밝을 때·어두울 때 색을 모두 맞춰 줘요.">
          <div className="flex flex-wrap gap-2">
            {ACCENT_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`${c} 색으로 시작하기`}
                onClick={() => onStart({ kind: 'color', color: c })}
                className="press h-9 w-9 rounded-full shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]"
                style={{ background: c }}
              />
            ))}
          </div>
        </StartGroup>
        <StartGroup id="new-theme-base" title="기본 테마에서 시작" hint="시작할 테마를 골라요. 색·배경 그림·꾸미기는 다음 화면에서 바꿔요.">
          <div className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5">
            {looks.map(({ c, looks: l }) => (
              <button
                key={c}
                type="button"
                onClick={() => onStart({ kind: 'preset', color: c })}
                aria-label={`${THEME_COLOR_INFO[c].label}에서 시작하기`}
                className="press group grid min-w-0 gap-1.5 rounded-[18px] text-xs font-semibold"
              >
                <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-[16px] shadow-[0_0_0_1px_var(--line)] transition-shadow duration-200 group-hover:shadow-[0_0_0_1px_var(--line),0_6px_16px_var(--shadow-strong)]">
                  <MiniTile looks={l} mode="both" />
                </span>
                <span className="w-full truncate text-center text-muted group-hover:text-ink">{THEME_COLOR_INFO[c].label}</span>
              </button>
            ))}
          </div>
        </StartGroup>
      </div>
    </Sheet>
  );
}

function StartGroup({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-2" aria-labelledby={id}>
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      <p className="-mt-1 text-xs text-muted">{hint}</p>
      {children}
    </section>
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
  /** notice: 꼭 알아야 할 말이 들어 있다 (그림 대신 무늬 등) */
  onMade: (row: ThemeRow, message: string, notice: boolean) => void;
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
      onMade(r.theme, [`'${r.theme.name}' 테마를 만들어 썼어요.`, r.summary, r.note].filter(Boolean).join(' '), !!r.note);
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
