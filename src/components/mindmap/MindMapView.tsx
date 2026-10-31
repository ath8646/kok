'use client';
// 마인드맵 보기: 폰은 '카드'(한눈 지도 + 가지 카드), 넓은 화면은 '지도'(큰 마인드맵)로 시작하고 언제든 바꿀 수 있다.
// 가지를 누르면 가지 자세히 (노트 설명·기억 상태·이 개념 문제 풀기·이전·다음 가지).
// 고치기·가리기 모드는 큰 지도에서 한다. 노트의 '한눈에 보기'(compact)는 한눈 지도만 보여 준다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mindmap, Note } from '@/lib/ai/schemas';
import type { UserSettings } from '@/lib/settings';
import { branchColor, branchOfKeyPoint, branchOfNode, branchesOf, type Branch } from '@/lib/mindmap-branches';
import type { MemoryInfo } from '@/lib/memory';
import { MindMap, type RecallResult } from '@/components/MindMap';
import { prefersReducedMotion } from '@/components/useReducedMotion';
import { BranchCards } from './BranchCards';
import { BranchSheet } from './BranchSheet';
import { MindAtlas } from './MindAtlas';
import { ONE_RING_MAX } from '@/lib/mindmap-atlas';
import { radioKeys, cx } from '@/components/ui';

/** 가지가 많을 때 거르기: 전체·헷갈려요·복습할 때 */
type Filter = 'all' | 'weak' | 'due';
const FILTER_LABEL: Record<Filter, string> = { all: '전체', weak: '헷갈려요', due: '복습할 때' };

export type MindMapMode = 'cards' | 'map';
type Mode = MindMapMode;
const MODE_KEY = 'kok.mindmap.mode';

/** 처음 보기: 고른 적이 있으면 그것, 아니면 폰은 카드·넓은 화면은 지도 */
export function initialMindMapMode(): Mode {
  if (typeof window === 'undefined') return 'cards';
  try {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === 'cards' || saved === 'map') return saved;
  } catch {
    /* 저장소를 못 쓰는 브라우저 */
  }
  return window.matchMedia?.('(min-width: 768px)').matches ? 'map' : 'cards';
}

/** 고른 보기를 이 기기에 기억한다 */
export function rememberMindMapMode(m: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, m);
  } catch {
    /* 저장소를 못 쓰는 브라우저 */
  }
}

export function MindMapView({
  mode,
  spec,
  settings,
  subjectColor,
  noteId,
  note,
  memory,
  editable,
  hideMode,
  highlightKeyPoint,
  onChange,
  onRecallDone,
  compact = false,
  onOpen,
  onShowInNote,
}: {
  /** 카드(한눈 지도 + 가지 카드) 또는 지도(큰 마인드맵). 고치기·가리기 중에는 늘 지도 */
  mode: Mode;
  spec: Mindmap;
  settings: UserSettings['visual'];
  subjectColor: string;
  noteId: string;
  note: Note | null;
  memory?: Map<string, MemoryInfo>;
  editable: boolean;
  hideMode: boolean;
  highlightKeyPoint?: string | null;
  onChange: (next: Mindmap) => void;
  onRecallDone: (results: RecallResult[]) => void;
  compact?: boolean;
  onOpen?: () => void;
  /** 정리 탭에서 이 개념 보기 */
  onShowInNote?: (keyPointId: string) => void;
}) {
  const { rootLabel, branches } = useMemo(() => branchesOf(spec), [spec]);
  const colorOf = useCallback((b: Branch) => branchColor(b.index, settings.color, subjectColor), [settings.color, subjectColor]);
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // 다른 화면(오답노트의 '마인드맵에서 보기' 등)이나 정리 탭에서 고른 개념이 걸린 가지: 한눈 지도와 카드에 테두리로 표시한다
  const hlBranch = useMemo(() => branchOfKeyPoint(branches, highlightKeyPoint), [branches, highlightKeyPoint]);
  const branch = open ? (branches.find((b) => b.id === open) ?? null) : null;
  const practiceHref = (b: Branch | null) => {
    if (!b?.keyPointId) return null;
    const m = memory?.get(b.keyPointId);
    return m && m.total > 0 ? `/review?kp=${encodeURIComponent(`${noteId}:${b.keyPointId}`)}` : null;
  };

  // 한눈 지도에서 가지를 누르면 그 카드로 내려가 잠깐 빛난다
  const goToCard = (id: string) => {
    const el = document.getElementById(`branch-${id}`);
    if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    setFlash(null);
    requestAnimationFrame(() => setFlash(id));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1300);
  };

  // 고치기·가리기는 큰 지도에서
  const view: Mode = editable || hideMode ? 'map' : mode;

  // 가지가 많으면(9개부터) 헷갈리는 가지·복습할 때인 가지만 골라 볼 수 있다 (한눈 지도와 가지 카드 모두)
  const [filter, setFilter] = useState<Filter>('all');
  const statusOf = (b: Branch) => (b.keyPointId ? memory?.get(b.keyPointId)?.status : undefined);
  const counts: Record<Filter, number> = {
    all: branches.length,
    weak: branches.filter((b) => statusOf(b) === 'weak').length,
    due: branches.filter((b) => statusOf(b) === 'due').length,
  };
  const filters = (['all', 'weak', 'due'] as const).filter((f) => f === 'all' || counts[f] > 0);
  const canFilter = branches.length > ONE_RING_MAX && filters.length > 1;
  // 고른 거르기의 가지가 없어지면(복습해서 나아짐) 전체로
  const on: Filter = canFilter && counts[filter] > 0 ? filter : 'all';
  const shown = on === 'all' ? branches : branches.filter((b) => statusOf(b) === on);

  if (compact) {
    return (
      <div className="kok-card overflow-hidden p-2">
        <MindAtlas
          rootLabel={rootLabel}
          branches={branches}
          colorOf={colorOf}
          memory={memory}
          icons={settings.icons}
          step={settings.reveal === 'step'}
          active={hlBranch}
          onPick={() => onOpen?.()}
          onRoot={onOpen}
          limit={12}
        />
      </div>
    );
  }

  const sheet = (
    <BranchSheet
      branch={branch}
      branches={branches}
      color={branch ? colorOf(branch) : 'var(--accent)'}
      note={note}
      memory={branch?.keyPointId ? memory?.get(branch.keyPointId) : undefined}
      practiceHref={practiceHref(branch)}
      onShowInNote={
        onShowInNote
          ? (kp) => {
              setOpen(null);
              onShowInNote(kp);
            }
          : undefined
      }
      onMove={setOpen}
      onClose={() => setOpen(null)}
    />
  );

  const legend = memory?.size ? (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="기억 상태 표시">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-bad" aria-hidden="true" />
        헷갈려요
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
        복습할 때
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />잘 기억해요
      </span>
    </span>
  ) : null;

  return (
    <div className="grid gap-3">
      {view === 'cards' ? (
        <div key="cards" className="kok-appear grid gap-3">
          {canFilter ? (
            <div role="radiogroup" aria-label="가지 거르기" className="flex flex-wrap gap-1.5">
              {filters.map((f, i) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on === f}
                  tabIndex={on === f ? 0 : -1}
                  onClick={() => setFilter(f)}
                  onKeyDown={(e) => radioKeys(e, i, filters.length, (n) => setFilter(filters[n]))}
                  className={cx(
                    'kok-chip press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold',
                    on === f ? 'kok-chip-on bg-accent text-accent-ink' : 'kok-chip-off bg-surface-2 text-ink',
                  )}
                >
                  {f !== 'all' ? <span className={cx('h-2 w-2 rounded-full', f === 'weak' ? 'bg-bad' : 'bg-warn')} aria-hidden="true" /> : null}
                  {FILTER_LABEL[f]} {counts[f]}
                </button>
              ))}
            </div>
          ) : null}
          <div className="kok-card kok-canvas overflow-hidden px-2 pb-3 pt-2">
            <MindAtlas
              rootLabel={rootLabel}
              branches={shown}
              colorOf={colorOf}
              memory={memory}
              icons={settings.icons}
              step={settings.reveal === 'step'}
              active={flash ?? hlBranch}
              onPick={goToCard}
            />
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2">
              <span className="text-xs text-muted">가지를 누르면 그 카드로 가요</span>
              {legend}
            </div>
          </div>
          <BranchCards branches={shown} colorOf={colorOf} memory={memory} icons={settings.icons} flash={flash} highlight={hlBranch} onOpen={setOpen} />
        </div>
      ) : (
        <div key="map" className="kok-appear">
          <MindMap
            spec={spec}
            settings={settings}
            subjectColor={subjectColor}
            editable={editable}
            hideMode={hideMode}
            highlightKeyPoint={highlightKeyPoint}
            onChange={onChange}
            onRecallDone={onRecallDone}
            memory={memory}
            onPick={(id) => {
              const b = branchOfNode(spec, id);
              if (b) setOpen(b);
            }}
          />
          {!editable && !hideMode ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="text-xs text-muted">가지를 누르면 노트 설명과 그 개념 문제를 볼 수 있어요.</span>
              {legend}
            </div>
          ) : null}
        </div>
      )}
      {sheet}
    </div>
  );
}
