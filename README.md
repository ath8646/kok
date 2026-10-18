# 콕 (Kok)

> 준비는 AI가, 외우기는 내가.

공부 자료(PDF·사진·직접 쓴 글)를 넣으면 AI가 정리 노트·마인드맵·핵심 문제·복습 일정을 만들고, 학생은 하루 5분씩 풀기만 하는 공부 웹앱이에요. 이 저장소는 **v0.1 (혼자 공부 완성)** 이에요.

## 들어 있는 기능 (v0.1)

- 구글 로그인, 약관 동의, 닉네임, 과목·단원
- 자료 넣기: 글(직접 쓰기·붙여넣기), PDF(15쪽씩 나눠 처리), 사진(올리기 전 긴 변 2000px로 줄임)
- AI 정리 노트: 한 줄 요약, 핵심 개념(중요도·시험 포인트·출처 쪽), 용어, 공식(KaTeX), 함정, 예시, 내가 쓴 글이면 "확인해 보세요"와 바뀐 점
- 그림: 마인드맵(퍼지기·오른쪽·아래로, 고치기, 끌어서 옮기기, 가리기 모드, PNG 저장), 표, 연표 — 다시 그리기는 미리보기 후 적용, 내가 고친 가지는 잠김
- 핵심 문제: 객관식·OX·빈칸·단답, AI 자기 검사, 직접 만들기·고치기·잠그기·쉬게 하기, "이상해요" 신고와 AI 수정 제안
- 복습: FSRS(ts-fsrs) 간격 반복, 자동 채점과 평가, 단답형 AI 채점, 시험 모드(D-day), 섞어 풀기, 집중 모드(5·10·25분), 오답노트(3번 연속 맞히면 졸업)와 약점 개념
- AI 에너지: 무료 하루 20 / Pro 한 달 2,000(하루 300), 무료 전체 월 예산, 분당 제한, 비상 스위치, 실패하면 돌려주기
- 관리자 화면: 키 상태·시험, 숫자, 모델·effort, 한도, 사용자, Pro 쿠폰, 신고함, 공지, 운영자 정보
- 설정: 모델(빠름/꼼꼼), 시각화, 복습, 문제, 내 데이터 내려받기, 탈퇴
- PWA(홈 화면에 설치), 밝은/어두운 화면

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
    (app)/             로그인한 뒤 화면: home, library, add, notes, review, wrong, questions, settings, plan, admin, welcome
    api/               서버 API: sources(자료 처리), notes(그림·문제 다시 만들기), grade, coupon, account, admin, cron, internal
    auth/callback/     구글 로그인에서 돌아오는 곳
  components/          화면 조각 (MindMap, NoteView, QuestionCard …)
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

자료 처리는 단계별(정리 → 합치기 → 그림 → 문제 → 검사·저장)로 진행되고, 상태는 `sources` 표에 저장돼요. 자료 만들기와 다시 하기는 DB 함수(`kok_create_source`, `kok_retry_source`)가 한 사람씩 줄을 세워서, 동시에 정리하는 수와 에너지(정리 중인 자료가 더 쓸 몫까지)를 한 번에 검사해요. 한 번 부를 때 90초까지 새 단계를 시작하고, 남으면 서버가 서명된 요청으로 자기 자신을 다시 불러 이어 가요(Vercel 300초 제한). 화면이 열려 있으면 멈춘 처리를 화면이 다시 깨워요.

## 환경변수

Vercel → Settings → Environment Variables 에만 넣어요. 이 저장소는 공개라서 **값을 코드나 파일에 적지 않아요.** (`.env.example` 참고)

| 이름 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 주소 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Supabase secret key (`sb_secret_…`) — 비밀 |
| `ANTHROPIC_API_KEY` | Claude API 키 — 비밀 |
| `ADMIN_EMAILS` | 관리자 구글 이메일 (쉼표로 여러 개) |
| `CRON_SECRET` | 매일 청소 작업 보호 (아무 영어·숫자 32자 이상) — 비밀. 없으면 청소가 돌지 않아요 |

## 처음 설치

1. Supabase SQL Editor 에 `supabase/schema.sql` 전체를 붙여 넣고 실행해요. 여러 번 실행해도 안전해요.
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
