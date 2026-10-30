'use client';
// 관리자 화면: 키 상태, 숫자, 비상 스위치, 공지, 모델, 한도, 사용자, 테스트 플랜·쿠폰, 신고함, 운영자 정보
import { useCallback, useEffect, useState } from 'react';
import { AdminPlans } from '@/components/AdminPlans';
import { useAskText, useConfirm } from '@/components/Confirm';
import { useMe } from '@/components/AppShell';
import { QuestionPreview } from '@/components/QuestionList';
import { Select } from '@/components/Select';
import { Button, Card, Chip, EmptyState, Field, LargeHeader, SectionTitle, Segmented, Toggle, api, cx, inputClass, useToast, DONE } from '@/components/ui';
import { costMultiplier } from '@/lib/ai/models';
import { MAX_FILE_MB, type Limits, type ModelsConfig, type Notice } from '@/lib/settings';
import type { QuestionRow } from '@/lib/types';
import { accountLabel } from '@/lib/login';
import { REPORT_LABEL } from '@/lib/report';

type Overview = {
  stats: {
    users: number;
    pro_users: number;
    /** 테스트 플랜을 쓰는 사람 (schema.sql 을 다시 실행하기 전에는 없음) */
    custom_users?: number;
    active_today: number;
    usd_month: number;
    usd_month_free: number;
    usd_today: number;
    sources_month: number;
    open_reports: number;
  };
  key: { connected: boolean; hint: string | null };
  settings: { limits: Limits; models: ModelsConfig; notice: Notice; aiEnabled: boolean; site: { contactEmail: string; operatorName: string } };
  env: { supabaseSecret: boolean; adminEmails: boolean; cronSecret: boolean; cloudflare?: boolean };
};
type UserRow = {
  id: string;
  email: string | null;
  /** 처음 가입한 로그인 회사 */
  provider: string | null;
  nickname: string | null;
  role: string;
  plan: string;
  pro_until: string | null;
  pro_active: boolean;
  /** 켜져 있는 테스트 플랜 */
  custom_plan: { id: string; name: string; until: string } | null;
  banned: boolean;
  created_at: string;
};
type Report = {
  id: number;
  reporter_id: string;
  target_type: string;
  target_id: string | null;
  reason: string;
  status: string;
  created_at: string;
  /** 신고할 때 본 AI 결과 (schema.sql 을 다시 실행하기 전 DB 에는 없다) */
  snapshot?: string | null;
};

const LIMIT_LABELS: Array<[keyof Limits, string]> = [
  ['freeDaily', '무료 하루 에너지'],
  ['proMonthly', 'Pro 한 달 에너지'],
  ['proDaily', 'Pro 하루 최대'],
  ['freeMonthlyBudgetUsd', '무료 전체 월 예산 ($)'],
  ['usdPerEnergy', '1 에너지 = $'],
  ['pdfPagesFree', '무료 PDF 쪽수'],
  ['pdfPagesPro', 'Pro PDF 쪽수'],
  ['imagesFree', '무료 사진 장수'],
  ['imagesPro', 'Pro 사진 장수'],
  ['textCharsFree', '무료 글자 수'],
  ['textCharsPro', 'Pro 글자 수'],
  ['fileMbFree', '무료 파일 MB'],
  ['fileMbPro', 'Pro 파일 MB'],
  ['ratePerMinute', '1분 요청 수'],
  ['freeFileDays', '무료 원본 보관 일수'],
];

const EFFORT_TASKS: Array<[keyof ModelsConfig['effort'], string]> = [
  ['organize', '정리'],
  ['merge', '합치기'],
  ['visual', '그림'],
  ['quiz', '문제'],
  ['check', '검사'],
  ['grade', '채점'],
  ['chat', '채팅'],
  ['theme', '테마 만들기'],
  ['solve', '풀이 (그림·단계)'],
  ['redraw', '자료 그림 다시 그리기'],
  ['locate', '자료 그림 자리 찾기'],
  ['cover', '표지 그림'],
];

export default function AdminPage() {
  const { me, refresh: refreshMe } = useMe();
  const toast = useToast();
  const ask = useConfirm();
  const askText = useAskText();
  const [ov, setOv] = useState<Overview | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [models, setModels] = useState<ModelsConfig | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [site, setSite] = useState<{ contactEmail: string; operatorName: string } | null>(null);
  const [testModel, setTestModel] = useState<'fast' | 'careful' | 'adminTest'>('fast');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [schemaResult, setSchemaResult] = useState<SchemaTest | null>(null);
  const [figResult, setFigResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [plansKey, setPlansKey] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<{
    reports: Report[];
    questions: Record<string, QuestionRow>;
    /** 테마 그림 신고: 그림 번호 → 잠깐 볼 수 있는 주소 */
    pictures?: Record<string, string>;
    users: Record<string, { email: string; nickname: string }>;
  } | null>(null);

  const applyOverview = useCallback((o: Overview) => {
    setOv(o);
    setLimits(o.settings.limits);
    setModels(o.settings.models);
    setNotice(o.settings.notice);
    setSite(o.settings.site);
  }, []);
  const load = useCallback(async () => applyOverview(await api<Overview>('/api/admin/overview')), [applyOverview]);
  const loadUsers = useCallback(async (term = '') => {
    const r = await api<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(term)}`);
    setUsers(r.users);
  }, []);
  const loadReports = useCallback(async () => setReports(await api('/api/admin/reports?status=open')), []);

  useEffect(() => {
    if (!me?.isAdmin) return;
    let alive = true;
    Promise.all([
      api<Overview>('/api/admin/overview'),
      api<{ users: UserRow[] }>('/api/admin/users?q='),
      api<NonNullable<typeof reports>>('/api/admin/reports?status=open'),
    ])
      .then(([o, u, r]) => {
        if (!alive) return;
        applyOverview(o);
        setUsers(u.users);
        setReports(r);
      })
      .catch((e) => {
        if (alive) toast((e as Error).message, 'bad');
      });
    return () => {
      alive = false;
    };
  }, [me?.isAdmin, applyOverview, toast]);

  if (!me) return null;
  if (!me.isAdmin) return <EmptyState title="관리자만 볼 수 있어요" />;
  if (!ov || !limits || !models || !notice || !site)
    return (
      <div className="grid gap-3">
        <LargeHeader title="관리자" subtitle=" " />
        <div className="kok-card kok-shimmer h-48" />
      </div>
    );

  const saveSetting = async (key: string, value: unknown, label: string) => {
    setBusy(key);
    try {
      await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key, value }) });
      toast(`${label} 저장했어요.`, 'ok', DONE);
      await load();
      refreshMe();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const s = ov.stats;
  const usd = (n: number) => `$${Number(n).toFixed(2)}`;

  return (
    <div className="grid gap-2 pb-10">
      <LargeHeader title="관리자" subtitle="키 상태 · 사용량 · 신고 · 운영 설정" />

      <SectionTitle>API 키 상태</SectionTitle>
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {ov.key.connected ? <Chip tone="ok">연결됨 {ov.key.hint}</Chip> : <Chip tone="bad">키 없음</Chip>}
          {ov.env.supabaseSecret ? <Chip tone="ok">Supabase 비밀 키 있음</Chip> : <Chip tone="bad">Supabase 비밀 키 없음</Chip>}
          {ov.env.adminEmails ? <Chip tone="ok">관리자 이메일 설정됨</Chip> : <Chip tone="warn">ADMIN_EMAILS 없음</Chip>}
          {ov.env.cloudflare ? <Chip tone="ok">테마 AI 그림(Cloudflare) 있음</Chip> : <Chip tone="warn">Cloudflare 없음 · AI 그림 대신 무늬</Chip>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="시험할 모델"
            value={testModel}
            onChange={setTestModel}
            options={[
              { value: 'fast', label: '빠름' },
              { value: 'careful', label: '꼼꼼' },
              { value: 'adminTest', label: '최고' },
            ]}
          />
          <Button
            size="sm"
            busy={busy === 'test'}
            onClick={async () => {
              setBusy('test');
              setTestResult(null);
              try {
                const r = await api<{ ok: boolean; model?: string; message?: string; ms: number }>('/api/admin/test-key', {
                  method: 'POST',
                  body: JSON.stringify({ model: models[testModel] }),
                });
                setTestResult(r.ok ? `작동해요 · ${r.model} (${r.ms}ms)` : `안 돼요: ${r.message}`);
              } catch (e) {
                setTestResult((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            키 시험
          </Button>
          <Button
            size="sm"
            variant="secondary"
            busy={busy === 'schemas'}
            onClick={async () => {
              setBusy('schemas');
              setSchemaResult(null);
              try {
                setSchemaResult(await api<SchemaTest>('/api/admin/test-schemas', { method: 'POST', body: JSON.stringify({ model: models[testModel] }) }));
              } catch (e) {
                toast((e as Error).message, 'bad');
              } finally {
                setBusy(null);
              }
            }}
          >
            AI 답 모양 시험
          </Button>
          <Button
            size="sm"
            variant="secondary"
            busy={busy === 'figures'}
            onClick={async () => {
              setBusy('figures');
              setFigResult(null);
              try {
                const r = await api<{
                  cut: { ok: boolean; message: string; size?: string; vision?: string; ms: number };
                  dbReady: boolean;
                  settingOn: boolean;
                  redraw: boolean;
                }>('/api/admin/test-figures', { method: 'POST', body: '{}' });
                setFigResult(
                  [
                    r.cut.ok
                      ? `그림 자르기 됨 (AI에 보낼 쪽 ${r.cut.vision ?? '?'} → 자른 그림 ${r.cut.size}, ${(r.cut.ms / 1000).toFixed(1)}초)`
                      : `그림 자르기 안 됨: ${r.cut.message}`,
                    r.dbReady ? 'DB 그림 칸 있음' : 'DB 그림 칸 없음: schema.sql 을 다시 실행해 주세요',
                    r.settingOn ? "내 설정 '자료 그림' 켬" : "내 설정 '자료 그림' 꺼짐",
                    r.redraw ? 'KOK 스타일 다시 그리기 됨(Pro)' : '다시 그리기는 Pro',
                  ].join(' · '),
                );
              } catch (e) {
                setFigResult((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            자료 그림 시험
          </Button>
        </div>
        {figResult ? <p className="text-sm">{figResult}</p> : null}
        {testResult ? <p className="text-sm">{testResult}</p> : null}
        {schemaResult ? <SchemaTestList result={schemaResult} /> : null}
        <p className="text-xs text-muted">
          키를 바꾸려면 Vercel 환경변수 ANTHROPIC_API_KEY 를 바꾸고 다시 배포해요. &lsquo;AI 답 모양 시험&rsquo;은 앱이 쓰는 모든 답 모양을 Claude 가 받는지
          짧게 물어봐요(아주 적은 비용).
        </p>
      </Card>

      <SectionTitle>숫자</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['사용자', s.users],
            ['Pro · 테스트 플랜', `${s.pro_users} · ${s.custom_users ?? 0}`],
            ['오늘 복습한 사람', s.active_today],
            ['이번 달 자료', s.sources_month],
            ['이번 달 AI 비용', usd(s.usd_month)],
            ['그중 무료', `${usd(s.usd_month_free)} / $${limits.freeMonthlyBudgetUsd}`],
            ['오늘 AI 비용', usd(s.usd_today)],
            ['열린 신고', s.open_reports],
          ] as Array<[string, string | number]>
        ).map(([k, v]) => (
          <Card key={k} className="grid gap-0.5 p-3">
            <span className="text-xs text-muted">{k}</span>
            <span className="font-display text-xl">{v}</span>
          </Card>
        ))}
      </div>

      <SectionTitle>비상 스위치</SectionTitle>
      <Card className={cx('grid gap-2', !ov.settings.aiEnabled && 'border-bad')}>
        <p className="font-semibold">{ov.settings.aiEnabled ? 'AI 기능이 켜져 있어요.' : 'AI 기능이 꺼져 있어요. (관리자는 계속 쓸 수 있어요)'}</p>
        <Button
          variant={ov.settings.aiEnabled ? 'danger' : 'primary'}
          busy={busy === 'ai_enabled'}
          onClick={async () => {
            if (
              ov.settings.aiEnabled &&
              !(await ask({
                title: 'AI 전체 끄기',
                body: '모든 사용자의 AI 기능을 끌까요?',
                note: '복습은 계속 돼요. 관리자는 계속 쓸 수 있어요.',
                ok: '끄기',
                danger: true,
              }))
            )
              return;
            saveSetting('ai_enabled', !ov.settings.aiEnabled, ov.settings.aiEnabled ? 'AI 끄기를' : 'AI 켜기를');
          }}
        >
          {ov.settings.aiEnabled ? 'AI 전체 끄기' : 'AI 다시 켜기'}
        </Button>
      </Card>

      <SectionTitle>공지 (앱 위쪽 띠)</SectionTitle>
      <Card className="grid gap-3">
        <Toggle id="notice-on" label="공지 보이기" checked={notice.active} onChange={(v) => setNotice({ ...notice, active: v })} />
        <input
          aria-label="공지 글"
          className={inputClass}
          value={notice.text}
          maxLength={300}
          onChange={(e) => setNotice({ ...notice, text: e.target.value })}
          placeholder="예: 오늘 밤 10시에 잠깐 점검해요"
        />
        <Button size="sm" className="justify-self-start" busy={busy === 'notice'} onClick={() => saveSetting('notice', notice, '공지를')}>
          공지 저장
        </Button>
      </Card>

      <SectionTitle>모델</SectionTitle>
      <Card className="grid gap-3">
        {(
          [
            ['fast', '빠름 (무료·Pro)'],
            ['careful', '꼼꼼 (Pro)'],
            ['adminTest', '최고 (관리자 시험용)'],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={`${label} · ${costMultiplier(models[k])}배`} htmlFor={`m-${k}`}>
            <input id={`m-${k}`} className={inputClass} value={models[k]} onChange={(e) => setModels({ ...models, [k]: e.target.value.trim() })} />
          </Field>
        ))}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EFFORT_TASKS.map(([k, label]) => (
            <label key={k} className="grid gap-1 text-sm font-semibold">
              {label} effort
              <Select
                value={models.effort[k]}
                onChange={(v) => setModels({ ...models, effort: { ...models.effort, [k]: v } })}
                options={[
                  { value: 'low', label: 'low' },
                  { value: 'medium', label: 'medium' },
                  { value: 'high', label: 'high' },
                ]}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">
          모르는 모델 이름은 가장 비싼 값으로 에너지를 계산해요(손해 방지). 새 모델은 요금표를 코드에 더한 뒤 쓰는 게 좋아요.
        </p>
        <Button size="sm" className="justify-self-start" busy={busy === 'models'} onClick={() => saveSetting('models', models, '모델을')}>
          모델 저장
        </Button>
      </Card>

      <SectionTitle>한도</SectionTitle>
      <Card className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LIMIT_LABELS.map(([k, label]) => (
            <label key={k} className="grid gap-1 text-sm font-semibold">
              {label}
              <input
                type="number"
                step="any"
                className={inputClass}
                value={limits[k]}
                onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">
          파일 MB는 {MAX_FILE_MB}까지 정할 수 있어요 (Supabase 저장소 한도). 20MB보다 큰 PDF는 AI에 보낼 수 있는 크기로 자동으로 나눠 정리해요.
        </p>
        <Button size="sm" className="justify-self-start" busy={busy === 'limits'} onClick={() => saveSetting('limits', limits, '한도를')}>
          한도 저장
        </Button>
      </Card>

      <SectionTitle>사용자</SectionTitle>
      <Card className="grid gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            loadUsers(q).catch(() => {});
          }}
        >
          <input aria-label="사용자 찾기" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일·닉네임" />
          <Button type="submit" variant="secondary">
            찾기
          </Button>
        </form>
        <ul className="grid gap-2">
          {users.map((u) => {
            const pro = u.pro_active;
            return (
              <li key={u.id} className="grid gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.nickname ?? '(닉네임 없음)'}</span>
                  <span className="text-sm text-muted">{accountLabel(u.email, u.provider)}</span>
                  {u.role === 'admin' ? <Chip tone="accent">관리자</Chip> : null}
                  {pro ? <Chip tone="hl">Pro ~{new Date(u.pro_until!).toLocaleDateString('ko-KR')}</Chip> : null}
                  {u.custom_plan ? (
                    <Chip tone="accent">
                      {u.custom_plan.name} ~{new Date(u.custom_plan.until).toLocaleDateString('ko-KR')}
                    </Chip>
                  ) : null}
                  {u.banned ? <Chip tone="bad">정지</Chip> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const typed = await askText({
                        title: 'Pro 기간',
                        body: `${accountLabel(u.email, u.provider)}의 Pro를 며칠 켤까요? 0이면 꺼요. 테스트 플랜이 켜져 있으면 플랜이 끝난 뒤부터 세요.`,
                        label: '며칠',
                        value: '30',
                        inputMode: 'numeric',
                        ok: '정하기',
                        cancel: '그만두기',
                        check: (v) => (/^\d{1,4}$/.test(v.trim()) && Number(v) <= 3650 ? null : '0부터 3650까지 숫자로 적어 주세요.'),
                      });
                      if (typed === null) return;
                      const days = Number(typed.trim());
                      try {
                        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ proDays: Math.round(days) }) });
                        loadUsers(q);
                      } catch (e) {
                        toast((e as Error).message, 'bad');
                      }
                    }}
                  >
                    Pro 기간
                  </Button>
                  {u.custom_plan ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const plan = u.custom_plan!.name;
                        if (
                          !(await ask({
                            title: '테스트 플랜 끝내기',
                            body: `'${plan}' 플랜을 지금 끝낼까요?`,
                            note: '원래 요금제로 돌아가요.',
                            ok: '끝내기',
                            danger: true,
                          }))
                        )
                          return;
                        try {
                          await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ endCustomPlan: true }) });
                          toast('테스트 플랜을 끝냈어요.', 'ok', DONE);
                          loadUsers(q);
                          setPlansKey((k) => k + 1);
                        } catch (e) {
                          toast((e as Error).message, 'bad');
                        }
                      }}
                    >
                      테스트 플랜 끝내기
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className={u.banned ? '' : 'text-bad'}
                    onClick={async () => {
                      if (
                        !u.banned &&
                        !(await ask({
                          title: '계정 정지',
                          body: '이 계정의 AI 기능을 멈출까요?',
                          note: '복습과 노트 보기는 그대로 돼요. 언제든 정지를 풀 수 있어요.',
                          ok: '정지',
                          danger: true,
                        }))
                      )
                        return;
                      try {
                        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ banned: !u.banned }) });
                        loadUsers(q);
                      } catch (e) {
                        toast((e as Error).message, 'bad');
                      }
                    }}
                  >
                    {u.banned ? '정지 풀기' : '정지'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <AdminPlans
        limits={ov.settings.limits}
        refreshKey={plansKey}
        planFlags={me.features.planFlags}
        figuresOn={me.features.figures}
        onChanged={() => loadUsers(q).catch(() => {})}
      />

      <SectionTitle>신고함</SectionTitle>
      <Card className="grid gap-3">
        {!reports?.reports.length ? <p className="text-sm text-muted">열린 신고가 없어요.</p> : null}
        {reports?.reports.map((r) => {
          const q = r.target_id ? reports.questions[r.target_id] : undefined;
          const who = reports.users[r.reporter_id];
          return (
            <div key={r.id} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Chip>{REPORT_LABEL[r.target_type] ?? r.target_type}</Chip>
                <span className="text-muted">
                  {who?.nickname ?? who?.email ?? '사용자'} · {new Date(r.created_at).toLocaleString('ko-KR')}
                </span>
              </div>
              <p className="whitespace-pre-wrap font-semibold">“{r.reason}”</p>
              {r.target_type === 'theme' && r.target_id && reports.pictures?.[r.target_id] ? (
                // 신고한 AI 그림 (서명 주소, 1시간)
                // eslint-disable-next-line @next/next/no-img-element
                <img src={reports.pictures[r.target_id]} alt="신고한 테마 그림" className="max-h-56 w-auto justify-self-start rounded-xl ring-1 ring-line" />
              ) : null}
              {r.snapshot ? (
                <div className="grid gap-1">
                  <p className="text-xs font-semibold text-muted">신고할 때 본 결과</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 font-sans text-[13px] leading-relaxed">
                    {r.snapshot}
                  </pre>
                </div>
              ) : null}
              {q ? (
                <div className="rounded-xl bg-surface-2 p-3">
                  <QuestionPreview q={q} />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {q ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await api(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', suspendQuestion: true }) });
                      loadReports();
                    }}
                  >
                    문제 쉬게 하고 해결
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await api(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
                    loadReports();
                  }}
                >
                  해결
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
                    loadReports();
                  }}
                >
                  기각
                </Button>
              </div>
            </div>
          );
        })}
      </Card>

      <SectionTitle>운영자 정보 (개인정보처리방침에 보여요)</SectionTitle>
      <Card className="grid gap-3">
        <Field label="운영자 이름 (개인정보 보호책임자)" htmlFor="site-name">
          <input
            id="site-name"
            className={inputClass}
            value={site.operatorName}
            maxLength={60}
            onChange={(e) => setSite({ ...site, operatorName: e.target.value })}
          />
        </Field>
        <Field label="문의 이메일" htmlFor="site-mail">
          <input
            id="site-mail"
            className={inputClass}
            value={site.contactEmail}
            maxLength={120}
            onChange={(e) => setSite({ ...site, contactEmail: e.target.value })}
          />
        </Field>
        <Button size="sm" className="justify-self-start" busy={busy === 'site'} onClick={() => saveSetting('site', site, '운영자 정보를')}>
          저장
        </Button>
      </Card>
    </div>
  );
}

type SchemaTest = { model: string; results: Array<{ name: string; props: number; ok: boolean | null; message: string; ms: number }> };

/** 'AI 답 모양 시험' 결과: 받지 않은 모양을 먼저 */
function SchemaTestList({ result }: { result: SchemaTest }) {
  const failed = result.results.filter((r) => r.ok === false).length;
  const unknown = result.results.filter((r) => r.ok === null).length;
  const rows = [...result.results].sort((a, b) => Number(a.ok === true) - Number(b.ok === true));
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-semibold">
        {failed ? `${failed}개는 Claude 가 받지 않아요` : unknown ? `${unknown}개는 확인하지 못했어요 (다시 해 보세요)` : '모두 받아요'} · {result.model}
      </p>
      <ul className="grid gap-1">
        {rows.map((r) => (
          <li key={r.name} className="rounded-xl bg-surface-2 px-3 py-2 text-xs">
            <span className={cx('font-semibold', r.ok === false ? 'text-bad' : r.ok === null ? 'text-warn' : 'text-ok')}>
              {r.ok === false ? '안 받음' : r.ok === null ? '모름' : '받음'}
            </span>{' '}
            {r.name} · 칸 {r.props} · {(r.ms / 1000).toFixed(1)}초{r.message ? <span className="mt-0.5 block break-all text-muted">{r.message}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
