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
- 자료 넣기는 `src/components/QuickAdd.tsx` 하나로 한다: + 버튼 입력창(엔터 = 정리, 한글 조합 중 엔터는 무시 `isSubmitKey`), 화면 어디든 끌어다 놓기·붙여 넣기. 파일을 자료로 나누는 규칙은 `src/lib/quick-add.ts`(시험 있음). 줄을 세워 하나씩 올리고, 동시에 정리 중인 자료가 3개면 기다린다. `/add` 는 `/library?compose=1` 로 보내기만 한다.
- 파일 올리기: `POST /api/uploads`(검사 + 한 번짜리 올리기 주소, `upload_tickets`) → 브라우저가 `uploadToSignedUrl`. 학생은 저장소에 직접 올리거나 지울 수 없다(저장소 정책은 읽기만).
- 디자인: 노트 앱(One UI) 느낌. 색·움직임 값은 `src/app/globals.css` 맨 위 변수, 화면 조각은 `src/components/ui.tsx`(`LargeHeader` 큰 제목, `kok-card`, `Sheet`, `Menu`). 움직임은 transform·opacity 만, 300ms 안, `prefers-reduced-motion` 을 따른다. 삼성 로고·상표·그림은 쓰지 않는다.
- 자료함은 `/library` 와 `/library/[과목]` 이 같은 `LibraryView` 다. 과목 칩을 바꾸면 `history.replaceState` 로 주소만 바꾼다.
- 자료 처리: `POST /api/sources` → `kok_create_source`(한 사람씩 줄 세워 동시 처리 수·에너지 검사 후 행 만들기) → `after()`로 `driveSource` → `runSteps`(90초까지 새 단계 시작) → 남으면 서명된 `/api/internal/process`로 이어 달리기. 상태는 `sources` 표(step, progress, partials, draft, locked_until). `partials`·`draft`는 학생에게 보이지 않는다(칸 단위 SELECT).
- 큰 PDF(20MB 넘음)는 첫 정리 단계에서 AI 요청 한도(32MB, base64)에 맞게 `splitPdfBySize`로 나눠 `내id/자료id/parts/`에 저장하고(`draft.pdfParts`), 단계마다 조각 하나만 받는다. 정리가 끝나면 조각은 지운다. 파일 최대 크기를 바꾸려면 `MAX_FILE_MB`(settings.ts), `schema.sql`의 버킷 `file_size_limit`, Supabase Storage 전체 한도를 같이 바꾼다.
- AI에 노트를 보낼 때는 `noteForPrompt`(길이 제한)를 쓰고, 작은 작업의 예상 에너지는 `runTask`가 보낼 내용 길이로 계산한다. 라우트 `maxDuration`보다 `timeoutMs`를 짧게 잡는다.
- 요금제 판단은 `src/lib/plans.ts` 한 곳(관리자 > 테스트 플랜 > Pro > 무료). 서버는 `getAccount`의 `acc.plan`·`acc.custom`·`acc.canCareful`·`acc.keepFiles`와 `limitsFor(acc, L)`을 쓰고, `isPro`로 혜택을 정하지 않는다. 테스트 플랜(`custom_plans`, 서버만)은 쿠폰 `plan_id`로 켜고(`kok_redeem_coupon`), 번개는 `custom_plan_start`부터 세며 DB 검사에는 `energyWindows`의 두 번째 창으로 넘긴다. 하루 최대도 플랜을 켠 뒤부터 센다.
- 복습: `src/lib/srs.ts`(ts-fsrs), `src/lib/review-plan.ts`(오늘 문제 고르기·시험 모드·연속 기록·약점 개념).
- 새 표·칸을 쓰는 기능은 `getFeatures(admin)`(서버, 1분 기억) → `me.features`(화면)로 켠다. 배포가 schema.sql 다시 실행보다 먼저 될 수 있어서, 없으면 예전처럼 동작해야 한다. 브라우저의 자료 목록은 `topLevelSources`/`fetchSources` 로 읽는다(더한 자료 빼기, 칸이 없으면 그냥 읽기). 브라우저에서 sources 의 새 칸을 select 할 때도 features 를 본다(칸 단위 GRANT).
- 노트 채팅: `POST /api/notes/[id]/chat`(`CHAT_SYSTEM` + `chatPrompt`, `runTaskFull`, 사용자·AI 말을 한 번에 저장: 여러 행 insert 는 모든 칸을 적는다) → 넣자는 것은 `chat_messages.proposal`(pending) → `chat/apply` 가 먼저 상태를 바꾸고(두 번 눌러도 한 번) AI 없이 넣는다. 화면 `src/components/note/NoteChat.tsx`(노트 화면에서는 + 버튼 대신 이 버튼, `NoteTarget.hideFab`).
- 노트에 자료 더하기(Pro, `acc.canAppend`): 더한 자료 = `sources.parent_id` 가 있는 자료 행, 한 노트에 하나씩(`append_busy`). 파이프라인은 합치기 단계에서 지금 노트와 합치고(`appendMergePrompt`), 문제는 새 내용으로만(`quizPrompt` onlyNew), 끝은 `kok_finalize_append`. 버전: `note_versions`(지금 버전 행은 바꿀 때만 저장되니 지금 버전은 늘 notes·visuals·questions 를 본다), `notes.current_version`, 지금 버전에 없는 문제는 `status = 'hidden'`. 바꾸기·지우기는 `/api/notes/[id]/versions`(→ `kok_switch_version`/`kok_delete_version`), 지난 버전 고치기는 화면이 note_versions 를 직접. 문제 빼기 규칙은 `removalPlan`(`src/lib/versions.ts`).
- 테마(Pro, `acc.canTheme`): `settings.theme` → AppShell 이 `applyTheme`(`src/lib/theme.ts`)로 `<html data-theme|data-font|data-paper>`. 색 값은 `globals.css` 의 테마 칸(명암비 4.5 이상)과 `THEME_COLOR_INFO` 를 같이 고친다. 글꼴 CSS 는 `src/lib/theme-fonts/*` 를 동적으로 불러온다. 깜빡임 막기는 layout 의 `THEME_BOOT`.
- Apple 로그인: `NEXT_PUBLIC_APPLE_LOGIN=1` 일 때만 버튼(`src/lib/login.ts`). Apple Secret Key(JWT)는 180일마다 끝나서 주인이 새로 만들어 Supabase 에 넣어야 한다. 관리자는 구글 로그인만.

## 확인 명령

```bash
npm test && npm run lint && npm run typecheck && npm run check:secrets
# RLS (로컬 Postgres, UTF8 데이터베이스): supabase/ 에서 stub.sql → schema.sql(두 번) → rls_test.sql
```
