@AGENTS.md

# 콕 (Kok) 작업 메모

공부 자료를 넣으면 AI가 정리·마인드맵·문제·복습 일정을 만드는 공부 웹앱. 기획서는 Claude Docs의 "콕 PRD"이고, 지금 코드는 v0.1(혼자 공부)이다.

## 꼭 지킬 것

- 저장소는 공개다. API 키·비밀 키·실제 사용자 데이터를 코드, 커밋, 이슈에 넣지 않는다. 값은 Vercel 환경변수에만 있다. 커밋 전에 `npm run check:secrets`.
- Claude API는 서버에서만 부른다(`src/lib/server/claude.ts`). AI를 쓰는 곳은 반드시 `assertAiAllowed` → 호출 → `charge` 순서(작은 작업은 `runTask`)를 거친다. 실패한 자료 처리는 `refundSource`로 돌려준다.
- `supabase/schema.sql`은 Supabase SQL Editor에서 여러 번 실행해도 안전해야 한다(`if not exists`, `create or replace`, `drop policy if exists`). Supabase가 소유한 표(`auth.*`, `storage.*`)에는 `ALTER TABLE`이나 `DROP TRIGGER`를 쓰지 않는다. 바꾸면 `supabase/test/rls_test.sql`로 확인한다.
- 사용자 데이터 표는 모두 RLS + 칸 단위 GRANT. 학생이 바꾸면 안 되는 칸(plan, role, energy 등)은 GRANT 하지 않는다. 서버 전용 함수는 `service_role`에만 EXECUTE.
- `src/lib/ai/prompts.ts`를 고치면 PRD 15장의 영어·한국어 프롬프트도 같이 고친다.
- 화면 글은 친근한 해요체, 짧고 쉽게. 오류 메시지도 한국어로(`UserFacingError`).

## 구조 요약

- Next.js 16: `middleware` 대신 `src/proxy.ts`, 라우트의 `ctx.params`는 Promise, `cacheComponents`는 끔. 새 API를 쓰기 전에 `node_modules/next/dist/docs/`를 읽는다.
- 로그인한 화면(`src/app/(app)/`)은 클라이언트 컴포넌트이고, Supabase를 브라우저에서 직접 읽고 쓴다(RLS가 막아 준다). AI·파일 검사·관리자 기능만 `src/app/api/`를 거친다.
- 파일 올리기: `POST /api/uploads`(검사 + 한 번짜리 올리기 주소, `upload_tickets`) → 브라우저가 `uploadToSignedUrl`. 학생은 저장소에 직접 올리거나 지울 수 없다(저장소 정책은 읽기만).
- 자료 처리: `POST /api/sources` → `kok_create_source`(한 사람씩 줄 세워 동시 처리 수·에너지 검사 후 행 만들기) → `after()`로 `driveSource` → `runSteps`(90초까지 새 단계 시작) → 남으면 서명된 `/api/internal/process`로 이어 달리기. 상태는 `sources` 표(step, progress, partials, draft, locked_until). `partials`·`draft`는 학생에게 보이지 않는다(칸 단위 SELECT).
- AI에 노트를 보낼 때는 `noteForPrompt`(길이 제한)를 쓰고, 작은 작업의 예상 에너지는 `runTask`가 보낼 내용 길이로 계산한다. 라우트 `maxDuration`보다 `timeoutMs`를 짧게 잡는다.
- 복습: `src/lib/srs.ts`(ts-fsrs), `src/lib/review-plan.ts`(오늘 문제 고르기·시험 모드·연속 기록·약점 개념).

## 확인 명령

```bash
npm test && npm run lint && npm run typecheck && npm run check:secrets
# RLS (로컬 Postgres): supabase/ 에서 stub.sql → schema.sql(두 번) → rls_test.sql
```
