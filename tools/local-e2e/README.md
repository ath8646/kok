# 로컬 끝-끝 시험 (가짜 Supabase · 가짜 Claude)

인터넷의 Supabase·Claude 없이, 로컬 Postgres 위에서 앱 전체를 브라우저로 눌러 보는 시험이에요.
가짜 서버(`fakebase/server.mjs`)가 Supabase Auth·REST(PostgREST)·Storage와 Claude Messages API를 흉내 내고,
REST 요청은 **로그인한 사람의 역할(authenticated)로 실제 Postgres에서 실행**해서 `schema.sql`의 GRANT·RLS가 그대로 적용돼요.
Claude 답은 정해진 예시(광합성 노트·문제)를 돌려줘요. 실제 키는 쓰지 않아요.

## 준비

- Postgres 15+ (`PGHOST`·`PGPORT`·`PGUSER`, 기본값 `/tmp` · `54329` · `postgres`). `db.sh setup` 은 Supabase 처럼 UTF8 데이터베이스를 만들어요
- Node 20+, Python 3 + Playwright(Chromium)

## 실행

```bash
cd tools/local-e2e
bash db.sh setup                         # 처음 한 번
node fakebase/server.mjs                 # 가짜 백엔드 :54321 (다른 창에서 계속 켜 두기, 저장소 맨 위에서 npm install 먼저)
bash serve.sh                            # 앱 빌드 + :3000 (다른 창에서 계속 켜 두기)
python3 e2e.py                           # 가입 → 자료 넣기 → 노트·그림·문제 → 복습 → 오답 → 관리자 … (화면은 shots/ 에)
python3 e2e_fail.py                      # 처리 실패·환불·다시 하기, 비상 스위치, 다른 사람 자료 막기
python3 e2e_term.py                      # 터미널 테마의 숨은 터미널만 (셸·./setting·nano·폰 키 줄)
python3 e2e_material.py                  # 자료 종류만 (입력창에서 고른 기출 → 원래 문제, 자동으로 고른 단어장 → 낱말 카드)
python3 e2e_relay.py                     # 이어 달리기가 끊겨도 잇는지만 (아무도 안 하는 자료·놓지 못한 잠금·세 번 멈춤·잠금 기다리기)
```

`e2e.py`·`e2e_fail.py` 는 `source env.sh` 한 창에서 돌려요 (매일 청소 시험이 `CRON_SECRET` 을 써요).

로그인은 가짜 세션 쿠키로 대신해요(`student@example.com`, 관리자 `admin@example.com`, `other@example.com`).
`/__fail?task=quiz` 를 가짜 서버에 부르면 그 단계의 AI 호출이 529(바쁨)로 실패해요.
`/__delay?task=organize&ms=1500` 은 그 일의 AI 답을 늦추고(`/__delay` 는 모두 처음대로), `/__stats` 의 `maxInflight` 에 일마다 같이 기다린 가장 많은 수가 남아요 (AI 를 같이 부르는지 확인).
