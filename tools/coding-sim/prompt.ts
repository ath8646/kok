// 코딩 자료 시뮬레이션: 앱이 AI 에 보내는 그대로의 지시(시스템·사용자 글·답 모양)를 찍는다.
// AI 역할을 하는 쪽이 이것을 보고 답(JSON)을 만들면 check.test.ts 가 앱의 코드 길로 그 답을 돌려 본다.
// 실행 (서버 코드를 불러서 react-server 조건이 필요하다):
//   NODE_OPTIONS=--conditions=react-server npx tsx tools/coding-sim/prompt.ts organize tools/coding-sim/materials/py-basics.md
//   NODE_OPTIONS=--conditions=react-server npx tsx tools/coding-sim/prompt.ts quiz tools/coding-sim/fixtures/py-basics.note.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COMMON_SYSTEM, organizePrompt, quizPrompt, wrap } from '@/lib/ai/prompts';
import { organizeJsonSchema, quizJsonSchema, zNote } from '@/lib/ai/schemas';
import { keyPointRange } from '@/lib/ai/scale';
import { normalizeNote } from '@/lib/server/pipeline';
import { noteForPrompt } from '@/lib/server/notes';
import { DEFAULT_SETTINGS } from '@/lib/settings';

const [, , mode, file] = process.argv;
if (!mode || !file) {
  console.error('usage: prompt.ts organize <material.md> | quiz <note.json>');
  process.exit(1);
}

function print(system: string, user: string[], schema: unknown) {
  console.log('===== SYSTEM =====');
  console.log(system);
  console.log('===== USER (blocks in order) =====');
  console.log(user.join('\n\n'));
  console.log('===== JSON SCHEMA (answer must match) =====');
  console.log(JSON.stringify(schema, null, 2));
}

if (mode === 'organize') {
  const text = readFileSync(file, 'utf8');
  const title = path.basename(file).replace(/\.[^.]+$/, '');
  // 붙여 넣은 글 자료는 앱이 학생이 직접 쓴 글로 다룬다 (pipeline.ts: 한글·워드·PPT 에서 꺼낸 글('(파일: …)' 로 시작)만 ownWriting false)
  const meta = { title, kind: 'text' as const, ownWriting: true, keyPoints: keyPointRange({ kind: 'text', chars: text.length }) };
  print(COMMON_SYSTEM, [wrap('material', text), organizePrompt(meta)], organizeJsonSchema({ figures: false, pageNumbers: false }));
} else if (mode === 'quiz') {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const note = normalizeNote(zNote.parse(raw));
  const q = DEFAULT_SETTINGS.quiz;
  print(
    COMMON_SYSTEM,
    [
      wrap('note', noteForPrompt(note)),
      wrap('existing_questions', JSON.stringify([])),
      quizPrompt({ types: q.types, mix: q.mix, language: q.language, perKeyPoint: q.perKeyPoint, figures: 0 }),
    ],
    quizJsonSchema,
  );
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
