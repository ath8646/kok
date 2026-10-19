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
        <div className="overflow-x-auto kok-card">
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

  /** 가린 칸 (가리기 모드): 누르면 보인다 */
  const cell = (r: number, c: number, text: string) => {
    const key = `${r}:${c}`;
    const hidden = hideMode && c > 0 && !shown.has(key);
    return hidden ? (
      <button
        type="button"
        className="press w-full rounded-lg border border-dashed border-line bg-surface-2 px-2 py-1 text-sm text-muted"
        onClick={() => setShown((s) => new Set(s).add(key))}
      >
        눌러서 확인
      </button>
    ) : (
      <RichText text={text} />
    );
  };

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

      {/* 폰: 줄마다 카드 (첫 칸이 제목, 나머지는 '열 이름: 값') */}
      <ol className="grid gap-2.5 sm:hidden" aria-label={spec.title || '표'}>
        {spec.rows.map((row, r) => (
          <li key={r} className="kok-card kok-rise relative overflow-hidden p-4 pl-5" style={{ ['--i' as string]: r }}>
            <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: `var(--b${(r % 8) + 1})` }} aria-hidden="true" />
            <p className="font-display text-[17px] leading-snug">{cell(r, 0, row[0] ?? '')}</p>
            <dl className="mt-2 grid gap-2">
              {Array.from({ length: cols - 1 }, (_, k) => k + 1).map((c) => (
                <div key={c} className="grid gap-0.5">
                  <dt className="text-xs font-bold tracking-wide text-muted">{spec.columns[c] ?? ''}</dt>
                  <dd className="text-[15px] leading-relaxed">{cell(r, c, row[c] ?? '')}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      {/* 넓은 화면: 표 (첫 열은 옆으로 밀어도 남는다) */}
      <div className="kok-card hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  className={cx(
                    'border-b border-line bg-surface-2 px-4 py-3 text-left text-[13px] font-bold tracking-wide text-muted',
                    c === 0 && 'sticky left-0 z-[1]',
                  )}
                >
                  {spec.columns[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, r) => (
              <tr key={r} className="align-top transition-colors hover:bg-surface-2/50">
                {Array.from({ length: cols }, (_, c) => {
                  const Cell = c === 0 ? 'th' : 'td';
                  return (
                    <Cell
                      key={c}
                      scope={c === 0 ? 'row' : undefined}
                      className={cx(
                        'border-b border-line px-4 py-3 text-left',
                        r === spec.rows.length - 1 && 'border-b-0',
                        c === 0 ? 'sticky left-0 bg-surface font-bold' : 'font-normal',
                      )}
                    >
                      {c === 0 ? (
                        <span className="inline-flex items-start gap-2">
                          <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--b${(r % 8) + 1})` }} aria-hidden="true" />
                          <span>{cell(r, c, row[c] ?? '')}</span>
                        </span>
                      ) : (
                        cell(r, c, row[c] ?? '')
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
          <div key={i} className="grid gap-2 kok-card p-3 sm:grid-cols-[120px_1fr_auto]">
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
      <ol className="relative grid gap-3 pl-11" aria-label={spec.title || '연표'}>
        {/* 세로 줄: 위에서 아래로 옅어진다 */}
        <span
          className="absolute bottom-3 left-[17px] top-3 w-[3px] rounded-full"
          style={{ background: 'linear-gradient(var(--accent), color-mix(in srgb, var(--accent) 18%, transparent))' }}
          aria-hidden="true"
        />
        {spec.events.map((ev, i) => {
          const hidden = hideMode && !shown.has(i);
          return (
            <li key={i} className="kok-rise relative" style={{ ['--i' as string]: i }}>
              <span
                className="absolute -left-11 top-3 grid h-9 w-9 place-items-center rounded-full bg-accent text-[13px] font-bold text-accent-ink shadow-[0_0_0_4px_var(--bg)]"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <div className="kok-card p-4">
                {ev.date ? <span className="mb-1.5 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent">{ev.date}</span> : null}
                {hidden ? (
                  <button
                    type="button"
                    className="press mt-0.5 block w-full rounded-xl border border-dashed border-line bg-surface-2 px-3 py-2 text-left text-sm text-muted"
                    onClick={() => setShown((s) => new Set(s).add(i))}
                  >
                    무슨 일이었을까요? 눌러서 확인
                  </button>
                ) : (
                  <>
                    <p className="text-[16px] font-bold leading-snug">
                      <RichText text={ev.label} />
                    </p>
                    {ev.detail ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        <RichText text={ev.detail} />
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
