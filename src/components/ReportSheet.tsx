'use client';
// '이상해요' 신고: AI 가 만든 노트·채팅 답·표지 그림·테마 그림·레슨에서 틀리거나 이상한 곳을 알린다 (/api/reports).
// 이유를 하나 고르고(칩, 다시 누르면 풀림) 더 적을 말은 글로. 보내면 알림을 띄우고 닫는다.
// - ReportForm: 시트 없이 쓰는 몸통 (표지 그림 창처럼 이미 열린 시트 안에서 내용만 바꿔 보일 때)
// - ReportSheet: 시트 + 몸통. 전체 화면 창(레슨·테마 만들기) 안에 두면 그 창 위에 뜬다 (Esc 는 그 창이 먼저 받으니 창이 닫기를 막는다)
import { useEffect, useId, useRef, useState } from 'react';
import { REPORT_REASONS, REPORT_REASON_MAX, reportReason, type ReportKind } from '@/lib/report';
import { Button, DONE, ICONS, Icon, Sheet, api, cx, inputClass, useToast } from './ui';

/** 무엇을 신고하는지: target 은 서버가 결과를 다시 읽을 번호, snapshot 은 저장하지 않는 결과(홈 채팅 답·보던 칸) */
export type ReportWhat = { kind: ReportKind; target?: string; snapshot?: string };

const INTRO: Record<ReportKind, string> = {
  note: '정리나 그림에서 틀린 곳, 이상한 곳을 알려 주세요. 관리자가 확인해요. 직접 고칠 수도 있어요.',
  chat: 'AI 답에서 틀리거나 이상한 곳을 알려 주세요. 관리자가 확인하고 더 잘 답하게 고칠게요.',
  cover: '표지 그림이 노트와 맞지 않거나 이상하면 알려 주세요. 다시 그리기로 새로 그릴 수도 있어요.',
  theme: 'AI가 그린 그림이 이상하거나 불쾌하면 알려 주세요. 관리자가 확인해요.',
  course: '레슨에서 틀리거나 이상한 곳을 알려 주세요. 지금 보던 카드나 문제도 같이 보내요.',
};
const PLACEHOLDER: Record<ReportKind, string> = {
  note: '예: 2번 개념 설명이 교과서와 달라요',
  chat: '예: 3단계 계산이 틀렸어요',
  cover: '예: 연표의 순서가 거꾸로예요',
  theme: '예: 그림 구석에 글자가 있어요',
  course: '예: 확인 문제의 정답이 2번이 아니라 3번이에요',
};

export function ReportForm({ what, onDone, autoFocus = false }: { what: ReportWhat; onDone: () => void; autoFocus?: boolean }) {
  // 이미 열린 창의 내용이 바뀌어 신고 칸이 될 때 (표지 창): 누른 단추가 사라지니 첫 이유 칩에 초점
  const reasons = useRef<HTMLDivElement>(null);
  const reasonsId = useId();
  useEffect(() => {
    if (autoFocus) reasons.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [autoFocus]);
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const reason = reportReason(picked, text);
  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await api('/api/reports', { method: 'POST', body: JSON.stringify({ ...what, reason }) });
      toast('신고했어요. 고마워요!', 'ok', DONE);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'bad');
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <p className="text-sm text-muted">{INTRO[what.kind]}</p>
      <div className="grid gap-2">
        <p id={reasonsId} className="text-sm font-semibold">
          무엇이 이상한가요?
        </p>
        <div ref={reasons} className="flex flex-wrap gap-1.5" role="group" aria-labelledby={reasonsId}>
          {REPORT_REASONS[what.kind].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={picked === r}
              onClick={() => setPicked(picked === r ? null : r)}
              className={cx(
                'press inline-flex min-h-9 items-center rounded-full px-3.5 py-1.5 text-left text-sm font-semibold',
                picked === r ? 'kok-chip-on' : 'kok-chip-off bg-surface-2 text-ink hover:bg-surface-3',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className={cx(inputClass, 'min-h-24')}
        value={text}
        // 고른 이유('…: ')와 합쳐 1000자 안
        maxLength={REPORT_REASON_MAX - 100}
        onChange={(e) => setText(e.target.value)}
        placeholder={picked ? '더 알려 줄 것이 있으면 적어 주세요 (없어도 돼요)' : PLACEHOLDER[what.kind]}
        aria-label="자세한 내용"
      />
      <Button type="submit" size="lg" disabled={!reason} busy={busy}>
        <Icon d={ICONS.flag} size={18} />
        보내기
      </Button>
    </form>
  );
}

export function ReportSheet({ what, onClose }: { what: ReportWhat | null; onClose: () => void }) {
  return (
    <Sheet open={!!what} onClose={onClose} title="이상해요">
      {what ? <ReportForm key={`${what.kind}:${what.target ?? ''}`} what={what} onDone={onClose} /> : null}
    </Sheet>
  );
}

/** AI 결과 아래의 작은 '이상해요' 단추 (채팅 답·표지 창·레슨 위 띠) */
export function ReportButton({ onClick, label = '이상해요', className }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'press inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-ink',
        className,
      )}
    >
      <Icon d={ICONS.flag} size={14} strokeWidth={2.2} />
      {label}
    </button>
  );
}

/** AI 가 만든 것이라는 작은 표시 (인공지능기본법: 생성형 AI 결과물 알리기) */
export function AiMark({ label = 'AI', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-[11px] font-semibold text-muted', className)}>
      <Icon d={ICONS.sparkle} size={12} strokeWidth={2.2} />
      {label}
    </span>
  );
}
