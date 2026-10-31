import { describe, expect, it } from 'vitest';
import { splitBogi } from '@/lib/bogi';

describe('<보기> 상자', () => {
  it("'<보기>' 줄 다음의 줄들을 상자로, 앞뒤 글은 그대로", () => {
    const p =
      '그림은 식물 세포를 나타낸 것이다. 옳은 것만을 <보기>에서 있는 대로 고른 것은?\n\n<보기>\nㄱ. A에서 광합성이 일어난다.\nㄴ. B는 유전 물질을 가진다.\nㄷ. C는 동물 세포에도 있다.';
    expect(splitBogi(p)).toEqual({
      before: '그림은 식물 세포를 나타낸 것이다. 옳은 것만을 <보기>에서 있는 대로 고른 것은?',
      items: ['ㄱ. A에서 광합성이 일어난다.', 'ㄴ. B는 유전 물질을 가진다.', 'ㄷ. C는 동물 세포에도 있다.'],
      after: '',
    });
  });

  it('상자 뒤에 물음이 오는 꼴, 〈보기〉·[보기] 도 읽는다', () => {
    const p = '다음은 광합성에 대한 설명이다.\n〈보기〉\nㄱ. 빛이 필요하다.\nㄴ. 산소가 생긴다.\n\n옳은 것만을 고른 것은?';
    expect(splitBogi(p)).toMatchObject({ items: ['ㄱ. 빛이 필요하다.', 'ㄴ. 산소가 생긴다.'], after: '옳은 것만을 고른 것은?' });
    expect(splitBogi('[보기]\nㄱ. 하나')?.items).toEqual(['ㄱ. 하나']);
  });

  it('글 속의 <보기> 낱말이나 빈 상자는 상자가 아니다', () => {
    expect(splitBogi('옳은 것만을 <보기>에서 있는 대로 고른 것은?')).toBeNull();
    expect(splitBogi('물음\n<보기>\n\n')).toBeNull();
  });
});
