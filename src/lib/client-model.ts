// 화면에서 예상 에너지를 계산할 때 쓸 모델 (서버의 modelForTier 와 같은 규칙)
import type { MeResponse } from './types';
import type { ModelTier } from './settings';

export function clientModel(me: MeResponse, tier: ModelTier): string {
  if (tier === 'admin' && me.isAdmin) return me.models.adminTest;
  if ((tier === 'careful' || tier === 'admin') && (me.isPro || me.isAdmin)) return me.models.careful;
  return me.models.fast;
}
