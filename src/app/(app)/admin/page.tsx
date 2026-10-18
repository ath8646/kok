'use client';
// 관리자 화면: 키 상태, 숫자, 비상 스위치, 공지, 모델, 한도, 사용자, 테스트 플랜·쿠폰, 신고함, 운영자 정보
import { useCallback, useEffect, useState } from 'react';
import { AdminPlans } from '@/components/AdminPlans';
import { useMe } from '@/components/AppShell';
import { QuestionPreview } from '@/components/QuestionList';
import { Button, Card, Chip, EmptyState, Field, LargeHeader, SectionTitle, Segmented, Toggle, api, cx, inputClass, useToast } from '@/components/ui';
import { costMultiplier } from '@/lib/ai/models';
import { MAX_FILE_MB, type Limits, type ModelsConfig, type Notice } from '@/lib/settings';
import type { QuestionRow } from '@/lib/types';
import { accountLabel } from '@/lib/login';

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
type Report = { id: number; reporter_id: string; target_type: string; target_id: string | null; reason: string; status: string; created_at: string };

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
];

export default function AdminPage() {
  const { me, refresh: refreshMe } = useMe();
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [models, setModels] = useState<ModelsConfig | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [site, setSite] = useState<{ contactEmail: string; operatorName: string } | null>(null);
  const [testModel, setTestModel] = useState<'fast' | 'careful' | 'adminTest'>('fast');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [plansKey, setPlansKey] = useState(0);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [reports, setReports] = useState<{
    reports: Report[];
    questions: Record<string, QuestionRow>;
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
      toast(`${label} 저장했어요.`, 'ok');
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
                setTestResult(r.ok ? `작동해요 ✓ ${r.model} (${r.ms}ms)` : `안 돼요: ${r.message}`);
              } catch (e) {
                setTestResult((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            키 시험
          </Button>
        </div>
        {testResult ? <p className="text-sm">{testResult}</p> : null}
        <p className="text-xs text-muted">키를 바꾸려면 Vercel 환경변수 ANTHROPIC_API_KEY 를 바꾸고 다시 배포해요.</p>
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
          onClick={() => {
            if (ov.settings.aiEnabled && !confirm('모든 사용자의 AI 기능을 끌까요? 복습은 계속 돼요.')) return;
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
              <select
                className={inputClass}
                value={models.effort[k]}
                onChange={(e) => setModels({ ...models, effort: { ...models.effort, [k]: e.target.value as 'low' | 'medium' | 'high' } })}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
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
                      const days = Number(prompt('Pro를 며칠 켤까요? (0이면 끄기)', '30'));
                      if (!Number.isFinite(days) || days < 0) return;
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
                        if (!confirm(`'${u.custom_plan!.name}' 플랜을 지금 끝낼까요? 원래 요금제로 돌아가요.`)) return;
                        try {
                          await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ endCustomPlan: true }) });
                          toast('테스트 플랜을 끝냈어요.', 'ok');
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
                      if (!u.banned && !confirm('이 계정의 AI 기능을 멈출까요?')) return;
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

      <AdminPlans limits={ov.settings.limits} refreshKey={plansKey} planFlags={me.features.planFlags} onChanged={() => loadUsers(q).catch(() => {})} />

      <SectionTitle>신고함</SectionTitle>
      <Card className="grid gap-3">
        {!reports?.reports.length ? <p className="text-sm text-muted">열린 신고가 없어요.</p> : null}
        {reports?.reports.map((r) => {
          const q = r.target_id ? reports.questions[r.target_id] : undefined;
          const who = reports.users[r.reporter_id];
          return (
            <div key={r.id} className="grid gap-2 rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Chip>{r.target_type === 'question' ? '문제' : r.target_type === 'note' ? '노트' : r.target_type}</Chip>
                <span className="text-muted">
                  {who?.nickname ?? who?.email ?? '사용자'} · {new Date(r.created_at).toLocaleString('ko-KR')}
                </span>
              </div>
              <p className="font-semibold">“{r.reason}”</p>
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
