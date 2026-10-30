// 이름 뒤 조사 (을/를·이/가·은/는·과/와·으로/로): 이름의 끝 글자 받침으로 고른다.
// 따옴표·괄호 같은 기호는 건너뛰고 마지막 글자(한글·숫자·영문)를 본다. 숫자는 읽는 소리로(1 일, 2 이 …),
// 영문은 대강(l·m·n·r 로 끝나면 받침이 있는 것처럼). 확인 창·알림 글에서 "'광합성'을 지울까요?"처럼 쓴다.

type Kind = '을' | '이' | '은' | '과' | '으로';

const PAIRS: Record<Kind, [string, string]> = {
  을: ['을', '를'],
  이: ['이', '가'],
  은: ['은', '는'],
  과: ['과', '와'],
  으로: ['으로', '로'],
};

/** 끝 글자의 받침 (없으면 none, ㄹ 받침이면 rieul: '으로/로'에서 ㄹ 받침은 '로') */
function ending(word: string): 'none' | 'rieul' | 'other' {
  for (let i = word.length - 1; i >= 0; i--) {
    const ch = word[i];
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const jong = (c - 0xac00) % 28;
      return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other';
    }
    if (/[0-9]/.test(ch)) return '178'.includes(ch) ? 'rieul' : '036'.includes(ch) ? 'other' : 'none';
    if (/[a-zA-Z]/.test(ch)) {
      const l = ch.toLowerCase();
      return l === 'l' ? 'rieul' : 'mnr'.includes(l) ? 'other' : 'none';
    }
  }
  return 'none';
}

/** 이름 + 조사 (josa('광합성', '을') → '광합성을', josa("'세포 호흡'", '을') → "'세포 호흡'을") */
export function josa(word: string, kind: Kind): string {
  const [withB, withoutB] = PAIRS[kind];
  const e = ending(word);
  const has = kind === '으로' ? e === 'other' : e !== 'none';
  return `${word}${has ? withB : withoutB}`;
}
