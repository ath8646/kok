'use client';
// 요금제: 무료와 Pro 비교, 쿠폰 입력 (결제는 v0.4)
import { useState } from 'react';
import { useMe } from '@/components/AppShell';
import { Button, Card, Field, api, inputClass, useToast } from '@/components/ui';

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
    ['사진 한 번에', '5장', '30장'],
    ['원본 파일 보관', '처리 후 7일 (노트·문제·그림은 계속)', '계속'],
    ['시각화', '마인드맵·표·연표', '무료 전부 + 다음 버전의 추가 그림'],
    ['복습·오답노트·직접 만든 문제', '무제한', '무제한'],
  ];

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-2xl">요금제</h1>
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">지금 요금제</span>
        <span className="rounded-full bg-surface-2 px-3 py-1 font-bold">
          {me.isAdmin ? '관리자' : me.isPro ? `Pro · ${new Date(me.proUntil!).toLocaleDateString('ko-KR')}까지` : '무료'}
        </span>
      </Card>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
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
      <p className="text-sm text-muted">결제는 다음 버전에서 열려요. 지금은 운영자가 나눠 주는 쿠폰으로 Pro를 켤 수 있어요.</p>

      <Card>
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!code.trim()) return;
            setBusy(true);
            try {
              const r = await api<{ proUntil: string }>('/api/coupon', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
              toast(`Pro가 켜졌어요! ${new Date(r.proUntil).toLocaleDateString('ko-KR')}까지예요.`, 'ok');
              setCode('');
              refresh();
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
