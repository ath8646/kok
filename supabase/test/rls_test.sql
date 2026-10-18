-- schema.sql 의 권한과 RLS를 로컬에서 시험한다. 실패하면 오류로 멈춘다.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_app_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', '{"provider": "google"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', '{"provider": "email"}')
on conflict do nothing;

-- 트리거가 profiles 를 만들었는지 (로그인 방법도 같이)
do $$ begin
  if (select count(*) from public.profiles) < 2 then raise exception 'profiles not created by trigger'; end if;
  if (select provider from public.profiles where id = '11111111-1111-1111-1111-111111111111') <> 'google' then
    raise exception 'provider not copied';
  end if;
end $$;

-- ---------- 사용자 A로 행동 ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.subjects (name) values ('과학');
do $$ begin
  if (select count(*) from public.subjects) <> 1 then raise exception 'A should see 1 subject'; end if;
end $$;

-- 닉네임 수정 가능
update public.profiles set nickname = '콕콕' where id = auth.uid();

-- 역할/요금제 수정은 막혀야 한다
do $$ begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'role update should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set plan = 'pro' where id = auth.uid();
    raise exception 'plan update should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 에너지 기록 직접 쓰기 막힘
do $$ begin
  begin
    insert into public.energy_ledger (user_id, task, energy) values (auth.uid(), 'hack', -1000);
    raise exception 'energy insert should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 자료 직접 만들기 막힘 (서버만)
do $$ begin
  begin
    insert into public.sources (user_id, subject_id, kind) select auth.uid(), id, 'text' from public.subjects limit 1;
    raise exception 'source insert should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 테스트 플랜 표는 학생이 볼 수 없고, 내 플랜 칸도 바꿀 수 없다
do $$ begin
  begin
    perform 1 from public.custom_plans;
    raise exception 'custom plans should be hidden';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set custom_plan_until = now() + interval '1 year' where id = auth.uid();
    raise exception 'custom plan update should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 서버 전용 함수 막힘
do $$ begin
  begin
    perform public.kok_redeem_coupon('X', auth.uid());
    raise exception 'coupon function should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 직접 만든 문제 + 카드 + 푼 기록
insert into public.questions (subject_id, type, prompt, answer)
  select id, 'ox', '물은 100도에서 끓는다', 'true'::jsonb from public.subjects limit 1;
insert into public.cards (question_id, subject_id)
  select q.id, q.subject_id from public.questions q limit 1;
insert into public.review_logs (question_id, rating, correct)
  select id, 3, true from public.questions limit 1;

-- 신고
insert into public.reports (target_type, reason) values ('other', '테스트 신고');

-- 파일: 학생은 직접 올리지 못한다 (내 폴더도). 서버가 준 주소로만 올린다
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('sources', '11111111-1111-1111-1111-111111111111/s1/a.pdf');
    raise exception 'direct upload should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('sources', '22222222-2222-2222-2222-222222222222/s1/a.pdf');
    raise exception 'foreign folder upload should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into storage.objects (bucket_id, name) values ('sources', '11111111-1111-1111-1111-111111111111/s1/a.pdf');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select count(*) from storage.objects) <> 1 then raise exception 'A should see own file'; end if;
  delete from storage.objects; -- 지우기 정책이 없으니 아무것도 안 지워진다
  if (select count(*) from storage.objects) <> 1 then raise exception 'A must not delete files directly'; end if;
end $$;

-- 서버만 쓰는 표는 보이지도 않는다
do $$ begin
  begin
    perform 1 from public.upload_tickets;
    raise exception 'upload_tickets should be hidden';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.account_tombstones;
    raise exception 'account_tombstones should be hidden';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- 사용자 B: A의 것이 안 보여야 한다 ----------
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  if (select count(*) from public.subjects) <> 0 then raise exception 'B must not see A subjects'; end if;
  if (select count(*) from public.questions) <> 0 then raise exception 'B must not see A questions'; end if;
  if (select count(*) from public.cards) <> 0 then raise exception 'B must not see A cards'; end if;
  if (select count(*) from public.review_logs) <> 0 then raise exception 'B must not see A logs'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'B must see only own profile'; end if;
  if (select count(*) from storage.objects) <> 0 then raise exception 'B must not see A files'; end if;
  if (select count(*) from public.app_settings) < 4 then raise exception 'settings should be readable'; end if;
end $$;

reset role;

-- ---------- 서버(service_role) ----------
set role service_role;
insert into public.coupons (code, days, max_uses) values ('TEST30', 30, 2);
select public.kok_redeem_coupon('test30', '11111111-1111-1111-1111-111111111111');
do $$ begin
  if (select plan from public.profiles where id = '11111111-1111-1111-1111-111111111111') <> 'pro' then
    raise exception 'coupon did not set pro';
  end if;
  begin
    perform public.kok_redeem_coupon('TEST30', '11111111-1111-1111-1111-111111111111');
    raise exception 'double redeem should fail';
  exception when raise_exception then
    if sqlerrm <> 'coupon_already_used' then raise; end if;
  end;
end $$;

-- 테스트 플랜 코드: Pro 는 건드리지 않고, 지금부터 정한 기간 동안 그 플랜
insert into public.custom_plans (id, name, energy_total, energy_daily, pdf_pages, images, text_chars, file_mb, careful)
  values ('44444444-4444-4444-4444-444444444444', '시험 플랜', 500, 100, 50, 10, 50000, 30, false);
insert into public.coupons (code, days, max_uses, plan_id) values ('TESTPLAN', 7, 1, '44444444-4444-4444-4444-444444444444');
select public.kok_redeem_coupon('testplan', '22222222-2222-2222-2222-222222222222');
do $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  if p.custom_plan_id is distinct from '44444444-4444-4444-4444-444444444444'::uuid then raise exception 'plan coupon did not set custom plan'; end if;
  if p.plan <> 'free' then raise exception 'plan coupon must not touch pro'; end if;
  if p.custom_plan_start is null or p.custom_plan_until < now() + interval '6 days 23 hours' or p.custom_plan_until > now() + interval '7 days 1 hour' then
    raise exception 'custom plan period wrong';
  end if;
  begin
    perform public.kok_redeem_coupon('TESTPLAN', '11111111-1111-1111-1111-111111111111');
    raise exception 'used up plan coupon should fail';
  exception when raise_exception then
    if sqlerrm <> 'coupon_used_up' then raise; end if;
  end;
end $$;
-- 플랜을 지우면 그 플랜의 코드도 지워지고, 쓰던 사람은 원래 플랜으로 돌아간다
delete from public.custom_plans where id = '44444444-4444-4444-4444-444444444444';
do $$ begin
  if exists (select 1 from public.coupons where code = 'TESTPLAN') then raise exception 'plan codes should go with the plan'; end if;
  if (select custom_plan_id from public.profiles where id = '22222222-2222-2222-2222-222222222222') is not null then raise exception 'custom plan should be cleared'; end if;
end $$;

insert into public.sources (user_id, subject_id, kind, text_content)
  select '11111111-1111-1111-1111-111111111111', id, 'text', 'hello' from public.subjects limit 1;
do $$
declare n int;
begin
  select count(*) into n from public.kok_claim_source((select id from public.sources limit 1), 60);
  if n <> 1 then raise exception 'first claim should succeed'; end if;
  select count(*) into n from public.kok_claim_source((select id from public.sources limit 1), 60);
  if n <> 0 then raise exception 'second claim should be locked'; end if;
end $$;

insert into public.energy_ledger (user_id, task, usd, energy, plan)
  values ('11111111-1111-1111-1111-111111111111', 'organize', 0.0123, 12.3, 'free');
do $$ begin
  if public.kok_energy_since('11111111-1111-1111-1111-111111111111', now() - interval '1 day') <> 12.3 then
    raise exception 'energy sum wrong';
  end if;
  if public.kok_free_usd_since(now() - interval '1 day') <> 0.0123 then raise exception 'free usd wrong'; end if;
  if not public.kok_hit_rate('11111111-1111-1111-1111-111111111111', 2, 60) then raise exception 'rate 1'; end if;
  if not public.kok_hit_rate('11111111-1111-1111-1111-111111111111', 2, 60) then raise exception 'rate 2'; end if;
  if public.kok_hit_rate('11111111-1111-1111-1111-111111111111', 2, 60) then raise exception 'rate 3 should block'; end if;
end $$;

select public.kok_admin_stats(now() - interval '30 days', now() - interval '1 day');

-- 자료 마무리 (노트·그림·문제·카드를 한 번에)
do $$
declare sid uuid; nid uuid; n int;
begin
  select id into sid from public.sources limit 1;
  nid := public.kok_finalize_source(sid, '광합성', '{"summary":"x"}'::jsonb,
    '[{"type":"mindmap","spec":{"root_label":"광합성","nodes":[]}}]'::jsonb,
    '[{"type":"mcq","prompt":"Q1","choices":["a","b","c","d"],"answer":1,"accepted":[],"explanation":"e","difficulty":"easy","pages":[1,2],"key_point_id":"k1"},
      {"type":"ox","prompt":"Q2","choices":null,"answer":true,"accepted":[],"explanation":"","difficulty":"medium","pages":[],"key_point_id":""}]'::jsonb,
    null);
  select count(*) into n from public.questions where note_id = nid;
  if n <> 2 then raise exception 'finalize questions: %', n; end if;
  select count(*) into n from public.cards c join public.questions q on q.id = c.question_id where q.note_id = nid;
  if n <> 2 then raise exception 'finalize cards: %', n; end if;
  if (select pages from public.questions where prompt = 'Q1') <> '{1,2}'::int[] then raise exception 'pages'; end if;
  -- 다시 실행해도 문제가 두 배가 되지 않는다
  nid := public.kok_finalize_source(sid, '광합성', '{}'::jsonb, '[]'::jsonb,
    '[{"type":"short","prompt":"Q3","answer":"산소","accepted":["O2"],"explanation":"","difficulty":"hard","pages":[3],"key_point_id":"k2"}]'::jsonb,
    null);
  select count(*) into n from public.questions where note_id = nid;
  if n <> 1 then raise exception 'rerun should replace, got %', n; end if;
  if (select status from public.sources where id = sid) <> 'ready' then raise exception 'status not ready'; end if;
  -- 더 만들기
  n := public.kok_add_questions(nid, '[{"type":"ox","prompt":"Q4","answer":false}]'::jsonb, false);
  if (select count(*) from public.questions where note_id = nid) <> 2 then raise exception 'add more'; end if;
end $$;
reset role;

-- 사용자 A는 노트·문제가 보이고, B는 안 보인다
select set_config('kok.a_note', (select id::text from public.notes where user_id = '11111111-1111-1111-1111-111111111111' limit 1), false);
select set_config('kok.a_question', (select id::text from public.questions where user_id = '11111111-1111-1111-1111-111111111111' limit 1), false);
select set_config('kok.a_subject', (select id::text from public.subjects where user_id = '11111111-1111-1111-1111-111111111111' limit 1), false);
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select count(*) from public.notes) <> 1 then raise exception 'A should see note'; end if;
  if (select count(*) from public.visuals) <> 1 then raise exception 'A should see visual'; end if;
  update public.notes set body = '{"summary":"edited"}'::jsonb;
  begin
    update public.notes set user_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'note owner change should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 자료: 보이는 칸만 읽고, 처리 중간 결과는 못 읽는다. 자료·과목·노트 지우기는 서버만
do $$ begin
  perform id, status, title, text_content, file_paths from public.sources;
  begin
    perform draft from public.sources;
    raise exception 'draft should not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform partials from public.sources;
    raise exception 'partials should not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.sources;
    raise exception 'source delete should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.subjects;
    raise exception 'subject delete should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.notes;
    raise exception 'note delete should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  if (select count(*) from public.notes) <> 0 then raise exception 'B must not see A note'; end if;
  if (select count(*) from public.visuals) <> 0 then raise exception 'B must not see A visual'; end if;
end $$;

-- B 는 A 의 노트·과목·문제 번호를 알아도 거기에 자기 문제·카드·기록을 붙이지 못한다
insert into public.subjects (name) values ('B과목');
do $$ begin
  begin
    insert into public.questions (subject_id, note_id, type, prompt, answer)
      select id, current_setting('kok.a_note')::uuid, 'ox', '남의 노트 읽기', 'true'::jsonb from public.subjects limit 1;
    raise exception 'foreign note link should be denied';
  exception when raise_exception then
    if sqlerrm not like 'kok_owner_mismatch%' then raise; end if;
  end;
  begin
    insert into public.questions (subject_id, type, prompt, answer)
      values (current_setting('kok.a_subject')::uuid, 'ox', '남의 과목', 'true'::jsonb);
    raise exception 'foreign subject link should be denied';
  exception when raise_exception then
    if sqlerrm not like 'kok_owner_mismatch%' then raise; end if;
  end;
  begin
    insert into public.cards (question_id, subject_id)
      select current_setting('kok.a_question')::uuid, id from public.subjects limit 1;
    raise exception 'foreign card should be denied';
  exception when raise_exception then
    if sqlerrm not like 'kok_owner_mismatch%' then raise; end if;
  end;
  begin
    insert into public.review_logs (question_id, rating, correct)
      values (current_setting('kok.a_question')::uuid, 3, true);
    raise exception 'foreign review log should be denied';
  exception when raise_exception then
    if sqlerrm not like 'kok_owner_mismatch%' then raise; end if;
  end;
  -- 내 과목에 내 문제는 된다
  insert into public.questions (subject_id, type, prompt, answer)
    select id, 'ox', 'B의 문제', 'false'::jsonb from public.subjects limit 1;
end $$;
reset role;

-- 공부한 날 함수: 내 기록만 센다, unit 고치기 가능
reset role;
insert into public.review_logs (user_id, question_id, rating, correct, reviewed_at)
select '11111111-1111-1111-1111-111111111111', id, 3, true, now() from public.questions
 where user_id = '11111111-1111-1111-1111-111111111111' limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select count(*) from public.kok_my_study_days(30)) <> 1 then raise exception 'A should have 1 study day'; end if;
  update public.sources set unit = '2. 광합성';
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  if (select count(*) from public.kok_my_study_days(30)) <> 0 then raise exception 'B must not see A study days'; end if;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.kok_my_study_days(30);
    raise exception 'anon must not call study days';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 행 수 제한: 학생이 하루에 신고를 101개 넣으면 막힌다
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$
declare i int;
begin
  for i in 1..100 loop
    insert into public.reports (target_type, reason) values ('other', 'test ' || i);
  end loop;
  begin
    insert into public.reports (target_type, reason) values ('other', 'one too many');
    raise exception 'row limit should block';
  exception when raise_exception then
    if sqlerrm not like 'kok_row_limit%' then raise; end if;
  end;
end $$;
reset role;
-- 서버(service_role)는 제한을 받지 않는다
set role service_role;
insert into public.reports (reporter_id, target_type, reason) values ('22222222-2222-2222-2222-222222222222', 'other', 'server insert');
reset role;

-- 자료 만들기: 동시에 정리하는 수와 에너지(정리 중인 것까지)를 한 번에 검사한다
set role service_role;
do $$
declare
  b uuid := '22222222-2222-2222-2222-222222222222';
  sub uuid;
  r jsonb;
  i int;
  ids uuid[] := array[]::uuid[];
  sid uuid;
  day_start timestamptz := now() - interval '1 hour';
  month_start timestamptz := now() - interval '20 days';
begin
  select id into sub from public.subjects where user_id = b limit 1;
  for i in 1..3 loop
    sid := gen_random_uuid();
    ids := ids || sid;
    r := public.kok_create_source(jsonb_build_object('id', sid, 'user_id', b, 'subject_id', sub, 'kind', 'text',
           'text_content', '광합성 정리 글입니다.', 'file_paths', '[]'::jsonb, 'energy_estimate', 5, 'chunk_total', 1,
           'model', 'claude-haiku-5-5', 'plan_at_start', 'free'), 4, day_start, 20, month_start, null);
    if r->>'result' <> 'ok' then raise exception 'create % failed: %', i, r; end if;
  end loop;
  if (select count(*) from public.sources where user_id = b and status = 'queued') <> 3 then raise exception 'queued count'; end if;
  -- 정리 중인 3개 x 5 = 15 를 미리 빼면 6 짜리는 한도 20 을 넘는다
  r := public.kok_create_source(jsonb_build_object('id', gen_random_uuid(), 'user_id', b, 'subject_id', sub, 'kind', 'text',
         'text_content', 'x', 'energy_estimate', 6), 4, day_start, 20, month_start, null);
  if r->>'result' <> 'no_energy' or (r->>'inflight')::numeric <> 15 then raise exception 'reservation: %', r; end if;
  -- 실제로 쓴 만큼은 예상에서 빠진다 (정리 중인 자료 하나가 2 를 썼다 → 13 + 쓴 2 = 15)
  insert into public.energy_ledger (user_id, task, usd, energy, plan, source_id) values (b, 'organize', 0.002, 2, 'free', ids[1]);
  if public.kok_inflight_energy(b) <> 13 then raise exception 'inflight after spend: %', public.kok_inflight_energy(b); end if;
  -- 5 짜리는 된다 (15 + 5 = 20)
  r := public.kok_create_source(jsonb_build_object('id', gen_random_uuid(), 'user_id', b, 'subject_id', sub, 'kind', 'text',
         'text_content', 'x', 'energy_estimate', 5), 4, day_start, 20, month_start, null);
  if r->>'result' <> 'ok' then raise exception 'fits exactly: %', r; end if;
  -- 동시에 정리하는 수 제한 (4개)
  r := public.kok_create_source(jsonb_build_object('id', gen_random_uuid(), 'user_id', b, 'subject_id', sub, 'kind', 'text',
         'text_content', 'x', 'energy_estimate', 0), 4, day_start, null, month_start, null);
  if r->>'result' <> 'too_many' then raise exception 'parallel limit: %', r; end if;
  -- 같은 번호는 다시 못 만든다
  r := public.kok_create_source(jsonb_build_object('id', ids[2], 'user_id', b, 'subject_id', sub, 'kind', 'text',
         'text_content', 'x', 'energy_estimate', 0), null, day_start, null, month_start, null);
  if r->>'result' <> 'duplicate' then raise exception 'duplicate: %', r; end if;

  -- 다시 하기: 실패한 자료만, 이미 쓴 만큼은 빼고 검사한다
  update public.sources set status = 'ready' where user_id = b and id <> ids[1];
  update public.sources set status = 'error', error = '실패' where id = ids[1];
  insert into public.energy_ledger (user_id, task, usd, energy, plan, source_id) values (b, 'refund', 0, -2, null, ids[1]);
  r := public.kok_retry_source(ids[1], b, 4, day_start, 2, month_start, null);
  if r->>'result' <> 'no_energy' or (r->>'need')::numeric <> 3 then raise exception 'retry energy: %', r; end if;
  r := public.kok_retry_source(ids[1], '11111111-1111-1111-1111-111111111111', 4, day_start, null, month_start, null);
  if r->>'result' <> 'not_found' then raise exception 'retry other user: %', r; end if;
  r := public.kok_retry_source(ids[1], b, 4, day_start, 20, month_start, null);
  if r->>'result' <> 'ok' then raise exception 'retry ok: %', r; end if;
  if (select status from public.sources where id = ids[1]) <> 'queued' then raise exception 'retry status'; end if;
  if (select draft->>'attempts' from public.sources where id = ids[1]) <> '0' then raise exception 'retry attempts'; end if;
  r := public.kok_retry_source(ids[1], b, 4, day_start, 20, month_start, null);
  if r->>'result' <> 'not_error' then raise exception 'retry twice: %', r; end if;
end $$;
reset role;

-- 문제를 지워도 푼 기록은 남는다 (연속 기록이 줄지 않게)
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare n int;
begin
  select count(*) into n from public.review_logs;
  delete from public.questions where prompt = '물은 100도에서 끓는다';
  if (select count(*) from public.review_logs) <> n then raise exception 'review logs should survive question delete'; end if;
  if (select count(*) from public.review_logs where question_id is null) < 1 then raise exception 'question_id should be null'; end if;
end $$;
reset role;

-- 탈퇴해도 비용 기록은 남는다 (누구 것인지만 지운다)
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'c@example.com');
insert into public.energy_ledger (user_id, task, usd, energy, plan) values ('33333333-3333-3333-3333-333333333333', 'organize', 0.5, 500, 'free');
do $$
declare before numeric;
begin
  before := public.kok_free_usd_since(now() - interval '1 day');
  delete from auth.users where id = '33333333-3333-3333-3333-333333333333';
  if exists (select 1 from public.profiles where id = '33333333-3333-3333-3333-333333333333') then raise exception 'profile should be gone'; end if;
  if public.kok_free_usd_since(now() - interval '1 day') <> before then raise exception 'free usd should stay after delete'; end if;
  if not exists (select 1 from public.energy_ledger where user_id is null and usd = 0.5) then raise exception 'ledger row should stay anonymous'; end if;
end $$;

select 'ALL RLS TESTS PASSED' as result;
