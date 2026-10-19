'use client';
// 원본 탭 (노트 버전을 쓸 수 있을 때): 버전 기록(열기·이 버전 쓰기·지우기), 이 노트에 자료 더하기(Pro),
// 보고 있는 버전에 들어간 자료들의 원본
import { useRef, useState } from 'react';
import type { MeResponse } from '@/lib/types';
import { estimateEnergy, estimateFigures, estimateSmallTask, figuresWanted } from '@/lib/ai/models';
import { clientModel } from '@/lib/client-model';
import { MIN_TEXT_CHARS } from '@/lib/quick-add';
import { materialLabel, versionItems, type ChildSource, type Material, type VersionRow } from '@/lib/versions';
import { OriginalPanel } from './OriginalPanel';
import { Button, Chip, EnergyEstimate, ICONS, Icon, LinkButton, cx } from '../ui';

const KIND_ICON = { text: ICONS.pen, pdf: ICONS.file, image: ICONS.image } as const;
const KIND_LABEL = { text: '글', pdf: 'PDF', image: '사진' } as const;

export type ParentSource = {
  id: string;
  kind: 'text' | 'pdf' | 'image';
  title: string;
  text_content: string | null;
  file_paths: string[];
  files_expire_at: string | null;
  page_count: number | null;
  created_at: string;
};

const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

export function OriginalTab({
  me,
  parent,
  kids,
  versions,
  current,
  viewing,
  existing,
  liveQuestionCount,
  appendBusy,
  focusPage,
  busy,
  onOpen,
  onUse,
  onDelete,
  onAdd,
}: {
  me: MeResponse;
  parent: ParentSource;
  /** 이 노트에 더한 자료 (정리를 마친 것) */
  kids: ChildSource[];
  versions: VersionRow[];
  /** 지금 쓰는 버전 번호 */
  current: number;
  /** 보고 있는 버전 번호 */
  viewing: number;
  /** 이 노트에 아직 있는 문제 번호 (버전마다 문제 수 세기) */
  existing: Set<string>;
  liveQuestionCount: number;
  /** 더하는 자료를 정리하는 중인지 (그동안 버전을 바꾸거나 지울 수 없다) */
  appendBusy: boolean;
  focusPage: number | null;
  /** 하고 있는 일 ('use-2', 'del-3') */
  busy: string | null;
  onOpen: (n: number) => void;
  onUse: (n: number) => void;
  onDelete: (n: number) => void;
  onAdd: (files: File[], text: string) => void;
}) {
  const first: Material = { source_id: parent.id, kind: parent.kind, title: parent.title, page_count: parent.page_count };
  const items = versionItems(versions, current, { first, questionCount: liveQuestionCount, createdAt: parent.created_at, existing });
  const listed = versions.find((r) => r.number === viewing)?.materials ?? [];
  const materials = listed.length ? listed : [first];

  return (
    <div className="grid gap-4">
      {versions.length ? (
        <section className="kok-card kok-rise grid gap-1 p-2" aria-label="버전 기록">
          <div className="flex items-baseline justify-between px-2.5 pb-1 pt-2">
            <h2 className="font-display text-lg">버전 기록</h2>
            <span className="text-xs text-muted">자료를 더할 때마다 버전이 생겨요</span>
          </div>
          <ol className="grid gap-1">
            {items.map((it) => {
              const seeing = it.number === viewing;
              return (
                <li key={it.number} className={cx('rounded-2xl p-3', seeing ? 'bg-surface-2' : '')}>
                  <div className="flex items-start gap-3">
                    <span
                      className={cx(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold tabular-nums',
                        it.current ? 'bg-accent text-accent-ink' : 'bg-surface-3 text-ink',
                      )}
                      aria-hidden="true"
                    >
                      {it.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                        <span>
                          버전 {it.number} · {it.number === 1 ? '처음 자료' : '더한 자료'}
                        </span>
                        {it.current ? <Chip tone="accent">지금 쓰는 버전</Chip> : null}
                        {seeing && !it.current ? <Chip tone="hl">보는 중</Chip> : null}
                      </p>
                      {it.added ? (
                        <p className="flex min-w-0 items-center gap-1.5 text-sm">
                          <Icon d={KIND_ICON[it.added.kind]} size={15} className="shrink-0 text-muted" />
                          <span className="truncate">{materialLabel(it.added)}</span>
                        </p>
                      ) : null}
                      <p className="text-xs text-muted">
                        {[`자료 ${it.materialCount}개`, `문제 ${it.questionCount}개`, it.createdAt ? day(it.createdAt) : ''].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                    {!seeing ? (
                      <Button size="sm" variant="secondary" onClick={() => onOpen(it.number)}>
                        {it.current ? '지금 버전 보기' : '열기'}
                      </Button>
                    ) : null}
                    {!it.current ? (
                      <Button size="sm" disabled={appendBusy || !!busy} busy={busy === `use-${it.number}`} onClick={() => onUse(it.number)}>
                        이 버전 쓰기
                      </Button>
                    ) : null}
                    {items.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-bad"
                        disabled={appendBusy || !!busy}
                        busy={busy === `del-${it.number}`}
                        onClick={() => onDelete(it.number)}
                      >
                        지우기
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {appendBusy ? <p className="px-3 pb-2 text-xs text-muted">자료를 더하는 동안에는 버전을 바꾸거나 지울 수 없어요.</p> : null}
        </section>
      ) : null}

      <AddMaterial me={me} busyHint={appendBusy} onAdd={onAdd} />

      <section className="grid gap-2" aria-label="원본 자료">
        {materials.length > 1 ? (
          <>
            <p className="px-1 text-sm font-semibold text-muted">
              버전 {viewing}의 원본 자료 {materials.length}개
            </p>
            {materials.map((m, i) => (
              <MaterialCard
                key={m.source_id}
                m={m}
                index={i}
                parent={parent}
                kid={kids.find((k) => k.id === m.source_id) ?? null}
                focusPage={m.source_id === parent.id ? focusPage : null}
              />
            ))}
          </>
        ) : (
          <OriginalPanel kind={parent.kind} text={parent.text_content} paths={parent.file_paths} expireAt={parent.files_expire_at} focusPage={focusPage} />
        )}
      </section>
    </div>
  );
}

/** 버전에 들어간 자료 하나: 누르면 원본을 펼친다 (처음 자료는 펼친 채로) */
function MaterialCard({
  m,
  index,
  parent,
  kid,
  focusPage,
}: {
  m: Material;
  index: number;
  parent: ParentSource;
  kid: ChildSource | null;
  focusPage: number | null;
}) {
  const isParent = m.source_id === parent.id;
  const [open, setOpen] = useState(isParent);
  const src = isParent ? parent : kid;
  const id = `material-${m.source_id}`;
  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="kok-card press flex items-center gap-3 p-3.5 text-left"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted" aria-hidden="true">
          <Icon d={KIND_ICON[m.kind]} size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{materialLabel(m)}</span>
          <span className="block text-xs text-muted">
            {index + 1}. {isParent ? '처음 자료' : '더한 자료'} · {KIND_LABEL[m.kind]}
            {m.page_count ? ` ${m.page_count}${m.kind === 'image' ? '장' : '쪽'}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-sm text-muted">{open ? '접기' : '원본 보기'}</span>
      </button>
      {open ? (
        <div id={id}>
          {src ? (
            <OriginalPanel kind={m.kind} text={src.text_content} paths={src.file_paths ?? []} expireAt={src.files_expire_at} focusPage={focusPage} />
          ) : (
            <p className="kok-card p-4 text-sm text-muted">이 자료의 원본을 찾을 수 없어요.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 이 노트에 자료 더하기 (Pro). 글은 적고 [더하기], 파일은 고르면 바로 더한다 */
function AddMaterial({ me, busyHint, onAdd }: { me: MeResponse; busyHint: boolean; onAdd: (files: File[], text: string) => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const can = me.canAppend;
  const trimmed = text.trim();
  const model = clientModel(me, me.settings.models.organize);
  const figures = figuresWanted({ canFigures: me.canFigures, figuresSetting: me.settings.quiz.figures, featureOn: me.features.figures });
  const est =
    trimmed.length >= MIN_TEXT_CHARS
      ? estimateEnergy({ kind: 'text', chars: trimmed.length }, model, me.usdPerEnergy) +
        Math.ceil(estimateSmallTask(model, me.usdPerEnergy, 9000, 3000)) +
        (figures ? estimateFigures(clientModel(me, me.settings.models.quiz), me.usdPerEnergy) : 0)
      : null;

  return (
    <section className="kok-card grid gap-3 p-4" aria-label="이 노트에 자료 더하기">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden="true">
          <Icon d={ICONS.plus} size={18} strokeWidth={2.4} />
        </span>
        <h2 className="font-display text-lg">이 노트에 자료 더하기</h2>
        {!can ? <Chip tone="accent">Pro</Chip> : null}
      </div>
      {can ? (
        <>
          <p className="text-sm text-muted">
            더한 자료는 AI가 지금 노트와 합쳐 새 버전으로 만들어요. 문제는 새 내용으로만 더 만들고, 푼 기록은 그대로예요. 지금 버전은 버전 기록에 남아요.
          </p>
          <textarea
            className="min-h-[88px] w-full resize-y rounded-2xl bg-surface-2 px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted/80 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="더할 내용을 적거나 붙여 넣어요"
            value={text}
            maxLength={me.plan.textChars + 1000}
            onChange={(e) => setText(e.target.value)}
            aria-label="더할 내용"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              multiple
              accept="application/pdf,.pdf,image/*,.txt,.md"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) onAdd(files, '');
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={!me.aiEnabled}>
              <Icon d={ICONS.clip} size={17} />
              파일 더하기
            </Button>
            <span className="flex-1" />
            {est !== null ? (
              <span className="text-xs font-semibold text-muted">
                <EnergyEstimate est={est} />
              </span>
            ) : null}
            <Button
              size="sm"
              disabled={!me.aiEnabled || trimmed.length < MIN_TEXT_CHARS}
              onClick={() => {
                onAdd([], text);
                setText('');
              }}
            >
              글 더하기
            </Button>
          </div>
          {trimmed && trimmed.length < MIN_TEXT_CHARS ? (
            <p className="-mt-1 text-xs text-muted">
              {MIN_TEXT_CHARS}자 이상 적으면 더할 수 있어요 ({trimmed.length}/{MIN_TEXT_CHARS})
            </p>
          ) : null}
          {busyHint ? <p className="text-xs text-muted">앞서 더한 자료를 정리하고 있어요. 끝나면 이어서 더해요.</p> : null}
          <p className="text-xs text-muted">이 화면에 파일을 끌어다 놓거나 붙여 넣어도 이 노트에 더할 수 있어요.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Pro에서는 지금 노트에 PDF·사진·글을 더할 수 있어요. AI가 지금 노트와 합쳐 새 버전을 만들고, 버전마다 정리·그림·문제가 따로 남아요.
          </p>
          <LinkButton href="/plan" size="sm" variant="secondary" className="justify-self-start">
            요금제 보기
          </LinkButton>
        </>
      )}
    </section>
  );
}
