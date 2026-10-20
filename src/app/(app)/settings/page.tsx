'use client';
// 설정: 계정, 에너지, AI 모델, AI 채팅, 테마(Pro), 시각화, 복습, 문제, 내 데이터
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { Select } from '@/components/Select';
import {
  Button,
  Card,
  Chip,
  Energy,
  Field,
  ICONS,
  Icon,
  LargeHeader,
  LinkButton,
  Segmented,
  SectionTitle,
  Toggle,
  api,
  cx,
  inputClass,
  useToast,
} from '@/components/ui';
import { fetchSubjects, sb } from '@/lib/data';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { SubjectRow } from '@/lib/types';
import { THEME_FONTS, type ModelTier, type UserSettings } from '@/lib/settings';
import { energyPeriodLabel, planLabel } from '@/lib/plans';
import { accountLabel } from '@/lib/login';
import { applyTheme, clearTheme, loadThemeFont } from '@/lib/theme';
import { ThemeSettings } from '@/components/ThemeSettings';
import { dropView } from '@/lib/view-cache';

const TASKS: Array<{ key: keyof UserSettings['models']; label: string; hint: string }> = [
  { key: 'organize', label: '정리', hint: '자료를 읽고 정리 노트로 바꿔요' },
  { key: 'visual', label: '그림', hint: '마인드맵·표·연표를 그려요' },
  { key: 'quiz', label: '문제', hint: '핵심 문제를 만들고 검사해요' },
  { key: 'grade', label: '채점', hint: '단답형 답을 같은 뜻까지 인정해요' },
];

const TASK_NAME: Record<string, string> = {
  organize: '정리',
  merge: '정리 합치기',
  visual: '그림',
  quiz: '문제 만들기',
  check: '문제 검사',
  grade: '채점',
  fix: '문제 고치기',
  chat: '노트 채팅',
  ask: 'AI에게 물어보기',
  solve: '그림 풀이',
  redraw: '자료 그림 다시 그리기',
  theme: '테마 만들기',
  refund: '돌려받음',
};

type Ledger = { task: string; model: string | null; energy: number; created_at: string };

export default function SettingsPage() {
  const { me, refresh } = useMe();
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<UserSettings | null>(me?.settings ?? null);
  const [nickname, setNickname] = useState(me?.nickname ?? '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    fetchSubjects()
      .then(setSubjects)
      .catch(() => {});
    sb()
      .from('energy_ledger')
      .select('task, model, energy, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setLedger((data ?? []) as Ledger[]));
    // 다른 화면에서 #energy·#chat·#theme 로 들어오면 그 칸으로
    const hash = window.location.hash.slice(1);
    if (/^[a-z]+$/.test(hash)) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }), 300);
    // 글꼴 고르기 미리보기
    for (const f of THEME_FONTS) loadThemeFont(f);
  }, []);

  // 바꾸면 0.6초 뒤 저장
  useEffect(() => {
    if (!draft || !me) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved('saving');
    const t = setTimeout(async () => {
      const { error } = await sb().from('profiles').update({ settings: draft }).eq('id', me.userId);
      if (error) {
        setSaved('idle');
        toast('설정을 저장하지 못했어요.', 'bad');
      } else {
        setSaved('saved');
        refresh();
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!me || !draft) return null;
  const canCareful = me.canCareful;
  const set = <K extends keyof UserSettings>(k: K, v: Partial<UserSettings[K]>) => setDraft({ ...draft, [k]: { ...draft[k], ...v } });
  const e = me.energy;
  const canTheme = me.canTheme;
  /** 테마 고르기: 바로 화면에 보이고, 설정에도 저장한다 */
  const pickTheme = (patch: Partial<UserSettings['theme']>) => {
    if (!canTheme) return toast('테마는 Pro에서 쓸 수 있어요.');
    set('theme', patch);
    applyTheme({ ...draft.theme, ...patch }, { allowMissing: true });
  };

  return (
    <div className="grid gap-2 pb-8">
      <LargeHeader
        title="설정"
        subtitle={`${me.nickname ?? '나'} · ${planLabel(me.planInfo, false)}`}
        actions={
          <span className="mr-2 inline-flex items-center gap-1 text-xs font-semibold text-muted" aria-live="polite">
            {saved === 'saving' ? (
              '저장 중…'
            ) : saved === 'saved' ? (
              <>
                <Icon d={ICONS.check} size={14} strokeWidth={2.6} />
                저장됨
              </>
            ) : (
              ''
            )}
          </span>
        }
      />

      <SectionTitle>계정</SectionTitle>
      <Card className="grid gap-3">
        <Field label="닉네임" htmlFor="set-nick">
          <div className="flex gap-2">
            <input id="set-nick" className={inputClass} value={nickname} maxLength={20} onChange={(ev) => setNickname(ev.target.value)} />
            <Button
              variant="secondary"
              disabled={!nickname.trim() || nickname.trim() === me.nickname}
              onClick={async () => {
                const { error } = await sb().from('profiles').update({ nickname: nickname.trim() }).eq('id', me.userId);
                if (error) toast('저장하지 못했어요.', 'bad');
                else {
                  toast('바꿨어요.', 'ok');
                  refresh();
                }
              }}
            >
              저장
            </Button>
          </div>
        </Field>
        <p className="text-sm text-muted">로그인 계정: {accountLabel(me.email, me.provider)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-bold">{planLabel(me.planInfo)}</span>
          <LinkButton href="/plan" size="sm" variant="secondary">
            요금제·쿠폰
          </LinkButton>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await supabaseBrowser().auth.signOut();
              clearTheme();
              dropView();
              router.replace('/');
              router.refresh();
            }}
          >
            로그아웃
          </Button>
        </div>
      </Card>

      <SectionTitle>
        <span id="energy" className="scroll-mt-24">
          AI 에너지
        </span>
      </SectionTitle>
      <Card className="grid gap-3">
        <p className="text-lg font-bold">
          {e.unlimited ? (
            '무제한 (관리자)'
          ) : (
            <>
              {energyPeriodLabel(e.period)} 남은 에너지 <Energy sr={false} n={`${Math.floor(e.remaining ?? 0)} / ${e.limit}`} />
            </>
          )}
        </p>
        <p className="text-sm text-muted">
          {e.period === 'plan' ? (
            <>
              &apos;{me.planInfo.name}&apos; 플랜에서 {e.usedPlan ?? 0} 사용 · 오늘 {e.usedToday} 사용
              {e.planDaily !== null ? ` · 하루 최대 ${e.planDaily}` : ''}. 플랜 에너지는 기간 동안 다시 채워지지 않아요.
            </>
          ) : (
            <>
              오늘 {e.usedToday} 사용 · 이번 달 {e.usedMonth} 사용
              {e.proDaily ? ` · Pro는 하루 최대 ${e.proDaily}` : ''}.
            </>
          )}{' '}
          1 에너지는 AI 비용 약 1.4원이에요. 복습·오답노트·직접 만든 문제·마인드맵 고치기는 에너지가 들지 않아요.
        </p>
        {ledger.length ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">최근 사용 기록</summary>
            <ul className="mt-2 grid gap-1 text-sm">
              {ledger.map((l, i) => (
                <li key={i} className="flex justify-between gap-2 border-b border-line py-1">
                  <span>
                    {TASK_NAME[l.task] ?? l.task}{' '}
                    <span className="text-muted">
                      {new Date(l.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>
                  <span className={Number(l.energy) < 0 ? 'text-ok' : ''}>
                    {Number(l.energy) < 0 ? `+${Math.abs(Number(l.energy))}` : `-${Number(l.energy)}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <SectionTitle>AI 모델</SectionTitle>
      <Card className="grid gap-4">
        {TASKS.map((t) => (
          <div key={t.key} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{t.label}</span>
              <span className="text-xs text-muted">{t.hint}</span>
            </div>
            <Segmented
              label={`${t.label} 모델`}
              value={draft.models[t.key]}
              onChange={(v: ModelTier) => {
                if (v === 'careful' && !canCareful) return toast('꼼꼼 모드는 Pro에서 쓸 수 있어요.');
                set('models', { [t.key]: v } as Partial<UserSettings['models']>);
              }}
              options={[
                { value: 'fast' as ModelTier, label: `빠름 · ${me.multipliers.fast}배` },
                { value: 'careful' as ModelTier, label: `꼼꼼${canCareful ? '' : '(Pro)'} · 약 ${Math.round(me.multipliers.careful)}배` },
                ...(me.isAdmin ? [{ value: 'admin' as ModelTier, label: `최고 · 약 ${Math.round(me.multipliers.adminTest)}배` }] : []),
              ]}
            />
          </div>
        ))}
        <p className="text-xs text-muted">배율은 에너지가 얼마나 더 드는지예요. 실제로는 쓴 만큼만 빠져요.</p>
      </Card>

      {me.features.chat ? (
        <>
          <SectionTitle>
            <span id="chat" className="scroll-mt-24">
              AI 채팅
            </span>
          </SectionTitle>
          <Card className="grid gap-4">
            <p className="text-sm text-muted">노트 화면의 주황 버튼을 누르면 그 노트에 대해 AI에게 물어볼 수 있어요. 답마다 에너지를 써요.</p>
            <Field label="처음 고를 모델 (채팅 창에서 바꾸면 그 모델을 기억해요)">
              <Segmented
                label="채팅 모델"
                value={draft.models.chat}
                onChange={(v: ModelTier) => {
                  if (v === 'careful' && !canCareful) return toast('꼼꼼 모드는 Pro에서 쓸 수 있어요.');
                  set('models', { chat: v });
                }}
                options={[
                  { value: 'fast' as ModelTier, label: '빠름' },
                  { value: 'careful' as ModelTier, label: `꼼꼼${canCareful ? '' : '(Pro)'}` },
                  ...(me.isAdmin ? [{ value: 'admin' as ModelTier, label: '최고' }] : []),
                ]}
              />
            </Field>
            <Toggle
              id="set-chat-questions"
              label="대화하다가 '문제로 넣어 줘' 하면 문제로 만들어 주기"
              checked={draft.chat.allowQuestions}
              onChange={(v) => set('chat', { allowQuestions: v })}
            />
            <Toggle
              id="set-chat-note"
              label="대화하다가 '노트에 넣어 줘' 하면 노트에 알맞게 넣어 주기"
              checked={draft.chat.allowNote}
              onChange={(v) => set('chat', { allowNote: v })}
            />
            <p className="text-xs text-muted">켜 두어도 바로 넣지 않아요. 먼저 미리보기를 보여 주고, [넣기]를 눌러야 들어가요.</p>
          </Card>
        </>
      ) : null}

      <SectionTitle>
        <span id="theme" className="scroll-mt-24 inline-flex items-center gap-2">
          테마 {!canTheme ? <Chip tone="accent">Pro</Chip> : null}
        </span>
      </SectionTitle>
      <Card className="grid gap-5">
        <ThemeSettings me={me} theme={draft.theme} onChange={pickTheme} />
      </Card>

      <SectionTitle>시각화</SectionTitle>
      <Card className="grid gap-4">
        <Field label="기본 표현 방식">
          <Segmented
            label="기본 표현 방식"
            value={draft.visual.defaultType}
            onChange={(v) => set('visual', { defaultType: v })}
            options={[
              { value: 'auto', label: '자동 추천' },
              { value: 'mindmap', label: '마인드맵' },
              { value: 'table', label: '표' },
              { value: 'timeline', label: '연표' },
            ]}
          />
        </Field>
        {subjects.length ? (
          <Field label="과목별 기본">
            <div className="grid gap-2">
              {subjects.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  {/* 고르기 칸은 너비를 정해 두어 과목 이름이 잘리지 않게 */}
                  <div className="w-44 shrink-0">
                    <Select
                      aria-label={`${s.name} 기본 표현`}
                      className="py-1.5!"
                      value={draft.visual.bySubject[s.id] ?? ''}
                      onChange={(v) => {
                        const by = { ...draft.visual.bySubject };
                        if (v) by[s.id] = v;
                        else delete by[s.id];
                        set('visual', { bySubject: by });
                      }}
                      options={[
                        { value: '', label: '따로 정하지 않음' },
                        { value: 'mindmap', label: '마인드맵' },
                        { value: 'table', label: '표' },
                        { value: 'timeline', label: '연표' },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Field>
        ) : null}
        <Field label="마인드맵 모양">
          <Segmented
            label="마인드맵 모양"
            value={draft.visual.layout}
            onChange={(v) => set('visual', { layout: v })}
            options={[
              { value: 'radial', label: '가운데서 퍼지기' },
              { value: 'right', label: '오른쪽으로' },
              { value: 'down', label: '위에서 아래로' },
            ]}
          />
        </Field>
        <Field label="가지 깊이 (다음에 만드는 그림부터)">
          <Segmented
            label="가지 깊이"
            value={draft.visual.depth}
            onChange={(v) => set('visual', { depth: v })}
            options={[
              { value: 2 as const, label: '2단계' },
              { value: 3 as const, label: '3단계' },
              { value: 4 as const, label: '4단계' },
            ]}
          />
        </Field>
        <Field label="가지 글자 (다음에 만드는 그림부터)">
          <Segmented
            label="가지 글자"
            value={draft.visual.labels}
            onChange={(v) => set('visual', { labels: v })}
            options={[
              { value: 'keyword', label: '키워드만' },
              { value: 'phrase', label: '짧은 문장' },
            ]}
          />
        </Field>
        <Field label="색">
          <Segmented
            label="색"
            value={draft.visual.color}
            onChange={(v) => set('visual', { color: v })}
            options={[
              { value: 'branch', label: '가지마다' },
              { value: 'subject', label: '과목 색' },
              { value: 'mono', label: '흑백' },
            ]}
          />
        </Field>
        <Field label="펼치는 방식">
          <Segmented
            label="펼치는 방식"
            value={draft.visual.reveal}
            onChange={(v) => set('visual', { reveal: v })}
            options={[
              { value: 'all', label: '한 번에' },
              { value: 'step', label: '한 가지씩' },
            ]}
          />
        </Field>
        <Field label="글자 크기">
          <Segmented
            label="글자 크기"
            value={draft.visual.fontSize}
            onChange={(v) => set('visual', { fontSize: v })}
            options={[
              { value: 'sm', label: '작게' },
              { value: 'md', label: '보통' },
              { value: 'lg', label: '크게' },
            ]}
          />
        </Field>
        <Toggle id="set-icons" label="그림 기호(이모지) 보이기" checked={draft.visual.icons} onChange={(v) => set('visual', { icons: v })} />
        <Toggle
          id="set-hide"
          label="그림을 처음부터 가린 채로 열기 (가리기 모드)"
          checked={draft.visual.hideMode === 'on'}
          onChange={(v) => set('visual', { hideMode: v ? 'on' : 'off' })}
        />
        {me.features.sourceFigures ? (
          <div className="grid gap-1.5">
            <Toggle
              id="set-original-first"
              label="자료 그림은 원본으로 먼저 보기"
              checked={!me.canFigures || draft.visual.originalFirst}
              disabled={!me.canFigures}
              onChange={(v) => set('visual', { originalFirst: v })}
            />
            <p className="text-xs text-muted">
              {me.canFigures
                ? '끄면 콕 스타일로 다시 그린 그림부터 보여 줘요. 그림마다 원본과 바꿔 볼 수 있어요.'
                : '자료 그림은 원본에서 잘라 보여 줘요. Pro는 지도·그래프·표·연표·도식을 콕 스타일로 다시 그려 줘요.'}
            </p>
          </div>
        ) : null}
      </Card>

      <SectionTitle>복습</SectionTitle>
      <Card className="grid gap-4">
        <Field label={`목표 기억률 ${Math.round(draft.review.retention * 100)}%`} hint="높일수록 더 자주 복습해요.">
          <input
            type="range"
            min={80}
            max={95}
            step={1}
            value={Math.round(draft.review.retention * 100)}
            onChange={(ev) => set('review', { retention: Number(ev.target.value) / 100 })}
            className="w-full accent-[var(--accent)]"
            aria-label="목표 기억률"
          />
        </Field>
        <Field label="하루 최대 문제 수" htmlFor="set-max" hint="넘으면 중요한 문제부터 내요.">
          <input
            id="set-max"
            type="number"
            min={10}
            max={500}
            className={cx(inputClass, 'w-32')}
            value={draft.review.dailyMax}
            onChange={(ev) => {
              const n = Math.max(10, Math.min(500, Math.round(Number(ev.target.value) || 10)));
              set('review', { dailyMax: n });
            }}
          />
        </Field>
        <Toggle id="set-mix" label="여러 과목 섞어 풀기" checked={draft.review.interleave} onChange={(v) => set('review', { interleave: v })} />
        <Toggle
          id="set-aigrade"
          label="단답형은 AI가 같은 뜻까지 채점 (에너지 1 미만)"
          checked={draft.review.aiShortGrade}
          onChange={(v) => set('review', { aiShortGrade: v })}
        />
        <p className="text-xs text-muted">하루 한 번 복습 알림은 다음 버전에서 열려요.</p>
      </Card>

      <SectionTitle>문제</SectionTitle>
      <Card className="grid gap-4">
        <Field label="쓸 유형 (다음에 만드는 문제부터)">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['mcq', '객관식'],
                ['ox', 'OX'],
                ['cloze', '빈칸'],
                ['short', '단답'],
              ] as const
            ).map(([k, label]) => {
              const on = draft.quiz.types.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const types = on ? draft.quiz.types.filter((x) => x !== k) : [...draft.quiz.types, k];
                    if (!types.length) return toast('한 가지는 골라야 해요.');
                    set('quiz', { types });
                  }}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold',
                    on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted',
                  )}
                >
                  {on ? <Icon d={ICONS.check} size={14} strokeWidth={2.6} /> : null}
                  {label}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="문제 수">
          <Segmented
            label="문제 수"
            value={draft.quiz.perKeyPoint}
            onChange={(v) => set('quiz', { perKeyPoint: v })}
            options={[
              { value: 'auto' as const, label: '자동 (중요도에 맞춰)' },
              { value: 1 as const, label: '개념당 1개' },
              { value: 2 as const, label: '2개' },
              { value: 3 as const, label: '3개' },
            ]}
          />
        </Field>
        <Field label="난이도 비율 (%)">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['easy', '쉬움'],
                ['medium', '보통'],
                ['hard', '어려움'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="grid gap-1 text-sm">
                {label}
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={inputClass}
                  value={draft.quiz.mix[k]}
                  onChange={(ev) => set('quiz', { mix: { ...draft.quiz.mix, [k]: Math.max(0, Math.min(100, Math.round(Number(ev.target.value) || 0))) } })}
                />
              </label>
            ))}
          </div>
        </Field>
        <Field label="문제 언어">
          <Segmented
            label="문제 언어"
            value={draft.quiz.language}
            onChange={(v) => set('quiz', { language: v })}
            options={[
              { value: 'ko', label: '한국어' },
              { value: 'material', label: '자료와 같은 언어 (영어 과목 등)' },
            ]}
          />
        </Field>
        {me.features.sourceFigures ? (
          <div className="grid gap-1.5">
            <Toggle
              id="set-source-figures"
              label="자료의 그림으로 문제 만들기"
              checked={draft.quiz.sourceFigures}
              onChange={(v) => set('quiz', { sourceFigures: v })}
            />
            <p className="text-xs text-muted">PDF·사진 속 지도·그래프·사진 같은 중요한 그림을 찾아 개념에 붙이고, 그 그림을 보고 푸는 문제를 만들어요.</p>
          </div>
        ) : null}
        {me.features.figures ? (
          <div className="grid gap-1.5">
            <Toggle
              id="set-figures"
              label={`필요한 문제에 그림과 단계 풀이 붙이기${me.canFigures ? '' : ' (Pro)'}`}
              checked={me.canFigures && draft.quiz.figures}
              disabled={!me.canFigures}
              onChange={(v) => set('quiz', { figures: v })}
            />
            <p className="text-xs text-muted">
              노트를 만들 때 수학·과학처럼 그림이나 단계가 도움이 되는 문제에만 붙여요. 에너지가 조금 더 들어요. 예전 문제는 문제 목록에서 하나씩 만들 수
              있어요.
            </p>
          </div>
        ) : null}
      </Card>

      <SectionTitle>내 데이터</SectionTitle>
      <Card className="grid gap-3">
        <a href="/api/account/export" className="font-semibold text-accent underline" download>
          내 데이터 내려받기 (JSON)
        </a>
        <details>
          <summary className="cursor-pointer font-semibold text-bad">탈퇴하기</summary>
          <div className="mt-3 grid gap-2">
            <p className="text-sm">
              모든 과목·자료·노트·문제·복습 기록과 올린 파일이 지워지고 되돌릴 수 없어요. 탈퇴한 날에는 다시 가입해도 AI를 쓸 수 없어요. 계속하려면 아래에{' '}
              <b>탈퇴</b>라고 적어 주세요.
            </p>
            <input aria-label="확인 글자" className={inputClass} value={confirmText} onChange={(ev) => setConfirmText(ev.target.value)} placeholder="탈퇴" />
            <Button
              variant="danger"
              busy={deleting}
              disabled={confirmText.trim() !== '탈퇴'}
              onClick={async () => {
                setDeleting(true);
                try {
                  await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: '탈퇴' }) });
                  await supabaseBrowser()
                    .auth.signOut()
                    .catch(() => {});
                  clearTheme();
                  dropView();
                  router.replace('/');
                  router.refresh();
                } catch (err) {
                  toast((err as Error).message, 'bad');
                  setDeleting(false);
                }
              }}
            >
              모든 데이터 지우고 탈퇴
            </Button>
          </div>
        </details>
      </Card>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted">
        <Link href="/terms">이용약관</Link>
        <Link href="/privacy">개인정보처리방침</Link>
        <Link href="/ai-guide">AI 사용 안내</Link>
        {me.isAdmin ? <Link href="/admin">관리자</Link> : null}
        <span>콕 v0.1</span>
      </div>
    </div>
  );
}
