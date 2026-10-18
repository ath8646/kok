# 콕 (Kok)

> 준비는 AI가, 외우기는 내가.

공부 자료(PDF·사진·직접 쓴 글)를 넣으면 AI가 정리 노트·마인드맵·핵심 문제·복습 일정을 만들고, 학생은 하루 5분씩 풀기만 하는 공부 웹앱이에요. 이 저장소는 **v0.1 (혼자 공부 완성)** 이에요.

## 들어 있는 기능 (v0.1)

- 구글 로그인(Apple 로그인은 설정 후 켜기), 약관 동의, 닉네임, 과목·단원
- 자료 넣기: 어느 화면에서나 오른쪽 아래 **+ 버튼** → 입력창에 적고 **엔터**(Shift+엔터는 줄바꿈)면 바로 AI 정리. PDF·사진·글 파일은 화면 아무 데나 **끌어다 놓거나 붙여 넣으면** 검사하고 알아서 정리(PDF는 하나씩, 사진은 묶어서 한 자료, 한글·워드는 PDF로 저장하라고 안내). PDF는 15쪽씩(무거운 PDF는 AI에 보낼 수 있는 크기로 더 잘게) 나눠 처리, 파일 한 개 무료 10MB·Pro 200MB(관리자 화면에서 바꿈), 사진은 올리기 전 긴 변 2000px로 줄임
- 자료함: 노트 앱처럼 과목(폴더) 칩 + 노트 카드 격자, 큰 제목이 스크롤하면 위 띠로 작아짐, 정리 중인 카드는 진행 고리, 멈춘 카드는 바로 다시 하기
- AI 정리 노트: 한 줄 요약, 핵심 개념(중요도·시험 포인트·출처 쪽), 용어, 공식(KaTeX), 함정, 예시, 내가 쓴 글이면 "확인해 보세요"와 바뀐 점
- 그림: 마인드맵(퍼지기·오른쪽·아래로, 고치기, 끌어서 옮기기, 가리기 모드, PNG 저장), 표, 연표 — 다시 그리기는 미리보기 후 적용, 내가 고친 가지는 잠김
- 핵심 문제: 객관식·OX·빈칸·단답, AI 자기 검사, 직접 만들기·고치기·잠그기·쉬게 하기, "이상해요" 신고와 AI 수정 제안
- 노트 채팅: 노트 화면의 주황 버튼을 누르면 그 노트에 대해 묻는 창이 열려요. 노트를 바탕으로 답하고(노트 밖 설명은 표시), 답마다 에너지, 모델 고르기(마지막 선택 기억), 노트마다 대화 저장. "문제로/노트에 넣어 줘" 하면 미리보기를 보여 주고 [넣기]를 눌러야 들어가요(설정 > AI 채팅에서 켜고 끄기)
- 노트에 자료 더하기와 버전 (Pro): 원본 탭에서 글·파일을 더하거나 노트 화면에 끌어다 놓기·붙여 넣기(먼저 물어봄). AI가 지금 노트와 합쳐 새 버전을 만들고, 기존 문제·복습 기록은 그대로 두고 새 내용으로만 문제를 더해요. 버전 기록(1. 처음 자료, 2. 더한 자료 …)에서 열기·고치기, 이 버전 쓰기, 지우기(지운 번호는 다시 쓰지 않음). 복습은 지금 버전의 문제만(쉬게 한 문제는 버전을 오가도 쉬는 그대로). 더하는 동안에는 정리·그림을 고칠 수 없고, 실패한 자료를 나중에 다시 하면 그때의 노트에 다시 합쳐요. 다른 탭·기기에서 먼저 바뀐 노트는 덮어쓰지 않아요. 예전 노트는 그대로 버전 1
- 복습: FSRS(ts-fsrs) 간격 반복, 자동 채점과 평가, 단답형 AI 채점, 시험 모드(D-day), 섞어 풀기, 집중 모드(5·10·25분), 오답노트(3번 연속 맞히면 졸업)와 약점 개념
- AI 에너지: 무료 하루 20 / Pro 한 달 2,000(하루 300), 무료 전체 월 예산, 분당 제한, 비상 스위치, 실패하면 돌려주기
- 테스트 플랜: 관리자가 번개(⚡) 총량·하루 최대·쪽수·사진·글자·파일 크기·꼼꼼 모델을 정해 만들고, 그 플랜의 코드를 나눠 준다. 코드를 쓴 계정은 정한 날수 동안 그 플랜(관리자 > 테스트 플랜 > Pro > 무료)을 쓰고, 끝나면 원래 요금제로 돌아간다
- 관리자 화면: 키 상태·시험, 숫자, 모델·effort, 한도, 사용자(테스트 플랜 끝내기), 테스트 플랜, 쿠폰(Pro·테스트 플랜 코드), 신고함, 공지, 운영자 정보
- 설정: 모델(빠름/꼼꼼), AI 채팅, 테마, 시각화, 복습, 문제, 내 데이터 내려받기, 탈퇴
- 테마 (Pro): 색 8가지, 글꼴 4가지(고운돋움·개구·고운바탕, 고른 사람만 글꼴 파일을 받음), 노트 종이 무늬(줄·모눈·점). Pro가 끝나면 기본 모양으로
- 테스트 플랜마다 꼼꼼 모델·노트에 자료 더하기·테마를 켜고 끌 수 있어요
- PWA(홈 화면에 설치), 밝은/어두운 화면, 노트 앱(One UI) 느낌의 디자인과 움직임(움직임 줄이기 설정을 따름)

## 구조

| 부분 | 쓰는 것 |
| --- | --- |
| 화면 + 서버 | Next.js 16 (App Router, `src/`), React 19, Tailwind CSS 4 |
| 로그인·데이터·파일 | Supabase (Auth + Postgres RLS + Storage `sources` 버킷) |
| AI | Claude API (`@anthropic-ai/sdk`), 서버에서만 호출, JSON 스키마로 답 받기 |
| 복습 알고리즘 | ts-fsrs (브라우저에서 계산, RLS로 내 카드만 저장) |
| 호스팅 | Vercel (함수 지역 서울 `icn1`, 매일 청소 Cron) |

```
src/
  app/                 화면과 API (route.ts)
    (app)/             로그인한 뒤 화면: home, library, notes, review, wrong, questions, settings, plan, admin, welcome (add 는 자료함으로 보내기만)
    api/               서버 API: sources(자료 처리·노트에 더하기), notes(그림·문제 다시 만들기, chat, versions), grade, coupon, account, admin, cron, internal
    auth/callback/     구글·Apple 로그인에서 돌아오는 곳
  components/          화면 조각 (QuickAdd: + 버튼·끌어다 놓기, LibraryView: 자료함, MindMap, NoteView, QuestionCard …)
  lib/
    ai/                요금표·에너지, 프롬프트, JSON 스키마
    server/            서버 전용 (계정·에너지, Claude 호출, 처리 파이프라인)
    supabase/          Supabase 클라이언트 (브라우저·서버·proxy·관리자)
  proxy.ts             로그인 세션 새로 고침, 로그인 안 하면 첫 화면으로
supabase/
  schema.sql           표·권한·RLS·함수·저장소 정책 (SQL Editor에서 한 번 실행)
  test/                로컬 Postgres로 RLS를 시험하는 SQL
```

파일은 서버가 개수·크기·하루 한도를 검사하고 준 한 번짜리 올리기 주소(`POST /api/uploads`)로만 올려요. 학생이 저장소에 직접 올리거나 지울 수는 없어요. 1시간 넘게 정리를 시작하지 않은 파일은 서버가 지워요.

자료 처리는 단계별(정리 → 합치기 → 그림 → 문제 → 검사·저장)로 진행되고, 상태는 `sources` 표에 저장돼요. 노트에 더한 자료는 부모 자료(`parent_id`)를 가리키는 자료 행으로 같은 단계를 거치고(합치기는 지금 노트와), 끝나면 `kok_finalize_append` 가 지금 버전을 `note_versions` 에 남기고 합친 노트를 새 버전으로 써요. 지금 버전의 내용은 늘 `notes`·`visuals`·`questions` 에 있고, 지금 버전에 없는 문제는 `status = 'hidden'` 이라 복습에 나오지 않아요. 자료 만들기와 다시 하기는 DB 함수(`kok_create_source`, `kok_retry_source`)가 한 사람씩 줄을 세워서, 동시에 정리하는 수와 에너지(정리 중인 자료가 더 쓸 몫까지)를 한 번에 검사해요. 한 번 부를 때 90초까지 새 단계를 시작하고, 남으면 서버가 서명된 요청으로 자기 자신을 다시 불러 이어 가요(Vercel 300초 제한). 화면이 열려 있으면 멈춘 처리를 화면이 다시 깨워요.

## 환경변수

Vercel → Settings → Environment Variables 에만 넣어요. 이 저장소는 공개라서 **값을 코드나 파일에 적지 않아요.** (`.env.example` 참고)

| 이름 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 주소 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_…`) — 비밀 |
| `ANTHROPIC_API_KEY` | Claude API 키 — 비밀 |
| `ADMIN_EMAILS` | 관리자 구글 이메일 (쉼표로 여러 개). 구글로 로그인한 계정만 관리자가 돼요 (Apple 로그인은 안 돼요) |
| `CRON_SECRET` | 매일 청소 작업 보호 (아무 영어·숫자 32자 이상) — 비밀. 없으면 청소가 돌지 않아요 |
| `NEXT_PUBLIC_APPLE_LOGIN` | `1` 이면 첫 화면에 "Apple로 계속하기" 버튼이 보여요. 비워 두면 버튼이 없어요. 빌드할 때 정해지니 바꾸면 다시 배포해요 (공개돼도 괜찮아요) |

### Apple 로그인 켜기 (선택)

1. Apple Developer Program(유료, 해마다)에서 App ID(Sign in with Apple 켜기), Services ID, 키(`.p8`)를 만들어요. Services ID 의 Return URL 은 `https://<프로젝트-ref>.supabase.co/auth/v1/callback` 이에요.
2. Supabase → Authentication → Sign In / Providers → Apple 을 켜고, Client IDs 에 Services ID, Secret Key (for OAuth) 에 `.p8` 로 만든 JWT 를 넣어요.
3. 위 순서를 다 마친 뒤 Vercel 에 `NEXT_PUBLIC_APPLE_LOGIN=1` 을 넣고 다시 배포해요.
4. **Secret Key(JWT)는 6개월마다 끝나요.** 끝나기 전에 `.p8` 로 새로 만들어 넣어요. 안 하면 Apple 로그인이 멈춰요. `.p8` 파일은 저장소에 절대 넣지 않아요.

## 처음 설치

1. Supabase SQL Editor 에 `supabase/schema.sql` 전체를 붙여 넣고 실행해요. 여러 번 실행해도 안전해요. **코드를 새로 올릴 때마다 한 번 더 실행해요.** 새 표·칸이 생기기 전에는 새 기능(노트 채팅, 자료 더하기와 버전)이 꺼진 채로 예전처럼 동작해요.
2. Vercel 에 이 저장소를 가져오고 위 환경변수를 넣어 배포해요.
3. Supabase → Authentication → URL Configuration 에 사이트 주소(Site URL)와 `https://<사이트>/**`(Redirect URLs)를 넣어요.

## 개발

```bash
npm install
npm run dev            # http://localhost:3000 (환경변수는 .env.local 에)
npm test               # 단위 시험 (vitest)
npm run lint
npm run typecheck      # next typegen + tsc
npm run check:secrets  # 비밀 키처럼 보이는 문자열 검사
```

RLS 시험 (로컬 Postgres 필요):

```bash
cd supabase
psql -d koktest -f test/stub.sql -f schema.sql -f test/rls_test.sql
```

## 다음 버전

- v0.2: 문제 세트 공유, 한글·워드·PPT·웹 링크 넣기, 기억 지도, 오프라인 복습, 하루 한 번 알림
- v0.3: 같이 공부하는 방
- v0.4: Pro 결제
