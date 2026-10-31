'use client';
// 요금제: 무료·Pro·Max 카드와 비교 표(관리자가 정한 값 그대로, /api/plans), 지금 쓰는 테스트 플랜, 쿠폰 입력 (결제는 다음 버전)
import { useEffect, useState, type ReactNode } from 'react';
import { useMe } from '@/components/AppShell';
import { useConfirm } from '@/components/Confirm';
import { ApiError, Button, Card, Chip, Energy, Field, ICONS, Icon, LargeHeader, api, cx, inputClass, useToast } from '@/components/ui';
import { PERKS, PERK_INFO, TIERS, TIER_NAME, energyText, planLabel, won, type Perk, type PlanSpec, type PlansConfig, type Tier } from '@/lib/plans';

const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
const n = (v: number) => v.toLocaleString('ko-KR');

type Redeemed = {
  until: string;
  plan: { kind: 'pro' | 'max' | 'custom'; name: string };
  /** Pro·Max 코드: 켜진 테스트 플랜(Pro 는 Max 도)이 끝난 뒤에 시작하면 그 시각 */
  proStarts?: string | null;
  /** 테스트 플랜·Max 코드: 남은 Pro 가 그 뒤에 이어지면 그 끝나는 때 */
  proAfter?: string | null;
  /** 테스트 플랜 코드: 남은 Max 가 플랜 뒤에 이어지면 그 끝나는 때 */
  maxAfter?: string | null;
};

/** 요금제마다 한 줄 소개 */
const TAGLINE: Record<Tier, string> = {
  free: '가볍게 시작해요',
  pro: '공부에 꼭 필요한 기능을 모두',
  max: '모든 기능과 넉넉한 한도',
};

/** 카드에 보일 혜택: 아래 요금제에 없는 것만 (무료는 기본 기능) */
function highlights(plans: PlansConfig, t: Tier): string[] {
  const s = plans[t];
  const lower: PlanSpec | null = t === 'max' ? plans.pro : t === 'pro' ? plans.free : null;
  const out = [`AI 에너지 ${energyText(s)}`, `자료 받기 하루 ${n(s.downloadsDaily)}개`, `PDF ${n(s.pdfPages)}쪽 · 파일 ${n(s.fileMb)}MB까지`];
  if (!lower) return [...out, '복습·오답노트·마인드맵·직접 만든 문제'];
  const added = PERKS.filter((p) => s.perks[p] && !lower.perks[p]).map((p) => PERK_INFO[p].label);
  if (t === 'max' && PERKS.some((p) => plans.pro.perks[p])) out.push('Pro 기능 모두');
  return [...out, ...added];
}

export default function PlanPage() {
  const { me, refresh } = useMe();
  const toast = useToast();
  const ask = useConfirm();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<PlansConfig | null>(null);
  const [fileDays, setFileDays] = useState(7);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ plans: PlansConfig; freeFileDays: number }>('/api/plans')
      .then((r) => {
        if (!alive) return;
        setPlans(r.plans);
        setFileDays(r.freeFileDays);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return null;
  const kind = me.planInfo.kind;
  const current: Tier | null = kind === 'free' || kind === 'pro' || kind === 'max' ? kind : null;

  return (
    <div className="grid gap-4">
      <LargeHeader title="요금제" subtitle="필요한 만큼 골라 써요" back={{ href: '/settings', label: '설정으로' }} />
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">지금 요금제</span>
        <span className="rounded-full bg-surface-2 px-3 py-1 font-bold">{planLabel(me.planInfo)}</span>
      </Card>

      {kind === 'custom' ? <CustomPlanCard /> : null}

      {plans ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {TIERS.map((t) => (
              <TierCard key={t} tier={t} plans={plans} current={current === t} />
            ))}
          </div>
          <p className="text-sm text-muted">결제는 다음 버전에서 열려요. 지금은 운영자가 나눠 주는 쿠폰으로 Pro·Max나 테스트 플랜을 켤 수 있어요.</p>
          <CompareTable plans={plans} current={current} fileDays={fileDays} />
        </>
      ) : failed ? (
        <Card className="text-sm text-muted">요금제 표를 불러오지 못했어요. 새로 고쳐 주세요.</Card>
      ) : (
        <div className="kok-skel grid gap-3 md:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="kok-card kok-shimmer h-[260px]" />
          ))}
        </div>
      )}

      <Card>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!code.trim()) return;
            setBusy(true);
            const redeem = (replace: boolean) => api<Redeemed>('/api/coupon', { method: 'POST', body: JSON.stringify({ code: code.trim(), replace }) });
            try {
              let r: Redeemed;
              try {
                r = await redeem(false);
              } catch (err) {
                // 다른 테스트 플랜을 쓰는 중이면 바꿀지 묻는다 (바꾸면 지금 플랜의 남은 기간·번개는 없어진다)
                if (!(err instanceof ApiError && err.code === 'plan_active')) throw err;
                const cur = me.planInfo;
                const ok = await ask({
                  title: '플랜 바꾸기',
                  body: `지금 쓰는 '${cur.name}' 플랜${cur.until ? `(${day(cur.until)}까지)` : ''}이 이 코드의 플랜으로 바뀌어요. 바꿀까요?`,
                  note: '지금 플랜의 남은 기간과 번개는 없어져요.',
                  ok: '바꾸기',
                });
                if (!ok) return;
                r = await redeem(true);
              }
              const until = day(r.until);
              if (r.plan.kind === 'custom') {
                const after = [r.maxAfter ? 'Max' : '', r.proAfter ? 'Pro' : ''].filter(Boolean).join('·');
                toast(`'${r.plan.name}' 플랜이 켜졌어요! ${until}까지예요.${after ? ` 남은 ${after}는 플랜이 끝난 뒤 이어져요.` : ''}`, 'ok');
              } else if (r.proStarts) {
                toast(`${r.plan.name} 쿠폰을 썼어요. 지금 쓰는 요금제가 끝나면 ${until}까지 ${r.plan.name}예요.`, 'ok');
              } else {
                toast(`${r.plan.name}가 켜졌어요! ${until}까지예요.${r.plan.kind === 'max' && r.proAfter ? ' 남은 Pro는 Max가 끝난 뒤 이어져요.' : ''}`, 'ok');
              }
              setCode('');
              await refresh();
            } catch (err) {
              toast((err as Error).message, 'bad');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="쿠폰 번호" htmlFor="coupon">
            <input
              id="coupon"
              className={inputClass}
              value={code}
              maxLength={40}
              placeholder="KOK-XXXX-XXXX"
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Button type="submit" busy={busy} disabled={!code.trim()}>
            쿠폰 쓰기
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** 요금제 카드: 이름·값·한 줄 소개·주요 혜택 */
function TierCard({ tier, plans, current }: { tier: Tier; plans: PlansConfig; current: boolean }) {
  const s = plans[tier];
  const items = highlights(plans, tier);
  return (
    <section
      className={cx('kok-card relative grid content-start gap-3 p-5', tier === 'max' && 'kok-hero', current && 'ring-2 ring-accent ring-inset')}
      aria-labelledby={`tier-${tier}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={`tier-${tier}`} className="font-display text-[22px]">
          {TIER_NAME[tier]}
        </h2>
        {current ? <Chip tone="accent">지금 요금제</Chip> : null}
      </div>
      <p>
        {s.price ? (
          <>
            <span className="font-display text-[26px] tabular-nums">{won(s.price)}</span>
            <span className="text-sm text-muted"> / 월 (예정)</span>
          </>
        ) : (
          <span className="font-display text-[26px]">0원</span>
        )}
      </p>
      <p className="text-sm text-muted">{TAGLINE[tier]}</p>
      <ul className="grid gap-2 text-[15px]">
        {items.map((x) => (
          <li key={x} className="flex items-start gap-2">
            <Icon d={ICONS.check} size={17} strokeWidth={2.6} className="mt-[3px] shrink-0 text-accent" />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 무료·Pro·Max 비교 표 (폰은 옆으로 넘긴다: 첫 칸은 붙어 있다) */
function CompareTable({ plans, current, fileDays }: { plans: PlansConfig; current: Tier | null; fileDays: number }) {
  const yes = <Icon d={ICONS.check} size={18} strokeWidth={2.6} className="text-ok" />;
  const no = (
    <span className="text-muted" aria-label="없음">
      –
    </span>
  );
  const rows: Array<[string, (s: PlanSpec, t: Tier) => ReactNode]> = [
    ['가격', (s) => (s.price ? `월 ${won(s.price)}` : '0원')],
    ['AI 에너지', (s) => energyText(s)],
    ['AI 모델', (s) => (s.perks.careful ? '빠름 + 꼼꼼' : '빠름')],
    ['PDF 한 번에', (s) => `${n(s.pdfPages)}쪽`],
    ['사진 한 번에', (s) => `${n(s.images)}장`],
    ['글 한 번에', (s) => `${n(s.textChars)}자`],
    ['파일 한 개', (s) => `${n(s.fileMb)}MB`],
    ['원본 파일 보관', (s) => (s.perks.keepFiles ? '계속' : `처리 후 ${fileDays}일 (노트·문제는 계속)`)],
    ...PERKS.filter((p): p is Exclude<Perk, 'careful' | 'keepFiles'> => p !== 'careful' && p !== 'keepFiles').map(
      (p) => [PERK_INFO[p].label, (s: PlanSpec) => (s.perks[p] ? yes : no)] as [string, (s: PlanSpec) => ReactNode],
    ),
    ['자료 받기 (하루)', (s) => `${n(s.downloadsDaily)}개`],
    ['갤러리 만들기', (s) => `${n(s.galleries)}개`],
    ['공유 파일 한 개', (s) => `${n(s.shareFileMb)}MB`],
    ['공유 글 하나에 파일', (s) => `${n(s.shareFiles)}개`],
    ['복습·오답노트·직접 만든 문제', () => '무제한'],
  ];
  return (
    // 폰에서도 세 요금제가 한눈에 보이게 칸 너비를 나눠 둔다 (옆으로 넘기지 않는다: 긴 글은 줄을 바꾼다)
    <div className="kok-card overflow-hidden">
      <table className="w-full table-fixed border-collapse text-[13px] leading-snug sm:text-[15px]">
        <caption className="sr-only">요금제 비교</caption>
        <colgroup>
          <col className="w-[31%] sm:w-[28%]" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead className="bg-surface-2">
          <tr>
            <th scope="col" className="px-2.5 py-2.5 text-left sm:px-3">
              항목
            </th>
            {TIERS.map((t) => (
              <th key={t} scope="col" className="px-2 py-2.5 text-left sm:px-3">
                <span className={cx(t !== 'free' && 'rounded bg-hl px-1.5 text-hl-ink')}>{TIER_NAME[t]}</span>
                {current === t ? <span className="mt-0.5 block text-[11px] font-semibold text-accent sm:ml-1 sm:mt-0 sm:inline sm:text-xs">지금</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, cell]) => (
            <tr key={k} className="border-t border-line align-top">
              <th scope="row" className="break-keep px-2.5 py-2.5 text-left font-semibold sm:px-3">
                {k}
              </th>
              {TIERS.map((t) => (
                <td key={t} className={cx('break-keep px-2 py-2.5 sm:px-3', t === 'free' && 'text-muted')}>
                  {cell(plans[t], t)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 지금 쓰는 테스트 플랜 (관리자가 만든 플랜) 내용 */
function CustomPlanCard() {
  const { me } = useMe();
  if (!me || me.planInfo.kind !== 'custom') return null;
  const e = me.energy;
  const on = (v: boolean) => (v ? '가능' : '없음');
  const items: Array<[string, ReactNode]> = [
    ['남은 에너지', <Energy key="e" n={`${Math.floor(e.remaining ?? 0)} / ${e.limit ?? 0}`} />],
    ['하루 최대', e.planDaily === null ? '없음' : <Energy key="d" n={e.planDaily} />],
    ['PDF 한 번에', `${me.plan.pdfPages}쪽`],
    ['사진 한 번에', `${me.plan.images}장`],
    ['글 한 번에', `${me.plan.textChars.toLocaleString('ko-KR')}자`],
    ['파일 한 개 크기', `${me.plan.fileMb}MB`],
    ['AI 모델', me.canCareful ? '빠름 + 꼼꼼' : '빠름'],
    ['원본 파일 보관', me.plan.fileDays === null ? '계속' : `플랜이 끝나고 ${me.plan.fileDays}일`],
    ['노트에 자료 더하기', on(me.canAppend)],
    ['그림 풀이', on(me.canFigures)],
    ['테마', on(me.canTheme)],
    ['단계별 학습', on(me.canCourse)],
    ['AI로 다시 정리', on(me.canReorganize)],
    ['표지 그림', on(me.canCover)],
    ['자료 그림 다시 그리기', on(me.canRedraw)],
    ['시그니처 테마', on(me.canSkins)],
    ['AI 테마 그림', on(me.canAiTheme)],
    ['자료 받기 (하루)', me.share.downloadsDaily === null ? '제한 없음' : `${me.share.downloadsDaily}개`],
    ['갤러리 만들기', me.share.galleries === null ? '제한 없음' : `${me.share.galleries}개`],
  ];
  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="text-xs font-semibold text-accent">테스트 플랜</span>
          <span className="font-display text-xl">{me.planInfo.name}</span>
        </div>
        {me.planInfo.until ? <Chip tone="accent">{day(me.planInfo.until)}까지</Chip> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
        {items.map(([k, v]) => (
          <div key={k} className="grid gap-0.5">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">플랜 에너지는 기간 동안 다시 채워지지 않아요. 플랜이 끝나면 원래 요금제로 돌아가요.</p>
    </Card>
  );
}
