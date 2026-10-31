// 코딩 자료 시뮬레이션: AI 역할을 한 답(fixtures/*.note.json, *.quiz.json)을 앱의 코드 길로 돌려 보고 문제를 센다.
// 실행: npx vitest run --config tools/coding-sim/vitest.config.ts   (SIM_PHASE=base|new, 기본 new 가 없으면 base)
// 결과: tools/coding-sim/out/report-<phase>.md (문제마다 예), 콘솔에 요약
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { it, vi } from 'vitest';
import * as fontkit from '@pdf-lib/fontkit';

vi.mock('server-only', () => ({}));

const ROOT = path.resolve(__dirname);
const FIX = path.join(ROOT, 'fixtures');
const OUT = path.join(ROOT, 'out');

type Issue = { kind: string; topic: string; where: string; text: string; detail?: string };

/** 수식 칸 안의 코드 (AI 가 코드를 LaTeX 로 감싼 것): 이스케이프한 밑줄·백슬래시, 코드 연산자, \text{} 안의 코드 */
const CODE_WORDS = /\b(?:print|printf|def|class|return|int|void|public|static|SELECT|FROM|WHERE|const|let|function|git|echo|chmod|fork|malloc|free|null|None|True|False|self|import|while|if|else)\b/;
function codeInTex(tex: string): boolean {
  if (/\\_|\\textbackslash|\\textasciicircum|==|!=|&&|\|\||"|;|\*\(/.test(tex)) return true;
  for (const m of tex.matchAll(/\\text(?:tt|sf|rm)?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) if (/[(){}[\]*:.]|\\[{}]/.test(m[1]) || CODE_WORDS.test(m[1])) return true;
  return CODE_WORDS.test(tex.replace(/\\text(?:tt|sf|rm)?\{[^{}]*\}/g, ''));
}

it('coding-sim report', async () => {
  const { zNote } = await import('@/lib/ai/schemas');
  const { normalizeNote } = await import('@/lib/server/pipeline');
  const { noteForPrompt } = await import('@/lib/server/notes');
  const { parseRich, previewText, stripMarks } = await import('@/lib/richtext');
  const { richToDoc, docToRich } = await import('@/lib/rich-doc');
  const { autoGrade } = await import('@/lib/grading');
  const { buildNotePdf } = await import('@/lib/server/note-pdf');
  const { zQuiz, zQuizItem } = await import('@/lib/ai/schemas');

  const phase = process.env.SIM_PHASE ?? (readdirSync(FIX).some((f) => f.includes('.new.')) ? 'new' : 'base');
  const topics = readdirSync(FIX)
    .filter((f) => f.endsWith(`.${phase}.note.json`))
    .map((f) => f.split('.')[0])
    .sort();
  const issues: Issue[] = [];
  const stats = { topics: topics.length, fields: 0, questions: 0, byType: {} as Record<string, number>, pdfs: 0, codeSpans: 0, codeBlocks: 0, codeQuestions: 0 };
  const add = (kind: string, topic: string, where: string, text: string, detail?: string) => issues.push({ kind, topic, where, text, detail });

  // PDF 글꼴에 없는 글자 (□ 로 나온다)
  const fontDir = path.resolve(ROOT, '../../src/lib/server/pdf-fonts');
  const fonts = readdirSync(fontDir)
    .filter((f) => f.endsWith('.woff2'))
    .map((f) => fontkit.create(new Uint8Array(readFileSync(path.join(fontDir, f)))) as unknown as { hasGlyphForCodePoint: (c: number) => boolean });
  const missingGlyphs = (s: string) => [...new Set([...s].filter((ch) => ch.trim() && !fonts.some((f) => f.hasGlyphForCodePoint(ch.codePointAt(0)!))))];

  /** 글 칸 하나를 앱의 길로 돌려 본다 */
  const field = (topic: string, where: string, text: string, rich = true) => {
    if (!text) return;
    stats.fields++;
    const lines = parseRich(text);
    // 코드 조각·코드 블록 수 (AI 가 코드를 코드로 적었는지)
    stats.codeSpans += lines.reduce((a, l) => a + (l.code ? 0 : l.c.filter((n) => n.t === 'code').length), 0);
    stats.codeBlocks += lines.filter((l) => l.code?.start).length;
    // 닫지 않은 코드 블록 (``` 줄이 홀수: 그 뒤 글이 모두 코드로 보인다)
    if ((text.match(/^[ \t]*`{3,}/gm)?.length ?? 0) % 2) add('unclosed-fence', topic, where, text);
    const walk = (ns: ReturnType<typeof parseRich>[number]['c']): void => {
      for (const n of ns) {
        if (n.t === 'math') {
          const explicit = text.includes(`$${n.tex}$`) || text.includes(`$$${n.tex}$$`);
          // 1. 수식 칸에 코드가 들어갔는지 (AI 가 $…$ 규칙을 지키려고 코드를 LaTeX 로 감쌈)
          if (explicit && codeInTex(n.tex)) add('code-in-math', topic, where, text, `$${n.tex}$`);
          // 2. $ 없이 쓴 글이 수식으로 읽힘 (코드가 수식 글꼴로)
          if (!explicit && rich) add('bare-math', topic, where, text, n.tex);
        }
        // 3. 글자 그대로 보이는 백틱 (짝이 안 맞는 코드 표시)
        if (n.t === 'text' && n.v.includes('`')) add('literal-backticks', topic, where, text, n.v);
        if (n.t === 'b' || n.t === 'mark' || n.t === 'red') walk(n.c);
      }
    };
    for (const l of lines) walk(l.c);
    // 4. 카드 미리보기에서 코드가 망가짐 (__init__ → init, **kwargs → kwargs)
    const pv = previewText(text);
    // (코드 조각은 한 줄 안의 `…` 만: 코드 블록은 미리보기에서 줄이 빈칸으로 이어진다)
    for (const tok of text.match(/\b__\w+__\b|\*\*\w+|(?<!`)`[^`\n]+`(?!`)/g) ?? []) if (!pv.includes(tok.replace(/`/g, ''))) add('preview-damage', topic, where, text, `${tok} → ${pv.slice(0, 80)}`);
    // 5. AI 에 다시 보낼 때 글이 바뀜 (noteForPrompt → stripMarks 가 $ 없이 쓴 글을 $…$ 로 감쌈)
    if (rich) {
      const sm = stripMarks(text);
      if ((sm.match(/\$/g)?.length ?? 0) > (text.match(/\$/g)?.length ?? 0)) add('prompt-damage', topic, where, text, sm);
    }
    // 6. 고치기 모드(편집기)로 열었다 닫으면 글이 바뀜
    if (rich) {
      const single = !text.includes('\n');
      const back = docToRich(richToDoc(text, { single }), { single });
      if (back !== text) add('editor-roundtrip', topic, where, text, back);
    }
  };

  for (const topic of topics) {
    // ------------------------------------------------------------ 노트
    const raw = JSON.parse(readFileSync(path.join(FIX, `${topic}.${phase}.note.json`), 'utf8'));
    const parsed = zNote.safeParse(raw);
    if (!parsed.success) {
      add('schema-note', topic, 'note', JSON.stringify(parsed.error.issues.slice(0, 2)));
      continue;
    }
    const note = normalizeNote(parsed.data);
    field(topic, 'title', note.title, false);
    field(topic, 'summary', note.summary);
    for (const k of note.key_points) {
      field(topic, `${k.id}.title`, k.title);
      field(topic, `${k.id}.explanation`, k.explanation);
      field(topic, `${k.id}.why`, k.why);
    }
    for (const t of note.terms) {
      field(topic, 'term', t.term, false);
      field(topic, 'term.meaning', t.meaning);
    }
    for (const f of note.formulas) {
      field(topic, 'formula.label', f.label, false);
      if (codeInTex(f.latex)) add('code-as-formula', topic, 'formula.latex', f.latex);
    }
    for (const p of note.pitfalls) field(topic, 'pitfall', p.text);
    for (const e of note.examples) field(topic, 'example', e.text);
    // 노트에 남은 코드: 자료의 코드 조각(``` 블록)의 줄 가운데 노트 어디에도 (거의) 그대로 안 남은 비율
    const material = readFileSync(path.join(ROOT, 'materials', `${topic}.md`), 'utf8');
    const codeLines = [...material.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n')).map((l) => l.trim()).filter((l) => l.length >= 8 && !l.startsWith('#') && !l.startsWith('//'));
    const all = JSON.stringify(note);
    const kept = codeLines.filter((l) => all.includes(JSON.stringify(l).slice(1, -1)));
    if (codeLines.length) add('code-kept', topic, 'note', `${kept.length}/${codeLines.length}`);
    // AI 에 다시 보내는 노트 (문제 만들기·채팅)
    const prompt = noteForPrompt(note);
    if ((prompt.match(/\$/g)?.length ?? 0) > (JSON.stringify(note).match(/\$/g)?.length ?? 0)) add('prompt-damage', topic, 'noteForPrompt', prompt.slice(0, 200));
    // PDF 요약
    try {
      await buildNotePdf({ title: note.title, subject: '컴퓨터공학', unit: note.unit, note, mindmap: null, figures: [], theme: 'dark', date: new Date('2026-10-31'), aiMade: true });
      stats.pdfs++;
    } catch (e) {
      add('pdf-error', topic, 'pdf', String(e));
    }
    const miss = missingGlyphs(all);
    if (miss.length) add('pdf-missing-glyph', topic, 'pdf', miss.join(' '));

    // ------------------------------------------------------------ 문제
    const qf = path.join(FIX, `${topic}.${phase}.quiz.json`);
    if (!existsSync(qf)) continue;
    const quiz = zQuiz.parse(JSON.parse(readFileSync(qf, 'utf8'))).questions;
    for (const [i, r] of quiz.entries()) {
      const q = zQuizItem.safeParse(r);
      if (!q.success) {
        add('schema-question', topic, `q${i + 1}`, JSON.stringify(q.error.issues.slice(0, 1)));
        continue;
      }
      const it = q.data;
      stats.questions++;
      if (/^[ \t]*`{3,}/m.test(it.prompt)) stats.codeQuestions++;
      stats.byType[it.type] = (stats.byType[it.type] ?? 0) + 1;
      field(topic, `q${i + 1}.prompt`, it.prompt);
      field(topic, `q${i + 1}.explanation`, it.explanation);
      for (const c of it.choices ?? []) field(topic, `q${i + 1}.choice`, c);
      if (it.type === 'cloze' || it.type === 'short') {
        field(topic, `q${i + 1}.answer`, it.answer_text, false);
        // 학생이 정답을 그대로 적으면 맞아야 한다 (화면에는 수식·꾸미기 없이 보이는 글자로 적는다)
        const typed = previewText(it.answer_text);
        const g = autoGrade({ type: it.type, answer: it.answer_text, accepted: it.accepted }, typed);
        if (!g.correct) add('grading-miss', topic, `q${i + 1}`, it.answer_text, `typed "${typed}"`);
        // 틀린 답이 맞다고 나오면 안 된다: 부등호를 뒤집거나 음수의 - 를 빼거나 소수점을 빼거나 ++/-- 를 바꾼 답
        const wrong = [
          typed.replace(/[<>]/g, (c) => (c === '<' ? '>' : '<')),
          typed.replace(/-(?=\d)/g, ''),
          typed.replace(/(\d)\.(\d)/g, '$1$2'),
          typed.replace(/--/g, '++'),
          typed.replace(/->/g, '>'),
          typed.replace(/!=/g, '='),
        ].filter((w) => w !== typed && w.trim());
        for (const w of wrong) if (autoGrade({ type: it.type, answer: it.answer_text, accepted: it.accepted }, w).correct) add('grading-too-lenient', topic, `q${i + 1}`, it.answer_text, `"${w}" 도 맞음`);
        if (it.type === 'cloze' && !/_{2,}|\(\s*\)|\[\s*\]/.test(it.prompt)) add('cloze-without-blank', topic, `q${i + 1}`, it.prompt);
      }
    }
  }

  // ------------------------------------------------------------ 보고
  const kinds = [...new Set(issues.map((x) => x.kind))].sort();
  const count = (k: string) => issues.filter((x) => x.kind === k).length;
  const topicsWith = (k: string) => new Set(issues.filter((x) => x.kind === k).map((x) => x.topic)).size;
  const lines = [
    `# 코딩 자료 시뮬레이션 (${phase})`,
    '',
    `주제 ${stats.topics}개 · 글 칸 ${stats.fields}개 · 문제 ${stats.questions}개 (${Object.entries(stats.byType).map(([k, v]) => `${k} ${v}`).join(', ')}) · PDF ${stats.pdfs}개`,
    `코드 조각 ${stats.codeSpans}개 · 코드 블록 ${stats.codeBlocks}개 · 코드를 보여 주는 문제 ${stats.codeQuestions}개`,
    '',
    '| 문제 | 수 | 주제 |',
    '| --- | --- | --- |',
    ...kinds.filter((k) => k !== 'code-kept').map((k) => `| ${k} | ${count(k)} | ${topicsWith(k)} |`),
    '',
    '## 노트에 남은 코드 줄 (자료의 ``` 블록 줄 가운데)',
    ...issues.filter((x) => x.kind === 'code-kept').map((x) => `- ${x.topic}: ${x.text}`),
    '',
  ];
  for (const k of kinds.filter((k) => k !== 'code-kept')) {
    lines.push(`## ${k}`, '');
    for (const x of issues.filter((y) => y.kind === k).slice(0, 12)) lines.push(`- **${x.topic}** \`${x.where}\`: ${x.text.slice(0, 160).replace(/\n/g, ' ⏎ ')}${x.detail ? `  → \`${x.detail.slice(0, 120).replace(/\n/g, ' ⏎ ')}\`` : ''}`);
    lines.push('');
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `report-${phase}.md`), lines.join('\n'));
  writeFileSync(path.join(OUT, `issues-${phase}.json`), JSON.stringify({ stats, issues }, null, 2));
  console.log(lines.slice(0, 20 + kinds.length + topics.length).join('\n'));
});
