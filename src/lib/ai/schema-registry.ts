// AI 에 보내는 모든 답 모양(JSON 스키마) 목록과 크기 재기.
// Claude structured outputs 는 스키마를 문법으로 바꿔 두는데, 속성이 모두 합쳐 약 42개를 넘으면
// "The compiled grammar is too large" (400) 로 거절한다 (2026-10: 노트 채팅 65개가 거절됐고, 34개(정리+자료 그림)는 된다).
// schemas.test.ts 가 여기 있는 모든 스키마를 SCHEMA_PROPS_MAX 로 지키고, 관리자 화면 'AI 답 모양 시험'이 실제 API 로 확인한다.
// 새 스키마를 쓰면 여기에도 넣는다.
import {
  chatFigureJsonSchema,
  checkJsonSchema,
  courseJsonSchema,
  gradeJsonSchema,
  homeChatJsonSchema,
  noteChatJsonSchema,
  noteJsonSchema,
  organizeFiguresJsonSchema,
  quizFiguresJsonSchema,
  quizJsonSchema,
  reorganizeJsonSchema,
  solveJsonSchema,
  themeImageJsonSchema,
  themeJsonSchema,
  visualJsonSchema,
} from './schemas';
import { ART_KINDS, artJsonSchema } from '@/lib/art/spec';

type JsonSchema = Record<string, unknown>;

/** 시험이 지키는 속성 수의 끝 (거절되는 약 42개보다 넉넉히 작게) */
export const SCHEMA_PROPS_MAX = 36;

/** 모든 객체의 속성 수를 합친 값 (안쪽 객체·배열 칸의 객체 모두, 같은 모양이 두 번 나오면 두 번 센다) */
export function schemaProps(s: unknown): number {
  if (!s || typeof s !== 'object') return 0;
  if (Array.isArray(s)) return s.reduce((a: number, x) => a + schemaProps(x), 0);
  const o = s as Record<string, unknown>;
  let n = 0;
  if (o.properties && typeof o.properties === 'object') {
    for (const v of Object.values(o.properties as Record<string, unknown>)) n += 1 + schemaProps(v);
  }
  if (o.items) n += schemaProps(o.items);
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(o[k])) n += schemaProps(o[k]);
  if (o.$defs && typeof o.$defs === 'object') n += schemaProps(Object.values(o.$defs as object));
  return n;
}

/** 앱이 AI 에 보내는 모든 답 모양 (이름은 관리자 화면에 보인다) */
export function aiSchemas(): Array<{ name: string; schema: JsonSchema }> {
  return [
    { name: '노트 정리', schema: noteJsonSchema },
    { name: '노트 정리 + 자료 그림', schema: organizeFiguresJsonSchema },
    { name: 'AI로 다시 정리', schema: reorganizeJsonSchema },
    { name: '마인드맵·표·연표', schema: visualJsonSchema },
    { name: '문제', schema: quizJsonSchema },
    { name: '문제 + 자료 그림', schema: quizFiguresJsonSchema },
    { name: '문제 검사', schema: checkJsonSchema },
    { name: '그림 풀이', schema: solveJsonSchema },
    { name: '채점', schema: gradeJsonSchema },
    { name: '노트 채팅 (예전 DB)', schema: noteChatJsonSchema({ solve: false, figures: false }) },
    { name: '노트 채팅', schema: noteChatJsonSchema({ solve: true, figures: false }) },
    { name: '노트 채팅 (Pro)', schema: noteChatJsonSchema({ solve: true, figures: true }) },
    { name: 'AI에게 물어보기', schema: homeChatJsonSchema(false) },
    { name: 'AI에게 물어보기 (Pro)', schema: homeChatJsonSchema(true) },
    { name: '채팅 풀이 그림 (Pro)', schema: chatFigureJsonSchema },
    { name: '단계별 학습 (Pro)', schema: courseJsonSchema },
    { name: '테마 만들기', schema: themeJsonSchema },
    { name: '테마 그림 다시 그리기', schema: themeImageJsonSchema },
    ...ART_KINDS.map((k) => ({ name: `자료 그림 다시 그리기 (${k})`, schema: artJsonSchema(k) })),
  ];
}
