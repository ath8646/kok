// AI 가 줄 법한 그림 설계도 예시 (figure-lab 미리보기와 가짜 백엔드 시험에 쓴다)
type It = Record<string, unknown>;
const it = (p: It): It => ({ refs: [], x: 0, y: 0, w: 0, h: 0, r: 0, expr: '', from: 0, to: 0, label: '', style: 'given', marks: 0, ...p });

export const SAMPLES: Array<{ name: string; figure: It; steps?: Array<{ text: string; add: string[]; focus: string[] }> }> = [
  {
    name: '직각삼각형의 빗변',
    figure: {
      include: true,
      view: { x_min: -1, x_max: 5, y_min: -1, y_max: 4 },
      axes: false,
      grid: false,
      items: [
        it({ id: 'A', type: 'point', x: 0, y: 0, label: 'A' }),
        it({ id: 'B', type: 'point', x: 4, y: 0, label: 'B' }),
        it({ id: 'C', type: 'point', x: 0, y: 3, label: 'C' }),
        it({ id: 'AB', type: 'segment', refs: ['A', 'B'], label: '4 cm' }),
        it({ id: 'AC', type: 'segment', refs: ['A', 'C'], label: '3 cm' }),
        it({ id: 'right', type: 'angle', refs: ['B', 'A', 'C'], label: '90°' }),
        it({ id: 'BC', type: 'segment', refs: ['B', 'C'], label: '?', style: 'answer' }),
      ],
    },
    steps: [
      { text: '∠A 가 직각이니 빗변은 직각의 맞은편에 있는 $\\overline{BC}$ 예요.', add: [], focus: ['right', 'BC'] },
      { text: '피타고라스 정리: $\\overline{BC}^2 = 3^2 + 4^2 = 25$', add: [], focus: ['AB', 'AC'] },
      { text: '그래서 $\\overline{BC} = 5$ cm 예요.', add: [], focus: ['BC'] },
    ],
  },
  {
    name: '이차함수의 x절편과 꼭짓점',
    figure: {
      include: true,
      view: { x_min: -3, x_max: 5, y_min: -5, y_max: 6 },
      axes: true,
      grid: true,
      items: [
        it({ id: 'f', type: 'function', expr: 'x^2 - 2x - 3', label: '$y=x^2-2x-3$' }),
        it({ id: 'P', type: 'point', x: -1, y: 0, label: '(−1, 0)', style: 'answer' }),
        it({ id: 'Q', type: 'point', x: 3, y: 0, label: '(3, 0)', style: 'answer' }),
        it({ id: 'V', type: 'point', x: 1, y: -4, label: '꼭짓점 (1, −4)' }),
        it({ id: 'axis', type: 'line', refs: ['V', 'V2'], style: 'aux' }),
        it({ id: 'V2', type: 'point', x: 1, y: 1, style: 'muted' }),
      ],
    },
    steps: [
      { text: '$y=0$ 을 넣으면 $x^2-2x-3=0$, 인수분해하면 $(x+1)(x-3)=0$ 이에요.', add: [], focus: ['f'] },
      { text: '그래서 x절편은 $x=-1$, $x=3$ 이에요.', add: ['P', 'Q'], focus: ['P', 'Q'] },
      { text: '대칭축은 두 절편의 가운데 $x=1$, 꼭짓점은 $(1,-4)$ 예요.', add: ['axis', 'V', 'V2'], focus: ['V', 'axis'] },
    ],
  },
  {
    name: '빗면 위 물체에 작용하는 힘',
    figure: {
      include: true,
      view: { x_min: -0.5, x_max: 6.5, y_min: -1.5, y_max: 4.2 },
      axes: false,
      grid: false,
      items: [
        it({ id: 'O', type: 'point', x: 0, y: 0, style: 'muted' }),
        it({ id: 'R', type: 'point', x: 6, y: 0, style: 'muted' }),
        it({ id: 'T', type: 'point', x: 0, y: 3.5, style: 'muted' }),
        it({ id: 'slope', type: 'polygon', refs: ['O', 'R', 'T'] }),
        it({ id: 'th', type: 'angle', refs: ['T', 'R', 'O'], label: 'θ' }),
        it({ id: 'M', type: 'point', x: 2.6, y: 2.1, label: '물체' }),
        it({ id: 'G', type: 'point', x: 2.6, y: 0.4, style: 'muted' }),
        it({ id: 'mg', type: 'vector', refs: ['M', 'G'], label: '중력 $mg$' }),
        it({ id: 'Nn', type: 'point', x: 3.45, y: 3.55, style: 'muted' }),
        it({ id: 'N', type: 'vector', refs: ['M', 'Nn'], label: '수직항력 $N$', style: 'answer' }),
        it({ id: 'Ff', type: 'point', x: 1.4, y: 2.8, style: 'muted' }),
        it({ id: 'f', type: 'vector', refs: ['M', 'Ff'], label: '마찰력', style: 'aux' }),
      ],
    },
    steps: [
      { text: '물체에는 아래로 중력 $mg$ 가 작용해요.', add: [], focus: ['mg'] },
      { text: '빗면은 면에 수직인 방향으로 물체를 밀어요: 수직항력 $N$.', add: ['N', 'Nn'], focus: ['N'] },
      { text: '미끄러지려는 반대쪽(빗면 위쪽)으로 마찰력이 작용해요.', add: ['f', 'Ff'], focus: ['f'] },
    ],
  },
  {
    name: '광합성 과정 (상자 그림)',
    figure: {
      include: true,
      view: { x_min: -5, x_max: 5, y_min: -2, y_max: 4 },
      axes: false,
      grid: false,
      items: [
        it({ id: 'light', type: 'box', x: 0, y: 3, label: '빛 에너지' }),
        it({ id: 'in', type: 'box', x: -3.4, y: 0, label: '물 + 이산화탄소' }),
        it({ id: 'chl', type: 'box', x: 0, y: 0, label: '엽록체' }),
        it({ id: 'out', type: 'box', x: 3.4, y: 0, label: '포도당 + 산소', style: 'answer' }),
        it({ id: 'a1', type: 'arrow', refs: ['light', 'chl'] }),
        it({ id: 'a2', type: 'arrow', refs: ['in', 'chl'], label: '재료' }),
        it({ id: 'a3', type: 'arrow', refs: ['chl', 'out'], label: '결과물' }),
      ],
    },
    steps: [
      { text: '재료(물, 이산화탄소)가 엽록체로 들어가요.', add: [], focus: ['in', 'a2'] },
      { text: '엽록체는 빛 에너지를 써서', add: [], focus: ['light', 'a1', 'chl'] },
      { text: '포도당과 산소를 만들어요.', add: [], focus: ['out', 'a3'] },
    ],
  },
  {
    name: '물의 순환 (상자 네 개가 돌아가는 그림)',
    figure: {
      include: true,
      view: { x_min: -4, x_max: 4, y_min: -3, y_max: 3 },
      axes: false,
      grid: false,
      items: [
        it({ id: 'sea', type: 'box', x: 0, y: -2, label: '바다·호수의 물' }),
        it({ id: 'vap', type: 'box', x: 2.5, y: 0, label: '수증기 (증발)' }),
        it({ id: 'cloud', type: 'box', x: 0, y: 2, label: '구름 (응결)' }),
        it({ id: 'rain', type: 'box', x: -2.5, y: 0, label: '비·눈 (강수)', style: 'answer' }),
        it({ id: 'e1', type: 'arrow', refs: ['sea', 'vap'], label: '태양열' }),
        it({ id: 'e2', type: 'arrow', refs: ['vap', 'cloud'] }),
        it({ id: 'e3', type: 'arrow', refs: ['cloud', 'rain'] }),
        it({ id: 'e4', type: 'arrow', refs: ['rain', 'sea'], label: '흘러감' }),
      ],
    },
    steps: [
      { text: '태양열을 받으면 바다의 물이 수증기가 돼요 (증발).', add: [], focus: ['sea', 'e1', 'vap'] },
      { text: '수증기가 높이 올라가 식으면 구름이 돼요 (응결).', add: [], focus: ['e2', 'cloud'] },
      { text: '구름의 물방울이 커지면 비나 눈으로 내려요 (강수).', add: [], focus: ['e3', 'rain'] },
    ],
  },
  {
    name: '세포 호흡 (위에서 아래로)',
    figure: {
      include: true,
      view: { x_min: -2, x_max: 2, y_min: -3, y_max: 3 },
      axes: false,
      grid: false,
      items: [
        it({ id: 'a', type: 'box', x: 0, y: 2.4, label: '포도당 + 산소' }),
        it({ id: 'b', type: 'box', x: 0, y: 0.6, label: '미토콘드리아에서 분해' }),
        it({ id: 'c', type: 'box', x: 0, y: -1.2, label: '물 + 이산화탄소 + 에너지(ATP)', style: 'answer' }),
        it({ id: 'x1', type: 'arrow', refs: ['a', 'b'] }),
        it({ id: 'x2', type: 'arrow', refs: ['b', 'c'], label: '에너지 발생' }),
      ],
    },
  },
  {
    name: '반원에 대한 원주각',
    figure: {
      include: true,
      view: { x_min: -4, x_max: 4, y_min: -3.6, y_max: 3.8 },
      axes: false,
      grid: false,
      items: [
        it({ id: 'O', type: 'point', x: 0, y: 0, label: 'O' }),
        it({ id: 'A', type: 'point', x: -3, y: 0, label: 'A' }),
        it({ id: 'B', type: 'point', x: 3, y: 0, label: 'B' }),
        it({ id: 'P', type: 'point', x: 1.2, y: 2.75, label: 'P' }),
        it({ id: 'c', type: 'circle', refs: ['O'], r: 3 }),
        it({ id: 'PA', type: 'segment', refs: ['P', 'A'] }),
        it({ id: 'PB', type: 'segment', refs: ['P', 'B'] }),
        it({ id: 'AB', type: 'segment', refs: ['A', 'B'], label: '지름', style: 'aux' }),
        it({ id: 'ang', type: 'angle', refs: ['A', 'P', 'B'], label: '?', style: 'answer' }),
      ],
    },
    steps: [
      { text: '$\\overline{AB}$ 가 원의 중심 O 를 지나니 지름이에요.', add: ['AB'], focus: ['AB', 'O'] },
      { text: '지름에 대한 원주각은 언제나 $90°$ 예요. 그래서 $\\angle APB = 90°$.', add: [], focus: ['ang'] },
    ],
  },
  {
    name: '반비례 그래프 (점근선)',
    figure: {
      include: true,
      view: { x_min: -5, x_max: 5, y_min: -5, y_max: 5 },
      axes: true,
      grid: false,
      items: [it({ id: 'g', type: 'function', expr: '4/x', label: '$y=\\frac{4}{x}$' }), it({ id: 'K', type: 'point', x: 2, y: 2, label: '(2, 2)' })],
    },
  },
];
