'use client';
// 관리자 화면의 '요금제 혜택': 무료·Pro·Max 의 값·에너지·한도·자료 공유 숫자·혜택 스위치를 한 표에서 고친다.
// 저장하면 app_settings 'plans' 에 들어가고 곧바로(15초 안) 모든 사람에게 적용된다. 이미 만든 것(테마·레슨·표지·버전)은 혜택이 없어져도 남는다.
import { useState } from 'react';
import { useConfirm } from '@/components/Confirm';
import { Button, Card, ICONS, Icon, SectionTitle, api, cx, inputClass, useToast, DONE } from '@/components/ui';
import { DEFAULT_PLANS, PERKS, PERK_INFO, PLAN_NUMBERS, TIER_NAME, TIERS, won, type Perk, type PlanSpec, type PlansConfig, type Tier } from '@/lib/plans';

type NumField = { key: 'price' | 'energyDaily' | 'energyMonthly' | (typeof PLAN_NUMBERS)[number]['key']; label: string; unit: string; optional?: boolean };

const NUMS: NumField[] = [
  { key: 'price', label: '한 달 값', unit: '원' },
  { key: 'energyMonthly', label: '한 달 에너지', unit: '', optional: true },
  { key: 'energyDaily', label: '하루 에너지', unit: '', optional: true },
  ...PLAN_NUMBERS.map((f) => ({ key: f.key, label: f.label, unit: f.unit })),
];

/** 고치는 동안의 값 (숫자 칸은 글로 두어 지우고 다시 적을 수 있게) */
type Draft = Record<Tier, { nums: Record<NumField['key'], string>; perks: PlanSpec['perks'] }>;

function toDraft(p: PlansConfig): Draft {
  return Object.fromEntries(
    TIERS.map((t) => [
      t,
      {
        nums: Object.fromEntries(NUMS.map((f) => [f.key, p[t][f.key] === null ? '' : String(p[t][f.key])])) as Record<NumField['key'], string>,
        perks: { ...p[t].perks },
      },
    ]),
  ) as Draft;
}

function fromDraft(d: Draft): { value: PlansConfig } | { error: string } {
  const out = {} as PlansConfig;
  for (const t of TIERS) {
    const spec: Record<string, unknown> = { perks: d[t].perks };
    for (const f of NUMS) {
      const raw = d[t].nums[f.key].trim();
      if (!raw) {
        if (f.optional) {
          spec[f.key] = null;
          continue;
        }
        return { error: `${TIER_NAME[t]} '${f.label}' 칸을 채워 주세요.` };
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `${TIER_NAME[t]} '${f.label}' 칸에는 숫자를 적어 주세요.` };
      spec[f.key] = n;
    }
    if (spec.energyDaily === null && spec.energyMonthly === null) return { error: `${TIER_NAME[t]}의 하루나 한 달 에너지 중 하나는 정해 주세요.` };
    out[t] = spec as PlanSpec;
  }
  return { value: out };
}

/** 에너지를 다 썼을 때 남는 돈 (부가세 10%·앱 결제 수수료 15%·1달러 1,450원): 값을 정할 때 참고 */
function margin(price: number, energyMonthly: number | null, energyDaily: number | null, usdPerEnergy: number): string | null {
  if (!price) return null;
  const net = (price / 1.1) * 0.85;
  const energy = energyMonthly ?? (energyDaily ?? 0) * 30;
  const cost = energy * usdPerEnergy * 1450;
  const left = net - cost;
  return `다 쓰면 남는 돈 약 ${won(left)} (${Math.round((left / net) * 100)}%)`;
}

export function AdminTiers({ plans, usdPerEnergy, onSaved }: { plans: PlansConfig; usdPerEnergy: number; onSaved: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => toDraft(plans));
  const [busy, setBusy] = useState(false);
  const setNum = (t: Tier, k: NumField['key'], v: string) => setDraft((d) => ({ ...d, [t]: { ...d[t], nums: { ...d[t].nums, [k]: v } } }));
  const setPerk = (t: Tier, k: Perk, v: boolean) => setDraft((d) => ({ ...d, [t]: { ...d[t], perks: { ...d[t].perks, [k]: v } } }));

  const save = async (value: PlansConfig) => {
    setBusy(true);
    try {
      await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: 'plans', value }) });
      toast('요금제 혜택을 저장했어요. 곧 모든 사람에게 적용돼요.', 'ok', DONE);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const parsed = fromDraft(draft);
  const spec = 'value' in parsed ? parsed.value : null;

  return (
    <>
      <SectionTitle>요금제 혜택</SectionTitle>
      <Card className="grid gap-4">
        <p className="text-sm text-muted">
          무료·Pro·Max가 받는 것을 칸마다 정해요. 한 달 에너지를 비우면 하루만 세요. 혜택을 끄면 새로 만드는 것만 막고, 이미 만든 테마·레슨·표지·버전은 그대로
          보여요. 요금제 화면과 &lsquo;…은 Max에서 쓸 수 있어요&rsquo; 같은 안내도 이 표를 따라요.
        </p>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">요금제 혜택 고치기</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="w-[38%] py-2 pr-2">
                  항목
                </th>
                {TIERS.map((t) => (
                  <th key={t} scope="col" className="px-1 py-2 font-display text-base">
                    {TIER_NAME[t]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NUMS.map((f) => (
                <tr key={f.key} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 text-left font-semibold">
                    {f.label}
                    {f.unit ? <span className="font-normal text-muted"> ({f.unit})</span> : null}
                    {f.optional ? <span className="block text-xs font-normal text-muted">비우면 제한 없음</span> : null}
                  </th>
                  {TIERS.map((t) => (
                    <td key={t} className="px-1 py-1.5">
                      <input
                        aria-label={`${TIER_NAME[t]} ${f.label}`}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        className={cx(inputClass, 'h-10 px-2.5 text-sm')}
                        value={draft[t].nums[f.key]}
                        placeholder={f.optional ? '없음' : undefined}
                        onChange={(e) => setNum(t, f.key, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {PERKS.map((k) => (
                <tr key={k} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 text-left font-semibold">
                    {PERK_INFO[k].label}
                    <span className="block text-xs font-normal text-muted">{PERK_INFO[k].hint}</span>
                  </th>
                  {TIERS.map((t) => {
                    const on = draft[t].perks[k];
                    return (
                      <td key={t} className="px-1 py-1.5">
                        {/* 설정의 스위치(Toggle)와 같은 모양: 시그니처 테마도 같이 꾸민다 */}
                        <label className="relative inline-flex shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={on}
                            aria-label={`${TIER_NAME[t]} ${PERK_INFO[k].label}`}
                            onChange={(e) => setPerk(t, k, e.target.checked)}
                          />
                          <span className="kok-switch h-7 w-12 rounded-full bg-surface-3 transition-colors peer-checked:bg-fab peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent" />
                          <span className="kok-switch-knob absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {spec ? (
          <ul className="grid gap-1 text-xs text-muted">
            {TIERS.filter((t) => spec[t].price > 0).map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Icon d={ICONS.bulb} size={14} />
                {TIER_NAME[t]} {won(spec[t].price)}: {margin(spec[t].price, spec[t].energyMonthly, spec[t].energyDaily, usdPerEnergy)}
              </li>
            ))}
            <li>부가세 10%·앱 결제 수수료 15%·1달러 1,450원으로 셌어요. 실제로는 대부분 에너지를 다 쓰지 않아 더 남아요.</li>
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            busy={busy}
            onClick={() => {
              if ('error' in parsed) return toast(parsed.error, 'bad');
              save(parsed.value);
            }}
          >
            혜택 저장
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (
                !(await ask({
                  title: '처음 값으로',
                  body: '무료·Pro·Max 혜택을 처음 값으로 되돌릴까요?',
                  note: '저장을 눌러야 적용돼요.',
                  ok: '되돌리기',
                }))
              )
                return;
              setDraft(toDraft(DEFAULT_PLANS));
            }}
          >
            처음 값으로
          </Button>
        </div>
      </Card>
    </>
  );
}
