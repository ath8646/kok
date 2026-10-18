// 기본 테마 색: globals.css 의 기본 색 + 예전 [data-theme] 색 그대로 (밝게·어둡게 모두 빠짐없이 적는다).
// 테마 CSS 는 늘 모든 칸을 적어서, 밝은 테마와 어두운 테마가 서로 섞이지 않게 한다.
import type { ThemeColor } from '../settings';
import type { CoreToken, Mode, TokenMap } from './colors';

export const BASE_TOKENS: Record<Mode, TokenMap> = {
  light: {
    '--bg': '#f3f3f6',
    '--surface': '#ffffff',
    '--surface-2': '#efeff3',
    '--surface-3': '#e5e5eb',
    '--raised': '#ffffff',
    '--line': '#e1e1e7',
    '--ink': '#17171a',
    '--muted': '#6b6b74',
    '--accent': '#b84c08',
    '--accent-soft': '#fff0e3',
    '--accent-ink': '#ffffff',
    '--fab': '#eb6a0f',
    '--fab-ink': '#ffffff',
    '--paper-line': 'rgba(40, 60, 110, 0.085)',
    '--paper-dot': 'rgba(40, 60, 110, 0.2)',
  },
  dark: {
    '--bg': '#000000',
    '--surface': '#17171a',
    '--surface-2': '#222226',
    '--surface-3': '#2d2d32',
    '--raised': '#3a3a41',
    '--line': '#2b2b30',
    '--ink': '#f2f2f4',
    '--muted': '#9c9ca6',
    '--accent': '#ff9b45',
    '--accent-soft': '#3a240f',
    '--accent-ink': '#1d0f00',
    '--fab': '#ff9b45',
    '--fab-ink': '#1d0f00',
    '--paper-line': 'rgba(255, 255, 255, 0.07)',
    '--paper-dot': 'rgba(255, 255, 255, 0.16)',
  },
};

type Partial = { [K in CoreToken]?: string };

/** 기본 테마가 기본 색에서 바꾸는 칸 */
const PRESET_PATCH: Record<ThemeColor, Record<Mode, Partial>> = {
  default: { light: {}, dark: {} },
  ocean: {
    light: { '--accent': '#1a5fc2', '--accent-soft': '#e7f0fd', '--fab': '#2b6fe0' },
    dark: { '--accent': '#7cb0ff', '--accent-soft': '#132541', '--accent-ink': '#04122b', '--fab': '#7cb0ff', '--fab-ink': '#04122b' },
  },
  forest: {
    light: { '--accent': '#2b7a3a', '--accent-soft': '#e6f4e8', '--fab': '#2f8a43' },
    dark: { '--accent': '#6ccf86', '--accent-soft': '#12291a', '--accent-ink': '#03210d', '--fab': '#6ccf86', '--fab-ink': '#03210d' },
  },
  lavender: {
    light: { '--accent': '#6a48c7', '--accent-soft': '#f0ebfd', '--fab': '#7656e0' },
    dark: { '--accent': '#b8a2ff', '--accent-soft': '#251c3e', '--accent-ink': '#170b35', '--fab': '#b8a2ff', '--fab-ink': '#170b35' },
  },
  cherry: {
    light: { '--accent': '#c0185a', '--accent-soft': '#fde8f0', '--fab': '#df3f77' },
    dark: { '--accent': '#ff8db4', '--accent-soft': '#3b1625', '--accent-ink': '#2c0615', '--fab': '#ff8db4', '--fab-ink': '#2c0615' },
  },
  mint: {
    light: { '--accent': '#0b7a6b', '--accent-soft': '#dff5f1', '--fab': '#119c88' },
    dark: { '--accent': '#5adfc8', '--accent-soft': '#0e2b27', '--accent-ink': '#032520', '--fab': '#5adfc8', '--fab-ink': '#032520' },
  },
  mocha: {
    light: {
      '--accent': '#8a5524',
      '--accent-soft': '#f6ece1',
      '--fab': '#a46a34',
      '--bg': '#f6f2ed',
      '--surface-2': '#f0e9e1',
      '--surface-3': '#e6ddd2',
      '--line': '#e6ddd2',
    },
    dark: {
      '--accent': '#e2b388',
      '--accent-soft': '#33261a',
      '--accent-ink': '#2a1706',
      '--fab': '#e2b388',
      '--fab-ink': '#2a1706',
      '--bg': '#0b0806',
      '--surface-2': '#231e1a',
      '--surface-3': '#2e2823',
      '--line': '#2e2823',
    },
  },
  night: {
    light: { '--accent': '#3a45b8', '--accent-soft': '#eaecfd', '--fab': '#4552d6' },
    dark: {
      '--accent': '#9ca6ff',
      '--accent-soft': '#1d2042',
      '--accent-ink': '#0b0f33',
      '--fab': '#9ca6ff',
      '--fab-ink': '#0b0f33',
      '--bg': '#04050d',
      '--surface': '#12142a',
      '--surface-2': '#1b1e38',
      '--surface-3': '#252949',
      '--raised': '#2e3358',
      '--line': '#22264a',
      '--muted': '#a3a7c4',
    },
  },
};

export function presetTokens(color: ThemeColor, mode: Mode): TokenMap {
  return { ...BASE_TOKENS[mode], ...(PRESET_PATCH[color]?.[mode] ?? {}) };
}
