'use client';
// 그림 탭: 마인드맵·표·연표 보기, 고치기, 가리기 모드, 다시 그리기(미리보기 → 적용)
import { useMemo, useState } from 'react';
import type { Mindmap, TableSpec, TimelineSpec } from '@/lib/ai/schemas';
import type { MeResponse } from '@/lib/types';
import type { UserSettings } from '@/lib/settings';
import { estimateSmallTask } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { sb } from '@/lib/data';
import { MindMap, type RecallResult } from '../MindMap';
import { TableView, TimelineView } from '../VisualViews';
import { Button, Chip, Segmented, Sheet, api, useToast } from '../ui';

export type Visuals = { mindmap?: Mindmap; table?: TableSpec; timeline?: TimelineSpec };
export type VisualType = 'mindmap' | 'table' | 'timeline';
export type NoteView = { type?: VisualType; layout?: 'radial' | 'right' | 'down' };

type Preview = { recommended: VisualType; mindmap: Mindmap; table: TableSpec | null; timeline: TimelineSpec | null; want?: 'table' | 'timeline' };

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
  compact = false,
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
  /** 고친 그림 저장을 바꾼다 (지난 버전 보기: 그 버전에 저장). 없으면 지금 노트의 그림에 저장 */
  saveSpec?: (t: VisualType, spec: Mindmap | TableSpec | TimelineSpec) => Promise<boolean>;
  /** AI 로 다시 그리기를 막을 때 그 까닭 (지난 버전 보기) */
  aiLocked?: string;
  compact?: boolean;
}) {
  const toast = useToast();
  const settings = me.settings.visual;
  const [type, setType] = useState<VisualType>(() => pickType(visuals, settings, subjectId, recommended, view));
  const [hide, setHide] = useState(settings.hideMode === 'on' && !compact);
  const [edit, setEdit] = useState(false);
  const [local, setLocal] = useState<Visuals>(visuals);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);

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
    if (!ok) {
      setSaving('idle');
      toast('저장하지 못했어요.', 'bad');
    } else setSaving('saved');
  };

  const regenerate = async (want?: 'table' | 'timeline') => {
    setBusy(want ? `${TYPE_LABEL[want]} 만드는 중…` : '다시 그리는 중…');
    try {
      const r = await api<{ preview: Preview }>(`/api/notes/${noteId}/visual`, { method: 'POST', body: JSON.stringify({ action: 'preview', want }) });
      if (want && !r.preview[want]) {
        toast(`이 노트로는 ${TYPE_LABEL[want]}를 만들기 어려워요.`);
        return;
      }
      setPreview({ ...r.preview, want });
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
      const body = preview.want
        ? { action: 'apply', [preview.want]: preview[preview.want] }
        : { action: 'apply', mindmap: preview.mindmap, table: preview.table, timeline: preview.timeline, recommended: preview.recommended };
      await api(`/api/notes/${noteId}/visual`, { method: 'POST', body: JSON.stringify(body) });
      if (preview.want) {
        setType(preview.want);
        onViewChange?.({ ...view, type: preview.want });
      }
      setPreview(null);
      toast('새 그림으로 바꿨어요.', 'ok');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const onRecall = async (results: RecallResult[]) => {
    const confused = [...new Set(results.filter((r) => !r.ok && r.keyPointId).map((r) => r.keyPointId))];
    if (!confused.length) {
      toast(`${results.length}개 모두 기억났어요! 👏`, 'ok');
      return;
    }
    const { data: qs } = await sb().from('questions').select('id').eq('note_id', noteId).in('key_point_id', confused).eq('status', 'active');
    const ids = (qs ?? []).map((q) => q.id as string);
    if (ids.length) await sb().from('cards').update({ due: new Date().toISOString() }).in('question_id', ids);
    toast(`헷갈린 개념 ${confused.length}개의 문제 ${ids.length}개를 오늘 복습에 넣었어요.`, 'ok');
  };

  const types = (['mindmap', 'table', 'timeline'] as VisualType[]).filter((t) => !!local[t]);
  const current = local[type] ? type : 'mindmap';

  return (
    <div className="grid gap-3">
      {!compact ? (
        <div className="flex flex-wrap items-center gap-2">
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
          ) : null}
          {current === 'mindmap' ? (
            <Segmented
              label="마인드맵 모양"
              value={layout}
              onChange={(l) => onViewChange?.({ ...view, layout: l })}
              options={[
                { value: 'radial', label: '퍼지기' },
                { value: 'right', label: '오른쪽' },
                { value: 'down', label: '아래로' },
              ]}
            />
          ) : null}
          <Chip>AI</Chip>
          {saving === 'saving' ? (
            <span className="text-xs text-muted">저장 중…</span>
          ) : saving === 'saved' ? (
            <span className="text-xs text-ok">저장됨</span>
          ) : null}
        </div>
      ) : null}

      {!compact ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={hide ? 'ink' : 'secondary'}
            onClick={() => {
              setHide((h) => !h);
              setEdit(false);
            }}
            aria-pressed={hide}
          >
            {hide ? '가리기 끄기' : '가리기 모드'}
          </Button>
          <Button
            size="sm"
            variant={edit ? 'ink' : 'secondary'}
            onClick={() => {
              setEdit((x) => !x);
              setHide(false);
            }}
            aria-pressed={edit}
          >
            {edit ? '고치기 끝' : '고치기'}
          </Button>
          <Button size="sm" variant="secondary" busy={!!busy} onClick={() => setMore(true)} aria-haspopup="dialog">
            더보기
          </Button>
        </div>
      ) : null}

      <Sheet open={more} onClose={() => setMore(false)} title="그림 더보기">
        <div className="grid gap-2">
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
            <span className="text-sm text-muted">⚡{est}</span>
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
              <span className="text-sm text-muted">⚡{est}</span>
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
              <span className="text-sm text-muted">⚡{est}</span>
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
      {hide ? <p className="text-sm text-muted">가려진 가지를 눌러 떠올려 보고, 기억났는지 골라요. 헷갈린 개념의 문제는 오늘 복습에 넣어요.</p> : null}

      {current === 'mindmap' && local.mindmap ? (
        <MindMap
          spec={local.mindmap}
          settings={mmSettings}
          subjectColor={subjectColor}
          editable={edit}
          hideMode={hide}
          highlightKeyPoint={highlightKeyPoint}
          onChange={(m) => save('mindmap', m)}
          onRecallDone={onRecall}
          compact={compact}
          onOpen={onOpen}
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
