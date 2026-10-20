'use client';
// 그림 탭: 마인드맵·표·연표 보기, 고치기, 가리기 모드, 다시 그리기(미리보기 → 적용)
import { useMemo, useState } from 'react';
import type { Mindmap, Note, TableSpec, TimelineSpec } from '@/lib/ai/schemas';
import type { MemoryInfo } from '@/lib/memory';
import type { MeResponse } from '@/lib/types';
import type { UserSettings } from '@/lib/settings';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { MindMap, type RecallResult } from '../MindMap';
import { MindMapView, initialMindMapMode, rememberMindMapMode, type MindMapMode } from '../mindmap/MindMapView';
import { TableView, TimelineView } from '../VisualViews';
import { ApiError, Button, Chip, Energy, ICONS, Icon, Segmented, Sheet, api, cx, useToast, DONE } from '../ui';

export type Visuals = { mindmap?: Mindmap; table?: TableSpec; timeline?: TimelineSpec };
export type VisualType = 'mindmap' | 'table' | 'timeline';
export type NoteView = { type?: VisualType; layout?: 'radial' | 'right' | 'down' };

type Preview = {
  recommended: VisualType;
  mindmap: Mindmap;
  table: TableSpec | null;
  timeline: TimelineSpec | null;
  want?: 'table' | 'timeline';
  /** 미리보기를 만든 노트 버전 (적용할 때 그사이 바뀌었는지 서버가 본다) */
  version?: number | null;
};

const TYPE_LABEL: Record<VisualType, string> = { mindmap: '마인드맵', table: '표', timeline: '연표' };

export function pickType(visuals: Visuals, settings: UserSettings['visual'], subjectId: string, recommended?: string, view?: NoteView): VisualType {
  const has = (t: VisualType) => !!visuals[t];
  if (view?.type && has(view.type)) return view.type;
  const bySubject = settings.bySubject[subjectId];
  if (bySubject && has(bySubject)) return bySubject;
  if (settings.defaultType !== 'auto' && has(settings.defaultType)) return settings.defaultType;
  if (recommended && has(recommended as VisualType)) return recommended as VisualType;
  return 'mindmap';
}

export function VisualPanel({
  me,
  noteId,
  subjectId,
  subjectColor,
  visuals,
  recommended,
  view,
  highlightKeyPoint,
  onSaved,
  onViewChange,
  onReport,
  onOpen,
  saveSpec,
  aiLocked,
  editLocked,
  compact = false,
  note = null,
  memory,
  onShowInNote,
}: {
  me: MeResponse;
  noteId: string;
  subjectId: string;
  subjectColor: string;
  visuals: Visuals;
  recommended?: string;
  view?: NoteView;
  highlightKeyPoint?: string | null;
  onSaved: () => void;
  onViewChange?: (v: NoteView) => void;
  onReport?: () => void;
  /** 한눈에 보기에서 누르면 그림 탭으로 */
  onOpen?: () => void;
  /**
   * 고친 그림 저장을 바꾼다 (지난 버전 보기: 그 버전에 저장). 없으면 지금 노트의 그림에 저장.
   * 'stale': 그사이 버전이 바뀌어 저장하지 않았다 (알리고 새로 읽는 것은 부른 쪽이 한다)
   */
  saveSpec?: (t: VisualType, spec: Mindmap | TableSpec | TimelineSpec) => Promise<boolean | 'stale'>;
  /** AI 로 다시 그리기를 막을 때 그 까닭 (지난 버전 보기, 자료를 더하는 중) */
  aiLocked?: string;
  /** 고치기를 막을 때 그 까닭 (자료를 더하는 중) */
  editLocked?: string;
  compact?: boolean;
  /** 가지 자세히에 보일 노트 (개념 설명·예·헷갈리는 점) */
  note?: Note | null;
  /** 개념 번호 → 기억 상태 (가지 색 점, 이 개념 문제 풀기) */
  memory?: Map<string, MemoryInfo>;
  /** 가지 자세히의 '정리에서 보기' */
  onShowInNote?: (keyPointId: string) => void;
}) {
  const toast = useToast();
  const settings = me.settings.visual;
  const [type, setType] = useState<VisualType>(() => pickType(visuals, settings, subjectId, recommended, view));
  const [hide, setHide] = useState(settings.hideMode === 'on' && !compact);
  const [editOn, setEdit] = useState(false);
  const edit = editOn && !editLocked;
  const [local, setLocal] = useState<Visuals>(visuals);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // 마인드맵 보기: 카드(폰 기본) 또는 지도(넓은 화면 기본). 이 기기에 기억한다
  const [mmMode, setMmMode] = useState<MindMapMode>(initialMindMapMode);

  const [prevVisuals, setPrevVisuals] = useState(visuals);
  if (prevVisuals !== visuals) {
    setPrevVisuals(visuals);
    setLocal(visuals);
  }

  const layout = view?.layout ?? settings.layout;
  const mmSettings = useMemo(() => ({ ...settings, layout }), [settings, layout]);
  const est = estimateSmallTask(clientModel(me, me.settings.models.visual), me.usdPerEnergy, 4500, 2500);

  const save = async (t: VisualType, spec: Mindmap | TableSpec | TimelineSpec) => {
    setLocal((v) => ({ ...v, [t]: spec }));
    setSaving('saving');
    const ok = saveSpec ? await saveSpec(t, spec) : !(await sb().from('visuals').update({ spec }).eq('note_id', noteId).eq('type', t)).error;
    if (ok === 'stale') setSaving('idle');
    else if (!ok) {
      setSaving('idle');
      toast('저장하지 못했어요.', 'bad');
    } else setSaving('saved');
  };

  const regenerate = async (want?: 'table' | 'timeline') => {
    setBusy(want ? `${TYPE_LABEL[want]} 만드는 중…` : '다시 그리는 중…');
    try {
      const r = await api<{ preview: Preview; version?: number | null }>(`/api/notes/${noteId}/visual`, {
        method: 'POST',
        body: JSON.stringify({ action: 'preview', want }),
      });
      if (want && !r.preview[want]) {
        toast(`이 노트로는 ${TYPE_LABEL[want]}를 만들기 어려워요.`);
        return;
      }
      setPreview({ ...r.preview, want, version: r.version ?? null });
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy('적용하는 중…');
    try {
      const version = preview.version ?? undefined;
      const body = preview.want
        ? { action: 'apply', version, [preview.want]: preview[preview.want] }
        : { action: 'apply', version, mindmap: preview.mindmap, table: preview.table, timeline: preview.timeline, recommended: preview.recommended };
      await api(`/api/notes/${noteId}/visual`, { method: 'POST', body: JSON.stringify(body) });
      if (preview.want) {
        setType(preview.want);
        onViewChange?.({ ...view, type: preview.want });
      }
      setPreview(null);
      toast('새 그림으로 바꿨어요.', 'ok', DONE);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
      // 그사이 노트가 다른 버전으로 바뀌었다: 미리보기를 닫고 새 버전을 불러온다
      if (e instanceof ApiError && e.code === 'stale_version') {
        setPreview(null);
        onSaved();
      }
    } finally {
      setBusy(null);
    }
  };

  const onRecall = async (results: RecallResult[]) => {
    const confused = [...new Set(results.filter((r) => !r.ok && r.keyPointId).map((r) => r.keyPointId))];
    if (!confused.length) {
      toast(`${results.length}개 모두 기억났어요!`, 'ok');
      return;
    }
    const { data: qs } = await sb().from('questions').select('id').eq('note_id', noteId).in('key_point_id', confused).eq('status', 'active');
    const ids = (qs ?? []).map((q) => q.id as string);
    if (ids.length) await sb().from('cards').update({ due: new Date().toISOString() }).in('question_id', ids);
    toast(`헷갈린 개념 ${confused.length}개의 문제 ${ids.length}개를 오늘 복습에 넣었어요.`, 'ok', DONE);
  };

  const types = (['mindmap', 'table', 'timeline'] as VisualType[]).filter((t) => !!local[t]);
  const current = local[type] ? type : 'mindmap';

  return (
    <div className="grid gap-3">
      {!compact ? (
        <div className="grid gap-2.5">
          <div className="flex items-center gap-2">
            {types.length > 1 ? (
              <Segmented
                label="그림 종류"
                value={current}
                onChange={(t) => {
                  setType(t);
                  onViewChange?.({ ...view, type: t });
                }}
                options={types.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
              />
            ) : (
              <span className="font-display text-lg">{TYPE_LABEL[current]}</span>
            )}
            <Chip>AI</Chip>
            <span className="flex-1" />
            {saving === 'saving' ? (
              <span className="text-xs text-muted">저장 중…</span>
            ) : saving === 'saved' ? (
              <span className="text-xs text-ok">저장됨</span>
            ) : null}
            <button
              type="button"
              className="press grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink hover:bg-surface-2 disabled:opacity-40"
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
              aria-label="그림 더보기"
              title="그림 더보기"
              disabled={!!busy}
            >
              <Icon d={ICONS.more} size={22} strokeWidth={2.6} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {current === 'mindmap' && !hide && !edit ? (
              <Segmented
                label="마인드맵 보기"
                value={mmMode}
                onChange={(m) => {
                  setMmMode(m);
                  rememberMindMapMode(m);
                }}
                options={[
                  { value: 'cards' as MindMapMode, label: '카드' },
                  { value: 'map' as MindMapMode, label: '지도' },
                ]}
              />
            ) : null}
            <button
              type="button"
              aria-pressed={hide}
              onClick={() => {
                setHide((h) => !h);
                setEdit(false);
              }}
              className={cx(
                'press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset',
                hide ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink ring-line hover:ring-accent',
              )}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.4 10.4 0 0 1 12 4c5 0 9 5 10 8a13 13 0 0 1-2.4 3.6M6.1 6.1A13 13 0 0 0 2 12c1 3 5 8 10 8a10 10 0 0 0 4-.8" />
              </svg>
              {hide ? '가리기 끝' : '가리기'}
            </button>
            <button
              type="button"
              aria-pressed={edit}
              disabled={!!editLocked}
              title={editLocked}
              onClick={() => {
                setEdit((x) => !x);
                setHide(false);
              }}
              className={cx(
                'press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset disabled:opacity-40',
                edit ? 'bg-ink text-surface ring-ink' : 'bg-surface text-ink ring-line hover:ring-accent',
              )}
            >
              <Icon d={ICONS.edit} size={16} strokeWidth={2} />
              {edit ? '고치기 끝' : '고치기'}
            </button>
          </div>
        </div>
      ) : null}

      <Sheet open={more} onClose={() => setMore(false)} title="그림 더보기">
        <div className="grid gap-2">
          {current === 'mindmap' ? (
            <div className="grid gap-1.5 pb-2">
              <p className="text-sm font-bold">지도 모양</p>
              <Segmented
                label="마인드맵 모양"
                value={layout}
                onChange={(l) => onViewChange?.({ ...view, layout: l })}
                options={[
                  { value: 'radial', label: '가운데서 퍼지기' },
                  { value: 'right', label: '오른쪽으로' },
                  { value: 'down', label: '아래로' },
                ]}
              />
            </div>
          ) : null}
          {aiLocked ? <p className="rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted">{aiLocked}</p> : null}
          <Button
            variant="secondary"
            className="justify-between"
            disabled={!!busy || !me.aiEnabled || !!aiLocked}
            onClick={() => {
              setMore(false);
              regenerate();
            }}
          >
            <span>AI로 다시 그리기</span>
            <Energy n={est} className="text-sm text-muted" />
          </Button>
          {!local.table ? (
            <Button
              variant="secondary"
              className="justify-between"
              disabled={!!busy || !me.aiEnabled || !!aiLocked}
              onClick={() => {
                setMore(false);
                regenerate('table');
              }}
            >
              <span>표로 만들기</span>
              <Energy n={est} className="text-sm text-muted" />
            </Button>
          ) : null}
          {!local.timeline ? (
            <Button
              variant="secondary"
              className="justify-between"
              disabled={!!busy || !me.aiEnabled || !!aiLocked}
              onClick={() => {
                setMore(false);
                regenerate('timeline');
              }}
            >
              <span>연표로 만들기</span>
              <Energy n={est} className="text-sm text-muted" />
            </Button>
          ) : null}
          <p className="text-xs text-muted">새로 만들면 미리보기를 먼저 보여 줘요. 내가 고친 가지는 그대로 남아요.</p>
          {onReport ? (
            <Button
              variant="ghost"
              onClick={() => {
                setMore(false);
                onReport();
              }}
            >
              그림이 이상해요
            </Button>
          ) : null}
        </div>
      </Sheet>
      {busy ? <p className="text-sm text-muted">{busy}</p> : null}
      {editLocked && !compact ? <p className="text-sm text-muted">{editLocked}</p> : null}
      {hide ? <p className="text-sm text-muted">가려진 가지를 눌러 떠올려 보고, 기억났는지 골라요. 헷갈린 개념의 문제는 오늘 복습에 넣어요.</p> : null}

      {current === 'mindmap' && local.mindmap ? (
        <MindMapView
          mode={compact ? 'cards' : mmMode}
          spec={local.mindmap}
          settings={mmSettings}
          subjectColor={subjectColor}
          noteId={noteId}
          note={note}
          memory={memory}
          editable={edit}
          hideMode={hide}
          highlightKeyPoint={highlightKeyPoint}
          onChange={(m) => save('mindmap', m)}
          onRecallDone={onRecall}
          compact={compact}
          onOpen={onOpen}
          onShowInNote={onShowInNote}
        />
      ) : null}
      {current === 'table' && local.table ? <TableView spec={local.table} editable={edit} hideMode={hide} onChange={(t) => save('table', t)} /> : null}
      {current === 'timeline' && local.timeline ? (
        <TimelineView spec={local.timeline} editable={edit} hideMode={hide} onChange={(t) => save('timeline', t)} />
      ) : null}
      {!local.mindmap && !local.table && !local.timeline ? <p className="text-sm text-muted">아직 그림이 없어요.</p> : null}

      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title="새 그림 미리보기"
        footer={
          <div className="flex gap-2">
            <Button busy={busy === '적용하는 중…'} onClick={apply}>
              적용
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              그대로 두기
            </Button>
          </div>
        }
      >
        {preview ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted">{preview.want ? '마음에 들면 적용을 눌러요.' : '내가 고친 가지는 그대로 남아요. 마음에 들면 적용을 눌러요.'}</p>
            {!preview.want ? <MindMap spec={preview.mindmap} settings={mmSettings} subjectColor={subjectColor} /> : null}
            {preview.table && preview.want !== 'timeline' ? <TableView spec={preview.table} /> : null}
            {preview.timeline && preview.want !== 'table' ? <TimelineView spec={preview.timeline} /> : null}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
