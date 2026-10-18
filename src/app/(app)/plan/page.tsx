'use client';
// 요금제: 무료와 Pro 비교, 지금 쓰는 테스트 플랜, 쿠폰 입력 (결제는 v0.4)
import { useState } from 'react';
import { useMe } from '@/components/AppShell';
import { ApiError, Button, Card, Chip, Field, LargeHeader, api, inputClass, useToast } from '@/components/ui';
import { planLabel } from '@/lib/plans';

const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

type Redeemed = {
  until: string;
  plan: { kind: 'pro' | 'custom'; name: string };
  /** Pro 코드: 켜진 테스트 플랜이 끝난 뒤에 시작하면 그 시각 */
  proStarts?: string | null;
  /** 테스트 플랜 코드: 남은 Pro 가 플랜 뒤에 이어지면 그 끝나는 때 */
  proAfter?: string | null;
};

export default function PlanPage() {
  const { me, refresh } = useMe();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const rows: Array<[string, string, string]> = [
    ['가격', '0원', '월 4,900원 (예정)'],
    ['AI 에너지', '하루 20', '한 달 2,000 (하루 최대 300)'],
    ['AI 모델', '빠름', '빠름 + 꼼꼼'],
    ['PDF 한 번에', '20쪽', '150쪽'],
    ['파일 한 개 크기', '10MB', '200MB'],
    ['사진 한 번에', '5장', '30장'],
    ['원본 파일 보관', '처리 후 7일 (노트·문제·그림은 계속)', '계속'],
    ['시각화', '마인드맵·표·연표', '무료 전부 + 다음 버전의 추가 그림'],
    ['노트 채팅', '가능 (답마다 에너지)', '가능 (답마다 에너지, 꼼꼼 모델도)'],
    ['노트에 자료 더하기', '없음', '자료를 더해 새 버전으로 (버전 기록)'],
    ['테마', '기본', '색·글꼴·노트 종이 무늬'],
    ['복습·오답노트·직접 만든 문제', '무제한', '무제한'],
  ];

  return (
    <div className="grid gap-4">
      <LargeHeader title="요금제" subtitle="무료로 충분히 쓰고, 더 필요하면 Pro" back={{ href: '/settings', label: '설정으로' }} />
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">지금 요금제</span>
        <span className="rounded-full bg-surface-2 px-3 py-1 font-bold">{planLabel(me.planInfo)}</span>
      </Card>

      {me.planInfo.kind === 'custom' ? <CustomPlanCard /> : null}

      <div className="kok-card overflow-x-auto">
        <table className="w-full min-w-[440px] border-collapse text-[15px]">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left">
                항목
              </th>
              <th scope="col" className="px-3 py-2.5 text-left">
                무료
              </th>
              <th scope="col" className="px-3 py-2.5 text-left">
                <span className="rounded bg-hl px-1.5 text-hl-ink">Pro</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, free, pro]) => (
              <tr key={k} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                  {k}
                </th>
                <td className="px-3 py-2.5 text-muted">{free}</td>
                <td className="px-3 py-2.5">{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">결제는 다음 버전에서 열려요. 지금은 운영자가 나눠 주는 쿠폰으로 Pro나 테스트 플랜을 켤 수 있어요.</p>

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
                const ok = confirm(
                  `지금 쓰는 '${cur.name}' 플랜${cur.until ? `(${day(cur.until)}까지)` : ''}이 이 코드의 플랜으로 바뀌어요. 지금 플랜의 남은 기간과 번개는 없어져요. 바꿀까요?`,
                );
                if (!ok) return;
                r = await redeem(true);
              }
              const until = day(r.until);
              if (r.plan.kind === 'custom') {
                toast(`'${r.plan.name}' 플랜이 켜졌어요! ${until}까지예요.${r.proAfter ? ' 남은 Pro는 플랜이 끝난 뒤 이어져요.' : ''}`, 'ok');
              } else if (r.proStarts) {
                toast(`Pro 쿠폰을 썼어요. 지금 쓰는 테스트 플랜이 끝나면 ${until}까지 Pro예요.`, 'ok');
              } else toast(`Pro가 켜졌어요! ${until}까지예요.`, 'ok');
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

/** 지금 쓰는 테스트 플랜 (관리자가 만든 플랜) 내용 */
function CustomPlanCard() {
  const { me } = useMe();
  if (!me || me.planInfo.kind !== 'custom') return null;
  const e = me.energy;
  const items: Array<[string, string]> = [
    ['남은 에너지', `⚡ ${Math.floor(e.remaining ?? 0)} / ${e.limit ?? 0}`],
    ['하루 최대', e.planDaily === null ? '없음' : `⚡ ${e.planDaily}`],
    ['PDF 한 번에', `${me.plan.pdfPages}쪽`],
    ['사진 한 번에', `${me.plan.images}장`],
    ['글 한 번에', `${me.plan.textChars.toLocaleString('ko-KR')}자`],
    ['파일 한 개 크기', `${me.plan.fileMb}MB`],
    ['AI 모델', me.canCareful ? '빠름 + 꼼꼼' : '빠름'],
    ['원본 파일 보관', me.plan.fileDays === null ? '계속' : `플랜이 끝나고 ${me.plan.fileDays}일`],
    ['노트에 자료 더하기', me.canAppend ? '가능' : '없음'],
    ['테마', me.canTheme ? '가능' : '없음'],
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
