'use client';
// 자료 공유의 창: 갤러리 만들기·고치기, 신고, 노트 고르기, 노트를 넣을 과목 고르기, 받기 한도 안내
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, ICONS, Icon, Sheet, api, cx, inputClass, radioKeys, useToast, DONE } from '@/components/ui';
import { useMe } from '@/components/AppShell';
import { fetchSubjects, sb, topLevelSources } from '@/lib/data';
import { SOURCES_CHANGED, SUBJECTS_CHANGED } from '@/lib/events';
import { createSubject } from '@/components/SubjectPick';
import { subjectVar } from '@/lib/colors';
import { pickerOrder } from '@/lib/subject-order';
import { TIER_NAME, TIERS, type PlansConfig } from '@/lib/plans';
import {
  CATEGORY_LABEL,
  GALLERY_CATEGORIES,
  SHARE_REPORT_REASONS,
  SHARE_TEXT,
  galleryNameProblem,
  type GalleryCategory,
  type GalleryView,
  type ShareReportKind,
} from '@/lib/share';
import { REPORT_REASON_MAX, reportReason } from '@/lib/report';
import { josa } from '@/lib/josa';
import type { SubjectRow } from '@/lib/types';

const chip = (on: boolean) =>
  cx(
    'kok-chip press inline-flex min-h-9 items-center rounded-full px-3.5 py-1.5 text-left text-sm font-semibold',
    on ? 'kok-chip-on' : 'kok-chip-off bg-surface-2 text-ink hover:bg-surface-3',
  );

// ------------------------------------------------------------- 갤러리 만들기·고치기
export function GallerySheet({
  open,
  onClose,
  edit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** 고칠 갤러리 (없으면 새로 만들기) */
  edit?: GalleryView | null;
  onSaved: (g: GalleryView) => void;
}) {
  const { me } = useMe();
  const toast = useToast();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<GalleryCategory>('middle');
  const [busy, setBusy] = useState(false);
  // 열 때마다 처음 모습 (고치기면 지금 값)
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) {
      setName(edit?.name ?? '');
      setDesc(edit?.description ?? '');
      setCat(edit?.category ?? 'middle');
    }
  }
  const problem = name.trim() ? galleryNameProblem(name, !!me?.isAdmin) : null;
  const save = async () => {
    const p = galleryNameProblem(name, !!me?.isAdmin);
    if (p) return toast(p, 'bad');
    setBusy(true);
    try {
      const body = JSON.stringify({ name, description: desc, category: cat });
      const r = edit
        ? await api<{ gallery: GalleryView }>(`/api/share/galleries/${edit.id}`, { method: 'PATCH', body })
        : await api<{ gallery: GalleryView }>('/api/share/galleries', { method: 'POST', body });
      toast(edit ? '갤러리를 고쳤어요.' : '갤러리를 만들었어요. 첫 글을 써 보세요!', 'ok', DONE);
      onSaved({ ...r.gallery, fav: edit ? edit.fav : true });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title={edit ? '갤러리 고치기' : '갤러리 만들기'}
      footer={
        <Button className="w-full" size="lg" busy={busy} disabled={!name.trim() || !!problem} onClick={save}>
          {edit ? '저장' : '만들기'}
        </Button>
      }
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!edit ? (
          <p className="text-sm text-muted">
            누구나 갤러리를 만들 수 있어요. 만든 사람은 그 갤러리의 글과 댓글을 지울 수 있어요.
            {me?.share.galleries !== null && me?.share.galleries !== undefined ? ` 지금 요금제는 ${me.share.galleries}개까지 만들 수 있어요.` : ''}
          </p>
        ) : null}
        <Field label="이름" htmlFor="gallery-name" hint={problem ?? `${SHARE_TEXT.galleryName.min}~${SHARE_TEXT.galleryName.max}자 (예: 동성중 2학년 갤러리)`}>
          <input
            id="gallery-name"
            className={inputClass}
            value={name}
            maxLength={SHARE_TEXT.galleryName.max}
            placeholder="갤러리 이름"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="소개 (없어도 돼요)" htmlFor="gallery-desc">
          <textarea
            id="gallery-desc"
            className={cx(inputClass, 'min-h-20')}
            value={desc}
            maxLength={SHARE_TEXT.galleryDesc}
            placeholder="어떤 자료와 이야기를 나누는 곳인지"
            onChange={(e) => setDesc(e.target.value)}
          />
        </Field>
        <div className="grid gap-2">
          <p className="text-sm font-semibold" id="gallery-cat">
            분류
          </p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="gallery-cat">
            {GALLERY_CATEGORIES.map((c, i) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cat === c}
                tabIndex={cat === c ? 0 : -1}
                className={chip(cat === c)}
                onClick={() => setCat(c)}
                onKeyDown={(e) => radioKeys(e, i, GALLERY_CATEGORIES.length, (n) => setCat(GALLERY_CATEGORIES[n]))}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------- 글을 쓸 갤러리 고르기
/** 즐겨찾는 갤러리 먼저, 찾기(이름·소개)와 분류, 없으면 새로 만들기 */
export function GalleryPickSheet({
  open,
  onClose,
  onPick,
  onMake,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (g: GalleryView) => void;
  /** '새 갤러리 만들기' (이 창을 닫고 만들기 창을 연다) */
  onMake: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [list, setList] = useState<GalleryView[] | null>(null);
  // 열 때마다 처음 모습
  const [seen, setSeen] = useState(false);
  if (open !== seen) {
    setSeen(open);
    if (open) {
      setQ('');
      setList(null);
    }
  }
  const term = q.trim();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    // 글자를 치는 동안은 조금 기다렸다가 찾는다
    const t = setTimeout(
      () => {
        api<{ galleries: GalleryView[] }>(`/api/share/galleries${term ? `?q=${encodeURIComponent(term)}` : ''}`)
          .then((r) => {
            if (!alive) return;
            // 즐겨찾는 갤러리 먼저 (같으면 서버 차례: 글이 많은 차례)
            setList([...r.galleries].sort((a, b) => Number(b.fav) - Number(a.fav)));
          })
          .catch(() => {
            if (!alive) return;
            setList([]);
            toast('갤러리를 불러오지 못했어요.', 'bad');
          });
      },
      term ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, term, toast]);
  return (
    <Sheet open={open} onClose={onClose} title="갤러리 고르기">
      <div className="grid gap-3">
        <input
          aria-label="갤러리 찾기"
          className={inputClass}
          value={q}
          maxLength={30}
          placeholder="갤러리 이름으로 찾기"
          onChange={(e) => setQ(e.target.value)}
        />
        {list === null ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : !list.length ? (
          <p className="text-sm text-muted">{term ? `'${term}' 갤러리가 없어요. 새로 만들어 보세요.` : '아직 갤러리가 없어요.'}</p>
        ) : (
          <ul className="grid max-h-[46vh] gap-1.5 overflow-y-auto overscroll-contain" aria-label="갤러리">
            {list.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="press flex w-full items-center gap-3 rounded-2xl bg-surface-2 px-3.5 py-3 text-left hover:bg-surface-3"
                  onClick={() => {
                    onPick(g);
                    onClose();
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{g.name}</span>
                      {g.fav ? <Icon d={ICONS.star} size={14} className="shrink-0 text-warn" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {CATEGORY_LABEL[g.category]} · 글 {g.posts}
                      {g.description ? ` · ${g.description}` : ''}
                    </span>
                  </span>
                  <Icon d={ICONS.chevronRight} size={18} className="shrink-0 text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            // 만들기를 먼저 알린 뒤 닫는다 (닫힐 때 '고르지 않고 닫음'으로 보지 않게)
            onMake();
            onClose();
          }}
        >
          <Icon d={ICONS.plus} size={16} strokeWidth={2.4} />새 갤러리 만들기
        </Button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------- 신고
const REPORT_INTRO: Record<ShareReportKind, string> = {
  post: '이 글에 어떤 문제가 있는지 알려 주세요. 운영자가 확인하고, 신고가 여러 번 쌓이면 확인할 때까지 가려져요.',
  comment: '이 댓글에 어떤 문제가 있는지 알려 주세요. 운영자가 확인해요.',
  gallery: '이 갤러리에 어떤 문제가 있는지 알려 주세요. 운영자가 확인해요.',
};

export function ShareReportSheet({ what, onClose }: { what: { kind: ShareReportKind; id: string } | null; onClose: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const key = what ? `${what.kind}:${what.id}` : null;
  if (key !== seen) {
    setSeen(key);
    setPicked(null);
    setText('');
  }
  const reason = reportReason(picked, text);
  const send = async () => {
    if (!what || !reason || busy) return;
    setBusy(true);
    try {
      await api('/api/share/report', { method: 'POST', body: JSON.stringify({ kind: what.kind, id: what.id, reason }) });
      toast('신고했어요. 운영자가 확인할게요.', 'ok', DONE);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={!!what} onClose={() => !busy && onClose()} title="신고하기">
      {what ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="text-sm text-muted">{REPORT_INTRO[what.kind]}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="신고하는 까닭">
            {SHARE_REPORT_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={picked === r} className={chip(picked === r)} onClick={() => setPicked(picked === r ? null : r)}>
                {r}
              </button>
            ))}
          </div>
          <textarea
            className={cx(inputClass, 'min-h-24')}
            value={text}
            maxLength={REPORT_REASON_MAX - 100}
            onChange={(e) => setText(e.target.value)}
            placeholder={picked ? '더 알려 줄 것이 있으면 적어 주세요 (없어도 돼요)' : '무엇이 문제인지 적어 주세요'}
            aria-label="자세한 내용"
          />
          {picked === SHARE_REPORT_REASONS[0] ? (
            <p className="text-xs text-muted">저작권자라면 어떤 자료의 권리를 가지고 있는지 적어 주세요. 확인되면 바로 지워요.</p>
          ) : null}
          <Button type="submit" size="lg" disabled={!reason} busy={busy}>
            <Icon d={ICONS.flag} size={18} />
            신고 보내기
          </Button>
        </form>
      ) : null}
    </Sheet>
  );
}

// ------------------------------------------------------------- 내 노트 고르기
export type PickedNote = { sourceId: string; title: string; subject: string };

export function NotePickerSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (n: PickedNote) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Array<{ id: string; title: string; subject_id: string; created_at: string }> | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [q, setQ] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      fetchSubjects(),
      topLevelSources<Array<{ id: string; title: string; subject_id: string; created_at: string }>>((onlyTop) => {
        let q = sb().from('sources').select('id, title, subject_id, created_at').eq('status', 'ready').order('created_at', { ascending: false }).limit(300);
        if (onlyTop) q = q.is('parent_id', null);
        return q;
      }),
    ])
      .then(([subs, list]) => {
        if (!alive) return;
        if (list.error) throw list.error;
        setSubjects(subs);
        setRows(list.data ?? []);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open, attempt]);
  const subjectOf = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const shown = (rows ?? []).filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="내 노트 붙이기">
      <div className="grid gap-3">
        <p className="text-sm text-muted">
          노트의 정리·마인드맵·문제가 이 글에 담겨요. 받은 사람은 AI 없이 바로 자기 자료함에 넣을 수 있어요. 원본 파일은 담기지 않아요.
        </p>
        <input aria-label="노트 찾기" className={inputClass} value={q} placeholder="노트 이름으로 찾기" onChange={(e) => setQ(e.target.value)} />
        {rows === null ? (
          failed ? (
            <LoadFailed
              what="노트 목록"
              onRetry={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            />
          ) : (
            <p className="text-sm text-muted">불러오는 중…</p>
          )
        ) : !shown.length ? (
          <p className="text-sm text-muted">{rows.length ? '찾는 노트가 없어요.' : '아직 정리가 끝난 노트가 없어요.'}</p>
        ) : (
          <ul className="grid max-h-[50vh] gap-1.5 overflow-y-auto overscroll-contain">
            {shown.map((r) => {
              const s = subjectOf.get(r.subject_id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="press flex w-full items-center gap-3 rounded-2xl bg-surface-2 px-3.5 py-3 text-left hover:bg-surface-3"
                    onClick={async () => {
                      // 공유받아 넣은 노트는 다시 나누지 않는다 (서버도 막는다: 고른 뒤 올릴 때 알기보다 지금)
                      const { data } = await sb().from('notes').select('shared:body->shared').eq('source_id', r.id).maybeSingle();
                      if (data && (data as { shared?: unknown }).shared) {
                        toast('공유받은 노트는 다시 공유할 수 없어요. 내가 만든 노트를 골라 주세요.', 'bad');
                        return;
                      }
                      onPick({ sourceId: r.id, title: r.title || '이름 없는 노트', subject: s?.name ?? '' });
                      onClose();
                    }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s ? subjectVar(s.color) : 'var(--line)' }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.title || '이름 없는 노트'}</span>
                      <span className="block truncate text-xs text-muted">{s?.name ?? ''}</span>
                    </span>
                    <Icon d={ICONS.plus} size={18} className="shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** 시트 안에서 읽지 못했을 때: 까닭 한 줄 + 다시 불러오기 */
function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-3.5 py-3">
      <p className="min-w-0 flex-1 text-sm">{josa(what, '을')} 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        다시 불러오기
      </Button>
    </div>
  );
}

// ------------------------------------------------------------- 공유받은 노트를 넣을 과목
export function ImportSheet({
  open,
  onClose,
  postId,
  title,
  defaultSubject,
}: {
  open: boolean;
  onClose: () => void;
  postId: string;
  title: string;
  /** 노트를 공유한 사람의 과목 이름 (같은 이름의 과목이 있으면 먼저 고른다) */
  defaultSubject: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetchSubjects()
      .then((s) => {
        if (!alive) return;
        const list = pickerOrder(s, null);
        setSubjects(list);
        const same = list.find((x) => x.name.trim() === defaultSubject.trim());
        setPick(same?.id ?? list[0]?.id ?? 'new');
        setNewName(same ? '' : defaultSubject);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, defaultSubject, attempt]);
  const save = async () => {
    setBusy(true);
    try {
      let subjectId = pick;
      if (pick === 'new') {
        const name = newName.trim();
        if (!name) {
          toast('새 과목 이름을 적어 주세요.', 'bad');
          return;
        }
        const made = await createSubject(name, subjects ?? [], toast);
        if (!made) return;
        window.dispatchEvent(new Event(SUBJECTS_CHANGED));
        subjectId = made.id;
      }
      if (!subjectId) return;
      const r = await api<{ sourceId: string; existing?: boolean }>(`/api/share/posts/${postId}/import`, {
        method: 'POST',
        body: JSON.stringify({ subjectId }),
      });
      if (r.existing) toast('이미 넣은 노트예요. 그 노트를 열게요.');
      else toast('내 자료함에 넣었어요. 문제는 오늘 복습에도 나와요.', 'ok', DONE);
      window.dispatchEvent(new Event(SOURCES_CHANGED));
      onClose();
      router.push(`/notes/${r.sourceId}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title="내 자료함에 넣기"
      footer={
        <Button className="w-full" size="lg" busy={busy} disabled={!pick || (pick === 'new' && !newName.trim())} onClick={save}>
          넣기 · 에너지 0
        </Button>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm text-muted">&lsquo;{title}&rsquo; 노트를 고른 과목에 넣어요. 정리·마인드맵·문제가 그대로 들어오고 AI를 쓰지 않아요.</p>
        {subjects === null ? (
          failed ? (
            <LoadFailed
              what="과목"
              onRetry={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            />
          ) : (
            <p className="text-sm text-muted">불러오는 중…</p>
          )
        ) : (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="넣을 과목">
            {subjects.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={pick === s.id}
                tabIndex={pick === s.id ? 0 : -1}
                className={chip(pick === s.id)}
                onClick={() => setPick(s.id)}
                onKeyDown={(e) => radioKeys(e, i, subjects.length + 1, (n) => setPick(subjects[n]?.id ?? 'new'))}
              >
                <span className="mr-1.5 h-2.5 w-2.5 rounded-full" style={{ background: subjectVar(s.color) }} aria-hidden="true" />
                {s.name}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={pick === 'new'}
              tabIndex={pick === 'new' ? 0 : -1}
              className={chip(pick === 'new')}
              onClick={() => setPick('new')}
              onKeyDown={(e) => radioKeys(e, subjects.length, subjects.length + 1, (n) => setPick(subjects[n]?.id ?? 'new'))}
            >
              <Icon d={ICONS.plus} size={14} className="mr-1" />새 과목
            </button>
          </div>
        )}
        {pick === 'new' ? (
          <input
            aria-label="새 과목 이름"
            className={inputClass}
            value={newName}
            maxLength={40}
            placeholder="새 과목 이름"
            onChange={(e) => setNewName(e.target.value)}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------- 받기 한도 안내
export function DownloadLimitSheet({ open, onClose, daily }: { open: boolean; onClose: () => void; daily: number | null }) {
  const router = useRouter();
  const [plans, setPlans] = useState<PlansConfig | null>(null);
  useEffect(() => {
    if (!open || plans) return;
    api<{ plans: PlansConfig }>('/api/plans')
      .then((r) => setPlans(r.plans))
      .catch(() => {});
  }, [open, plans]);
  return (
    <Sheet open={open} onClose={onClose} title="오늘 받을 수 있는 자료를 다 받았어요">
      <div className="grid gap-3">
        <p className="text-[15px] leading-relaxed">
          오늘은 자료를 {daily ?? 0}개까지 받을 수 있어요. 내일 다시 받을 수 있고, 이미 받은 자료는 언제든 다시 열 수 있어요.
        </p>
        {plans ? (
          <ul className="grid gap-1.5">
            {TIERS.map((t) => (
              <li key={t} className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
                <span className="font-semibold">{TIER_NAME[t]}</span>
                <span className="tabular-nums">하루 {plans[t].downloadsDaily}개</span>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          size="lg"
          onClick={() => {
            onClose();
            router.push('/plan');
          }}
        >
          요금제 보기
        </Button>
      </div>
    </Sheet>
  );
}
