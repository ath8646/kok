// AI 결과 신고 ('이상해요'): 신고할 수 있는 것, 고르는 이유, 신고할 때 본 결과를 운영자가 읽을 글로 바꾸기.
// 화면(components/ReportSheet.tsx)과 서버(/api/reports)가 같이 쓴다. Google Play 의 AI 생성 콘텐츠 정책(앱 안에서 신고)과
// 인공지능기본법(이용자 보호)에 맞춰 AI 가 만든 것이 보이는 곳마다 신고할 수 있게 한다.
import { solutionAnswer, type ChatSolution } from './chat';
import type { CourseCard, CourseCheck, CourseLesson } from './course';
import type { Cover } from './cover';

/** /api/reports 가 받는 종류 (문제 신고는 고친 문제를 같이 받는 /api/questions/[id]/report 가 따로) */
export const REPORT_KINDS = ['note', 'chat', 'cover', 'theme', 'course'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** DB 의 snapshot 칸 끝 (schema.sql reports_snapshot_check 와 같게) */
export const REPORT_SNAPSHOT_MAX = 4000;
/** DB 의 reason 칸 끝 */
export const REPORT_REASON_MAX = 1000;

/** 관리자 신고함에 보이는 이름 (DB 의 target_type) */
export const REPORT_LABEL: Record<string, string> = {
  question: '문제',
  note: '노트',
  visual: '그림',
  chat: '채팅 답',
  cover: '표지 그림',
  theme: '테마 그림',
  course: '레슨',
  other: '기타',
};

/** 늘 맨 끝에 두는 이유: 해로운 내용은 어느 결과에서나 바로 고를 수 있게 */
export const REPORT_HARMFUL = '불쾌하거나 해로운 내용이에요';

/** 고를 수 있는 이유 (하나만 고르고, 더 적을 말은 글로) */
export const REPORT_REASONS: Record<ReportKind, readonly string[]> = {
  note: ['틀린 내용이 있어요', '빠진 내용이 있어요', '그림이 이상해요', REPORT_HARMFUL],
  chat: ['틀린 내용이 있어요', '물어본 것과 다른 답이에요', '풀이가 이상해요', REPORT_HARMFUL],
  cover: ['노트와 맞지 않아요', '틀린 내용이 있어요', '글자가 이상해요', REPORT_HARMFUL],
  theme: ['부탁한 것과 달라요', '사람이나 글자가 들어 있어요', '무섭거나 어두운 그림이에요', REPORT_HARMFUL],
  course: ['틀린 내용이 있어요', '수준에 맞지 않아요', '문제의 정답이 이상해요', REPORT_HARMFUL],
};

/** 고른 이유와 적은 말을 한 줄로 ('틀린 내용이 있어요: 2번 단계 계산이 틀려요') */
export function reportReason(picked: string | null, text: string): string {
  const t = text.trim();
  const out = picked ? (t ? `${picked}: ${t}` : picked) : t;
  return clip(out, REPORT_REASON_MAX);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 운영자가 읽을 글의 끝을 맞춘다 */
export function clipSnapshot(s: string): string {
  return clip(s.trim(), REPORT_SNAPSHOT_MAX);
}

/** 채팅 답: 물어본 말 + 답 + 풀이 단계·정답 */
export function chatSnapshot(p: { question?: string | null; reply: string; solution?: ChatSolution | null }): string {
  const parts: string[] = [];
  if (p.question?.trim()) parts.push(`학생: ${clip(p.question.trim(), 800)}`);
  parts.push(`AI: ${p.reply.trim()}`);
  const s = p.solution;
  if (s) {
    if (s.problem.trim()) parts.push(`풀이한 문제: ${clip(oneLine(s.problem), 600)}`);
    s.steps.forEach((st, i) => {
      if (st.text.trim()) parts.push(`${i + 1}단계: ${clip(oneLine(st.text), 400)}`);
    });
    const answer = solutionAnswer(s.question);
    if (answer) parts.push(`정답: ${answer}`);
  }
  return clipSnapshot(parts.join('\n'));
}

/** 저장된 채팅 풀이(chat_messages.solution)를 글로 바꿀 만큼만 읽는다 (모양이 다르면 null) */
export function storedChatSolution(raw: unknown): ChatSolution | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as { problem?: unknown; steps?: unknown; question?: unknown };
  if (!Array.isArray(s.steps)) return null;
  const steps = s.steps
    .filter((x): x is { text: string } => !!x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string')
    .map((x) => ({ text: x.text, add: [], focus: [] }));
  const q = s.question as ChatSolution['question'];
  const question = q && typeof q === 'object' && typeof q.type === 'string' && typeof q.prompt === 'string' ? q : null;
  return { problem: typeof s.problem === 'string' ? s.problem : '', steps, figure: null, question, subject: '', unit: '' };
}

/** 표지 그림: 모양과 글 (v1 은 그림 설명만) */
export function coverSnapshot(title: string, c: Cover | null): string {
  if (!c) return clipSnapshot(`노트: ${title}\n(표지가 없어요)`);
  if (c.v === 1) return clipSnapshot(`노트: ${title}\n예전 표지 그림: ${c.alt}`);
  const lines = [`노트: ${title}`, `모양: ${c.kind}${c.alt ? ` (${c.alt})` : ''}`];
  if (c.title) lines.push(`제목: ${c.title}`);
  if (c.left || c.right) lines.push(`비교: ${c.left} / ${c.right}`);
  for (const it of c.items) {
    lines.push(
      `- ${it.side ? `[${it.side === 'left' ? c.left || '왼쪽' : c.right || '오른쪽'}] ` : ''}${it.text}${it.sub ? ` (${it.sub})` : ''}${it.key ? ' ★' : ''}`,
    );
  }
  if (c.figure) lines.push(`그래프·도형: 요소 ${c.figure.items.length}개`);
  return clipSnapshot(lines.join('\n'));
}

/** 레슨 카드 한 장 */
export function cardSnapshot(c: CourseCard): string {
  return [c.heading, c.text, c.tip ? `팁: ${c.tip}` : ''].filter(Boolean).map(oneLine).join(' / ');
}

/** 확인 문제 하나 (보기·정답·해설) */
export function checkSnapshot(c: CourseCheck): string {
  const choices = c.choices?.length ? ` 보기: ${c.choices.map((x, i) => `${i + 1}) ${oneLine(x)}`).join(' ')}` : '';
  const answer = c.type === 'mcq' ? `${Number(c.answer) + 1}번` : c.type === 'ox' ? (c.answer ? 'O' : 'X') : String(c.answer ?? '').trim();
  return `${oneLine(c.prompt)}${choices} → 정답 ${answer}${c.explanation ? ` (해설: ${oneLine(c.explanation)})` : ''}`;
}

/** 레슨 전체 (제목·목표·카드·확인 문제): 서버가 저장된 레슨에서 만든다 */
export function lessonSnapshot(l: CourseLesson): string {
  const lines = [`레슨: ${l.title}`];
  if (l.goal) lines.push(`목표: ${oneLine(l.goal)}`);
  l.cards.forEach((c, i) => lines.push(`카드 ${i + 1}: ${clip(cardSnapshot(c), 500)}`));
  l.checks.forEach((c, i) => lines.push(`문제 ${i + 1}: ${clip(checkSnapshot(c), 500)}`));
  return clipSnapshot(lines.join('\n'));
}

/** 레슨에서 지금 보던 칸 (어느 카드·문제가 이상했는지) */
export function lessonStepSnapshot(step: { kind: 'card'; card: CourseCard } | { kind: 'check'; check: CourseCheck } | null, index: number): string {
  if (!step) return '';
  return clip(
    `보던 칸 ${index + 1} (${step.kind === 'card' ? '카드' : '문제'}): ${step.kind === 'card' ? cardSnapshot(step.card) : checkSnapshot(step.check)}`,
    800,
  );
}

/**
 * 예전 DB(새 종류·snapshot 칸이 없다: schema.sql 을 다시 실행하기 전)에 넣을 이유 글:
 * 무엇을 신고했는지와 본 결과를 이유 끝에 붙여 1000자 안에 담는다
 */
export function legacyReportReason(kind: ReportKind, reason: string, snapshot: string | null): string {
  const head = `[${REPORT_LABEL[kind] ?? kind}] ${reason}`;
  if (!snapshot) return clip(head, REPORT_REASON_MAX);
  return clip(`${head}\n\n--- 신고한 결과 ---\n${snapshot}`, REPORT_REASON_MAX);
}
