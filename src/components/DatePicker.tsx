'use client';
// 날짜 고르기: 브라우저의 날짜 창(<input type="date">) 대신 앱 디자인의 달력. 입력 칸처럼 생긴 단추를 누르면 바로 아래에 달력이 펼쳐진다
// (시트 안에서도 창을 하나 더 띄우지 않게 그 자리에서). 날짜를 누르면 고르고 접힌다.
// - 키보드: 화살표 하루·한 주, Page Up/Down 한 달, Home/End 그 주의 처음·끝, Enter·Space 고르기, Esc 접기 (시트는 닫지 않는다)
// - 달력은 늘 여섯 줄이라 달을 넘겨도 높이가 바뀌지 않는다. 오늘은 테두리, 고른 날은 포인트 색
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { WEEKDAYS, addDays, addMonths, dayLabel, isDay, monthGrid, monthOf, pickedLabel, shortDayLabel, weekday } from '@/lib/calendar';
import { daysUntil, kstDateString } from '@/lib/time';
import { ICONS, Icon, cx, inputClass } from './ui';

export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = '날짜를 골라요',
  dDay = false,
}: {
  /** 단추의 id (Field 의 htmlFor 와 같게: 이름표를 눌러도 열린다) */
  id: string;
  /** 읽어 줄 이름 ('시험 날짜'): 단추는 '시험 날짜: 2026년 11월 18일 수요일'로 읽힌다 */
  label: string;
  /** 'YYYY-MM-DD' 또는 빈 글 */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 고른 날 옆에 D-day */
  dDay?: boolean;
}) {
  const panelId = useId();
  const monthId = useId();
  const [open, setOpen] = useState(false);
  const today = kstDateString();
  const picked = isDay(value) ? value : null;
  // 초점이 있는 칸 (보이는 달도 이 날의 달)
  const [cursor, setCursor] = useState(picked ?? today);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusCursor = useRef(false);

  const { y, m } = monthOf(cursor);
  const weeks = monthGrid(y, m);

  // 키로 칸을 옮기면 그 칸에 초점 (달이 바뀌어 새로 그린 뒤)
  useEffect(() => {
    if (!open || !focusCursor.current) return;
    focusCursor.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${cursor}"]`)?.focus();
  }, [open, cursor]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setCursor(picked ?? today);
    focusCursor.current = true;
    setOpen(true);
  };
  const choose = (d: string) => {
    onChange(d);
    setOpen(false);
    trigger.current?.focus();
  };
  const move = (d: string) => {
    focusCursor.current = true;
    setCursor(d);
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    let next: string | null = null;
    if (k === 'ArrowLeft') next = addDays(cursor, -1);
    else if (k === 'ArrowRight') next = addDays(cursor, 1);
    else if (k === 'ArrowUp') next = addDays(cursor, -7);
    else if (k === 'ArrowDown') next = addDays(cursor, 7);
    else if (k === 'PageUp') next = addMonths(cursor, -1);
    else if (k === 'PageDown') next = addMonths(cursor, 1);
    else if (k === 'Home') next = addDays(cursor, -weekday(cursor));
    else if (k === 'End') next = addDays(cursor, 6 - weekday(cursor));
    if (next) {
      e.preventDefault();
      move(next);
    }
  };
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    // 달력만 접는다 (둘러싼 시트는 defaultPrevented 인 Esc 를 받지 않는다)
    e.preventDefault();
    setOpen(false);
    trigger.current?.focus();
  };

  const left = picked ? daysUntil(picked) : null;
  const leftText = left === null ? '' : left > 0 ? `D-${left}` : left === 0 ? 'D-day' : '지났어요';
  return (
    <div className="grid gap-2">
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${picked ? `${dayLabel(picked)}${dDay && leftText ? `, ${leftText}` : ''}` : '고르지 않았어요'}`}
        onClick={toggle}
        className={cx(inputClass, 'press flex items-center gap-2 text-left')}
      >
        <Icon d={ICONS.calendar} size={18} className="shrink-0 text-muted" />
        <span className={cx('min-w-0 flex-1 truncate', !picked && 'text-muted')}>{picked ? pickedLabel(picked, today) : placeholder}</span>
        {dDay && left !== null ? (
          <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', left >= 0 ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted')}>
            {leftText}
          </span>
        ) : null}
        <Icon d={ICONS.chevronDown} size={16} strokeWidth={2.4} className={cx('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open ? (
        <div id={panelId} className="kok-unfold rounded-2xl bg-surface-2 p-3" role="group" aria-labelledby={monthId} onKeyDown={onPanelKey}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="press grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
              aria-label="이전 달"
              onClick={() => setCursor(addMonths(cursor, -1))}
            >
              <Icon d={ICONS.chevronLeft} size={18} strokeWidth={2.4} />
            </button>
            <p id={monthId} className="font-semibold tabular-nums" aria-live="polite">
              {y}년 {m}월
            </p>
            <button
              type="button"
              className="press grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
              aria-label="다음 달"
              onClick={() => setCursor(addMonths(cursor, 1))}
            >
              <Icon d={ICONS.chevronRight} size={18} strokeWidth={2.4} />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-semibold" aria-hidden="true">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={cx('py-1', i === 0 ? 'text-bad' : 'text-muted')}>
                {w}
              </span>
            ))}
          </div>
          <div ref={grid} className="grid grid-cols-7 gap-y-0.5" onKeyDown={onGridKey}>
            {weeks.flat().map((d) => {
              const inMonth = monthOf(d).m === m;
              const on = d === picked;
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  data-day={d}
                  tabIndex={d === cursor ? 0 : -1}
                  aria-label={`${shortDayLabel(d)}${isToday ? ', 오늘' : ''}`}
                  aria-pressed={on}
                  onClick={() => choose(d)}
                  className={cx(
                    'press mx-auto grid h-10 w-10 place-items-center rounded-full text-[15px] tabular-nums transition-colors duration-150',
                    on
                      ? 'bg-accent font-bold text-accent-ink'
                      : isToday
                        ? 'font-bold text-accent ring-1 ring-inset ring-accent hover:bg-surface-3'
                        : inMonth
                          ? 'text-ink hover:bg-surface-3'
                          : 'text-muted hover:bg-surface-3',
                  )}
                >
                  {Number(d.slice(8, 10))}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end">
            <button type="button" className="press rounded-full px-3 py-1.5 text-sm font-semibold text-accent hover:bg-surface-3" onClick={() => choose(today)}>
              오늘
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
