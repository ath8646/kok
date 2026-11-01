// AI 결과 신고 ('이상해요'): 신고할 수 있는 것, 고르는 이유, 신고할 때 본 결과를 운영자가 읽을 글로 바꾸기.
// 화면(components/ReportSheet.tsx)과 서버(/api/reports)가 같이 쓴다. Google Play 의 AI 생성 콘텐츠 정책(앱 안에서 신고)과
// 인공지능기본법(이용자 보호)에 맞춰 AI 가 만든 것이 보이는 곳마다 신고할 수 있게 한다.
import { solutionAnswer, type ChatSolution } from './chat';
import type { CourseCard, CourseCheck, CourseLesson } from './course';
import type { Cover } from './cover';

/** /api/reports 가 받는 종류 */
export const REPORT_KINDS = ['question', 'note', 'chat', 'cover', 'theme', 'course'] as const;
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
  share_post: '공유 글',
  share_comment: '공유 댓글',
  share_gallery: '갤러리',
  other: '기타',
};

/** 늘 맨 끝에 두는 이유: 해로운 내용은 어느 결과에서나 바로 고를 수 있게 */
export const REPORT_HARMFUL = '불쾌하거나 해로운 내용이에요';

/** 고를 수 있는 이유 (하나만 고르고, 더 적을 말은 글로) */
export const REPORT_REASONS: Record<ReportKind, readonly string[]> = {
  question: ['정답이 틀렸어요', '문제나 보기가 이상해요', '해설이 틀렸어요', REPORT_HARMFUL],
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

// ------------------------------------------------------------- 보낼 글 검사 (화면과 서버가 같이)
/**
 * 욕설: 기호·숫자를 끼워 써도 찾는다 (빈칸은 그대로 둔다: '씨 발아'·'영향을 미친 년도'·'불이 꺼져' 같은 공부 글을 막지 않게).
 * '시발점'·'병신년'·'닥쳐오다'처럼 다른 뜻이 흔한 말은 넣지 않는다. 자음 줄임말은 따로 떨어져 있을 때만 ('ㄱㄴㄷㄹㅁㅂㅅ' 은 괜찮다)
 */
const ABUSE_KO = ['씨발', '씨빨', '씌발', '좆', '존나', '개새끼', '지랄', '엿먹어', '니애미', '느금마', '애미뒤', '병신같'];
/** 자음 욕은 따로 선 말일 때만 ('ㅅㅂ 틀렸네'). 겹받침 'ㅄ'·초성 'ㅈㄹ' 처럼 국어 공부에 나오는 것은 넣지 않는다 */
const ABUSE_JAMO = /(?:^|[\s\p{P}])(?:ㅅㅂ|ㅆㅂ|ㅈㄴ)(?=[\s\p{P}]|$)/u;
const ABUSE_EN = /\b(?:fuck\w*|shit\w*|bitch\w*|asshole|motherfuck\w*|f[*@#_.-]ck\w*|sh[*@#_.-]t\w*)/i;
/** 과학의 '씨 발아'(씨앗이 싹 틈): 띄어 쓰지 않거나 괄호를 끼워도 욕이 아니다 ('씨발아 실험'·'씨(발아 조건)') */
const SEED_GERMINATION = /씨\s*발아(?=\s*(?:실험|조건|과정|율|률|온도|속도|시간|기간|에|를|은|는|가|와|과|의|도|시|때|하|되|중|후|전|에서|로|부터|까지))/g;
/** 전화번호 (+82 · 띄어 쓴 것도) 와 메일 주소 (끝은 두 글자 넘는 영어: 'A@B.T' 같은 코드는 아니다) */
const CONTACT = /(?:\+82[\s-]*0?1[016789]|\b01[016789])\s*[-.]?\s*\d{3,4}\s*[-.]?\s*\d{4}\b|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/i;
/** 링크: 주소 머리, 또는 소문자로 쓴 흔한 웹 주소 끝 ('java.io'·'System.Net'·'ASP.NET' 같은 코드 이름은 아니다) */
const LINK = /https?:\/\/|\bwww\./i;
const DOMAIN = /\b[a-z0-9-]+\.(?:com|net|org|kr|co|me|ly|gg|xyz|site|link)\b/;

/**
 * 신고 글을 보내도 되는지: 안 되면 고칠 말 (되면 null). 이유 칩만 고른 글도 통과한다.
 * 링크·전화번호·메일(개인정보), 욕설, 알아볼 수 없는 글(기호만·같은 글자 되풀이·자음만)을 막는다.
 * 이유 칩을 고른 글은 적은 말이 기호·숫자만이어도 된다 (고칠 정답이 '->'·'1111'·'ㄱ, ㄴ, ㄷ' 일 수 있다)
 */
export function reportTextProblem(text: string): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (CONTACT.test(t)) return '전화번호·메일 주소 같은 개인정보는 빼고 적어 주세요.';
  if (LINK.test(t) || DOMAIN.test(t)) return '링크는 보낼 수 없어요. 무엇이 이상한지만 적어 주세요.';
  const plain = t.replace(/[\d._*\-~!@#$%^&+=|\\/:;'"`,?()[\]{}<>]/g, '').replace(SEED_GERMINATION, '');
  if (ABUSE_KO.some((w) => plain.includes(w)) || ABUSE_JAMO.test(t) || ABUSE_EN.test(t)) return '고운 말로 적어 주세요. 욕설은 보낼 수 없어요.';
  // 고른 이유('…: ') 뒤의 적은 말: 문장 부호만('?!?!')이 아니면 된다
  if (t.includes(': ')) {
    const own = t.slice(t.indexOf(': ') + 2).trim();
    return /^[?!.,~…\s]+$/.test(own) ? '무엇이 이상한지 글로 적어 주세요.' : null;
  }
  const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
  if (!letters) return '무엇이 이상한지 글로 적어 주세요.';
  // 같은 글자 되풀이('ㅋㅋㅋㅋ'·'aaaa', 숫자는 빼고)·자음만('ㅁㄴㅇㄹ', 'ㄱ, ㄴ, ㄷ'처럼 쉼표로 띄운 보기 조합은 된다)
  if (letters.length >= 4 && (/^(\p{L})\1+$/u.test(letters) || (/^[ㄱ-ㅎㅏ-ㅣ]+$/.test(letters) && !/^[ㄱ-ㅎ](?:\s*[,，·]\s*[ㄱ-ㅎ])+$/.test(t))))
    return '무엇이 이상한지 알아볼 수 있게 적어 주세요.';
  return null;
}

/** 복습 문제 (신고할 때의 모습): 유형·문제·보기·정답·해설 */
export function questionSnapshot(q: { type: string; prompt: string; choices: string[] | null; answer: unknown; explanation?: string | null }): string {
  const choices = q.choices?.length ? `\n보기: ${q.choices.map((c, i) => `${i + 1}) ${oneLine(c)}`).join(' ')}` : '';
  const answer =
    q.type === 'mcq' ? `${Number(q.answer) + 1}번 (${q.choices?.[Number(q.answer)] ?? ''})` : q.type === 'ox' ? (q.answer ? 'O' : 'X') : String(q.answer ?? '');
  return clipSnapshot(`문제(${q.type}): ${q.prompt.trim()}${choices}\n정답: ${answer}${q.explanation ? `\n해설: ${q.explanation.trim()}` : ''}`);
}

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

/**
 * 확인 문제 하나 (보기·정답·해설). 짝 맞추기는 짝, 순서 맞추기는 바른 차례, 낱말 고르기 빈칸은 고를 낱말까지.
 * order: 화면에 보인 보기 차례 (레슨 플레이어가 섞는다): 주면 보기 번호를 그 차례로 단다 (학생이 '2번'이라고 쓰면 그 보기)
 */
export function checkSnapshot(c: CourseCheck, order?: readonly number[]): string {
  const explain = c.explanation ? ` (해설: ${oneLine(c.explanation)})` : '';
  if (c.type === 'match') return `${oneLine(c.prompt)} 짝: ${(c.pairs ?? []).map((p) => `${oneLine(p.left)} = ${oneLine(p.right)}`).join(', ')}${explain}`;
  if (c.type === 'order') return `${oneLine(c.prompt)} 바른 차례: ${(c.choices ?? []).map(oneLine).join(' → ')}${explain}`;
  const list = c.choices ?? [];
  const shown = order && order.length === list.length ? order : list.map((_, i) => i);
  const choices = list.length
    ? ` ${c.type === 'cloze' ? '고를 낱말' : '보기'}${order ? '(화면 차례)' : ''}: ${shown.map((i, d) => `${d + 1}) ${oneLine(list[i] ?? '')}`).join(' ')}`
    : '';
  const answer = c.type === 'mcq' ? `${shown.indexOf(Number(c.answer)) + 1}번` : c.type === 'ox' ? (c.answer ? 'O' : 'X') : String(c.answer ?? '').trim();
  return `${oneLine(c.prompt)}${choices} → 정답 ${answer}${explain}`;
}

/** 레슨 전체 (제목·목표·카드·확인 문제): 서버가 저장된 레슨에서 만든다 */
export function lessonSnapshot(l: CourseLesson): string {
  const lines = [`레슨: ${l.title}`];
  if (l.goal) lines.push(`목표: ${oneLine(l.goal)}`);
  l.cards.forEach((c, i) => lines.push(`카드 ${i + 1}: ${clip(cardSnapshot(c), 500)}`));
  l.checks.forEach((c, i) => lines.push(`문제 ${i + 1}: ${clip(checkSnapshot(c), 500)}`));
  return clipSnapshot(lines.join('\n'));
}

/** 레슨에서 지금 보던 칸 (어느 카드·문제가 이상했는지). 문제의 order 는 화면에 보인 보기 차례 */
export function lessonStepSnapshot(
  step: { kind: 'card'; card: CourseCard } | { kind: 'check'; check: CourseCheck; order?: readonly number[] } | null,
  index: number,
): string {
  if (!step) return '';
  return clip(
    `보던 칸 ${index + 1} (${step.kind === 'card' ? '카드' : '문제'}): ${step.kind === 'card' ? cardSnapshot(step.card) : checkSnapshot(step.check, step.order)}`,
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
