'use client';
// 테마 만들기·고치기 (Pro): 미리보기를 보면서 한 화면에서 고친다.
// - 위 띠: 닫기 · 이름 · 되돌리기/다시 하기 · 저장하고 쓰기 (⋯ 에 지우기)
// - 미리보기: 실제 화면과 같은 CSS 로 그린 홈·노트 화면 (iframe /theme-preview, src/lib/theme-preview.ts).
//   미리보기를 누르면 그 부분을 바꾸는 칸으로 가고, 칸에 손을 올리거나 초점을 두면 미리보기의 그 부분에 테두리와 이름표가 생긴다.
//   '처음 모습'을 누르고 있는 동안은 고치기 전 모습.
// - 칸: 스타일(보통·시그니처 테마 6) / 색 / 배경 / 효과 / 글자. 칸마다 무엇이 어디서 바뀌는지 한 줄로 알려 준다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MeResponse } from '@/lib/types';
import { GLOW_TONES, SKIN_IDS, THEME_FONTS, THEME_PAPERS, type Glow, type ThemeColor, type ThemeFont, type ThemePaper } from '@/lib/settings';
import { THEME_COLOR_INFO, THEME_FONT_INFO, THEME_PAPER_INFO, specLookFx, withGlow } from '@/lib/theme';
import { readFromPreview, type PreviewPart, type PreviewScreen, type PreviewState, type ToPreview } from '@/lib/theme-preview';
import { contrast, fitPalette, mix, type Mode, type Palette } from '@/lib/themes/colors';
import { themeCss, type ModeLook } from '@/lib/themes/css';
import { minDimFor } from '@/lib/themes/backdrop';
import { DEFAULT_FX, isDefaultFx, type ThemeFx } from '@/lib/themes/fx';
import { GLOW_TONE_INFO, glowPair } from '@/lib/themes/glow';
import { CODE_PATTERNS, PATTERN_SIZE, codePatternSvg, svgDataUrl, type CodePattern } from '@/lib/themes/pattern';
import { ACCENT_SWATCHES, BASE_TONES, BASE_TONE_INFO, paletteFromColor, toneOf, type BaseTone } from '@/lib/themes/palette-from';
import { BASE_TOKENS, presetTokens } from '@/lib/themes/presets';
import { SKINS, buildSkin, randomSkinColors, skinDefaults, skinLook, topic, type SkinId } from '@/lib/themes/skins';
import { readSpec, withSkinPalettes, THEME_NAME_MAX, type ThemeImage, type ThemeSpec } from '@/lib/themes/spec';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { shrinkImage } from '@/lib/image';
import { ApiError, Button, DONE, Energy, ICONS, Icon, Menu, Segmented, Sheet, Toggle, api, cx, inputClass, radioKeys, useToast } from '@/components/ui';
import { useConfirm } from '@/components/Confirm';
import { ColorPicker } from '@/components/ColorPicker';
import { AiMark, ReportButton, ReportSheet, type ReportWhat } from '@/components/ReportSheet';
import { josa } from '@/lib/josa';
import { MiniTile, SkinMini, TwoDots } from './minis';
import { onTone } from './GlowSettings';

/** user_themes 행 */
export type ThemeRow = { id: string; name: string; spec: unknown; updated_at?: string | null };
export type Ready = { id: string; name: string; spec: ThemeSpec; updatedAt: string | null };

/** 테마 만들기를 여는 곳: 내 테마 고치기, 또는 기본 테마·시그니처 테마·색 하나에서 시작하는 새 테마 */
export type StudioStart =
  { kind: 'edit'; theme: Ready } | { kind: 'preset'; color: ThemeColor } | { kind: 'skin'; id: SkinId } | { kind: 'color'; color: string };

type TabId = 'style' | 'color' | 'bg' | 'fx' | 'text';
const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'style', label: '스타일', icon: ICONS.layers },
  { id: 'color', label: '색', icon: ICONS.palette },
  { id: 'bg', label: '배경', icon: ICONS.image },
  { id: 'fx', label: '효과', icon: ICONS.sparkle },
  { id: 'text', label: '글자', icon: ICONS.type },
];

const MODES: Mode[] = ['light', 'dark'];
const MODE_LABEL: Record<Mode, string> = { light: '밝을 때', dark: '어두울 때' };
const PALETTE_LABEL: Record<keyof Palette, string> = { bg: '바탕', surface: '카드', accent: '포인트' };
// 덮는 정도 기본값 (서버 DIM_IMAGE·DIM_PATTERN 과 같게). 사진은 무엇이 그려졌는지 몰라서 진하게 덮는다
const DIM_IMAGE = 0.8;
const DIM_PATTERN = 0.3;
const PATTERN_LABEL: Record<CodePattern, string> = { dots: '물방울', grid: '모눈', waves: '물결', diagonal: '빗금', confetti: '색종이', petals: '꽃잎' };
const basePalette = (m: Mode): Palette => ({ bg: BASE_TOKENS[m]['--bg'], surface: BASE_TOKENS[m]['--surface'], accent: BASE_TOKENS[m]['--accent'] });

/** 기본 테마에서 시작하는 새 테마 (색은 그 테마의 바탕·카드·+ 버튼 색, 꾸미기는 기본) */
export function specFromPreset(c: ThemeColor): ThemeSpec {
  const pal = (m: Mode): Palette => {
    const t = presetTokens(c, m);
    return { bg: t['--bg'], surface: t['--surface'], accent: t['--fab'] };
  };
  return { light: pal('light'), dark: pal('dark'), image: null, dim: 0.6, font: null, paper: null, fx: { ...DEFAULT_FX }, skin: null };
}

/** 시그니처 테마에서 시작하는 새 테마 */
function specFromSkin(id: SkinId, base?: ThemeSpec): ThemeSpec {
  const from = base ?? specFromPreset('default');
  return withSkinPalettes({ ...from, skin: { id, ...skinDefaults(id) }, fx: { ...from.fx, floatTab: SKINS[id].fx.floatTab } });
}

function startSpec(s: StudioStart): ThemeSpec {
  if (s.kind === 'edit') return s.theme.spec;
  if (s.kind === 'preset') return specFromPreset(s.color);
  if (s.kind === 'skin') return specFromSkin(s.id);
  const p = paletteFromColor(s.color, 'gray');
  return { ...specFromPreset('default'), light: p.light, dark: p.dark };
}

function startName(s: StudioStart): string {
  if (s.kind === 'edit') return s.theme.name;
  if (s.kind === 'preset') return `내 ${THEME_COLOR_INFO[s.color].label}`;
  if (s.kind === 'skin') return `내 ${SKINS[s.id].label}`;
  return '';
}

export function studioTitle(s: StudioStart): string {
  if (s.kind === 'edit') return '테마 고치기';
  if (s.kind === 'preset') return `새 테마 · ${THEME_COLOR_INFO[s.color].label}에서 시작`;
  if (s.kind === 'skin') return `새 테마 · ${SKINS[s.id].label}`;
  return '새 테마';
}

/** 미리보기에서 누른 곳 → 그 부분을 바꾸는 칸 */
function tabFor(part: PreviewPart, skin: boolean): TabId {
  if (skin) return part === 'page' || part === 'title' ? 'style' : part === 'tabbar' || part === 'star' ? 'fx' : part === 'note' ? 'text' : 'color';
  const map: Record<PreviewPart, TabId> = {
    page: 'bg',
    title: 'text',
    hero: 'fx',
    button: 'color',
    chips: 'fx',
    cards: 'color',
    star: 'fx',
    tabbar: 'fx',
    fab: 'color',
    note: 'text',
  };
  return map[part];
}

type Draft = { name: string; spec: ThemeSpec };
const same = (a: Draft, b: Draft) => a.name === b.name && JSON.stringify(a.spec) === JSON.stringify(b.spec);

function toReady(row: ThemeRow): Ready | null {
  const spec = readSpec(row.spec);
  return spec ? { id: row.id, name: row.name, spec, updatedAt: row.updated_at ?? null } : null;
}

export function ThemeStudio({
  me,
  start,
  glow,
  userFont,
  userPaper,
  motion,
  onClose,
  onSaved,
  onDeleted,
}: {
  me: MeResponse;
  start: StudioStart;
  /** 별표 빛 (설정의 것, 미리보기에 같이) */
  glow: Glow;
  /** 테마가 글꼴·종이를 정하지 않을 때 쓰는 지금 글꼴·종이 */
  userFont: ThemeFont;
  userPaper: ThemePaper;
  motion: boolean;
  onClose: () => void;
  /** 저장했다 (apply: 저장하고 쓰기) */
  onSaved: (row: ThemeRow, apply: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const confirmIt = useConfirm();
  const own = start.kind === 'edit' ? start.theme : null;
  const [id, setId] = useState<string | null>(own?.id ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(own?.updatedAt ?? null);
  const initial = useMemo<Draft>(() => ({ name: startName(start), spec: startSpec(start) }), [start]);
  // 고치기 전 모습 ('처음 모습'·닫을 때 저장 안 한 것이 있는지)
  const [saved, setSaved] = useState<Draft>(initial);
  const [hist, setHist] = useState<{ items: Draft[]; at: number }>({ items: [initial], at: 0 });
  const lastKey = useRef<{ key: string; t: number } | null>(null);
  const draft = hist.items[hist.at];
  const spec = draft.spec;
  const skin = spec.skin ?? null;

  /** 고치기 (같은 칸을 잇달아 바꾸면 되돌리기 한 번에 묶는다: 슬라이더·색 고르기) */
  const update = useCallback((fn: (d: Draft) => Draft, key?: string) => {
    // 묶을지는 바꾸기 전에 정한다 (state 를 바꾸는 함수 안에서는 다른 값을 바꾸지 않는다: 개발 모드는 두 번 부른다)
    const now = Date.now();
    const merge = !!key && lastKey.current?.key === key && now - lastKey.current.t < 800;
    lastKey.current = key ? { key, t: now } : null;
    setHist((h) => {
      const cur = h.items[h.at];
      const next = fn(cur);
      if (same(cur, next)) return h;
      const items = h.items.slice(0, h.at + 1);
      if (merge && h.at > 0) items[items.length - 1] = next;
      else items.push(next);
      const trimmed = items.slice(-60);
      return { items: trimmed, at: trimmed.length - 1 };
    });
  }, []);
  const setSpec = useCallback((fn: (s: ThemeSpec) => ThemeSpec, key?: string) => update((d) => ({ ...d, spec: fn(d.spec) }), key), [update]);
  const canUndo = hist.at > 0;
  const canRedo = hist.at < hist.items.length - 1;
  const undo = () => canUndo && setHist((h) => ({ ...h, at: h.at - 1 }));
  const redo = () => canRedo && setHist((h) => ({ ...h, at: h.at + 1 }));

  const [tab, setTab] = useState<TabId>(start.kind === 'skin' ? 'color' : start.kind === 'edit' ? 'style' : 'color');
  const [screen, setScreen] = useState<PreviewScreen>('home');
  const [previewMode, setPreviewMode] = useState<Mode>(() =>
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [comparing, setComparing] = useState(false);
  const [hover, setHover] = useState<PreviewPart | null>(null);
  const [flash, setFlash] = useState<PreviewPart | null>(null);
  const [focusPart, setFocusPart] = useState<{ part: PreviewPart; n: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [report, setReport] = useState<ReportWhat | null>(null);
  const [big, setBig] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const dirty = !same(draft, saved);
  const title = id && start.kind !== 'edit' ? '테마 고치기' : studioTitle(start);

  // 미리보기에 보낼 모습 (처음 모습을 누르고 있으면 고치기 전 것)
  const shown = comparing ? saved.spec : spec;
  const preview = useMemo(() => {
    if (shown.skin) {
      const mode = SKINS[shown.skin.id].mode;
      const look = withGlow(skinLook(shown.skin.id, shown.skin, shown.fx.floatTab), glow, mode);
      return { css: themeCss(look, look), mode, skin: shown.skin.id, bg: false };
    }
    const light = withGlow(specLookFx(shown, 'light'), glow, 'light');
    const dark = withGlow(specLookFx(shown, 'dark'), glow, 'dark');
    return { css: themeCss(light, dark), mode: previewMode, skin: null, bg: !!shown.image };
  }, [shown, glow, previewMode]);
  const highlight = flash ?? hover;
  const state: PreviewState = {
    css: preview.css,
    mode: preview.mode,
    font: shown.font ?? userFont,
    paper: shown.paper ?? userPaper,
    skin: preview.skin,
    motion,
    bg: preview.bg,
    screen,
    highlight,
  };

  // 화면 뒤(설정 화면)는 스크롤하지 않게
  useEffect(() => {
    const d = document.documentElement;
    const prev = d.style.overflow;
    d.style.overflow = 'hidden';
    rootRef.current?.focus();
    return () => {
      d.style.overflow = prev;
    };
  }, []);

  const requestClose = () => {
    if (busy) return;
    if (dirty) setAsk(true);
    else onClose();
  };
  const closeRef = useRef(requestClose);
  useEffect(() => {
    closeRef.current = requestClose;
  });
  const undoRef = useRef({ undo, redo });
  useEffect(() => {
    undoRef.current = { undo, redo };
  });
  // 키: Esc 닫기, ⌘Z·Ctrl+Z 되돌리기, ⇧⌘Z·Ctrl+Y 다시 하기 (글을 쓰는 칸에서는 그 칸의 되돌리기)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'file'].includes((t as HTMLInputElement).type)));
      if (e.key === 'Escape') {
        // 열린 시트(닫을지 묻기)는 시트가 닫는다
        if (document.querySelector('[data-studio-ask]')) return;
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (typing || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        undoRef.current.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 미리보기에서 누른 곳 → 그 칸으로 가서 그 부분을 잠깐 강조하고, 그 칸의 첫 컨트롤에 초점
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPick = useCallback(
    (part: PreviewPart) => {
      setTab(tabFor(part, !!skin));
      setFlash(part);
      setFocusPart((f) => ({ part, n: (f?.n ?? 0) + 1 }));
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 1600);
    },
    [skin],
  );
  useEffect(() => () => (flashTimer.current ? clearTimeout(flashTimer.current) : undefined), []);
  useEffect(() => {
    if (!focusPart) return;
    const el = panelRef.current?.querySelector<HTMLElement>(`[data-part-control~='${focusPart.part}']`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.remove('kok-picked');
    // 같은 곳을 다시 눌러도 깜빡이게
    void el.offsetWidth;
    el.classList.add('kok-picked');
    // 초점도 그 칸으로 (미리보기 iframe 에 남으면 키보드·Esc 가 이 화면에 오지 않는다). 글 칸은 폰 자판이 뜨지 않게 건너뛴다
    el.querySelector<HTMLElement>(
      "[role='radio'][tabindex='0'], input[type='checkbox'], input[type='range'], input[type='color'], button:not([disabled])",
    )?.focus({
      preventScroll: true,
    });
  }, [focusPart, tab]);

  /** 칸에 손을 올리거나 초점을 두면 미리보기의 그 부분을 강조 */
  const hoverProps = (part: PreviewPart) => ({
    'data-part-control': part,
    onPointerEnter: () => setHover(part),
    onPointerLeave: () => setHover((h) => (h === part ? null : h)),
    onFocus: () => setHover(part),
    onBlur: () => setHover((h) => (h === part ? null : h)),
  });

  /** 저장 (새 테마면 만든다). 저장한 행 */
  const save = async (): Promise<ThemeRow | null> => {
    const label = draft.name.trim() || '내 테마';
    const body = withSkinPalettes(draft.spec);
    try {
      const r = id
        ? await api<{ theme: ThemeRow }>(`/api/themes/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: label, spec: body, ...(updatedAt ? { updatedAt } : {}) }),
          })
        : await api<{ theme: ThemeRow }>('/api/themes', { method: 'POST', body: JSON.stringify({ name: label, spec: body }) });
      const ready = toReady(r.theme);
      setId(r.theme.id);
      setUpdatedAt(r.theme.updated_at ?? null);
      if (ready) {
        const next = { name: ready.name, spec: ready.spec };
        setSaved(next);
        // 저장한 그대로를 지금 모습으로 (서버가 맞춘 색 등). 되돌리기 기록은 남긴다
        update(() => next);
      }
      return r.theme;
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'theme_changed' ? '다른 곳에서 이 테마가 바뀌었어요. 닫고 다시 열어 주세요.' : (e as Error).message, 'bad');
      return null;
    }
  };

  const saveAndUse = async () => {
    setBusy('저장하는 중…');
    const row = await save();
    setBusy(null);
    if (!row) return;
    onSaved(row, true);
    toast('테마를 저장하고 썼어요.', 'ok', DONE);
    onClose();
  };

  const remove = async () => {
    if (!id) return;
    const name = draft.name.trim() ? `'${draft.name.trim()}'` : '이 테마';
    if (!(await confirmIt({ title: '테마 지우기', body: `${josa(name, '을')} 지울까요?`, note: '되돌릴 수 없어요.', ok: '지우기', danger: true }))) return;
    try {
      await api(`/api/themes/${id}`, { method: 'DELETE' });
      toast('테마를 지웠어요.', 'plain', DONE);
      onDeleted(id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  // ---------------------------------------------------------------- 배경 그림 (올리기·AI 그리기)
  const [kind, setKind] = useState<'none' | 'file' | 'ai' | 'pattern'>(() => (!spec.image ? 'none' : spec.image.kind === 'pattern' ? 'pattern' : 'file'));
  const [aiText, setAiText] = useState('');
  const aiEst = Math.round(estimateSmallTask(clientModel(me, 'fast'), me.usdPerEnergy, 500, 150) * 10) / 10;
  const canRedraw = spec.image?.kind === 'file' && spec.image.ai === true;
  // 그림을 바꾸면 덮는 정도는 그 그림의 처음 값부터 (직접 고른 값은 지운다)
  const setImage = (image: ThemeImage | null, dim?: number) =>
    setSpec((s) => ({ ...s, image, dim: dim ?? s.dim, dimExact: dim === undefined ? s.dimExact : undefined }));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('사진을 올리는 중…');
    try {
      const blob = await shrinkImage(file, 1600, 0.85);
      const res = await fetch('/api/themes/images', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
      const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok || !body?.id) throw new Error(body?.message ?? '사진을 올리지 못했어요.');
      const imgId = body.id;
      setSpec((s) => ({ ...s, image: { kind: 'file', id: imgId }, dim: Math.max(s.dim, DIM_IMAGE), dimExact: undefined }));
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
      const ready = toReady(r.theme);
      if (ready) {
        const next = { name: ready.name, spec: ready.spec };
        setSaved(next);
        update(() => next);
        setUpdatedAt(ready.updatedAt);
        setKind(ready.spec.image?.kind === 'pattern' ? 'pattern' : 'file');
      }
      onSaved(r.theme, false);
      toast(r.note ?? '그림을 그렸어요.', r.note ? 'bad' : 'ok', r.note ? undefined : DONE);
    } catch (e) {
      toast((e as Error).message, 'bad');
      if (e instanceof ApiError && e.code === 'need_prompt') setKind('ai');
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- 그리기
  const looks = useMemo(() => ({ light: specLookFx(spec, 'light'), dark: specLookFx(spec, 'dark') }), [spec]);
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="kok-studio fixed inset-0 z-[70] flex flex-col bg-bg text-ink outline-none"
    >
      {/* 위 띠 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 pb-2 pt-[calc(8px+env(safe-area-inset-top))] md:px-4">
        <button
          type="button"
          onClick={requestClose}
          aria-label="닫기"
          title="닫기"
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-surface-2"
        >
          <Icon d={ICONS.close} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-muted">{title}</p>
          <input
            id="theme-name"
            className="w-full min-w-0 truncate rounded-lg bg-transparent px-0 py-0.5 text-[17px] font-bold text-ink placeholder:text-muted/80 focus:bg-surface-2 focus:px-1.5 focus:outline-none"
            value={draft.name}
            maxLength={THEME_NAME_MAX}
            placeholder="내 테마"
            aria-label="테마 이름"
            onChange={(e) => {
              const v = e.target.value;
              update((d) => ({ ...d, name: v }), 'name');
            }}
          />
        </div>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          aria-label="되돌리기"
          title="되돌리기 (⌘Z)"
          className="press grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-35"
        >
          <Icon d={ICONS.undo} size={20} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo}
          aria-label="다시 하기"
          title="다시 하기 (⇧⌘Z)"
          className="press grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-surface-2 disabled:opacity-35"
        >
          <Icon d={ICONS.redo} size={20} />
        </button>
        {id ? <Menu label="테마 메뉴" items={[{ label: '지우기', icon: ICONS.trash, danger: true, onSelect: remove }]} /> : null}
        <Button size="sm" className="ml-0.5" busy={busy === '저장하는 중…'} disabled={!!busy && busy !== '저장하는 중…'} onClick={saveAndUse}>
          저장하고 쓰기
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(340px,460px)_minmax(0,1fr)] md:grid-rows-1">
        {/* 미리보기 */}
        <section
          aria-label="미리보기"
          className={cx(
            'flex min-h-0 flex-col gap-2 border-b border-line bg-surface-2/60 px-3 pb-2 pt-2.5 transition-[height] duration-300 md:h-auto md:border-b-0 md:border-r md:px-6 md:pb-6 md:pt-5',
            big ? 'h-[76dvh]' : 'h-[44dvh] min-h-[260px]',
          )}
        >
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Segmented<PreviewScreen>
              label="미리볼 화면"
              value={screen}
              options={[
                { value: 'home', label: '홈' },
                { value: 'note', label: '노트' },
              ]}
              onChange={setScreen}
            />
            {skin ? (
              <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-muted">
                늘 {SKINS[skin.id].mode === 'dark' ? '어두운' : '밝은'} 화면
              </span>
            ) : (
              <Segmented<Mode>
                label="미리볼 밝기"
                value={previewMode}
                options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
                onChange={setPreviewMode}
              />
            )}
          </div>
          <PreviewFrame state={state} onPick={onPick} />
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              disabled={!dirty}
              aria-pressed={comparing}
              className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-ink disabled:opacity-40"
              onPointerDown={() => setComparing(true)}
              onPointerUp={() => setComparing(false)}
              onPointerLeave={() => setComparing(false)}
              onPointerCancel={() => setComparing(false)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setComparing(true);
                }
              }}
              onKeyUp={() => setComparing(false)}
              onBlur={() => setComparing(false)}
            >
              <Icon d={ICONS.eye} size={15} />
              누르고 있으면 처음 모습
            </button>
            <button
              type="button"
              className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-ink md:hidden"
              aria-pressed={big}
              onClick={() => setBig((v) => !v)}
            >
              <Icon d={ICONS.expand} size={14} />
              {big ? '작게 보기' : '크게 보기'}
            </button>
          </div>
        </section>

        {/* 칸 */}
        <div className="flex min-h-0 flex-col">
          <div role="tablist" aria-label="테마 만들기 칸" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 md:px-5">
            {TABS.map((t, i) => {
              const on = tab === t.id;
              const off = t.id === 'bg' && !!skin;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`studio-tab-${t.id}`}
                  aria-selected={on}
                  aria-controls="studio-panel"
                  tabIndex={on ? 0 : -1}
                  onKeyDown={(e) => radioKeys(e as unknown as React.KeyboardEvent<HTMLElement>, i, TABS.length, (n) => setTab(TABS[n].id))}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    'press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors',
                    on ? 'bg-ink text-surface' : 'text-muted hover:bg-surface-2 hover:text-ink',
                    off && !on && 'opacity-60',
                  )}
                >
                  <Icon d={t.icon} size={16} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div
            ref={panelRef}
            id="studio-panel"
            role="tabpanel"
            aria-labelledby={`studio-tab-${tab}`}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(32px+env(safe-area-inset-bottom))] pt-4 md:px-8"
          >
            <p className="mb-4 flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
              <Icon d={ICONS.phone} size={15} className="shrink-0" />
              미리보기를 누르면 그 부분을 바꾸는 칸으로 와요. 아래 칸을 고르거나 손을 올리면 미리보기에서 어디가 바뀌는지 보여 줘요.
            </p>
            {tab === 'style' ? <StylePanel spec={spec} setSpec={setSpec} hoverProps={hoverProps} /> : null}
            {tab === 'color' ? <ColorPanel spec={spec} setSpec={setSpec} hoverProps={hoverProps} looks={looks} /> : null}
            {tab === 'bg' ? (
              skin ? (
                <SkinNote skinId={skin.id} what="바탕 그림" onNormal={() => setSpec((s) => ({ ...s, skin: null }))} />
              ) : (
                <BgPanel
                  me={me}
                  spec={spec}
                  looks={looks}
                  kind={kind}
                  setKind={setKind}
                  busy={busy}
                  aiText={aiText}
                  setAiText={setAiText}
                  aiEst={aiEst}
                  canRedraw={canRedraw}
                  upload={upload}
                  drawAi={drawAi}
                  setImage={setImage}
                  setSpec={setSpec}
                  hoverProps={hoverProps}
                  onReport={(id) => setReport({ kind: 'theme', target: id })}
                />
              )
            ) : null}
            {tab === 'fx' ? <FxPanel spec={spec} looks={looks} setSpec={setSpec} hoverProps={hoverProps} /> : null}
            {tab === 'text' ? <TextPanel spec={spec} setSpec={setSpec} hoverProps={hoverProps} userFont={userFont} userPaper={userPaper} /> : null}
          </div>
        </div>
      </div>

      {/* AI 그림 신고: 이 창 안에 둬야 창(z 70) 위에 뜬다. data-studio-ask 가 있으면 창의 Esc 는 시트에 맡긴다 */}
      {report ? (
        <div data-studio-ask="">
          <ReportSheet what={report} onClose={() => setReport(null)} />
        </div>
      ) : null}

      <Sheet open={ask} onClose={() => setAsk(false)} title="저장하지 않고 닫을까요?">
        <div className="grid gap-3 pb-1" data-studio-ask="">
          <p className="text-sm text-muted">바꾼 것을 저장하지 않았어요. 닫으면 바꾼 것이 사라져요.</p>
          <Button
            onClick={async () => {
              setAsk(false);
              await saveAndUse();
            }}
          >
            저장하고 쓰기
          </Button>
          <Button variant="secondary" onClick={onClose}>
            저장하지 않고 닫기
          </Button>
          <Button variant="ghost" onClick={() => setAsk(false)}>
            계속 고치기
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

type HoverProps = (part: PreviewPart) => Record<string, unknown>;
type SetSpec = (fn: (s: ThemeSpec) => ThemeSpec, key?: string) => void;

/** 미리보기 (iframe). 폰 화면 크기(390×800)로 그리고 칸에 맞게 줄인다 */
function PreviewFrame({ state, onPick }: { state: PreviewState; onPick: (part: PreviewPart) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.45);
  const W = 390;
  const H = 800;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = readFromPreview(e, frame.current);
      if (!m) return;
      if (m.kind === 'kok-preview-ready') setReady(true);
      else onPick(m.part);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onPick]);
  const key = JSON.stringify(state);
  useEffect(() => {
    if (!ready) return;
    const msg: ToPreview = { kind: 'kok-preview', state: JSON.parse(key) as PreviewState };
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, [ready, key]);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setScale(Math.max(0.2, Math.min(width / W, height / H, 1)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={wrap} className="relative grid min-h-0 flex-1 place-items-center">
      <div
        className="relative overflow-hidden rounded-[26px] bg-surface shadow-[0_0_0_1px_var(--line),0_18px_40px_-18px_var(--shadow-strong)]"
        style={{ width: W * scale, height: H * scale }}
      >
        <iframe
          ref={frame}
          src="/theme-preview"
          title="테마 미리보기 (누르면 그 부분을 바꾸는 곳으로 가요)"
          tabIndex={-1}
          className="absolute left-0 top-0 border-0"
          style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0', opacity: ready ? 1 : 0, transition: 'opacity 200ms ease' }}
        />
        {!ready ? (
          <div className="kok-skel absolute inset-0 grid content-start gap-3 p-[8%]" aria-hidden="true">
            <span className="kok-bone mt-[20%] h-[4%] w-1/2" />
            <span className="kok-bone h-[24%] w-full rounded-[14px]" />
            <span className="kok-bone h-[12%] w-full rounded-[14px]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 칸 묶음 제목 + 한 줄 설명 */
function Block({ title, hint, children, hover }: { title: string; hint?: ReactNode; children: ReactNode; hover?: Record<string, unknown> }) {
  return (
    <section className="kok-studio-block mb-6 grid gap-2.5 rounded-2xl" {...(hover ?? {})}>
      <div className="grid gap-0.5">
        <h3 className="text-[15px] font-bold">{title}</h3>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** 시그니처 테마에서는 쓰지 않는 칸 */
function SkinNote({ skinId, what, onNormal }: { skinId: SkinId; what: string; onNormal: () => void }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-2xl bg-surface-2 p-4">
      <p className="text-sm">
        {topic(SKINS[skinId].label)} {what}이 정해져 있어요.
      </p>
      <p className="text-xs text-muted">스타일을 &lsquo;보통&rsquo;으로 바꾸면 사진·AI 그림·무늬를 넣을 수 있어요.</p>
      <Button size="sm" variant="secondary" onClick={onNormal}>
        보통 스타일로 바꾸기
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ 스타일
function StylePanel({ spec, setSpec, hoverProps }: { spec: ThemeSpec; setSpec: SetSpec; hoverProps: HoverProps }) {
  const options: Array<'normal' | SkinId> = ['normal', ...SKIN_IDS];
  const cur = spec.skin?.id ?? 'normal';
  const index = Math.max(0, options.indexOf(cur));
  const choose = (o: 'normal' | SkinId) =>
    setSpec((s) => {
      if (o === 'normal') return { ...s, skin: null };
      if (s.skin?.id === o) return s;
      return specFromSkin(o, s);
    });
  const looks = useMemo(() => ({ light: specLookFx({ ...spec, skin: null }, 'light'), dark: specLookFx({ ...spec, skin: null }, 'dark') }), [spec]);
  return (
    <Block
      title="스타일"
      hint="보통은 색·배경 그림·빛을 마음대로 바꾸고, 시그니처 테마는 카드·버튼·글꼴·바탕 그림까지 통째로 바뀌어요 (색만 바꿀 수 있어요)."
      hover={hoverProps('page')}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="테마 스타일">
        {options.map((o, i) => {
          const on = o === cur;
          const label = o === 'normal' ? '보통' : SKINS[o].label;
          const tagline = o === 'normal' ? '색·배경 그림·빛을 마음대로' : SKINS[o].tagline;
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={label}
              tabIndex={i === index ? 0 : -1}
              onKeyDown={(e) => radioKeys(e, i, options.length, (n) => choose(options[n]))}
              onClick={() => choose(o)}
              className="press group grid min-w-0 gap-1.5 rounded-[20px] text-left"
            >
              <span
                className={cx(
                  'relative block aspect-[4/3] w-full overflow-hidden rounded-[18px] transition-shadow duration-200',
                  on
                    ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]'
                    : 'shadow-[0_0_0_1px_var(--line)] group-hover:shadow-[0_0_0_1px_var(--line),0_6px_16px_var(--shadow-strong)]',
                )}
              >
                {o === 'normal' ? <MiniTile looks={looks} mode="both" /> : <SkinMini id={o} colors={spec.skin?.id === o ? spec.skin : skinDefaults(o)} />}
                {on ? (
                  <span className="kok-check-in absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink text-surface" aria-hidden="true">
                    <Icon d={ICONS.check} size={13} strokeWidth={3.2} />
                  </span>
                ) : null}
              </span>
              <span className="px-0.5">
                <span className={cx('block truncate text-sm font-bold', on ? 'text-ink' : 'text-ink/90')}>{label}</span>
                <span className="line-clamp-2 text-[11px] leading-snug text-muted">{tagline}</span>
              </span>
            </button>
          );
        })}
      </div>
      {spec.skin ? (
        <p className="rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
          {SKINS[spec.skin.id].label} · 늘 {SKINS[spec.skin.id].mode === 'dark' ? '어두운' : '밝은'} 화면 · 제목 글꼴 {SKINS[spec.skin.id].font}
          {SKINS[spec.skin.id].motion ? ' · 가끔 살짝 움직여요' : ''}
        </p>
      ) : null}
    </Block>
  );
}

// ------------------------------------------------------------------ 색
function ColorPanel({ spec, setSpec, hoverProps, looks }: { spec: ThemeSpec; setSpec: SetSpec; hoverProps: HoverProps; looks: Record<Mode, ModeLook> }) {
  // 펼친 색 고르기 칸: 'accent' 또는 '모드-칸' ('light-bg' …)
  const [picking, setPicking] = useState<string | null>(null);
  if (spec.skin) return <SkinColors spec={spec} setSpec={setSpec} hoverProps={hoverProps} />;
  const closePick = () => {
    const id = picking ? `pick-${picking}` : null;
    setPicking(null);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };
  const accent = spec.light.accent;
  const tone = toneOf(spec);
  const setAccent = (c: string, key?: string) =>
    setSpec((s) => {
      const t = toneOf(s);
      if (t) {
        const p = paletteFromColor(c, t);
        return { ...s, light: p.light, dark: p.dark };
      }
      return {
        ...s,
        light: fitPalette({ ...s.light, accent: c }, 'light', basePalette('light')),
        dark: fitPalette({ ...s.dark, accent: c }, 'dark', basePalette('dark')),
      };
    }, key);
  const setTone = (t: BaseTone) =>
    setSpec((s) => {
      const p = paletteFromColor(s.light.accent, t);
      return { ...s, light: p.light, dark: p.dark };
    });
  const setColor = (m: Mode, k: keyof Palette, v: string) => setSpec((s) => ({ ...s, [m]: fitPalette({ ...s[m], [k]: v }, m, basePalette(m)) }), `${m}-${k}`);
  const swatchIndex = Math.max(0, ACCENT_SWATCHES.indexOf(accent as (typeof ACCENT_SWATCHES)[number]));
  const toneIndex = Math.max(0, tone ? BASE_TONES.indexOf(tone) : 0);
  return (
    <>
      <Block
        title="포인트 색"
        hint="버튼·+ 버튼·고른 칩·포인트 글자의 색이에요. 글자가 잘 보이게 조금 진하게·밝게 맞출 수 있어요."
        hover={hoverProps('button')}
      >
        <Surprise
          onClick={() => {
            // 지금 색이 아닌 것 중에서 아무거나, 바탕 느낌도 아무거나
            const others = ACCENT_SWATCHES.filter((c) => c !== accent);
            const c = others[Math.floor(Math.random() * others.length)];
            const p = paletteFromColor(c, BASE_TONES[Math.floor(Math.random() * BASE_TONES.length)]);
            setSpec((x) => ({ ...x, light: p.light, dark: p.dark }));
          }}
        />
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="포인트 색">
          {ACCENT_SWATCHES.map((c, i) => {
            const on = c === accent;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`포인트 색 ${c}`}
                tabIndex={i === swatchIndex ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, ACCENT_SWATCHES.length, (n) => setAccent(ACCENT_SWATCHES[n]))}
                onClick={() => setAccent(c)}
                className={cx(
                  'press grid h-9 w-9 place-items-center rounded-full transition-shadow',
                  on ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]' : 'shadow-[0_0_0_1px_var(--line)]',
                )}
                style={{ background: c }}
              >
                {on ? (
                  <Icon d={ICONS.check} size={15} strokeWidth={3} className={contrast('#ffffff', c) >= contrast('#111111', c) ? 'text-white' : 'text-black'} />
                ) : null}
              </button>
            );
          })}
          <button
            id="pick-accent"
            type="button"
            aria-expanded={picking === 'accent'}
            aria-label="포인트 색 직접 고르기"
            title="직접 고르기"
            onClick={() => setPicking(picking === 'accent' ? null : 'accent')}
            className={cx(
              'press relative grid h-9 w-9 place-items-center overflow-hidden rounded-full transition-shadow',
              picking === 'accent' ? 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]' : 'shadow-[0_0_0_1px_var(--line)]',
            )}
          >
            <span
              className="absolute inset-0"
              style={{ background: 'conic-gradient(#f53071, #ffb300, #34c759, #32ade6, #635aea, #a85be1, #f53071)' }}
              aria-hidden="true"
            />
            <span className="relative grid h-5 w-5 place-items-center rounded-full bg-surface text-ink" aria-hidden="true">
              <Icon d={ICONS.plus} size={12} strokeWidth={3} />
            </span>
          </button>
        </div>
        {picking === 'accent' ? <ColorPicker label="포인트 색" value={accent} onChange={(hex) => setAccent(hex, 'accent')} onClose={closePick} /> : null}
      </Block>
      <Block title="바탕 느낌" hint="화면 바탕과 카드 색이에요. 밝을 때·어두울 때 모두 같이 바뀌어요." hover={hoverProps('cards')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="바탕 느낌">
          {BASE_TONES.map((t, i) => {
            const on = t === tone;
            const p = paletteFromColor(accent, t);
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === toneIndex ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, BASE_TONES.length, (n) => setTone(BASE_TONES[n]))}
                onClick={() => setTone(t)}
                className={cx('press grid gap-1.5 rounded-2xl border-2 p-2 text-left', on ? 'border-ink bg-surface' : 'border-line hover:bg-surface-2')}
              >
                <span className="grid h-9 grid-cols-2 overflow-hidden rounded-xl ring-1 ring-line" aria-hidden="true">
                  {MODES.map((m) => (
                    <span key={m} className="grid place-items-center" style={{ background: p[m].bg }}>
                      <span className="h-4 w-6 rounded-md" style={{ background: p[m].surface, boxShadow: `inset 0 -3px 0 ${p[m].accent}` }} />
                    </span>
                  ))}
                </span>
                <span className="text-xs font-bold">{BASE_TONE_INFO[t].label}</span>
              </button>
            );
          })}
        </div>
        {!tone ? <p className="text-xs text-muted">지금은 아래에서 직접 고른 색이에요.</p> : null}
      </Block>
      <details className="kok-studio-block mb-6 rounded-2xl border border-line p-3" {...hoverProps('cards')}>
        <summary className="cursor-pointer text-sm font-bold">색 하나하나 고르기</summary>
        <div className="mt-3 grid gap-4">
          {MODES.map((m) => (
            <div key={m} className="grid gap-1.5">
              <p className="flex items-center justify-between text-xs font-bold text-muted">
                <span>{MODE_LABEL[m]} 색</span>
                <Readability look={looks[m]} />
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['bg', '바탕'],
                    ['surface', '카드'],
                    ['accent', '포인트'],
                  ] as Array<[keyof Palette, string]>
                ).map(([k, label]) => {
                  const on = picking === `${m}-${k}`;
                  return (
                    <button
                      key={k}
                      id={`pick-${m}-${k}`}
                      type="button"
                      aria-expanded={on}
                      aria-label={`${MODE_LABEL[m]} ${label} 색 ${spec[m][k]}`}
                      onClick={() => setPicking(on ? null : `${m}-${k}`)}
                      className="press grid gap-1 text-left text-xs font-semibold text-muted"
                    >
                      <span
                        className={cx(
                          'block h-10 w-full rounded-xl border border-line transition-shadow',
                          on && 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]',
                        )}
                        style={{ background: spec[m][k] }}
                        aria-hidden="true"
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
              {picking?.startsWith(`${m}-`)
                ? (() => {
                    const k = picking.slice(m.length + 1) as keyof Palette;
                    return (
                      <ColorPicker
                        key={picking}
                        className="mt-1"
                        label={`${MODE_LABEL[m]} ${PALETTE_LABEL[k]} 색`}
                        value={spec[m][k]}
                        onChange={(hex) => setColor(m, k, hex)}
                        onClose={closePick}
                      />
                    );
                  })()
                : null}
            </div>
          ))}
          <p className="text-xs text-muted">밝을 때는 밝은 바탕, 어두울 때는 어두운 바탕으로만 고를 수 있어요. 글자가 잘 보이게 색을 조금 바꿀 수 있어요.</p>
        </div>
      </details>
    </>
  );
}

/** 아무거나: 어울리는 색을 골라 준다 (마음에 안 들면 되돌리기) */
function Surprise({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press inline-flex items-center gap-1.5 justify-self-start rounded-full bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent"
    >
      <Icon d={ICONS.sparkle} size={14} />
      어울리는 색 아무거나
    </button>
  );
}

/** 글자가 잘 보이는지 한눈에: 본문·포인트 글자의 명암비 */
function Readability({ look }: { look: ModeLook }) {
  const t = look.tokens;
  const body = contrast(t['--ink'], t['--bg']);
  const point = contrast(t['--accent'], t['--surface']);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-bold text-ok">
      <Icon d={ICONS.check} size={11} strokeWidth={3} />
      글자 잘 보여요 · 본문 {body.toFixed(1)} · 포인트 {point.toFixed(1)}
    </span>
  );
}

/** 시그니처 테마의 색: 색 짝 넷 + 두 색 직접 고르기 */
function SkinColors({ spec, setSpec, hoverProps }: { spec: ThemeSpec; setSpec: SetSpec; hoverProps: HoverProps }) {
  const s = spec.skin!;
  const info = SKINS[s.id];
  const built = buildSkin(s.id, s);
  const vIndex = info.variants.findIndex((v) => v.a === s.a && v.b === s.b);
  const setColors = (a: string, b: string, key?: string) => setSpec((x) => withSkinPalettes({ ...x, skin: { id: s.id, a, b } }), key);
  // 고른 색과 실제로 쓰는 색이 많이 다르면 알려 준다 (글자가 읽히게 밝기를 맞춘 것)
  const far = (x: string, y: string) => contrast(x, y) > 1.25;
  const adjusted = far(s.a, built.vars['--skin-a']) || far(s.b, built.vars['--skin-b']);
  // 펼친 색 고르기 칸 (첫째·둘째 색)
  const [picking, setPicking] = useState<0 | 1 | null>(null);
  const closePick = () => {
    const k = picking;
    setPicking(null);
    if (k !== null) requestAnimationFrame(() => document.getElementById(`pick-skin-${k}`)?.focus());
  };
  return (
    <>
      <Block title={`${info.label} 색 짝`} hint="시그니처 테마의 모양은 그대로 두고 두 가지 색만 바꿔요." hover={hoverProps('hero')}>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="색 짝">
          {info.variants.map((v, i) => {
            const on = i === vIndex;
            return (
              <button
                key={v.label}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === Math.max(0, vIndex) ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, info.variants.length, (n) => setColors(info.variants[n].a, info.variants[n].b))}
                onClick={() => setColors(v.a, v.b)}
                className={cx(
                  'press flex items-center gap-2.5 rounded-2xl border-2 px-3 py-2.5 text-left',
                  on ? 'border-ink bg-surface' : 'border-line hover:bg-surface-2',
                )}
              >
                <TwoDots a={v.a} b={v.b} />
                <span className="min-w-0 truncate text-sm font-semibold">{v.label}</span>
              </button>
            );
          })}
        </div>
      </Block>
      <Block title="직접 고르기" hint="두 색이 어디에 쓰이는지 보고 골라 보세요." hover={hoverProps('button')}>
        <Surprise
          onClick={() => {
            const c = randomSkinColors(s.id);
            setColors(c.a, c.b);
          }}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {([0, 1] as const).map((k) => {
            const c = info.colors[k];
            const value = k === 0 ? s.a : s.b;
            const on = picking === k;
            return (
              <button
                key={k}
                id={`pick-skin-${k}`}
                type="button"
                aria-expanded={on}
                onClick={() => setPicking(on ? null : k)}
                className={cx(
                  'press flex items-center gap-3 rounded-2xl border-2 p-2.5 text-left',
                  on ? 'border-ink bg-surface' : 'border-line hover:bg-surface-2',
                )}
                {...hoverProps(k === 0 ? 'button' : 'chips')}
              >
                <span className="h-11 w-11 shrink-0 rounded-xl ring-1 ring-line" style={{ background: value }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{c.name}</span>
                  <span className="block text-xs text-muted">{c.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {picking !== null ? (
          <ColorPicker
            key={picking}
            label={info.colors[picking].name}
            value={picking === 0 ? s.a : s.b}
            onChange={(hex) => (picking === 0 ? setColors(hex, s.b, 'skin-a') : setColors(s.a, hex, 'skin-b'))}
            onClose={closePick}
          />
        ) : null}
        {adjusted ? <p className="text-xs text-muted">글자가 잘 보이게 고른 색의 밝기를 조금 맞췄어요.</p> : null}
      </Block>
    </>
  );
}

// ------------------------------------------------------------------ 배경
function BgPanel({
  me,
  spec,
  looks,
  kind,
  setKind,
  busy,
  aiText,
  setAiText,
  aiEst,
  canRedraw,
  upload,
  drawAi,
  setImage,
  setSpec,
  hoverProps,
  onReport,
}: {
  me: MeResponse;
  spec: ThemeSpec;
  looks: Record<Mode, ModeLook>;
  kind: 'none' | 'file' | 'ai' | 'pattern';
  setKind: (k: 'none' | 'file' | 'ai' | 'pattern') => void;
  busy: string | null;
  aiText: string;
  setAiText: (v: string) => void;
  aiEst: number;
  canRedraw: boolean;
  upload: (f: File | undefined) => void;
  drawAi: () => void;
  setImage: (img: ThemeImage | null, dim?: number) => void;
  setSpec: SetSpec;
  hoverProps: HoverProps;
  /** AI 가 그린 그림 신고 (theme_images 번호) */
  onReport: (imageId: string) => void;
}) {
  const kinds: Array<{ value: 'none' | 'file' | 'ai' | 'pattern'; label: string }> = [
    { value: 'none', label: '없음' },
    { value: 'file', label: '사진' },
    ...(me.themePictures ? [{ value: 'ai' as const, label: 'AI 그림' }] : []),
    { value: 'pattern', label: '무늬' },
  ];
  const realDims = MODES.map((m) => looks[m].dim);
  const raised = !!spec.image && realDims.some((d) => d > spec.dim + 0.005);
  const readDims = MODES.map((m) => looks[m].readDim ?? looks[m].dim);
  const belowModes = spec.image ? MODES.filter((m, i) => readDims[i] > looks[m].dim + 0.005) : [];
  return (
    <>
      <Block title="배경 그림" hint="화면 맨 뒤에 깔리는 그림이에요. 글자가 잘 보이게 그 위를 바탕색으로 덮어요." hover={hoverProps('page')}>
        <Segmented<'none' | 'file' | 'ai' | 'pattern'>
          label="배경 그림"
          value={kind}
          options={kinds}
          onChange={(k) => {
            setKind(k);
            if (k === 'none') setImage(null);
          }}
        />
        {/* AI 가 그린 그림이면 알리고 신고할 수 있게 (인공지능기본법·Google Play AI 생성 콘텐츠 정책) */}
        {spec.image?.kind === 'file' && spec.image.ai ? (
          <div className="flex items-center justify-between gap-2">
            <AiMark label="AI가 그린 그림이에요" className="pl-1" />
            <ReportButton onClick={() => spec.image?.kind === 'file' && onReport(spec.image.id)} />
          </div>
        ) : null}
        {kind === 'file' ? (
          <label className="press grid cursor-pointer justify-items-center gap-1.5 rounded-2xl border-2 border-dashed border-line px-4 py-6 text-center hover:border-accent">
            <Icon d={ICONS.upload} size={24} className="text-muted" />
            <span className="text-sm font-semibold">사진 고르기</span>
            <span className="text-xs text-muted">고르면 줄여서 올려요 (3MB 안)</span>
            <input
              type="file"
              className="sr-only"
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
      </Block>
      {spec.image ? (
        <Block title="그림 흐리게" hint="그림 위를 바탕색으로 덮는 정도예요. 높을수록 글자가 잘 보여요." hover={hoverProps('page')}>
          <label className="grid gap-1 text-sm">
            <span className="flex justify-between text-muted">
              <span>그림 위를 덮는 정도 (글자가 잘 보이게)</span>
              <span className="tabular-nums">{Math.round(spec.dim * 100)}%</span>
            </span>
            <input
              type="range"
              min={Math.round(minDimFor(spec.image) * 100)}
              max={92}
              step={1}
              value={Math.round(spec.dim * 100)}
              aria-label="그림 위를 덮는 정도"
              className="w-full accent-[var(--accent)]"
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setSpec((s) => ({ ...s, dim: v, dimExact: true }), 'dim');
              }}
            />
            {belowModes.length ? (
              <span className="text-xs text-muted">
                글자가 잘 보이는 정도({belowModes.map((m) => `${MODE_LABEL[m]} ${Math.round(readDims[MODES.indexOf(m)] * 100)}%`).join(', ')})보다 낮아요.
                {spec.fx.textHalo ? ' 그림 위 글자 둘레에 바탕색을 둘러 읽기 쉽게 해요.' : ' 글자가 그림에 묻히면 아래 스위치를 켜 보세요.'}
              </span>
            ) : raised ? (
              <span className="text-xs text-muted">
                글자가 잘 보이게 {MODES.map((m, i) => `${MODE_LABEL[m]} ${Math.round(realDims[i] * 100)}%`).join(', ')}로 덮어요.
              </span>
            ) : null}
          </label>
          {belowModes.length ? (
            <Toggle
              label="글자 뒤에 바탕색 번짐"
              hint="그림 위에 바로 놓인 큰 제목·설명 글자 둘레에 바탕색을 둘러요. 기본은 없음이에요."
              checked={spec.fx.textHalo}
              onChange={(v) => setSpec((s) => ({ ...s, fx: { ...s.fx, textHalo: v } }))}
            />
          ) : null}
        </Block>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ 효과
/** 화면 꾸미기 스위치 (12살도 알아듣게: 무엇이 어디서 바뀌는지) + 미리보기에서 강조할 곳 */
const FX_SWITCHES: Array<{ key: 'top' | 'hero' | 'buttons' | 'bottom' | 'details' | 'floatTab'; label: string; hint: string; part: PreviewPart }> = [
  { key: 'top', label: '화면 위에 은은한 빛', hint: '큰 제목 뒤가 테마 색으로 은은하게 빛나요.', part: 'title' },
  { key: 'hero', label: '중요한 카드가 빛나요', hint: '오늘의 KOK·복습 시작 카드에 빛 테두리가 생겨요.', part: 'hero' },
  { key: 'buttons', label: '버튼을 두 가지 색으로', hint: '시작 버튼·고른 칩·+ 버튼이 두 색으로 섞여요.', part: 'button' },
  { key: 'bottom', label: '화면 아래에도 은은한 빛', hint: '아래 메뉴 쪽에서도 빛이 올라와요.', part: 'tabbar' },
  { key: 'details', label: '작은 카드에도 반짝이는 포인트', hint: '에너지 막대·공부한 날·바로 가기에 작은 빛이 생겨요.', part: 'cards' },
  { key: 'floatTab', label: '아래 메뉴를 띄우기', hint: '폰에서 아래 메뉴가 화면 끝에서 살짝 떠 있어요.', part: 'tabbar' },
];

/** rgba(…, a) 의 a */
const alphaOf = (v: string | undefined) => Number(/,\s*([\d.]+)\)$/.exec(v ?? '')?.[1] ?? 0);

function FxPanel({ spec, looks, setSpec, hoverProps }: { spec: ThemeSpec; looks: Record<Mode, ModeLook>; setSpec: SetSpec; hoverProps: HoverProps }) {
  const fx = spec.fx;
  const set = (patch: Partial<ThemeFx>, key?: string) => setSpec((s) => ({ ...s, fx: { ...s.fx, ...patch } }), key);
  if (spec.skin) {
    const info = SKINS[spec.skin.id];
    return (
      <>
        <Block title="아래 메뉴" hint="폰에서 보이는 아래 메뉴의 모양이에요." hover={hoverProps('tabbar')}>
          <Toggle
            label="아래 메뉴를 띄우기"
            hint="폰에서 아래 메뉴가 화면 끝에서 살짝 떠 있어요."
            checked={fx.floatTab}
            onChange={(v) => set({ floatTab: v })}
          />
        </Block>
        <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
          {info.label}의 빛과 그림자는 테마가 정해요.
          {info.motion ? ' 움직임은 설정의 ‘시그니처 테마 움직임’에서 끌 수 있어요.' : ''} 별표 빛은 설정의 ‘별표 빛’에서 모든 테마에 같이 바꿔요.
        </p>
      </>
    );
  }
  const index = Math.max(0, GLOW_TONES.indexOf(fx.aura));
  const see = fx.tabSeeThrough;
  // 화면 위 빛을 켰는데 글자 때문에 거의 안 보이게 줄인 모드
  const faint = fx.top || fx.bottom ? MODES.filter((m) => Math.max(alphaOf(looks[m].fx?.['--aura-1']), alphaOf(looks[m].fx?.['--aura-3'])) < 0.03) : [];
  return (
    <>
      <Block title="꾸미기" hint="별표 빛처럼 화면 곳곳에 은은한 빛을 넣어요. 스위치에 손을 올리면 미리보기에서 어디인지 보여요.">
        <div className="grid gap-1.5">
          {FX_SWITCHES.map((sw) => (
            <div key={sw.key} className="kok-studio-row rounded-xl px-1" {...hoverProps(sw.part)}>
              <Toggle label={sw.label} hint={sw.hint} checked={fx[sw.key]} onChange={(v) => set({ [sw.key]: v })} />
            </div>
          ))}
        </div>
        {faint.length ? (
          <p className="rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
            {faint.map((m) => MODE_LABEL[m]).join('·')}는 바탕{spec.image ? '·배경 그림' : ''} 때문에 글자가 잘 보이게 화면 빛을 아주 옅게 했어요.
          </p>
        ) : null}
        {!isDefaultFx(fx) ? (
          <button
            type="button"
            className="press justify-self-start rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
            onClick={() => setSpec((s) => ({ ...s, fx: { ...DEFAULT_FX, textHalo: s.fx.textHalo } }))}
          >
            처음대로
          </button>
        ) : null}
      </Block>
      <Block title="아래 메뉴가 비치는 정도" hint="아래 메뉴 뒤로 화면이 얼마나 비칠지예요." hover={hoverProps('tabbar')}>
        <label className="grid gap-1.5">
          <span className="flex items-baseline justify-end text-xs font-semibold tabular-nums text-muted">{see === 0 ? '안 비침' : `${see}%`}</span>
          <input
            type="range"
            min={0}
            max={60}
            step={4}
            value={see}
            aria-label="아래 메뉴가 비치는 정도"
            aria-valuetext={see === 0 ? '안 비침' : `${see}퍼센트 비침`}
            className="w-full accent-[var(--accent)]"
            onChange={(e) => set({ tabSeeThrough: Number(e.target.value) }, 'see')}
          />
          <span className="flex justify-between text-xs text-muted" aria-hidden="true">
            <span>안 비침</span>
            <span>유리처럼</span>
          </span>
          {see > 30 ? <span className="text-xs text-muted">유리처럼 할수록 뒤 화면이 비쳐서 메뉴 글자가 조금 흐려 보일 수 있어요.</span> : null}
        </label>
      </Block>
      <Block title="빛 색" hint="화면 빛·빛나는 카드·두 색 버튼의 둘째 색이에요." hover={hoverProps('hero')}>
        <div className="grid grid-cols-6 gap-1" role="radiogroup" aria-label="꾸미기 빛 색">
          {GLOW_TONES.map((tone, i) => {
            const on = fx.aura === tone;
            const [c1, c2] = glowPair(tone, looks.light.tokens);
            return (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === index ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, GLOW_TONES.length, (n) => set({ aura: GLOW_TONES[n] }))}
                onClick={() => set({ aura: tone })}
                className="press group grid min-w-0 justify-items-center gap-1.5 rounded-2xl py-1 text-[11px] font-semibold"
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
      </Block>
    </>
  );
}

// ------------------------------------------------------------------ 글자
function TextPanel({
  spec,
  setSpec,
  hoverProps,
  userFont,
  userPaper,
}: {
  spec: ThemeSpec;
  setSpec: SetSpec;
  hoverProps: HoverProps;
  userFont: ThemeFont;
  userPaper: ThemePaper;
}) {
  const fonts: Array<ThemeFont | null> = [null, ...THEME_FONTS];
  const papers: Array<ThemePaper | null> = [null, ...THEME_PAPERS];
  const fIndex = Math.max(0, fonts.indexOf(spec.font));
  const pIndex = Math.max(0, papers.indexOf(spec.paper));
  return (
    <>
      <Block
        title="이 테마의 글꼴"
        hint={
          spec.skin
            ? `큰 제목은 ${SKINS[spec.skin.id].font} 글꼴로 정해져 있어요. 여기서는 본문 글꼴을 골라요.`
            : '이 테마를 고르면 글꼴도 같이 바뀌어요. ‘그대로’면 지금 쓰는 글꼴을 써요.'
        }
        hover={hoverProps('title')}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="이 테마의 글꼴">
          {fonts.map((f, i) => {
            const on = spec.font === f;
            const family = THEME_FONT_INFO[f ?? userFont].family;
            return (
              <button
                key={f ?? 'keep'}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === fIndex ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, fonts.length, (n) => setSpec((s) => ({ ...s, font: fonts[n] })))}
                onClick={() => setSpec((s) => ({ ...s, font: f }))}
                className={cx(
                  'press grid gap-0.5 rounded-2xl border-2 px-3 py-2.5 text-left',
                  on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2',
                )}
              >
                <span className="text-lg leading-snug" style={{ fontFamily: family }}>
                  가나다 공부
                </span>
                <span className={cx('text-xs font-semibold', on ? 'text-accent' : 'text-muted')}>
                  {f ? THEME_FONT_INFO[f].label : `그대로 (${THEME_FONT_INFO[userFont].label})`}
                </span>
              </button>
            );
          })}
        </div>
      </Block>
      <Block title="이 테마의 노트 종이" hint="정리 노트 카드 바탕의 무늬예요." hover={hoverProps('note')}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="이 테마의 노트 종이">
          {papers.map((p, i) => {
            const on = spec.paper === p;
            const shownPaper = p ?? userPaper;
            return (
              <button
                key={p ?? 'keep'}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={i === pIndex ? 0 : -1}
                onKeyDown={(e) => radioKeys(e, i, papers.length, (n) => setSpec((s) => ({ ...s, paper: papers[n] })))}
                onClick={() => setSpec((s) => ({ ...s, paper: p }))}
                className={cx('press grid gap-1.5 rounded-2xl p-1.5 text-xs font-semibold', on ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2')}
              >
                <span
                  className={cx(
                    'block h-12 rounded-xl bg-surface ring-1 ring-line',
                    shownPaper !== 'none' && `kok-paper-${shownPaper}`,
                    on && 'ring-2 ring-accent',
                  )}
                  aria-hidden="true"
                />
                {p ? THEME_PAPER_INFO[p].label : '그대로'}
              </button>
            );
          })}
        </div>
      </Block>
    </>
  );
}
