'use client';
// 표와 연표 (보기, 고치기, 가리기 모드)
import { useState } from 'react';
import type { TableSpec, TimelineSpec } from '@/lib/ai/schemas';
import { RichText } from './RichText';
import { Button, cx, inputClass } from './ui';

export function TableView({
  spec,
  editable,
  onChange,
  hideMode,
}: {
  spec: TableSpec;
  editable?: boolean;
  onChange?: (next: TableSpec) => void;
  hideMode?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TableSpec>(spec);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [prev, setPrev] = useState({ spec, hideMode });
  if (prev.spec !== spec || prev.hideMode !== hideMode) {
    setPrev({ spec, hideMode });
    setDraft(spec);
    setShown(new Set());
  }

  const cols = Math.max(spec.columns.length, ...spec.rows.map((r) => r.length), 1);

  if (editing) {
    const setCell = (r: number, c: number, v: string) =>
      setDraft((d) => ({ ...d, rows: d.rows.map((row, i) => (i === r ? Array.from({ length: cols }, (_, j) => (j === c ? v : (row[j] ?? ''))) : row)) }));
    return (
      <div className="grid gap-3">
        <input aria-label="표 제목" className={inputClass} value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} className="border-b border-line p-1.5">
                    <input
                      aria-label={`${c + 1}번째 열 이름`}
                      className={cx(inputClass, 'py-1.5 font-bold')}
                      value={draft.columns[c] ?? ''}
                      maxLength={40}
                      onChange={(e) =>
                        setDraft({ ...draft, columns: Array.from({ length: cols }, (_, j) => (j === c ? e.target.value : (draft.columns[j] ?? ''))) })
                      }
                    />
                  </th>
                ))}
                <th className="w-10 border-b border-line" />
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} className="border-b border-line p-1.5 align-top">
                      <input
                        aria-label={`${r + 1}행 ${c + 1}열`}
                        className={cx(inputClass, 'py-1.5')}
                        value={row[c] ?? ''}
                        maxLength={200}
                        onChange={(e) => setCell(r, c, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="border-b border-line p-1.5 text-center">
                    <button
                      type="button"
                      aria-label={`${r + 1}행 지우기`}
                      className="rounded-lg px-2 py-1 text-bad hover:bg-bad-soft"
                      onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, i) => i !== r) })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, rows: [...draft.rows, Array.from({ length: cols }, () => '')] })}>
            줄 추가
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={cols >= 8}
            onClick={() =>
              setDraft({
                ...draft,
                columns: [...Array.from({ length: cols }, (_, j) => draft.columns[j] ?? ''), '새 열'],
                rows: draft.rows.map((r) => [...Array.from({ length: cols }, (_, j) => r[j] ?? ''), '']),
              })
            }
          >
            열 추가
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              onChange?.({ ...draft, rows: draft.rows.filter((r) => r.some((x) => x.trim())) });
              setEditing(false);
            }}
          >
            저장
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(spec);
              setEditing(false);
            }}
          >
            취소
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        {spec.title ? <h3 className="font-display text-lg">{spec.title}</h3> : <span />}
        {editable && !hideMode ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            표 고치기
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[480px] border-collapse text-[15px]">
          <thead className="bg-surface-2">
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} scope="col" className="border-b border-line px-3 py-2.5 text-left font-bold">
                  {spec.columns[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, r) => (
              <tr key={r} className="align-top">
                {Array.from({ length: cols }, (_, c) => {
                  const key = `${r}:${c}`;
                  const hidden = hideMode && c > 0 && !shown.has(key);
                  const Cell = c === 0 ? 'th' : 'td';
                  return (
                    <Cell
                      key={c}
                      scope={c === 0 ? 'row' : undefined}
                      className={cx('border-b border-line px-3 py-2.5 text-left', c === 0 ? 'font-bold' : 'font-normal')}
                    >
                      {hidden ? (
                        <button
                          type="button"
                          className="w-full rounded-lg border border-dashed border-line bg-surface-2 px-2 py-1 text-sm text-muted"
                          onClick={() => setShown((s) => new Set(s).add(key))}
                        >
                          눌러서 확인
                        </button>
                      ) : (
                        <RichText text={row[c] ?? ''} />
                      )}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TimelineView({
  spec,
  editable,
  onChange,
  hideMode,
}: {
  spec: TimelineSpec;
  editable?: boolean;
  onChange?: (next: TimelineSpec) => void;
  hideMode?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TimelineSpec>(spec);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [prev, setPrev] = useState({ spec, hideMode });
  if (prev.spec !== spec || prev.hideMode !== hideMode) {
    setPrev({ spec, hideMode });
    setDraft(spec);
    setShown(new Set());
  }

  if (editing) {
    const setEv = (i: number, k: 'date' | 'label' | 'detail', v: string) =>
      setDraft((d) => ({ ...d, events: d.events.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));
    return (
      <div className="grid gap-3">
        <input
          aria-label="연표 제목"
          className={inputClass}
          value={draft.title}
          maxLength={60}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        {draft.events.map((ev, i) => (
          <div key={i} className="grid gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-[120px_1fr_auto]">
            <input aria-label="때" placeholder="때" className={inputClass} value={ev.date} maxLength={30} onChange={(e) => setEv(i, 'date', e.target.value)} />
            <div className="grid gap-2">
              <input
                aria-label="일"
                placeholder="일"
                className={inputClass}
                value={ev.label}
                maxLength={80}
                onChange={(e) => setEv(i, 'label', e.target.value)}
              />
              <input
                aria-label="자세히"
                placeholder="자세히 (없어도 돼요)"
                className={inputClass}
                value={ev.detail}
                maxLength={200}
                onChange={(e) => setEv(i, 'detail', e.target.value)}
              />
            </div>
            <button
              type="button"
              aria-label="지우기"
              className="self-start rounded-lg px-2 py-2 text-bad hover:bg-bad-soft"
              onClick={() => setDraft({ ...draft, events: draft.events.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, events: [...draft.events, { date: '', label: '', detail: '' }] })}>
            사건 추가
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              onChange?.({ ...draft, events: draft.events.filter((e) => e.date.trim() || e.label.trim()) });
              setEditing(false);
            }}
          >
            저장
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(spec);
              setEditing(false);
            }}
          >
            취소
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        {spec.title ? <h3 className="font-display text-lg">{spec.title}</h3> : <span />}
        {editable && !hideMode ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            연표 고치기
          </Button>
        ) : null}
      </div>
      <ol className="relative grid gap-4 border-l-2 border-accent/40 pl-6">
        {spec.events.map((ev, i) => {
          const hidden = hideMode && !shown.has(i);
          return (
            <li key={i} className="relative">
              <span className="absolute -left-[33px] top-1 h-4 w-4 rounded-full border-2 border-accent bg-surface" aria-hidden="true" />
              <p className="text-sm font-bold text-accent">{ev.date}</p>
              {hidden ? (
                <button
                  type="button"
                  className="mt-1 rounded-lg border border-dashed border-line bg-surface-2 px-3 py-1.5 text-sm text-muted"
                  onClick={() => setShown((s) => new Set(s).add(i))}
                >
                  무슨 일이었을까요? 눌러서 확인
                </button>
              ) : (
                <>
                  <p className="text-[16px] font-bold">
                    <RichText text={ev.label} />
                  </p>
                  {ev.detail ? (
                    <p className="text-sm text-muted">
                      <RichText text={ev.detail} />
                    </p>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
