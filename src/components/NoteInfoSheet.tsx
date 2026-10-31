'use client';
// 노트 정보: 이름·과목·단원을 한 화면에서 고친다 (자료함 카드 메뉴·노트 메뉴의 '이름·과목·단원 바꾸기').
// 과목을 바꾸면 그 과목의 단원이 바로 보이고, 저장하면 노트·문제·복습 기록이 같이 옮겨진다 (/api/sources/move: 부르는 쪽이 한다)
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SubjectRow } from '@/lib/types';
import { subjectVar } from '@/lib/colors';
import { isSubmitKey } from '@/lib/quick-add';
import { matchesSubject, pickerOrder } from '@/lib/subject-order';
import { createSubject } from './SubjectPick';
import { UNIT_MAX, normalizeUnit, useSubjectUnits } from './UnitPick';
import { Button, ICONS, Icon, Sheet, cx, inputClass, radioKeys, useToast } from './ui';

export type NoteInfo = { title: string; subjectId: string; unit: string };

/** 노트 이름 길이 (자료함·노트 화면과 같게) */
const TITLE_MAX = 120;
/** 과목이 이만큼 넘으면 찾기 칸을 보인다 */
const SEARCH_FROM = 10;

const chipClass = (on: boolean) =>
  cx(
    'press inline-flex h-9 max-w-full items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors duration-150',
    on ? 'kok-chip-on' : 'kok-chip-off bg-surface-2 text-ink hover:bg-surface-3',
  );

/** 고르는 칩 줄의 키보드: 고른 칩만 Tab 으로 가고, 화살표로 옮겨 고른다 */
function chipKeys(e: KeyboardEvent<HTMLElement>, index: number, count: number, pick: (i: number) => void) {
  radioKeys(e, index, count, pick);
}

/**
 * 노트 정보 시트. value: 지금 이름·과목·단원, canMove: 다른 과목으로 옮길 수 있는지 (features.merge),
 * suggestUnit: AI 가 읽은 단원 ('AI 추천', 노트 화면만), onSave: 저장 (moveTo 는 과목을 바꿨을 때만). true 면 닫는다
 */
export function NoteInfoSheet({
  open,
  onClose,
  value,
  subjects,
  canMove,
  suggestUnit,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  value: NoteInfo;
  subjects: SubjectRow[];
  canMove: boolean;
  suggestUnit?: string;
  onSave: (next: NoteInfo, moveTo: SubjectRow | null) => Promise<boolean>;
}) {
  const toast = useToast();
  const formId = useId();
  const nameId = useId();
  const subjectLabel = useId();
  const unitLabel = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(value.title);
  const [subjectId, setSubjectId] = useState(value.subjectId);
  const [unit, setUnit] = useState(value.unit);
  const [made, setMade] = useState<SubjectRow[]>([]);
  const [query, setQuery] = useState('');
  /** 새 과목·새 단원 적는 칸 (하나만 연다) */
  const [adding, setAdding] = useState<'subject' | 'unit' | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => [...subjects, ...made.filter((m) => !subjects.some((s) => s.id === m.id))], [subjects, made]);
  const units = useSubjectUnits(subjectId, open);

  const subjectOf = (id: string) => all.find((s) => s.id === id) ?? null;
  const from = subjectOf(value.subjectId);
  const to = subjectOf(subjectId);
  const moving = subjectId !== value.subjectId;
  const name = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  const dirty = name !== value.title.trim() || moving || unit !== value.unit;

  // 과목 칩: 고정 → 최근 쓴 차례 (보관한 과목은 빼되 지금 과목·고른 과목은 남긴다), 많으면 찾기
  const ordered = useMemo(() => {
    const keep = pickerOrder(all, value.subjectId);
    const picked = all.find((s) => s.id === subjectId);
    return picked && !keep.includes(picked) ? [...keep, picked] : keep;
  }, [all, value.subjectId, subjectId]);
  const many = ordered.length >= SEARCH_FROM;
  const shown = query.trim() ? ordered.filter((s) => s.id === subjectId || matchesSubject(s.name, query)) : ordered;

  // 단원 칩: 단원 없음 → AI 추천 → 이 과목의 단원 (최근 쓴 차례). 고른 단원이 목록에 없으면(새로 적은 단원) 앞에
  const sug = !moving ? normalizeUnit(suggestUnit ?? '') : '';
  const unitList = useMemo(() => {
    const list = [...(sug && !(units ?? []).includes(sug) ? [sug] : []), ...(units ?? [])];
    if (unit && !list.includes(unit)) list.unshift(unit);
    return ['', ...list];
  }, [units, sug, unit]);

  const pickSubject = (id: string) => {
    if (id === subjectId) return;
    setSubjectId(id);
    // 다른 과목의 단원은 그 과목에 없다: 단원 없음으로 (지금 과목으로 돌아오면 원래 단원)
    setUnit(id === value.subjectId ? value.unit : '');
  };

  const openAdd = (what: 'subject' | 'unit') => {
    setAdding(what);
    setTyped('');
  };

  const addSubject = async () => {
    if (!typed.trim() || busy) return;
    setBusy(true);
    const s = await createSubject(typed, all, toast);
    setBusy(false);
    if (!s) return;
    setMade((m) => [...m, s]);
    setAdding(null);
    setTyped('');
    pickSubject(s.id);
  };

  const addUnit = () => {
    const u = normalizeUnit(typed);
    if (!u) return;
    setUnit(u);
    setAdding(null);
    setTyped('');
  };

  const save = async () => {
    if (!dirty || !name || busy) return;
    setBusy(true);
    try {
      if (await onSave({ title: name, subjectId, unit }, moving ? to : null)) onClose();
    } finally {
      setBusy(false);
    }
  };

  const addRow = (what: 'subject' | 'unit') => (
    <div className="kok-appear flex w-full items-center gap-2">
      <input
        className={cx(inputClass, 'min-w-0 flex-1')}
        aria-label={what === 'subject' ? '새 과목 이름' : '새 단원 이름'}
        placeholder={what === 'subject' ? '새 과목 이름 (예: 자료구조)' : '새 단원 (예: 2. 연결 리스트)'}
        maxLength={what === 'subject' ? 40 : UNIT_MAX}
        value={typed}
        autoFocus
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e.nativeEvent)) {
            // 이름 칸의 엔터(저장)와 달리 여기서는 만들기만 한다
            e.preventDefault();
            e.stopPropagation();
            if (what === 'subject') void addSubject();
            else addUnit();
          } else if (e.key === 'Escape') {
            // 적는 칸만 닫는다 (시트는 그대로)
            e.preventDefault();
            e.stopPropagation();
            setAdding(null);
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        busy={busy && what === 'subject'}
        disabled={!typed.trim()}
        onClick={() => (what === 'subject' ? void addSubject() : addUnit())}
      >
        {what === 'subject' ? '만들기' : '쓰기'}
      </Button>
      <button type="button" className="press rounded-full px-2.5 py-1.5 text-sm font-semibold text-muted hover:bg-surface-2" onClick={() => setAdding(null)}>
        취소
      </button>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title="노트 정보"
      footer={
        <Button type="submit" form={formId} size="lg" className="w-full" busy={busy} disabled={!dirty || !name}>
          {moving && to ? `저장하고 '${to.name}' 과목으로 옮기기` : '저장'}
        </Button>
      }
    >
      <form
        id={formId}
        className="grid gap-6 pb-1"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {/* 이름 */}
        <div className="grid gap-2">
          <label htmlFor={nameId} className="text-sm font-bold text-muted">
            이름
          </label>
          <div className="relative">
            <input
              ref={nameRef}
              id={nameId}
              className={cx(inputClass, 'pr-12 text-[17px] font-semibold')}
              value={title}
              maxLength={TITLE_MAX}
              placeholder="노트 이름"
              autoComplete="off"
              onChange={(e) => setTitle(e.target.value)}
            />
            {title ? (
              <button
                type="button"
                aria-label="이름 지우기"
                title="이름 지우기"
                className="press absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
                onClick={() => {
                  setTitle('');
                  nameRef.current?.focus();
                }}
              >
                <Icon d={ICONS.close} size={16} strokeWidth={2.4} />
              </button>
            ) : null}
          </div>
          {!name ? <p className="text-xs font-semibold text-bad">이름을 적어 주세요.</p> : null}
        </div>

        {/* 과목 */}
        <div className="grid gap-2">
          <p id={subjectLabel} className="text-sm font-bold text-muted">
            과목
          </p>
          {canMove ? (
            <>
              {many ? (
                <input
                  type="search"
                  className={inputClass}
                  placeholder="과목 찾기 (첫 글자 ㄱㅎ처럼도 돼요)"
                  aria-label="과목 찾기"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              ) : null}
              <div role="radiogroup" aria-labelledby={subjectLabel} className="flex flex-wrap gap-2">
                {shown.map((s, i) => {
                  const on = s.id === subjectId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on || (!shown.some((x) => x.id === subjectId) && i === 0) ? 0 : -1}
                      className={chipClass(on)}
                      onClick={() => pickSubject(s.id)}
                      onKeyDown={(e) => chipKeys(e, i, shown.length, (n) => pickSubject(shown[n].id))}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                      <span className="truncate">{s.name}</span>
                      {s.id === value.subjectId && moving ? <span className="shrink-0 text-xs font-semibold opacity-70">지금</span> : null}
                    </button>
                  );
                })}
                {!shown.length ? <p className="py-1 text-sm text-muted">{`'${query.trim()}'에 맞는 과목이 없어요.`}</p> : null}
                {adding !== 'subject' ? (
                  <button
                    type="button"
                    className="press inline-flex h-9 items-center gap-1 rounded-full border-2 border-dashed border-line px-3 text-sm font-semibold text-muted hover:border-accent hover:text-accent"
                    onClick={() => openAdd('subject')}
                  >
                    <Icon d={ICONS.plus} size={14} strokeWidth={2.6} />새 과목
                  </button>
                ) : null}
              </div>
              {adding === 'subject' ? addRow('subject') : null}
            </>
          ) : (
            // 옮기기를 쓸 수 없는 DB (schema.sql 을 다시 실행하기 전): 지금 과목만 보인다
            <p className="inline-flex items-center gap-2 text-[15px] font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(from?.color) }} aria-hidden="true" />
              {from?.name ?? '과목'}
            </p>
          )}
        </div>

        {/* 단원: 고른 과목의 단원 */}
        <div className="grid gap-2">
          <p id={unitLabel} className="text-sm font-bold text-muted">
            단원 <span className="font-medium">· 같은 단원끼리 자료함에서 묶여요</span>
          </p>
          <div role="radiogroup" aria-labelledby={unitLabel} className="flex flex-wrap gap-2">
            {unitList.map((u, i) => {
              const on = u === unit;
              return (
                <button
                  key={u || '∅'}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className={chipClass(on)}
                  onClick={() => setUnit(u)}
                  onKeyDown={(e) => chipKeys(e, i, unitList.length, (n) => setUnit(unitList[n]))}
                >
                  <span className="truncate">{u || '단원 없음'}</span>
                  {u && u === sug ? (
                    <span className={cx('shrink-0 rounded-full px-1.5 text-[11px] font-bold', on ? 'bg-white/25' : 'bg-accent-soft text-accent')}>AI 추천</span>
                  ) : null}
                </button>
              );
            })}
            {adding !== 'unit' ? (
              <button
                type="button"
                className="press inline-flex h-9 items-center gap-1 rounded-full border-2 border-dashed border-line px-3 text-sm font-semibold text-muted hover:border-accent hover:text-accent"
                onClick={() => openAdd('unit')}
              >
                <Icon d={ICONS.plus} size={14} strokeWidth={2.6} />새 단원
              </button>
            ) : null}
          </div>
          {units === null ? <p className="text-xs text-muted">단원을 불러오는 중…</p> : null}
          {adding === 'unit' ? addRow('unit') : null}
        </div>

        {/* 과목을 바꾸면 무엇이 같이 옮겨지는지 */}
        {moving && to ? (
          <div className="kok-appear flex items-start gap-2.5 rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-relaxed text-ink" role="status">
            <Icon d={ICONS.move} size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <b>{from?.name ?? '지금 과목'}</b> → <b>{to.name}</b> 과목으로 옮겨요. 노트·문제·복습 기록이 같이 옮겨져요.
            </span>
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}
