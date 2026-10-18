'use client';
// 정리 노트: 한 줄 요약, 핵심 개념, 용어, 공식, 함정, 예시, 확인할 것
import { useState } from 'react';
import type { KeyPoint, Note } from '@/lib/ai/schemas';
import { RichText, Tex } from './RichText';
import { Button, Chip, cx, inputClass } from './ui';

export type NoteBody = Note & { recommended?: string };

const IMPORTANCE: Record<KeyPoint['importance'], { label: string; tone: 'bad' | 'accent' | 'plain' }> = {
  high: { label: '꼭 외우기', tone: 'bad' },
  medium: { label: '중요', tone: 'accent' },
  low: { label: '참고', tone: 'plain' },
};

export function pageLabel(kind: string, p: number): string {
  return kind === 'image' ? `사진 ${p}` : `${p}쪽`;
}

function EditBox({
  initial,
  onSave,
  onCancel,
  multiline = true,
  label,
}: {
  initial: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  multiline?: boolean;
  label: string;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="grid gap-2">
      {multiline ? (
        <textarea aria-label={label} className={cx(inputClass, 'min-h-24')} value={v} maxLength={2000} onChange={(e) => setV(e.target.value)} autoFocus />
      ) : (
        <input aria-label={label} className={inputClass} value={v} maxLength={200} onChange={(e) => setV(e.target.value)} autoFocus />
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(v.trim())} disabled={!v.trim()}>
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  );
}

function PencilButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink"
      aria-label={label}
    >
      고치기
    </button>
  );
}

export function NoteView({
  note,
  kind,
  editable,
  onChange,
  highlightKeyPoint,
  onSelectKeyPoint,
  onOpenPage,
}: {
  note: NoteBody;
  kind: string;
  editable?: boolean;
  onChange?: (next: NoteBody) => void;
  highlightKeyPoint?: string | null;
  onSelectKeyPoint?: (id: string | null) => void;
  onOpenPage?: (page: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const save = (next: NoteBody) => {
    onChange?.(next);
    setEditing(null);
  };

  const pages = (ps: number[]) =>
    ps.length && kind !== 'text' ? (
      <span className="flex flex-wrap gap-1">
        {ps.slice(0, 6).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onOpenPage?.(p)}
            className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
          >
            {pageLabel(kind, p)}
          </button>
        ))}
      </span>
    ) : null;

  return (
    <div className="grid gap-5">
      {/* 한 줄 요약 */}
      <section className="kok-card p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-muted">한 줄 요약</h3>
          {editable && editing !== 'summary' ? <PencilButton label="요약 고치기" onClick={() => setEditing('summary')} /> : null}
        </div>
        {editing === 'summary' ? (
          <EditBox label="요약" initial={note.summary} onCancel={() => setEditing(null)} onSave={(v) => save({ ...note, summary: v, summary_edited: true })} />
        ) : (
          <p className="text-[17px] font-semibold leading-relaxed">
            <span className="hl-mark">
              <RichText text={note.summary || '요약이 아직 없어요.'} />
            </span>
          </p>
        )}
      </section>

      {/* 핵심 개념 */}
      <section className="grid gap-3">
        <h3 className="font-display text-lg">핵심 개념 {note.key_points.length}개</h3>
        {note.key_points.map((kp, idx) => {
          const imp = IMPORTANCE[kp.importance] ?? IMPORTANCE.medium;
          const hl = highlightKeyPoint === kp.id;
          const pits = note.pitfalls.filter((p) => p.key_point_id === kp.id);
          const exs = note.examples.filter((p) => p.key_point_id === kp.id);
          const editKey = `kp-${kp.id}`;
          return (
            <article
              key={kp.id}
              id={`kp-${kp.id}`}
              className={cx('kok-card p-4 transition-shadow', hl && 'shadow-[0_0_0_3px_var(--hl)]')}
              onClick={() => onSelectKeyPoint?.(hl ? null : kp.id)}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  {editing === editKey ? (
                    <KeyPointEditor
                      kp={kp}
                      onCancel={() => setEditing(null)}
                      onSave={(next) => save({ ...note, key_points: note.key_points.map((x) => (x.id === kp.id ? { ...next, edited: true } : x)) })}
                      onDelete={() =>
                        save({
                          ...note,
                          key_points: note.key_points.filter((x) => x.id !== kp.id),
                          pitfalls: note.pitfalls.filter((p) => p.key_point_id !== kp.id),
                          examples: note.examples.filter((p) => p.key_point_id !== kp.id),
                        })
                      }
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[16px] font-bold">
                          <RichText text={kp.title} />
                        </h4>
                        <Chip tone={imp.tone}>{imp.label}</Chip>
                        {kp.starred ? <Chip tone="hl">★ 별표</Chip> : null}
                      </div>
                      <p className="mt-1.5 text-[15px] leading-relaxed">
                        <RichText text={kp.explanation} />
                      </p>
                      {kp.why ? (
                        <p className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink">
                          <b className="text-accent">시험 포인트 </b>
                          <RichText text={kp.why} />
                        </p>
                      ) : null}
                      {pits.length ? (
                        <ul className="mt-2 grid gap-1.5">
                          {pits.map((p, i) => (
                            <li key={i} className="rounded-xl bg-bad-soft px-3 py-2 text-sm">
                              <b className="text-bad">함정 </b>
                              <RichText text={p.text} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {exs.length ? (
                        <ul className="mt-2 grid gap-1.5">
                          {exs.map((p, i) => (
                            <li key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                              <b className="text-ok">예시 </b>
                              <RichText text={p.text} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                        {pages(kp.pages)}
                        {editable ? (
                          <span className="ml-auto flex gap-1">
                            <button
                              type="button"
                              className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink"
                              onClick={() => save({ ...note, key_points: note.key_points.map((x) => (x.id === kp.id ? { ...x, starred: !x.starred } : x)) })}
                            >
                              {kp.starred ? '별표 빼기' : '★ 별표'}
                            </button>
                            <PencilButton label={`${kp.title} 고치기`} onClick={() => setEditing(editKey)} />
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {editable ? (
          <Button
            variant="secondary"
            onClick={() => {
              const used = new Set(note.key_points.map((k) => k.id));
              let n = note.key_points.length + 1;
              while (used.has(`k${n}`)) n++;
              const kp: KeyPoint = {
                id: `k${n}`,
                title: '새 개념',
                explanation: '설명을 적어 주세요.',
                why: '',
                importance: 'medium',
                pages: [],
                edited: true,
              };
              onChange?.({ ...note, key_points: [...note.key_points, kp] });
              setEditing(`kp-${kp.id}`);
            }}
          >
            개념 추가
          </Button>
        ) : null}
      </section>

      {/* 공식 */}
      {note.formulas.length ? (
        <section className="grid gap-2">
          <h3 className="font-display text-lg">공식</h3>
          {note.formulas.map((f, i) => (
            <div key={i} className="overflow-x-auto kok-card p-4">
              {f.label ? <p className="mb-1 text-sm font-semibold text-muted">{f.label}</p> : null}
              <Tex tex={f.latex} display />
            </div>
          ))}
        </section>
      ) : null}

      {/* 용어 */}
      {note.terms.length || editable ? (
        <section className="grid gap-2">
          <h3 className="font-display text-lg">용어</h3>
          <dl className="divide-y divide-line overflow-hidden kok-card">
            {note.terms.map((t, i) =>
              editing === `term-${i}` ? (
                <div key={i} className="p-3">
                  <TermEditor
                    term={t.term}
                    meaning={t.meaning}
                    onCancel={() => setEditing(null)}
                    onSave={(term, meaning) => save({ ...note, terms: note.terms.map((x, j) => (j === i ? { term, meaning, edited: true } : x)) })}
                    onDelete={() => save({ ...note, terms: note.terms.filter((_, j) => j !== i) })}
                  />
                </div>
              ) : (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <dt className="w-28 shrink-0 font-bold sm:w-36">
                    <RichText text={t.term} />
                  </dt>
                  <dd className="min-w-0 flex-1 text-[15px]">
                    <RichText text={t.meaning} />
                  </dd>
                  {editable ? <PencilButton label={`${t.term} 고치기`} onClick={() => setEditing(`term-${i}`)} /> : null}
                </div>
              ),
            )}
            {editing === 'term-new' ? (
              <div className="p-3">
                <TermEditor
                  term=""
                  meaning=""
                  onCancel={() => setEditing(null)}
                  onSave={(term, meaning) => save({ ...note, terms: [...note.terms, { term, meaning, edited: true }] })}
                />
              </div>
            ) : null}
          </dl>
          {editable && editing !== 'term-new' ? (
            <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setEditing('term-new')}>
              용어 추가
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* 내가 쓴 글: 확인할 것, AI가 고친 것 */}
      {note.checks.length ? (
        <section className="rounded-2xl border border-warn/40 bg-warn-soft p-4">
          <h3 className="mb-2 font-bold text-warn">한 번 확인해 보세요</h3>
          <ul className="grid list-disc gap-1 pl-5 text-sm">
            {note.checks.map((c, i) => (
              <li key={i}>
                <RichText text={c.text} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {note.changes.length ? (
        <section className="kok-card p-4">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-bold"
            onClick={() => setShowChanges((v) => !v)}
            aria-expanded={showChanges}
          >
            AI가 정리하며 바꾼 것 {note.changes.length}개<span className="text-sm text-muted">{showChanges ? '접기' : '펼치기'}</span>
          </button>
          {showChanges ? (
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted">
              {note.changes.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function KeyPointEditor({ kp, onSave, onCancel, onDelete }: { kp: KeyPoint; onSave: (kp: KeyPoint) => void; onCancel: () => void; onDelete: () => void }) {
  const [title, setTitle] = useState(kp.title);
  const [explanation, setExplanation] = useState(kp.explanation);
  const [why, setWhy] = useState(kp.why);
  const [importance, setImportance] = useState<KeyPoint['importance']>(kp.importance);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
      <input aria-label="개념 이름" className={inputClass} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        aria-label="설명"
        className={cx(inputClass, 'min-h-24')}
        value={explanation}
        maxLength={1000}
        onChange={(e) => setExplanation(e.target.value)}
      />
      <input
        aria-label="시험 포인트"
        placeholder="시험 포인트 (없어도 돼요)"
        className={inputClass}
        value={why}
        maxLength={300}
        onChange={(e) => setWhy(e.target.value)}
      />
      <select aria-label="중요도" className={inputClass} value={importance} onChange={(e) => setImportance(e.target.value as KeyPoint['importance'])}>
        <option value="high">꼭 외우기</option>
        <option value="medium">중요</option>
        <option value="low">참고</option>
      </select>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!title.trim()}
          onClick={() => onSave({ ...kp, title: title.trim(), explanation: explanation.trim(), why: why.trim(), importance })}
        >
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
        {confirm ? (
          <Button size="sm" variant="danger" className="ml-auto" onClick={onDelete}>
            정말 지우기
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={() => setConfirm(true)}>
            지우기
          </Button>
        )}
      </div>
    </div>
  );
}

function TermEditor({
  term,
  meaning,
  onSave,
  onCancel,
  onDelete,
}: {
  term: string;
  meaning: string;
  onSave: (term: string, meaning: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [t, setT] = useState(term);
  const [m, setM] = useState(meaning);
  return (
    <div className="grid gap-2">
      <input aria-label="용어" placeholder="용어" className={inputClass} value={t} maxLength={80} onChange={(e) => setT(e.target.value)} autoFocus />
      <textarea aria-label="뜻" placeholder="뜻" className={cx(inputClass, 'min-h-20')} value={m} maxLength={600} onChange={(e) => setM(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!t.trim() || !m.trim()} onClick={() => onSave(t.trim(), m.trim())}>
          저장
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
        {onDelete ? (
          <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={onDelete}>
            지우기
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export { EditBox };
