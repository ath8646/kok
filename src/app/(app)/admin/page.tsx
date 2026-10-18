'use client';
// 관리자 화면: 키 상태, 숫자, 비상 스위치, 공지, 모델, 한도, 사용자, 쿠폰, 신고함, 운영자 정보
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/AppShell';
import { QuestionPreview } from '@/components/QuestionList';
import { Button, Card, Chip, EmptyState, Field, SectionTitle, Segmented, Toggle, api, cx, inputClass, useToast } from '@/components/ui';
import { costMultiplier } from '@/lib/ai/models';
import type { Limits, ModelsConfig, Notice } from '@/lib/settings';
import type { QuestionRow } from '@/lib/types';

type Overview = {
  stats: {
    users: number;
    pro_users: number;
    active_today: number;
    usd_month: number;
    usd_month_free: number;
    usd_today: number;
    sources_month: number;
    open_reports: number;
  };
  key: { connected: boolean; hint: string | null };
  settings: { limits: Limits; models: ModelsConfig; notice: Notice; aiEnabled: boolean; site: { contactEmail: string; operatorName: string } };
  env: { supabaseSecret: boolean; adminEmails: boolean; cronSecret: boolean };
};
type UserRow = {
  id: string;
  email: string | null;
  nickname: string | null;
  role: string;
  plan: string;
  pro_until: string | null;
  pro_active: boolean;
  banned: boolean;
  created_at: string;
};
type Coupon = { code: string; days: number; max_uses: number; used: number; note: string | null; expires_at: string | null; created_at: string };
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
  const [users, setUsers] = useState<UserRow[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [newCoupon, setNewCoupon] = useState({ days: 30, maxUses: 1, count: 1, note: '' });
  const [madeCodes, setMadeCodes] = useState<string[]>([]);
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
  const loadCoupons = useCallback(async () => setCoupons((await api<{ coupons: Coupon[] }>('/api/admin/coupons')).coupons), []);
  const loadReports = useCallback(async () => setReports(await api('/api/admin/reports?status=open')), []);

  useEffect(() => {
    if (!me?.isAdmin) return;
    let alive = true;
    Promise.all([
      api<Overview>('/api/admin/overview'),
      api<{ users: UserRow[] }>('/api/admin/users?q='),
      api<{ coupons: Coupon[] }>('/api/admin/coupons'),
      api<NonNullable<typeof reports>>('/api/admin/reports?status=open'),
    ])
      .then(([o, u, c, r]) => {
        if (!alive) return;
        applyOverview(o);
        setUsers(u.users);
        setCoupons(c.coupons);
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
  if (!ov || !limits || !models || !notice || !site) return <div className="h-48 animate-pulse rounded-2xl bg-surface-2" />;

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
      <h1 className="font-display text-2xl">관리자</h1>

      <SectionTitle>API 키 상태</SectionTitle>
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {ov.key.connected ? <Chip tone="ok">연결됨 {ov.key.hint}</Chip> : <Chip tone="bad">키 없음</Chip>}
          {ov.env.supabaseSecret ? <Chip tone="ok">Supabase 비밀 키 있음</Chip> : <Chip tone="bad">Supabase 비밀 키 없음</Chip>}
          {ov.env.adminEmails ? <Chip tone="ok">관리자 이메일 설정됨</Chip> : <Chip tone="warn">ADMIN_EMAILS 없음</Chip>}
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
            ['Pro', s.pro_users],
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
                  <span className="text-sm text-muted">{u.email}</span>
                  {u.role === 'admin' ? <Chip tone="accent">관리자</Chip> : null}
                  {pro ? <Chip tone="hl">Pro ~{new Date(u.pro_until!).toLocaleDateString('ko-KR')}</Chip> : null}
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

      <SectionTitle>Pro 쿠폰</SectionTitle>
      <Card className="grid gap-3">
        <div className="grid grid-cols-3 gap-2">
          <label className="grid gap-1 text-sm font-semibold">
            기간(일)
            <input
              type="number"
              className={inputClass}
              value={newCoupon.days}
              min={1}
              onChange={(e) => setNewCoupon({ ...newCoupon, days: Number(e.target.value) })}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            쓸 수 있는 사람
            <input
              type="number"
              className={inputClass}
              value={newCoupon.maxUses}
              min={1}
              onChange={(e) => setNewCoupon({ ...newCoupon, maxUses: Number(e.target.value) })}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            만들 개수
            <input
              type="number"
              className={inputClass}
              value={newCoupon.count}
              min={1}
              max={50}
              onChange={(e) => setNewCoupon({ ...newCoupon, count: Number(e.target.value) })}
            />
          </label>
        </div>
        <input
          aria-label="메모"
          className={inputClass}
          value={newCoupon.note}
          maxLength={100}
          placeholder="메모 (예: 친구 시험용)"
          onChange={(e) => setNewCoupon({ ...newCoupon, note: e.target.value })}
        />
        <Button
          size="sm"
          className="justify-self-start"
          busy={busy === 'coupon'}
          onClick={async () => {
            setBusy('coupon');
            try {
              const r = await api<{ codes: string[] }>('/api/admin/coupons', { method: 'POST', body: JSON.stringify(newCoupon) });
              setMadeCodes(r.codes);
              loadCoupons();
            } catch (e) {
              toast((e as Error).message, 'bad');
            } finally {
              setBusy(null);
            }
          }}
        >
          쿠폰 만들기
        </Button>
        {madeCodes.length ? (
          <div className="rounded-xl bg-hl/40 p-3">
            <p className="text-sm font-semibold">새 쿠폰 (눌러서 복사)</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {madeCodes.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rounded-lg bg-surface px-2 py-1 font-mono text-sm"
                  onClick={() => navigator.clipboard?.writeText(c).then(() => toast('복사했어요.'))}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {coupons.length ? (
          <details>
            <summary className="cursor-pointer text-sm font-semibold">만든 쿠폰 {coupons.length}개</summary>
            <ul className="mt-2 grid gap-1 text-sm">
              {coupons.map((c) => (
                <li key={c.code} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
                  <span className="font-mono">{c.code}</span>
                  <span className="text-muted">
                    {c.days}일 · {c.used}/{c.max_uses}명 {c.note ? `· ${c.note}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

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
