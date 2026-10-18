# 로컬 끝-끝 시험 (가짜 Supabase · 가짜 Claude)

인터넷의 Supabase·Claude 없이, 로컬 Postgres 위에서 앱 전체를 브라우저로 눌러 보는 시험이에요.
가짜 서버(`fakebase/server.mjs`)가 Supabase Auth·REST(PostgREST)·Storage와 Claude Messages API를 흉내 내고,
REST 요청은 **로그인한 사람의 역할(authenticated)로 실제 Postgres에서 실행**해서 `schema.sql`의 GRANT·RLS가 그대로 적용돼요.
Claude 답은 정해진 예시(광합성 노트·문제)를 돌려줘요. 실제 키는 쓰지 않아요.

## 준비

- Postgres 15+ (`PGHOST`·`PGPORT`·`PGUSER`, 기본값 `/tmp` · `54329` · `postgres`)
- Node 20+, Python 3 + Playwright(Chromium)

## 실행

```bash
cd tools/local-e2e
bash db.sh setup                         # 처음 한 번
node fakebase/server.mjs                 # 가짜 백엔드 :54321 (다른 창에서 계속 켜 두기, 저장소 맨 위에서 npm install 먼저)
bash serve.sh                            # 앱 빌드 + :3000 (다른 창에서 계속 켜 두기)
python3 e2e.py                           # 가입 → 자료 넣기 → 노트·그림·문제 → 복습 → 오답 → 관리자 … (화면은 shots/ 에)
python3 e2e_fail.py                      # 처리 실패·환불·다시 하기, 비상 스위치, 다른 사람 자료 막기
```

로그인은 가짜 세션 쿠키로 대신해요(`student@example.com`, 관리자 `admin@example.com`, `other@example.com`).
`/__fail?task=quiz` 를 가짜 서버에 부르면 그 단계의 AI 호출이 529(바쁨)로 실패해요.
