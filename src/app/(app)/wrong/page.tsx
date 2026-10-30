'use client';
// 오답노트: 약점 개념 5개, 틀린 문제 다시 풀기, 다 외운 문제 빼기 (하나씩 · 꾹 눌러 여러 개 · 모두)
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { QuestionPreview } from '@/components/QuestionList';
import { RichText } from '@/components/RichText';
import { BarAction, PICKED_RING, PickBadge, SelectionBar, pickKeyHandler, useMultiSelect } from '@/components/SelectionBar';
import { useLongPress } from '@/components/useLongPress';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ICONS,
  Icon,
  IconButton,
  LargeHeader,
  LinkButton,
  Menu,
  SectionTitle,
  Sheet,
  Swap,
  buttonClass,
  cx,
  useToast,
  DONE,
  type MenuItem,
} from '@/components/ui';
import { fetchPlanData, fetchQuestionsByIds, sb } from '@/lib/data';
import { readView, viewStamp, writeView } from '@/lib/view-cache';
import { weakConcepts, type WeakConcept } from '@/lib/review-plan';
import type { QuestionRow } from '@/lib/types';

type NoteInfo = { id: string; source_id: string; title: string };
type Item = { q: QuestionRow; lapses: number };

/** 한 번에 고치는 카드 수 (주소 길이 안에) */
const BULK_MAX = 100;

/** sourceFigures: 자료 그림 문제의 그림도 읽는다 (DB 에 칸이 있을 때만) */
async function fetchWrong(sourceFigures: boolean) {
  const plan = await fetchPlanData();
  const titles = plan.concepts;
  // 자료함에서 복습을 끈 노트의 문제는 빼고 (몇 개 뺐는지는 알려 준다)
  const wrong = plan.cards.filter((c) => c.in_wrong_note && c.in_review);
  const hidden = plan.cards.filter((c) => c.in_wrong_note && !c.in_review).length;
  const qs = await fetchQuestionsByIds(
    wrong.map((c) => c.question_id),
    { sourceFigures },
  );
  const lapses = new Map(wrong.map((c) => [c.question_id, Math.max(1, c.wrong_count ?? 0)]));
  const noteIds = [...new Set(wrong.map((c) => c.note_id).filter((x): x is string => !!x))];
  const notes = new Map<string, NoteInfo>();
  for (let i = 0; i < noteIds.length; i += 100) {
    const { data } = await sb()
      .from('notes')
      .select('id, source_id, title')
      .in('id', noteIds.slice(i, i + 100));
    for (const n of data ?? []) notes.set(n.id, n as NoteInfo);
  }
  const items: Item[] = qs.map((q) => ({ q, lapses: lapses.get(q.id) ?? 0 })).sort((a, b) => b.lapses - a.lapses);
  return { titles, notes, items, hidden };
}

/** 오답노트에서 뺀다 (카드는 남고 다시 틀리면 다시 들어온다). 뺀 수 */
async function removeFromWrong(ids: string[]): Promise<number> {
  let done = 0;
  for (let i = 0; i < ids.length; i += BULK_MAX) {
    const part = ids.slice(i, i + BULK_MAX);
    const { error } = await sb().from('cards').update({ in_wrong_note: false }).in('question_id', part);
    if (error) throw error;
    done += part.length;
  }
  return done;
}

type WrongData = Awaited<ReturnType<typeof fetchWrong>>;
/** 오답노트를 기억해 두는 이름 (다시 들어오면 바로 보이고 뒤에서 새로 읽는다: src/lib/view-cache.ts) */
const WRONG_VIEW = 'wrong';

export default function WrongPage() {
  const toast = useToast();
  const { me } = useMe();
  const owner = me?.userId;
  const sourceFiguresOn = !!me?.features.sourceFigures;
  // 기억해 둔 오답노트가 있으면 처음부터 그것으로 그린다
  const [first] = useState(() => readView<WrongData>(WRONG_VIEW, owner) ?? null);
  const [loading, setLoading] = useState(!first);
  const [titles, setTitles] = useState<Map<string, Map<string, { title: string }>>>(() => first?.titles ?? new Map());
  const [notes, setNotes] = useState<Map<string, NoteInfo>>(() => first?.notes ?? new Map());
  const [items, setItems] = useState<Item[]>(() => first?.items ?? []);
  /** 복습을 끈 노트라서 뺀 틀린 문제 수 */
  const [hidden, setHidden] = useState(() => first?.hidden ?? 0);
  /** 새로 읽은 것이 들어왔는지: 그 전에 기억해 둔 화면으로 그린 글은 번지지 않는다 */
  const [fresh, setFresh] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // 못 읽었을 때는 '비어 있어요' 대신 다시 불러오기를 보여 준다
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // 여러 개 고르기 (카드를 꾹 누르거나 메뉴에서) · 모두 빼기 확인
  const { selecting, picked, setPicked, startSelect, endSelect, togglePick } = useMultiSelect();
  const [busy, setBusy] = useState<'some' | 'all' | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => {
    let alive = true;
    // 읽는 사이에 저장이 있었으면 기억하지 않는다
    const stamp = viewStamp();
    fetchWrong(sourceFiguresOn)
      .then((r) => {
        if (!alive) return;
        setTitles(r.titles);
        setNotes(r.notes);
        setItems(r.items);
        setHidden(r.hidden);
        setFailed(false);
        setLoading(false);
        setFresh(true);
        writeView(WRONG_VIEW, owner, r, { stamp });
      })
      .catch(() => {
        if (!alive) return;
        // 기억해 둔 목록을 보이고 있으면 그대로 둔다 (못 읽었다고 지우지 않는다)
        if (!first || attempt > 0) setFailed(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt, sourceFiguresOn, owner, first]);

  const retry = () => {
    setLoading(true);
    setFailed(false);
    setAttempt((a) => a + 1);
  };

  // 약점 개념은 남은 틀린 문제로 센다 (빼면 같이 줄어든다)
  const weak: WeakConcept[] = useMemo(
    () =>
      weakConcepts(
        items.map(({ q, lapses }) => ({ question_id: q.id, note_id: q.note_id, key_point_id: q.key_point_id, lapses })),
        5,
      ),
    [items],
  );

  /** 뺀 문제는 목록에서 지운다 */
  const dropItems = (ids: Set<string>) => {
    setItems((xs) => {
      const next = xs.filter((x) => !ids.has(x.q.id));
      // 저장이 끝난 뒤 바뀐 목록을 다시 기억해 둔다 (다시 들어오면 바로 보이게)
      writeView(WRONG_VIEW, owner, { titles, notes, items: next, hidden });
      return next;
    });
    if (open && ids.has(open)) setOpen(null);
  };

  const removeOne = async (q: QuestionRow) => {
    try {
      await removeFromWrong([q.id]);
      dropItems(new Set([q.id]));
      toast('다 외운 문제로 뺐어요.', 'ok', DONE);
    } catch {
      toast('빼지 못했어요.', 'bad');
    }
  };
  const removePicked = async () => {
    const ids = items.map((x) => x.q.id).filter((id) => picked.has(id));
    if (!ids.length) return;
    setBusy('some');
    try {
      const n = await removeFromWrong(ids);
      dropItems(new Set(ids));
      endSelect();
      toast(`${n}개를 다 외운 문제로 뺐어요.`, 'ok', DONE);
    } catch {
      toast('빼지 못했어요. 다시 해 주세요.', 'bad');
    } finally {
      setBusy(null);
    }
  };
  const removeAll = async () => {
    const ids = items.map((x) => x.q.id);
    setBusy('all');
    try {
      const n = await removeFromWrong(ids);
      dropItems(new Set(ids));
      setConfirmAll(false);
      endSelect();
      toast(`틀린 문제 ${n}개를 모두 뺐어요.`, 'ok', DONE);
    } catch {
      toast('빼지 못했어요. 다시 해 주세요.', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const itemIds = useMemo(() => new Set(items.map((x) => x.q.id)), [items]);
  /** 여러 문제를 한 번에 고르거나 풀기 (약점 개념 카드: 그 개념의 틀린 문제 모두) */
  const pickMany = (ids: string[], on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const pickedCount = items.filter((x) => picked.has(x.q.id)).length;
  const allPicked = items.length > 0 && pickedCount === items.length;
  const headerMenu: MenuItem[] = [
    { label: '여러 개 고르기', icon: ICONS.select, onSelect: () => startSelect() },
    { label: '모두 빼기', icon: ICONS.trash, onSelect: () => setConfirmAll(true), danger: true },
  ];

  const subtitleText = failed ? '불러오지 못했어요' : items.length ? `틀린 문제 ${items.length}개 · 3번 연속 맞히면 졸업해요` : '틀린 문제가 모이는 곳이에요';
  const subtitle = loading ? (
    // 읽는 동안에도 부제 줄 높이를 지켜서, 다 읽었을 때 제목이 위로 튀지 않게 한다
    <span className="kok-skel inline-block h-6 align-top" aria-hidden="true">
      <span className="kok-bone mt-[7px] h-2.5 w-52 max-w-full" />
    </span>
  ) : selecting ? (
    // 한 줄로 (부제 줄이 늘어 아래 카드가 밀리지 않게)
    <span className="kok-swap">카드를 눌러 고르고, 아래에서 빼요</span>
  ) : (
    // 기억해 둔 목록으로 처음 그린 부제는 번지지 않는다
    <Swap key={subtitleText} still={!!first && !fresh}>
      {subtitleText}
    </Swap>
  );
  // 틀린 문제 카드가 번지는 순서 (약점 개념 카드 다음)
  const itemsFrom = weak.length ? weak.length + 2 : 1;

  return (
    <div className={cx('grid gap-3', selecting && 'pb-20')}>
      <LargeHeader
        title={
          selecting ? (
            <span key={pickedCount ? 'n' : 'none'} className="kok-swap">
              {pickedCount ? `${pickedCount}개 선택` : '문제 고르기'}
            </span>
          ) : (
            '오답노트'
          )
        }
        compactTitle={selecting ? (pickedCount ? `${pickedCount}개 선택` : '문제 고르기') : undefined}
        subtitle={subtitle}
        actions={
          selecting ? (
            <>
              <button
                type="button"
                // 위 띠 글자는 화면 위 빛 위에 놓이지 않게 알약 안에 (화면 바탕 위 글자는 본문·흐린 글자만: fx.ts)
                className="press rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent hover:brightness-95"
                onClick={() => setPicked(allPicked ? new Set() : new Set(items.map((x) => x.q.id)))}
              >
                {allPicked ? '모두 풀기' : '모두 고르기'}
              </button>
              <IconButton label="고르기 끝내기" onClick={endSelect}>
                <Icon d={ICONS.close} />
              </IconButton>
            </>
          ) : items.length ? (
            <>
              <LinkButton href="/review?mode=wrong" size="sm" className="kok-fill">
                전부 다시 풀기
              </LinkButton>
              <Menu label="오답노트 메뉴" items={headerMenu} />
            </>
          ) : null
        }
      />

      {!loading && !failed && hidden ? <p className="kok-fill -mt-1 px-1 text-sm text-muted">복습을 끈 노트의 틀린 문제 {hidden}개는 빼고 보여 줘요.</p> : null}
      {loading ? (
        <WrongSkeleton />
      ) : failed ? (
        <div className="kok-fill">
          <EmptyState
            icon={<Icon d={ICONS.retry} size={34} strokeWidth={2.2} />}
            title="오답노트를 불러오지 못했어요"
            body="인터넷 연결을 확인하고 다시 불러와 주세요."
            action={<Button onClick={retry}>다시 불러오기</Button>}
          />
        </div>
      ) : !items.length ? (
        // 자리 표시와 모양이 달라서 카드째 살짝 번지며 나타난다
        <div className="kok-fill">
          <EmptyState
            icon={<Icon d={ICONS.check} size={34} strokeWidth={2.2} />}
            title="오답노트가 비어 있어요"
            body="틀린 문제가 생기면 여기에 모여요."
            action={<LinkButton href="/home">홈으로</LinkButton>}
          />
        </div>
      ) : (
        // 자리 표시와 같은 모양의 카드는 그 자리에 두고, 안의 글만 위에서부터 차례로 번지며 나타난다
        <>
          {weak.length ? (
            <>
              <SectionTitle>
                <span className="kok-fill inline-block">약점 개념 {weak.length}개</span>
              </SectionTitle>
              <div className="grid gap-2">
                {weak.map((w, i) => {
                  const n = notes.get(w.note_id);
                  const t = titles.get(w.note_id)?.get(w.key_point_id)?.title ?? w.key_point_id;
                  const ids = w.questionIds.filter((id) => itemIds.has(id));
                  const pickedAll = ids.length > 0 && ids.every((id) => picked.has(id));
                  return (
                    <WeakCard
                      key={`${w.note_id}:${w.key_point_id}`}
                      index={i + 1}
                      title={t}
                      noteTitle={n?.title ?? '노트'}
                      count={w.count}
                      links={
                        n
                          ? {
                              solve: `/review?kp=${w.note_id}:${w.key_point_id}`,
                              note: `/notes/${n.source_id}?kp=${encodeURIComponent(w.key_point_id)}`,
                              map: `/notes/${n.source_id}?tab=visual&kp=${encodeURIComponent(w.key_point_id)}`,
                            }
                          : { solve: `/review?kp=${w.note_id}:${w.key_point_id}` }
                      }
                      selecting={selecting}
                      picked={pickedAll}
                      onPick={() => pickMany(ids, !pickedAll)}
                      onLongPress={() => {
                        if (selecting) pickMany(ids, !pickedAll);
                        else {
                          startSelect();
                          pickMany(ids, true);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </>
          ) : null}

          <SectionTitle>
            <span className="kok-fill block" style={{ ['--i' as string]: itemsFrom - 1 }}>
              틀린 문제 {items.length}개
            </span>
          </SectionTitle>
          {/* 고르는 동안에도 그대로 둔다 (줄이 사라지며 카드가 밀리지 않게) */}
          <p className="-mt-2 px-1 text-xs text-muted">카드를 꾹 누르면 여러 개를 한꺼번에 뺄 수 있어요 (개념 카드를 꾹 누르면 그 개념의 문제 모두).</p>
          <div className="grid gap-2">
            {items.map(({ q, lapses }, i) => (
              <WrongCard
                key={q.id}
                q={q}
                lapses={lapses}
                index={itemsFrom + i}
                expanded={open === q.id}
                onToggleOpen={() => setOpen(open === q.id ? null : q.id)}
                selecting={selecting}
                picked={picked.has(q.id)}
                onPick={() => togglePick(q.id)}
                onLongPress={() => (selecting ? togglePick(q.id) : startSelect(q.id))}
                onRemove={() => removeOne(q)}
              />
            ))}
          </div>
        </>
      )}

      {/* 여러 개 고르기: 아래 띠 (폰은 아래 메뉴 자리, 넓은 화면은 가운데 떠 있는 띠) */}
      {selecting ? (
        <SelectionBar count={pickedCount} noun="문제">
          <BarAction
            icon={ICONS.check}
            label={pickedCount ? `${pickedCount}개 다 외웠어요 · 빼기` : '뺄 문제를 골라 주세요'}
            prominent
            disabled={!pickedCount || !!busy}
            busy={busy === 'some'}
            onClick={removePicked}
          />
        </SelectionBar>
      ) : null}

      {/* 모두 빼기: 한 번 확인한다 (카드는 남아서 다시 틀리면 다시 들어온다) */}
      <Sheet
        open={confirmAll}
        onClose={() => !busy && setConfirmAll(false)}
        title="오답노트 비우기"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setConfirmAll(false)} disabled={!!busy}>
              그대로 두기
            </Button>
            <Button variant="danger" size="lg" busy={busy === 'all'} onClick={removeAll}>
              모두 빼기
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed">
          틀린 문제 <b>{items.length}개</b>를 모두 다 외운 문제로 뺄까요?
        </p>
        <p className="mt-2 text-sm text-muted">문제와 복습 카드는 그대로 있어요. 다시 틀리면 오답노트에 다시 들어와요.</p>
      </Sheet>
    </div>
  );
}

/**
 * 약점 개념 카드: 개념 풀기·노트·마인드맵 링크. 꾹 누르면 그 개념의 틀린 문제를 모두 골라 여러 개 고르기.
 * 고르는 동안에도 카드는 그대로(링크도 보인다)이고 모서리에 동그라미만 걸린다: 어디를 눌러도 고르기만 한다
 */
function WeakCard({
  index,
  title,
  noteTitle,
  count,
  links,
  selecting,
  picked,
  onPick,
  onLongPress,
}: {
  index: number;
  title: string;
  noteTitle: string;
  count: number;
  links: { solve: string; note?: string; map?: string };
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onLongPress: () => void;
}) {
  const press = useLongPress(onLongPress, true);
  const selectProps = selecting ? { role: 'checkbox' as const, 'aria-checked': picked, tabIndex: 0, onKeyDown: pickKeyHandler(onPick) } : {};
  return (
    <div
      className="kok-no-callout relative"
      style={{ ['--i' as string]: index }}
      {...press}
      onClickCapture={(e) => {
        press.onClickCapture(e);
        if (e.defaultPrevented) return;
        if (selecting) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      }}
    >
      <Card className={cx('grid gap-2', selecting && 'cursor-pointer', selecting && picked && PICKED_RING)} {...selectProps}>
        <div className="kok-fill flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-bold">{title}</p>
            <p className="truncate text-sm text-muted">{noteTitle}</p>
          </div>
          <Chip tone="bad">틀린 문제 {count}</Chip>
        </div>
        {/* 고르는 동안에도 보이지만 누를 수 없다 (누르면 카드를 고른다) */}
        <div className="kok-fill flex flex-wrap gap-2" inert={selecting || undefined} aria-hidden={selecting || undefined}>
          <LinkButton size="sm" href={links.solve}>
            이 개념 풀기
          </LinkButton>
          {links.note ? (
            <Link className={buttonClass('secondary', 'sm')} href={links.note}>
              노트에서 보기
            </Link>
          ) : null}
          {links.map ? (
            <Link className={buttonClass('secondary', 'sm')} href={links.map}>
              마인드맵에서 보기
            </Link>
          ) : null}
        </div>
      </Card>
      {selecting ? <PickBadge picked={picked} /> : null}
    </div>
  );
}

/** 틀린 문제 카드: 누르면 답을 펼치고, 꾹 누르면 여러 개 고르기 (고르는 동안은 카드 모양 그대로, 어디를 눌러도 고르기만) */
function WrongCard({
  q,
  lapses,
  index,
  expanded,
  onToggleOpen,
  selecting,
  picked,
  onPick,
  onLongPress,
  onRemove,
}: {
  q: QuestionRow;
  lapses: number;
  index: number;
  expanded: boolean;
  onToggleOpen: () => void;
  selecting: boolean;
  picked: boolean;
  onPick: () => void;
  onLongPress: () => void;
  onRemove: () => void | Promise<void>;
}) {
  const press = useLongPress(onLongPress, true);
  const selectProps = selecting ? { role: 'checkbox' as const, 'aria-checked': picked, tabIndex: 0, onKeyDown: pickKeyHandler(onPick) } : {};
  return (
    <div
      className="kok-no-callout relative"
      style={{ ['--i' as string]: index }}
      {...press}
      onClickCapture={(e) => {
        press.onClickCapture(e);
        if (e.defaultPrevented) return;
        // 고르는 중에는 카드 안 어디를 눌러도 고르기만 한다
        if (selecting) {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      }}
    >
      <Card className={cx('grid gap-2', selecting && 'cursor-pointer', selecting && picked && PICKED_RING)} {...selectProps}>
        <div className="kok-fill flex items-start gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            onClick={onToggleOpen}
            aria-expanded={expanded}
            tabIndex={selecting ? -1 : undefined}
          >
            <span className="line-clamp-2 min-w-0 flex-1 font-semibold">
              <RichText text={q.prompt} />
            </span>
            <Chip tone="bad">{lapses}번 틀림</Chip>
          </button>
        </div>
        {expanded ? (
          // 펼친 답은 바로 (늦추지 않고) 살짝 번지며 나타난다
          <div className="kok-fill" style={{ ['--i' as string]: 0 }}>
            <QuestionPreview q={q} />
          </div>
        ) : null}
        {/* 고르는 동안에도 보이지만 누를 수 없다 (누르면 카드를 고른다) */}
        <div className="kok-fill flex justify-end" inert={selecting || undefined} aria-hidden={selecting || undefined}>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            다 외웠어요 · 빼기
          </Button>
        </div>
      </Card>
      {selecting ? <PickBadge picked={picked} /> : null}
    </div>
  );
}

/** 오답노트를 읽는 동안: 실제 목록과 같은 모양·크기 (약점 개념 카드 둘, 틀린 문제 카드 둘) */
function WrongSkeleton() {
  return (
    <div className="kok-skel grid gap-3" aria-busy="true">
      <span className="sr-only">오답을 불러오는 중이에요</span>
      <SectionBone width="w-24" />
      <div className="grid gap-2" aria-hidden="true">
        <WeakCardBone title="w-28" />
        <WeakCardBone title="w-36" />
      </div>
      <SectionBone width="w-24" />
      <div className="grid gap-2" aria-hidden="true">
        <WrongCardBone lines={2} />
        <WrongCardBone lines={1} />
      </div>
    </div>
  );
}

/** 구역 제목 자리 (SectionTitle 과 같은 여백·높이) */
function SectionBone({ width }: { width: string }) {
  return (
    <div className="mb-1 mt-5 flex h-7 items-center px-1" aria-hidden="true">
      <span className={cx('kok-bone h-3.5', width)} />
    </div>
  );
}

/** 약점 개념 카드 자리: 개념·노트 이름, 틀린 수, 버튼 셋 (버튼과 같은 너비라 같은 화면 너비에서 줄이 바뀐다) */
function WeakCardBone({ title }: { title: string }) {
  return (
    <div className="kok-card kok-shimmer grid gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="grid">
          <span className="flex h-[25.6px] items-center">
            <span className={cx('kok-bone h-3', title)} />
          </span>
          <span className="flex h-5 items-center">
            <span className="kok-bone h-2.5 w-12" />
          </span>
        </div>
        <span className="kok-bone h-5 w-[74px]" />
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="kok-bone h-8 w-[95px]" />
        <span className="kok-bone h-8 w-[104px]" />
        <span className="kok-bone h-8 w-32" />
      </div>
    </div>
  );
}

/** 틀린 문제 카드 자리: 문제 글(한두 줄), 틀린 횟수, 빼기 버튼 */
function WrongCardBone({ lines }: { lines: 1 | 2 }) {
  return (
    <div className="kok-card kok-shimmer grid gap-2 p-4">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1">
          <span className="flex h-[25.6px] items-center">
            <span className={cx('kok-bone h-3', lines === 2 ? 'w-full' : 'w-[70%]')} />
          </span>
          {lines === 2 ? (
            <span className="flex h-[25.6px] items-center">
              <span className="kok-bone h-3 w-[45%]" />
            </span>
          ) : null}
        </div>
        <span className="kok-bone h-5 w-[62px]" />
      </div>
      <div className="flex h-8 items-center justify-end">
        <span className="kok-bone mr-3.5 h-2.5 w-24" />
      </div>
    </div>
  );
}
