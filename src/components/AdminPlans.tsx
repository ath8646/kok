'use client';
// 관리자 화면의 "테스트 플랜"과 "쿠폰(코드)" 칸.
// 테스트 플랜: 번개(에너지) 총량과 한도, 혜택 스위치 전부, 자료 공유 숫자를 정해 만든다 (칸은 요금제 혜택과 같다: lib/plans.ts).
// 코드를 쓴 사람은 코드에 정한 날수 동안 이 플랜을 쓰고, 끝나면 원래 요금제로 돌아간다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/Confirm';
import { josa } from '@/lib/josa';
import { ApiError, Button, Card, Chip, Energy, Field, SectionTitle, Sheet, Toggle, api, cx, inputClass, useToast, DONE } from '@/components/ui';
import { MAX_FILE_MB } from '@/lib/settings';
import {
  PERKS,
  PERK_INFO,
  PLAN_NUMBERS,
  SHARE_MAX_FILES,
  SHARE_MAX_FILE_MB,
  TIER_NAME,
  TIERS,
  toCustomPlan,
  type Perk,
  type Perks,
  type PlansConfig,
  type Tier,
} from '@/lib/plans';

export type PlanRow = {
  id: string;
  name: string;
  energy_total: number | string;
  energy_daily: number | string | null;
  pdf_pages: number;
  images: number;
  text_chars: number;
  file_mb: number;
  careful: boolean;
  /** schema.sql 을 다시 실행하기 전에는 없다 */
  can_append?: boolean;
  can_theme?: boolean;
  can_figures?: boolean;
  /** 혜택 스위치 전부·자료 공유 숫자 (없으면 예전 칸으로 읽는다) */
  extra?: unknown;
  note: string | null;
  created_at: string;
  active_users: number;
  codes: number;
  redeemed: number;
};

type Coupon = {
  code: string;
  days: number;
  max_uses: number;
  used: number;
  note: string | null;
  expires_at: string | null;
  created_at: string;
  plan_id: string | null;
  plan_name: string | null;
  /** 테스트 플랜이 아닐 때 켜는 요금제 (schema.sql 을 다시 실행하기 전에는 없다: Pro) */
  tier?: string | null;
};

type NumKey = 'energyTotal' | 'energyDaily' | 'pdfPages' | 'images' | 'textChars' | 'fileMb' | 'downloadsDaily' | 'galleries' | 'shareFileMb' | 'shareFiles';

type PlanForm = {
  id: string | null;
  name: string;
  nums: Record<NumKey, string>;
  perks: Perks;
  note: string;
};

const NUM_FIELDS: Array<{ key: NumKey; label: string; hint?: string; optional?: boolean }> = [
  { key: 'energyTotal', label: '에너지 총량', hint: '플랜 기간 전체에 쓸 수 있어요' },
  { key: 'energyDaily', label: '하루 최대 에너지', hint: '비우면 하루 제한 없음', optional: true },
  ...PLAN_NUMBERS.map((f) => ({
    key: f.key,
    label: `${f.label} (${f.unit})`,
    hint:
      f.key === 'fileMb'
        ? `${MAX_FILE_MB}까지`
        : f.key === 'shareFileMb'
          ? `${SHARE_MAX_FILE_MB}까지`
          : f.key === 'shareFiles'
            ? `${SHARE_MAX_FILES}까지`
            : undefined,
  })),
];

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

/** 요금제 하나의 값으로 채운 폼 (에너지 총량은 한 달 값, 하루만 세는 요금제면 하루 × 30) */
function formFromTier(t: Tier, tiers: PlansConfig, keep?: Pick<PlanForm, 'id' | 'name' | 'note'>): PlanForm {
  const s = tiers[t];
  const total = s.energyMonthly ?? (s.energyDaily ?? 0) * 30;
  return {
    id: keep?.id ?? null,
    name: keep?.name ?? '',
    note: keep?.note ?? '',
    nums: {
      energyTotal: String(total),
      energyDaily: s.energyDaily === null ? '' : String(s.energyDaily),
      pdfPages: String(s.pdfPages),
      images: String(s.images),
      textChars: String(s.textChars),
      fileMb: String(Math.min(s.fileMb, MAX_FILE_MB)),
      downloadsDaily: String(s.downloadsDaily),
      galleries: String(s.galleries),
      shareFileMb: String(s.shareFileMb),
      shareFiles: String(s.shareFiles),
    },
    perks: { ...s.perks },
  };
}

function formFrom(p: PlanRow): PlanForm {
  const c = toCustomPlan(p);
  return {
    id: p.id,
    name: p.name,
    note: p.note ?? '',
    nums: {
      energyTotal: String(c.energyTotal),
      energyDaily: c.energyDaily === null ? '' : String(c.energyDaily),
      pdfPages: String(c.pdfPages),
      images: String(c.images),
      textChars: String(c.textChars),
      fileMb: String(c.fileMb),
      downloadsDaily: String(c.downloadsDaily),
      galleries: String(c.galleries),
      shareFileMb: String(c.shareFileMb),
      shareFiles: String(c.shareFiles),
    },
    perks: { ...c.perks },
  };
}

/** 폼 → 서버로 보낼 값. 빈칸이면 무엇이 빠졌는지 알려 준다 */
function toBody(f: PlanForm): { body: Record<string, unknown> } | { error: string } {
  if (!f.name.trim()) return { error: '플랜 이름을 적어 주세요.' };
  const out: Record<string, unknown> = { name: f.name.trim(), perks: f.perks, note: f.note.trim() };
  for (const field of NUM_FIELDS) {
    const raw = f.nums[field.key].trim();
    if (!raw) {
      if (field.optional) {
        out[field.key] = null;
        continue;
      }
      return { error: `'${field.label}' 칸을 채워 주세요.` };
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `'${field.label}' 칸에는 숫자를 적어 주세요.` };
    out[field.key] = n;
  }
  return { body: out };
}

/** 플랜 목록에 보일 켠 혜택 이름 */
function perkNames(p: PlanRow): string[] {
  const c = toCustomPlan(p);
  return PERKS.filter((k) => c.perks[k]).map((k) => PERK_INFO[k].label);
}

/**
 * tiers: 무료·Pro·Max 혜택 (새 플랜을 그 값으로 채운다)
 * refreshKey: 바뀌면 플랜 목록(쓰는 사람 수)을 다시 읽는다 (사용자 목록에서 테스트 플랜을 끝냈을 때)
 * maxOn: DB 에 Max 와 혜택 전부(extra) 칸이 있는지 (없으면 예전 네 스위치만 저장되고, Max 코드는 만들 수 없다)
 */
export function AdminPlans({
  tiers,
  onChanged,
  refreshKey = 0,
  maxOn = true,
}: {
  tiers: PlansConfig;
  onChanged?: () => void;
  refreshKey?: number;
  maxOn?: boolean;
}) {
  const toast = useToast();
  const ask = useConfirm();
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [schemaHint, setSchemaHint] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newCoupon, setNewCoupon] = useState<{ days: number; maxUses: number; count: number; note: string; planId: string | null; tier: 'pro' | 'max' }>({
    days: 30,
    maxUses: 1,
    count: 1,
    note: '',
    planId: null,
    tier: 'pro',
  });
  const [made, setMade] = useState<{ codes: string[]; planName: string; days: number } | null>(null);
  const codeCard = useRef<HTMLDivElement>(null);
  const daysInput = useRef<HTMLInputElement>(null);

  const loadPlans = useCallback(async () => {
    try {
      const r = await api<{ plans: PlanRow[] }>('/api/admin/plans');
      setPlans(r.plans);
      setSchemaHint(null);
    } catch (e) {
      setPlans(null);
      if (e instanceof ApiError && e.code === 'schema_outdated') setSchemaHint(e.message);
      else toast((e as Error).message, 'bad');
    }
  }, [toast]);
  const loadCoupons = useCallback(async () => {
    try {
      setCoupons((await api<{ coupons: Coupon[] }>('/api/admin/coupons')).coupons);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api<{ plans: PlanRow[] }>('/api/admin/plans'), api<{ coupons: Coupon[] }>('/api/admin/coupons')]).then(([p, c]) => {
      if (!alive) return;
      if (p.status === 'fulfilled') setPlans(p.value.plans);
      else if (p.reason instanceof ApiError && p.reason.code === 'schema_outdated') setSchemaHint(p.reason.message);
      else toast((p.reason as Error).message, 'bad');
      if (c.status === 'fulfilled') setCoupons(c.value.coupons);
      else toast((c.reason as Error).message, 'bad');
    });
    return () => {
      alive = false;
    };
  }, [toast]);

  const seenKey = useRef(refreshKey);
  useEffect(() => {
    if (seenKey.current === refreshKey) return;
    seenKey.current = refreshKey;
    loadPlans();
  }, [refreshKey, loadPlans]);

  const planName = (id: string | null, tier: 'pro' | 'max' = 'pro') => (id ? (plans?.find((p) => p.id === id)?.name ?? '테스트 플랜') : TIER_NAME[tier]);

  const savePlan = async () => {
    if (!form) return;
    const v = toBody(form);
    if ('error' in v) {
      toast(v.error, 'bad');
      return;
    }
    setBusy('plan');
    try {
      const r = form.id
        ? await api<{ warning?: string }>(`/api/admin/plans/${form.id}`, { method: 'PATCH', body: JSON.stringify(v.body) })
        : await api<{ warning?: string }>('/api/admin/plans', { method: 'POST', body: JSON.stringify(v.body) });
      if (r.warning) toast(r.warning, 'bad');
      else toast(form.id ? '플랜을 고쳤어요.' : `'${form.name.trim()}' 플랜을 만들었어요. 이제 코드를 만들어 나눠 주세요.`, 'ok', DONE);
      setForm(null);
      await loadPlans();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const removePlan = async (p: PlanRow) => {
    const notes: string[] = [];
    if (p.codes) notes.push(`이 플랜의 코드 ${p.codes}개도 함께 지워져요.`);
    if (p.active_users) notes.push(`지금 쓰는 ${p.active_users}명은 원래 요금제로 돌아가요.`);
    notes.push('되돌릴 수 없어요.');
    if (!(await ask({ title: '플랜 지우기', body: `${josa(`'${p.name}' 플랜`, '을')} 지울까요?`, note: notes.join(' '), ok: '지우기', danger: true }))) return;
    setBusy(`del-${p.id}`);
    try {
      await api(`/api/admin/plans/${p.id}`, { method: 'DELETE' });
      toast('플랜을 지웠어요.', 'ok', DONE);
      if (newCoupon.planId === p.id) setNewCoupon((c) => ({ ...c, planId: null }));
      await Promise.all([loadPlans(), loadCoupons()]);
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  /** 이 플랜으로 코드 만들기: 쿠폰 칸으로 가서 플랜을 골라 둔다 */
  const codeFor = (p: PlanRow) => {
    setNewCoupon((c) => ({ ...c, planId: p.id }));
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    codeCard.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    daysInput.current?.focus({ preventScroll: true });
  };

  const makeCodes = async () => {
    setBusy('coupon');
    try {
      const r = await api<{ codes: string[] }>('/api/admin/coupons', { method: 'POST', body: JSON.stringify(newCoupon) });
      setMade({ codes: r.codes, planName: planName(newCoupon.planId, newCoupon.tier), days: newCoupon.days });
      await Promise.all([loadCoupons(), newCoupon.planId ? loadPlans() : Promise.resolve()]);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const copy = (text: string, label = '복사했어요.') =>
    navigator.clipboard?.writeText(text).then(
      () => toast(label, 'plain', DONE),
      () => toast('복사하지 못했어요. 길게 눌러 직접 복사해 주세요.', 'bad'),
    );

  return (
    <>
      <SectionTitle
        action={
          plans ? (
            <Button size="sm" variant="secondary" onClick={() => setForm(formFromTier('pro', tiers))}>
              + 새 플랜
            </Button>
          ) : null
        }
      >
        테스트 플랜
      </SectionTitle>
      <Card className="grid gap-3">
        <p className="text-sm text-muted">
          에너지 총량과 한도, 혜택을 하나하나 정해 플랜을 만들고, 아래에서 그 플랜의 코드를 만들어 나눠 주세요. 코드를 쓴 사람은 정한 날수 동안 이 플랜을 쓰고,
          끝나면 원래 요금제(무료·Pro·Max)로 돌아가요.
        </p>
        {schemaHint ? (
          <p className="rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn" role="status">
            {schemaHint}
          </p>
        ) : null}
        {plans && !plans.length ? <p className="text-sm text-muted">아직 만든 테스트 플랜이 없어요.</p> : null}
        {plans?.length ? (
          <ul className="grid gap-2">
            {plans.map((p) => {
              const daily = num(p.energy_daily);
              return (
                <li key={p.id} className="grid gap-2 rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <Chip tone="hl">
                      <Energy n={fmt(num(p.energy_total) ?? 0)} />
                    </Chip>
                    {daily !== null ? (
                      <Chip>
                        하루 <Energy n={fmt(daily)} />
                      </Chip>
                    ) : null}
                    <Chip tone={p.active_users ? 'ok' : 'plain'}>쓰는 사람 {p.active_users}명</Chip>
                  </div>
                  {perkNames(p).length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {perkNames(p).map((x) => (
                        <Chip key={x} tone="accent">
                          {x}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-muted">
                    PDF {p.pdf_pages}쪽 · 사진 {p.images}장 · 글자 {fmt(p.text_chars)}자 · 파일 {p.file_mb}MB · 자료 받기 하루 {toCustomPlan(p).downloadsDaily}
                    개 · 코드 {p.codes}개 (쓴 횟수 {p.redeemed}){p.note ? ` · ${p.note}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => codeFor(p)}>
                      코드 만들기
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setForm(formFrom(p))}>
                      고치기
                    </Button>
                    <Button size="sm" variant="ghost" className="text-bad" busy={busy === `del-${p.id}`} onClick={() => removePlan(p)}>
                      지우기
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>

      <SectionTitle>쿠폰 (코드)</SectionTitle>
      <div ref={codeCard} className="scroll-mt-24">
        <Card className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">
            켜 줄 플랜
            <Select
              value={newCoupon.planId ?? `tier:${newCoupon.tier}`}
              onChange={(v) =>
                setNewCoupon(
                  v.startsWith('tier:')
                    ? { ...newCoupon, planId: null, tier: v === 'tier:max' ? 'max' : 'pro' }
                    : { ...newCoupon, planId: v || null, tier: 'pro' },
                )
              }
              options={[
                { value: 'tier:pro', label: 'Pro' },
                ...(maxOn ? [{ value: 'tier:max', label: 'Max' }] : []),
                ...(plans ?? []).map((p) => ({ value: p.id, label: `테스트 플랜 · ${p.name} (에너지 ${fmt(num(p.energy_total) ?? 0)})` })),
              ]}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1 text-sm font-semibold">
              기간(일)
              <input
                ref={daysInput}
                type="number"
                className={inputClass}
                value={newCoupon.days}
                min={1}
                max={3650}
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
          <p className="text-xs text-muted">
            기간은 코드를 쓴 날부터 세요. 코드 하나를 여러 명이 쓰게 하려면 &lsquo;쓸 수 있는 사람&rsquo;을 늘리세요. 학생은 설정 → 요금제·쿠폰에서 코드를
            넣어요.
          </p>
          <Button size="sm" className="justify-self-start" busy={busy === 'coupon'} onClick={makeCodes}>
            {newCoupon.planId ? `'${planName(newCoupon.planId)}' 코드 만들기` : `${TIER_NAME[newCoupon.tier]} 코드 만들기`}
          </Button>
          {made ? (
            <div className="kok-pop rounded-xl bg-hl/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  새 코드 · {made.planName} {made.days}일 (눌러서 복사)
                </p>
                {made.codes.length > 1 ? (
                  <button type="button" className="press text-sm font-semibold text-accent" onClick={() => copy(made.codes.join('\n'), '모두 복사했어요.')}>
                    모두 복사
                  </button>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {made.codes.map((c) => (
                  <button key={c} type="button" className="press rounded-lg bg-surface px-2 py-1 font-mono text-sm" onClick={() => copy(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {coupons.length ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">만든 코드 {coupons.length}개</summary>
              <ul className="mt-2 grid gap-1 text-sm">
                {coupons.map((c) => (
                  <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{c.code}</span>
                      <Chip tone={c.plan_id ? 'accent' : 'hl'}>{c.plan_id ? (c.plan_name ?? '테스트 플랜') : c.tier === 'max' ? 'Max' : 'Pro'}</Chip>
                    </span>
                    <span className={cx('text-muted', c.used >= c.max_uses && 'line-through')}>
                      {c.days}일 · {c.used}/{c.max_uses}명 {c.note ? `· ${c.note}` : ''}
                      {c.expires_at ? ` · ${day(c.expires_at)}까지 쓸 수 있음` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      </div>

      <Sheet
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? '테스트 플랜 고치기' : '새 테스트 플랜'}
        footer={
          <Button className="w-full" busy={busy === 'plan'} onClick={savePlan}>
            {form?.id ? '고친 내용 저장' : '플랜 만들기'}
          </Button>
        }
      >
        {form ? (
          <form
            className="grid gap-3"
            // 브라우저의 검사 말풍선 대신 앱 알림으로 (toBody 가 검사한다)
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              savePlan();
            }}
          >
            <Field label="플랜 이름" htmlFor="plan-name">
              <input
                id="plan-name"
                className={inputClass}
                value={form.name}
                maxLength={30}
                placeholder="예: 베타 테스터"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-sm font-semibold">요금제 값으로 채우기</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="요금제 값으로 채우기">
                {TIERS.map((t) => (
                  <Button key={t} size="sm" variant="secondary" onClick={() => setForm(formFromTier(t, tiers, form))}>
                    {TIER_NAME[t]}처럼
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted">에너지 총량은 그 요금제의 한 달 값이에요. 채운 뒤 칸마다 바꿀 수 있어요.</p>
            </div>
            <div className="grid grid-cols-2 items-start gap-x-2 gap-y-3">
              {NUM_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint} htmlFor={`plan-${f.key}`}>
                  <input
                    id={`plan-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    className={inputClass}
                    value={form.nums[f.key]}
                    placeholder={f.optional ? '제한 없음' : undefined}
                    onChange={(e) => setForm({ ...form, nums: { ...form.nums, [f.key]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>
            <p className="text-xs text-muted">
              참고: 무료는 {tiers.free.energyMonthly !== null ? '한 달' : '하루'} <Energy n={fmt(tiers.free.energyMonthly ?? tiers.free.energyDaily ?? 0)} />,
              Pro는 한 달 <Energy n={fmt(tiers.pro.energyMonthly ?? 0)} />, Max는 한 달 <Energy n={fmt(tiers.max.energyMonthly ?? 0)} />
              이에요.
            </p>
            <fieldset className="grid gap-2.5">
              <legend className="mb-1 text-sm font-semibold">혜택</legend>
              {PERKS.map((k: Perk) => (
                <Toggle
                  key={k}
                  id={`plan-perk-${k}`}
                  label={PERK_INFO[k].label}
                  hint={PERK_INFO[k].hint}
                  checked={form.perks[k]}
                  onChange={(v) => setForm({ ...form, perks: { ...form.perks, [k]: v } })}
                />
              ))}
            </fieldset>
            {!maxOn ? (
              <p className="rounded-xl bg-warn-soft p-3 text-xs font-semibold text-warn">
                Supabase 에서 schema.sql 을 다시 실행하기 전에는 꼼꼼 모델·자료 더하기·테마·그림 풀이만 저장돼요.
              </p>
            ) : null}
            <input
              aria-label="메모"
              className={inputClass}
              value={form.note}
              maxLength={100}
              placeholder="메모 (예: 10월 베타)"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            {form.id ? <p className="text-xs text-muted">고치면 지금 이 플랜을 쓰는 사람에게 바로 적용돼요. 이미 쓴 번개는 그대로 세요.</p> : null}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        ) : null}
      </Sheet>
    </>
  );
}
