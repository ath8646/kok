// 단계 풀이 한 단계의 이름: AI 는 과목마다의 차례대로 단계를 '식 세우기: …'·'지문 근거: …'처럼 이름과 쌍점으로 시작한다
// (prompts.ts SUBJECT_STEPS). 화면은 이름을 따로 굵게 보인다. 이름이 아닌 것(수식·문장·'따라서 답은:')은 글 그대로 둔다.

/** 이름 + 쌍점 + 빈칸 + 내용. 이름은 한글이 든 짧은 말 (첫 글자는 숫자·기호가 아니다, 수식·꾸미기 기호 없음) */
const TITLE = /^\s*([가-힣A-Za-z][^:：\n$`*=\\<>{}[\]()]{0,13}?)\s*[:：]\s+(\S[\s\S]*)$/;
/**
 * 이런 조사·끝맺음으로 끝나면 이름이 아니라 문장의 앞부분이다 ('따라서 답은: 5', '정리하면: …').
 * '이·가·의·도'는 이름 끝 글자일 수 있어서(넓이·평가·정의·속도) 보지 않는다
 */
const NOT_TITLE_END = /(?:[은는을를]|에서|으로|하면|이면|[.!?]|[니어아에예해]요|[이한]다)$/;

export type StepParts = { title: string | null; body: string };

/** '식 세우기: $x+2=5$' → { title: '식 세우기', body: '$x+2=5$' }. 이름이 없으면 title null, body 는 글 그대로 */
export function stepParts(text: string): StepParts {
  const m = TITLE.exec(text);
  if (!m) return { title: null, body: text };
  const title = m[1].trim();
  // 한글이 든 세 낱말까지의 말, 문장 끝·조사로 끝나지 않는 것만
  if (!/[가-힣]/.test(title) || title.split(/\s+/).length > 3 || NOT_TITLE_END.test(title)) return { title: null, body: text };
  return { title, body: m[2].trim() };
}
