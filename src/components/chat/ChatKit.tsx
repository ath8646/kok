'use client';
// 채팅 창 조각 (노트 채팅·홈 AI 채팅 공통): 모델 고르기, 입력 줄(파일·사진 붙이기), 보낸 파일, 답 기다리기, 풀이 카드, 사진 크게 보기
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RichText } from '@/components/RichText';
import { StepPlayer } from '@/components/figure/StepPlayer';
import { ICONS, Icon, Spinner, cx } from '@/components/ui';
import { isSubmitKey } from '@/lib/quick-add';
import { CHAT_FILE_LIMITS, solutionAnswer, type ChatSolution } from '@/lib/chat';
import { pickChatFiles, releasePicks, type ChatPick } from '@/lib/chat-files';
import { pushFileSink } from '@/lib/file-sink';
import type { ModelTier } from '@/lib/settings';

export const TIER_LABEL: Record<ModelTier, string> = { fast: '빠름', careful: '꼼꼼', admin: '최고' };

/** 모델 고르기 (빠름·꼼꼼·최고). locked: Pro 가 아니라 못 쓰는 것 */
export function TierPicker({
  tiers,
  tier,
  locked,
  onPick,
}: {
  tiers: ModelTier[];
  tier: ModelTier;
  locked: (t: ModelTier) => boolean;
  onPick: (t: ModelTier) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-full bg-surface-2 p-0.5" role="radiogroup" aria-label="AI 모델">
      {tiers.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={tier === t}
          onClick={() => onPick(t)}
          className={cx(
            'press rounded-full px-2.5 py-1 text-xs font-bold transition-colors',
            tier === t ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
            locked(t) && 'opacity-60',
          )}
        >
          {TIER_LABEL[t]}
          {locked(t) ? ' · Pro' : ''}
        </button>
      ))}
    </div>
  );
}

const KIND_NAME = { image: '사진', pdf: 'PDF', text: '글 파일' } as const;

/** 보내기 전에 붙인 파일 (사진은 작은 그림, 나머지는 이름 조각) */
export function PickStrip({ picks, onRemove }: { picks: ChatPick[]; onRemove: (id: string) => void }) {
  if (!picks.length) return null;
  return (
    <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5" aria-label="붙인 파일">
      {picks.map((p) => (
        <li
          key={p.id}
          className={cx(
            'kok-attach relative flex h-16 shrink-0 items-center overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-inset ring-line',
            p.preview ? 'w-16' : 'max-w-[200px] gap-2 pl-2 pr-9',
          )}
          title={p.file.name}
        >
          {p.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.preview} alt={p.file.name} className="h-full w-full object-cover" />
          ) : (
            <>
              <span
                className={cx(
                  'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
                  p.kind === 'pdf' ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent',
                )}
              >
                <Icon d={p.kind === 'pdf' ? ICONS.file : ICONS.pen} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{p.file.name}</span>
                <span className="block text-[11px] text-muted">
                  {KIND_NAME[p.kind]} · {Math.max(1, Math.round(p.file.size / 1024))}KB
                </span>
              </span>
            </>
          )}
          <button
            type="button"
            aria-label={`${p.file.name} 빼기`}
            className="press absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
            onClick={() => onRemove(p.id)}
          >
            <Icon d={ICONS.close} size={12} strokeWidth={2.8} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 보낸 말에 붙은 파일: 사진은 눌러서 크게 본다. url 이 없으면(보관하지 않음) 이름만 */
export type SentFile = { kind: 'image' | 'pdf' | 'text'; name: string; url?: string | null };

export function SentFiles({ files, onOpenImage }: { files: SentFile[]; onOpenImage: (f: SentFile) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex max-w-[88%] flex-wrap justify-end gap-1.5" aria-label="보낸 파일">
      {files.map((f, i) =>
        f.kind === 'image' && f.url ? (
          <li key={i}>
            <button
              type="button"
              className="press block h-[88px] w-[88px] overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-inset ring-line"
              onClick={() => onOpenImage(f)}
              aria-label={`${f.name} 크게 보기`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.name} className="h-full w-full object-cover" loading="lazy" />
            </button>
          </li>
        ) : (
          <li key={i} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-1.5 pr-3 text-xs" title={f.name}>
            <span
              className={cx(
                'grid h-6 w-6 shrink-0 place-items-center rounded-full',
                f.kind === 'pdf' ? 'bg-bad-soft text-bad' : f.kind === 'image' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent',
              )}
            >
              <Icon d={f.kind === 'pdf' ? ICONS.file : f.kind === 'image' ? ICONS.image : ICONS.pen} size={13} strokeWidth={2.2} />
            </span>
            {f.url && f.kind === 'pdf' ? (
              <a href={f.url} target="_blank" rel="noreferrer" className="truncate font-semibold underline-offset-2 hover:underline">
                {f.name}
              </a>
            ) : (
              <span className="truncate font-semibold">{f.name}</span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

/** 답을 기다리는 동안: 점 세 개와 글, 오래 걸리면 지난 초 */
export function ThinkingRow({ label }: { label: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <li className="flex items-center gap-2 px-1 text-sm text-muted" aria-label={label}>
      <span className="inline-flex gap-1" aria-hidden="true">
        <span className="kok-dot h-1.5 w-1.5 rounded-full bg-muted" />
        <span className="kok-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:120ms]" />
        <span className="kok-dot h-1.5 w-1.5 rounded-full bg-muted [animation-delay:240ms]" />
      </span>
      {label}
      {sec >= 6 ? <span className="tabular-nums text-muted/80">· {sec}초</span> : null}
    </li>
  );
}

/**
 * AI 가 풀어 준 문제: 읽은 문제(눌러서 펼치기), 단계별 풀이(Pro 는 그림), 아래에 넣기 같은 버튼.
 * 문제 글은 세 줄까지 보여 주고 더 길면 '더 보기'
 */
export function SolutionCard({ solution, actions, className }: { solution: ChatSolution; actions?: ReactNode; className?: string }) {
  const [more, setMore] = useState(false);
  const long = solution.problem.length > 120 || solution.problem.split('\n').length > 3;
  // 노트에 넣을 문제의 정답 (단계 끝의 답과 같아야 한다. 넣기 전에 학생이 확인할 수 있게)
  const answer = solutionAnswer(solution.question);
  return (
    <div className={cx('grid w-full gap-2.5', className)}>
      {solution.problem ? (
        <div className="rounded-[18px] bg-surface-2/70 px-3.5 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted">
            <Icon d={ICONS.search} size={12} strokeWidth={2.4} />
            읽은 문제
            {solution.subject ? (
              <span className="rounded-full bg-surface px-1.5 py-px text-[10px] font-semibold">
                {[solution.subject, solution.unit].filter(Boolean).join(' · ')}
              </span>
            ) : null}
          </p>
          <p className={cx('whitespace-pre-line text-sm leading-relaxed', !more && long && 'line-clamp-3')}>
            <RichText text={solution.problem} />
          </p>
          {long ? (
            <button type="button" className="mt-0.5 text-xs font-semibold text-accent" onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? '접기' : '더 보기'}
            </button>
          ) : null}
        </div>
      ) : null}
      {solution.steps.length ? (
        <div data-own-keys>
          <StepPlayer figure={solution.figure} steps={solution.steps} compact />
        </div>
      ) : null}
      {answer ? (
        <p className="flex items-baseline gap-2 px-1 text-[15px] leading-relaxed">
          <b className="shrink-0 text-sm text-ok">정답</b>
          <span className="min-w-0 font-semibold">
            <RichText text={answer} />
          </span>
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** 사진 크게 보기 (누르거나 Esc 로 닫기) */
export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // 열면 닫기 단추로, 닫으면 연 곳(사진)으로 초점을 옮긴다
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div className="kok-drop fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="kok-drop-card max-h-full max-w-full rounded-2xl object-contain shadow-2xl" />
      <button
        ref={close}
        type="button"
        aria-label="닫기"
        className="press absolute right-4 top-[calc(16px+env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
        onClick={onClose}
      >
        <Icon d={ICONS.close} size={20} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/**
 * 입력 줄: 파일 붙이기(클립 아이콘), 사진 찍기(카메라 아이콘), 글, 보내기. 엔터로 보내고 Shift+엔터·한글 조합 중 엔터는 줄바꿈.
 * cameraRef: 밖에서 사진 찍기를 바로 열 때 (홈의 카메라 버튼)
 */
export function ChatInput({
  text,
  onText,
  onFiles,
  onSend,
  canSend,
  sending,
  placeholder,
  areaRef,
  cameraRef,
  maxLength = 2000,
}: {
  text: string;
  onText: (t: string) => void;
  onFiles: (files: File[]) => void;
  onSend: () => void;
  canSend: boolean;
  sending: boolean;
  placeholder: string;
  areaRef: React.RefObject<HTMLTextAreaElement | null>;
  cameraRef?: React.RefObject<HTMLInputElement | null>;
  maxLength?: number;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const ownCamera = useRef<HTMLInputElement>(null);
  const camera = cameraRef ?? ownCamera;

  // 입력칸 높이를 글에 맞춘다
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text, areaRef]);

  return (
    <div className="flex items-end gap-1">
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="image/*,application/pdf,.pdf,.txt,.md"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="press grid h-11 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        aria-label="사진·파일 붙이기"
        title="사진·파일 붙이기"
        onClick={() => fileInput.current?.click()}
      >
        <Icon d={ICONS.clip} size={21} />
      </button>
      <button
        type="button"
        className="press grid h-11 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        aria-label="사진 찍기"
        title="사진 찍기"
        onClick={() => camera.current?.click()}
      >
        <Icon d={ICONS.camera} size={21} />
      </button>
      <textarea
        ref={areaRef}
        rows={1}
        enterKeyHint="send"
        className="max-h-[140px] min-h-[44px] w-full resize-none rounded-[22px] bg-surface-2 px-4 py-2.5 text-[16px] leading-snug text-ink placeholder:text-muted/80 focus:outline-none"
        placeholder={placeholder}
        value={text}
        maxLength={maxLength}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e.nativeEvent)) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        aria-label="물어볼 내용"
      />
      <button
        type="submit"
        className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-35"
        disabled={!canSend}
        aria-label="보내기"
      >
        {sending ? <Spinner className="h-4 w-4" /> : <Icon d={ICONS.send} size={19} strokeWidth={2.2} />}
      </button>
    </div>
  );
}

/** 폰에서 키보드가 열리면 보이는 화면(visualViewport)에 맞춰 창을 줄인다 (아래 입력칸이 키보드에 가리지 않게) */
export function useKeyboardInset(open: boolean): { height: number; top: number } | null {
  const [kb, setKb] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const v = typeof window === 'undefined' ? null : window.visualViewport;
    if (!open || !v) return;
    const onResize = () => {
      const covered = window.innerHeight - v.height;
      setKb(covered > 120 && window.innerWidth < 640 ? { height: v.height, top: v.offsetTop } : null);
    };
    v.addEventListener('resize', onResize);
    v.addEventListener('scroll', onResize);
    return () => {
      v.removeEventListener('resize', onResize);
      v.removeEventListener('scroll', onResize);
    };
  }, [open]);
  return open ? kb : null;
}

/** 파일을 끌고 오면 창 위에 뜨는 안내 */
export function ChatDropHint() {
  return (
    <div className="kok-drop pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[28px] bg-[color-mix(in_srgb,var(--surface)_86%,transparent)] backdrop-blur-[3px]">
      <div className="grid justify-items-center gap-2 text-center">
        <span className="kok-float grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-ink shadow-lg">
          <Icon d={ICONS.upload} size={26} strokeWidth={2.2} />
        </span>
        <p className="font-display text-lg">여기에 놓으면 채팅에 붙여요</p>
        <p className="text-sm text-muted">사진 · PDF · 글 파일</p>
      </div>
    </div>
  );
}

/**
 * 붙일 파일 관리: 고르기·빼기, 창이 열려 있는 동안 끌어다 놓기·붙여 넣기한 파일도 받는다 (자료 넣기 대신).
 * dragging: 파일을 끌고 오는 중 (창 위에 안내를 띄운다)
 */
export function useChatAttach(open: boolean, toast: (text: string, tone?: 'plain' | 'ok' | 'bad') => void) {
  const [picks, setPicks] = useState<ChatPick[]>([]);
  const [dragging, setDragging] = useState(false);
  const picksRef = useRef<ChatPick[]>([]);
  useEffect(() => {
    picksRef.current = picks;
  }, [picks]);

  const add = useCallback(
    (files: File[]) => {
      const { picks: got, skipped } = pickChatFiles(files);
      if (skipped.length) toast(`사진·PDF·글 파일만 붙일 수 있어요. (${skipped.slice(0, 2).join(', ')})`, 'bad');
      const room = Math.max(0, CHAT_FILE_LIMITS.files - picksRef.current.length);
      if (got.length > room) {
        toast(`한 번에 ${CHAT_FILE_LIMITS.files}개까지 붙일 수 있어요.`, 'bad');
        releasePicks(got.slice(room));
      }
      const kept = got.slice(0, room);
      if (!kept.length) return;
      picksRef.current = [...picksRef.current, ...kept];
      setPicks(picksRef.current);
    },
    [toast],
  );
  const remove = useCallback((id: string) => {
    const gone = picksRef.current.filter((p) => p.id === id);
    releasePicks(gone);
    picksRef.current = picksRef.current.filter((p) => p.id !== id);
    setPicks(picksRef.current);
  }, []);
  /** 보낼 때: 붙인 것을 넘겨주고 비운다 (미리보기 주소는 보낸 말에서 계속 쓴다) */
  const take = useCallback((): ChatPick[] => {
    const out = picksRef.current;
    picksRef.current = [];
    setPicks([]);
    return out;
  }, []);
  /** 보내지 못했을 때 되돌린다 */
  const restore = useCallback((back: ChatPick[]) => {
    picksRef.current = [...back, ...picksRef.current].slice(0, CHAT_FILE_LIMITS.files);
    setPicks(picksRef.current);
  }, []);
  const clear = useCallback(() => {
    releasePicks(picksRef.current);
    picksRef.current = [];
    setPicks([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    const off = pushFileSink(add);
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      off();
      setDragging(false);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [open, add]);

  // 창이 없어질 때 미리보기 주소를 돌려준다
  useEffect(() => () => releasePicks(picksRef.current), []);

  return { picks, add, remove, take, restore, clear, dragging };
}
