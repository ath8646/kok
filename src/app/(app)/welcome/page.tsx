'use client';
// 가입 확인: 약관·개인정보·AI 안내 동의 → 닉네임 → 첫 과목 → 자료 넣기
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMe } from '@/components/AppShell';
import { Button, Card, Field, cx, inputClass, useToast } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { SUBJECT_COLORS } from '@/lib/settings';
import { SUBJECT_COLOR_LABEL, subjectVar } from '@/lib/colors';

const SUGGEST = ['국어', '영어', '수학', '과학', '사회', '역사'];

export default function WelcomePage() {
  const { me, refresh } = useMe();
  const router = useRouter();
  const toast = useToast();
  const [agree, setAgree] = useState({ terms: false, privacy: false, ai: false });
  const [nickname, setNickname] = useState(me?.nickname ?? '');
  const [subject, setSubject] = useState('');
  const [color, setColor] = useState<string>('blue');
  const [busy, setBusy] = useState(false);
  const all = agree.terms && agree.privacy && agree.ai;
  const nickOk = nickname.trim().length >= 1 && nickname.trim().length <= 20;
  const subjOk = subject.trim().length >= 1 && subject.trim().length <= 40;

  const submit = async () => {
    if (!me || !all || !nickOk || !subjOk) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { error: pErr } = await sb.from('profiles').update({ nickname: nickname.trim(), consented_at: new Date().toISOString() }).eq('id', me.userId);
    if (pErr) {
      setBusy(false);
      toast('저장하지 못했어요. 다시 해 주세요.', 'bad');
      return;
    }
    const { data: existing } = await sb.from('subjects').select('id').limit(1);
    let subjectId = existing?.[0]?.id as string | undefined;
    if (!subjectId) {
      const { data, error } = await sb.from('subjects').insert({ name: subject.trim(), color, position: 0 }).select('id').single();
      if (error) {
        setBusy(false);
        toast('과목을 만들지 못했어요. 다시 해 주세요.', 'bad');
        return;
      }
      subjectId = data.id;
    }
    await refresh();
    router.replace(`/library/${subjectId}?compose=1`);
  };

  const check = (k: keyof typeof agree, children: React.ReactNode) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-2">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
        checked={agree[k]}
        onChange={(e) => setAgree({ ...agree, [k]: e.target.checked })}
      />
      <span className="text-[15px]">{children}</span>
    </label>
  );

  return (
    <div className="mx-auto grid max-w-lg gap-4 pb-6 pt-[calc(28px+env(safe-area-inset-top))]">
      <div className="text-center">
        <p className="font-brand text-6xl text-accent">
          <span className="hl-mark">콕</span>
        </p>
        <h1 className="mt-3 font-display text-2xl">반가워요! 세 가지만 정하면 시작해요</h1>
      </div>

      <Card className="kok-rise grid gap-1" style={{ ['--i' as string]: 1 }}>
        <h2 className="mb-1 font-bold">1. 안내 확인</h2>
        <button
          type="button"
          className="mb-1 justify-self-start text-sm font-semibold text-accent"
          onClick={() => setAgree({ terms: !all, privacy: !all, ai: !all })}
        >
          {all ? '모두 해제' : '모두 동의'}
        </button>
        {check(
          'terms',
          <>
            <Link href="/terms" target="_blank" className="font-semibold underline">
              이용약관
            </Link>
            에 동의해요 (필수)
          </>,
        )}
        {check(
          'privacy',
          <>
            <Link href="/privacy" target="_blank" className="font-semibold underline">
              개인정보처리방침
            </Link>
            을 확인했어요 (필수)
          </>,
        )}
        {check(
          'ai',
          <>
            <Link href="/ai-guide" target="_blank" className="font-semibold underline">
              AI 사용 안내
            </Link>
            를 읽었어요: AI는 틀릴 수 있고, 자료에 다른 사람의 개인정보를 넣지 않아요 (필수)
          </>,
        )}
      </Card>

      <Card className="kok-rise grid gap-3" style={{ ['--i' as string]: 2 }}>
        <h2 className="font-bold">2. 닉네임</h2>
        <Field label="콕에서 쓸 이름 (실명이 아니어도 돼요)" htmlFor="nick">
          <input
            id="nick"
            className={inputClass}
            value={nickname}
            maxLength={20}
            placeholder="예: 공부하는 고래"
            onChange={(e) => setNickname(e.target.value)}
          />
        </Field>
      </Card>

      <Card className="kok-rise grid gap-3" style={{ ['--i' as string]: 3 }}>
        <h2 className="font-bold">3. 첫 과목</h2>
        <div className="flex flex-wrap gap-2">
          {SUGGEST.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSubject(s)}
              className={cx(
                'press rounded-full px-3.5 py-1.5 text-sm font-semibold',
                subject === s ? 'bg-ink text-surface' : 'bg-surface-2 text-ink hover:bg-surface-3',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <Field label="과목 이름" htmlFor="subj">
          <input id="subj" className={inputClass} value={subject} maxLength={40} placeholder="예: 과학" onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="과목 색">
          {SUBJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={SUBJECT_COLOR_LABEL[c]}
              onClick={() => setColor(c)}
              className={cx('h-9 w-9 rounded-full border-4', color === c ? 'border-ink' : 'border-transparent')}
              style={{ background: subjectVar(c) }}
            />
          ))}
        </div>
      </Card>

      <Button size="lg" busy={busy} disabled={!all || !nickOk || !subjOk} onClick={submit}>
        시작하기
      </Button>
      <button
        type="button"
        className="text-sm text-muted underline"
        onClick={async () => {
          await supabaseBrowser().auth.signOut();
          router.replace('/');
          router.refresh();
        }}
      >
        다른 계정으로 로그인
      </button>
    </div>
  );
}
