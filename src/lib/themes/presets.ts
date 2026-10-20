// KOK 의 기본 테마 색 (밝게·어둡게 모두 빠짐없이 적는다). 기본(인디고)은 globals.css 의 기본 색과 같다.
// 바탕·카드·글자는 애플 앱처럼 맑은 회색이고(모카는 따뜻한 바탕, 미드나잇은 남색 바탕), 테마마다 포인트 색만 다르다.
// 글자로 쓰는 포인트 색(--accent)은 바탕·카드·연한 포인트 바탕에서 4.5 이상, 버튼 글자 4.5 이상,
// + 버튼(--fab)은 맑은 색 그대로 두고 아이콘이 3 이상 (흰색이 되면 흰색). themes.test.ts 가 모두 확인한다.
// 테마 CSS 는 늘 모든 칸을 적어서, 밝은 테마와 어두운 테마가 서로 섞이지 않게 한다.
import type { ThemeColor } from '../settings';
import type { Mode, TokenMap } from './colors';

type AccentToken = '--accent' | '--accent-soft' | '--accent-ink' | '--fab' | '--fab-ink';
type Neutral = Omit<TokenMap, AccentToken>;

const PAPER: Record<Mode, Pick<TokenMap, '--paper-line' | '--paper-dot'>> = {
  light: { '--paper-line': 'rgba(60, 60, 67, 0.09)', '--paper-dot': 'rgba(60, 60, 67, 0.2)' },
  dark: { '--paper-line': 'rgba(235, 235, 245, 0.07)', '--paper-dot': 'rgba(235, 235, 245, 0.16)' },
};

/** 애플 앱 같은 회색 (밝게: 연한 회색 바탕에 흰 카드, 어둡게: 검정 바탕에 짙은 회색 카드) */
const GRAY: Record<Mode, Neutral> = {
  light: {
    '--bg': '#f2f2f7',
    '--surface': '#ffffff',
    '--surface-2': '#efeff4',
    '--surface-3': '#e5e5ea',
    '--raised': '#ffffff',
    '--line': '#e3e3e8',
    '--ink': '#1c1c1e',
    '--muted': '#6b6b70',
    ...PAPER.light,
  },
  dark: {
    '--bg': '#000000',
    '--surface': '#1c1c1e',
    '--surface-2': '#2c2c2e',
    '--surface-3': '#3a3a3c',
    '--raised': '#48484a',
    '--line': '#38383a',
    '--ink': '#f5f5f7',
    '--muted': '#98989f',
    ...PAPER.dark,
  },
};

/** 모카: 크림빛 따뜻한 바탕 */
const WARM: Record<Mode, Neutral> = {
  light: {
    '--bg': '#f5f1ec',
    '--surface': '#fffdfa',
    '--surface-2': '#f1ebe4',
    '--surface-3': '#e7dfd6',
    '--raised': '#fffdfa',
    '--line': '#e6ded4',
    '--ink': '#221d19',
    '--muted': '#6c635c',
    ...PAPER.light,
  },
  dark: {
    '--bg': '#0d0b09',
    '--surface': '#1e1b18',
    '--surface-2': '#2b2723',
    '--surface-3': '#38332e',
    '--raised': '#4a443e',
    '--line': '#38332e',
    '--ink': '#f6f1ec',
    '--muted': '#a69c92',
    ...PAPER.dark,
  },
};

/** 미드나잇: 남색 바탕 */
const NAVY: Record<Mode, Neutral> = {
  light: {
    '--bg': '#eff1f7',
    '--surface': '#ffffff',
    '--surface-2': '#ebeef5',
    '--surface-3': '#e0e4ee',
    '--raised': '#ffffff',
    '--line': '#dfe3ec',
    '--ink': '#161a26',
    '--muted': '#636a7d',
    ...PAPER.light,
  },
  dark: {
    '--bg': '#05070f',
    '--surface': '#121729',
    '--surface-2': '#1b2137',
    '--surface-3': '#252c46',
    '--raised': '#323a58',
    '--line': '#222941',
    '--ink': '#f1f3ff',
    '--muted': '#a1a8c6',
    ...PAPER.dark,
  },
};

/** 포인트 색: 글자용 포인트, 연한 포인트 바탕, 버튼 글자, + 버튼, + 버튼 아이콘 */
const accent = (text: string, soft: string, ink: string, fab: string, fabInk: string): Pick<TokenMap, AccentToken> => ({
  '--accent': text,
  '--accent-soft': soft,
  '--accent-ink': ink,
  '--fab': fab,
  '--fab-ink': fabInk,
});

const theme = (n: Record<Mode, Neutral>, light: Pick<TokenMap, AccentToken>, dark: Pick<TokenMap, AccentToken>): Record<Mode, TokenMap> => ({
  light: { ...n.light, ...light },
  dark: { ...n.dark, ...dark },
});

const PRESETS: Record<ThemeColor, Record<Mode, TokenMap>> = {
  default: theme(GRAY, accent('#6057e7', '#efeefd', '#ffffff', '#635aea', '#ffffff'), accent('#888aff', '#2d2b4c', '#111111', '#6861f1', '#ffffff')),
  ocean: theme(GRAY, accent('#0168db', '#e6f2ff', '#ffffff', '#007aff', '#ffffff'), accent('#4da3ff', '#183350', '#111111', '#0a84ff', '#ffffff')),
  lavender: theme(GRAY, accent('#9446cb', '#f6effc', '#ffffff', '#a85be1', '#ffffff'), accent('#c58ff3', '#3c2c49', '#111111', '#ac65e3', '#ffffff')),
  cherry: theme(GRAY, accent('#d5005b', '#feeaf1', '#ffffff', '#f53071', '#ffffff'), accent('#fe6c8f', '#4c2632', '#111111', '#f54879', '#ffffff')),
  coral: theme(GRAY, accent('#ca3609', '#fdefeb', '#ffffff', '#ef5b36', '#ffffff'), accent('#ff8162', '#4b2c26', '#111111', '#f26644', '#ffffff')),
  // 라임: 검정·흰색에 형광 라임 하나 (밝을 때는 검정 버튼에 라임 아이콘)
  forest: theme(GRAY, accent('#1c1c1e', '#f1f8d9', '#ffffff', '#1c1c1e', '#c3f74c'), accent('#c6fb50', '#232a10', '#111111', '#c6fb50', '#111111')),
  mint: theme(GRAY, accent('#057a74', '#e6f8f7', '#ffffff', '#08beaf', '#111111'), accent('#63e6e2', '#2c4849', '#111111', '#63e6e2', '#111111')),
  mocha: theme(WARM, accent('#905f3c', '#f5eee8', '#ffffff', '#996845', '#ffffff'), accent('#d2a883', '#3f3327', '#111111', '#b6875e', '#ffffff')),
  night: theme(NAVY, accent('#334f9d', '#ebedf5', '#ffffff', '#334f9d', '#ffffff'), accent('#90aff8', '#212d50', '#111111', '#567ad9', '#ffffff')),
};

/** 기본 테마 (인디고) = globals.css 의 기본 색 */
export const BASE_TOKENS: Record<Mode, TokenMap> = PRESETS.default;

export function presetTokens(color: ThemeColor, mode: Mode): TokenMap {
  return { ...(PRESETS[color] ?? PRESETS.default)[mode] };
}
