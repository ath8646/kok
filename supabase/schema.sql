-- =====================================================================
-- 콕 v0.1 데이터베이스
-- Supabase → SQL Editor → 새 쿼리에 이 파일 전체를 붙여 넣고 Run 하세요.
-- 여러 번 실행해도 안전해요 (이미 있는 것은 건너뛰거나 다시 만들어요).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
-- ---------------------------------------------------------------------
create or replace function public.kok_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles: 사용자 (auth.users 와 1:1)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  -- 처음 로그인한 방법 (google 등). 관리자 이메일 확인에 쓴다
  provider text,
  nickname text check (nickname is null or char_length(nickname) between 1 and 20),
  role text not null default 'user' check (role in ('user', 'admin')),
  plan text not null default 'free' check (plan in ('free', 'pro')),
  pro_until timestamptz,
  consented_at timestamptz,
  banned boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (pg_column_size(settings) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists provider text;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.kok_touch_updated_at();

-- 새 사용자가 처음 로그인하면 profiles 행을 자동으로 만든다
create or replace function public.kok_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, provider)
  values (new.id, new.email, new.raw_app_meta_data->>'provider')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- auth.users 는 Supabase 가 관리하는 표라서 트리거를 지우지 않고, 없을 때만 만든다
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'kok_on_auth_user_created' and tgrelid = 'auth.users'::regclass
  ) then
    create trigger kok_on_auth_user_created
      after insert on auth.users
      for each row execute function public.kok_handle_new_user();
  end if;
end $$;

-- 이미 가입한 사용자가 있으면 profiles 를 채운다
insert into public.profiles (id, email, provider)
select id, email, raw_app_meta_data->>'provider' from auth.users
on conflict (id) do nothing;
update public.profiles p
   set provider = u.raw_app_meta_data->>'provider'
  from auth.users u
 where u.id = p.id and p.provider is null and u.raw_app_meta_data->>'provider' is not null;

-- ---------------------------------------------------------------------
-- subjects: 과목
-- ---------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default 'blue' check (char_length(color) <= 20),
  exam_date date,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists subjects_user_idx on public.subjects (user_id, position);

-- ---------------------------------------------------------------------
-- sources: 넣은 자료와 AI 처리 상태
-- ---------------------------------------------------------------------
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null check (kind in ('text', 'pdf', 'image')),
  title text not null default '' check (char_length(title) <= 120),
  unit text not null default '' check (char_length(unit) <= 40),
  text_content text,
  file_paths text[] not null default '{}',
  page_count int,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'error')),
  step text not null default 'organize' check (step in ('organize', 'merge', 'visual', 'quiz', 'check', 'done')),
  progress int not null default 0 check (progress between 0 and 100),
  chunk_index int not null default 0,
  chunk_total int not null default 1,
  partials jsonb not null default '[]'::jsonb,
  draft jsonb not null default '{}'::jsonb,
  model text,
  plan_at_start text,
  energy_estimate numeric(10, 1) not null default 0,
  error text,
  locked_until timestamptz,
  files_expire_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 예전 버전으로 만든 표에도 단원 칸을 더한다
alter table public.sources add column if not exists unit text not null default '' check (char_length(unit) <= 40);
alter table public.sources add column if not exists energy_estimate numeric(10, 1) not null default 0;
create index if not exists sources_user_idx on public.sources (user_id, created_at desc);
create index if not exists sources_subject_idx on public.sources (subject_id);
create index if not exists sources_expire_idx on public.sources (files_expire_at) where files_expire_at is not null;

drop trigger if exists sources_touch on public.sources;
create trigger sources_touch before update on public.sources
  for each row execute function public.kok_touch_updated_at();

-- ---------------------------------------------------------------------
-- notes: AI 정리 노트 (자료 1개 = 노트 1개)
-- ---------------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null unique references public.sources(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  body jsonb not null default '{}'::jsonb check (pg_column_size(body) <= 524288),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, created_at desc);
create index if not exists notes_subject_idx on public.notes (subject_id);

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.kok_touch_updated_at();

-- ---------------------------------------------------------------------
-- visuals: 그림 설계도 (마인드맵, 표, 연표)
-- ---------------------------------------------------------------------
create table if not exists public.visuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  type text not null check (type in ('mindmap', 'table', 'timeline')),
  spec jsonb not null check (pg_column_size(spec) <= 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id, type)
);
create index if not exists visuals_user_idx on public.visuals (user_id);

drop trigger if exists visuals_touch on public.visuals;
create trigger visuals_touch before update on public.visuals
  for each row execute function public.kok_touch_updated_at();

-- ---------------------------------------------------------------------
-- questions: 문제
-- ---------------------------------------------------------------------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  key_point_id text,
  type text not null check (type in ('mcq', 'ox', 'cloze', 'short')),
  prompt text not null check (char_length(prompt) between 1 and 1000),
  choices jsonb check (choices is null or pg_column_size(choices) <= 8192),
  answer jsonb not null check (pg_column_size(answer) <= 2048),
  accepted jsonb not null default '[]'::jsonb check (pg_column_size(accepted) <= 4096),
  explanation text not null default '' check (char_length(explanation) <= 2000),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  pages int[] not null default '{}',
  created_by text not null default 'user' check (created_by in ('ai', 'user')),
  locked boolean not null default false,
  edited boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists questions_user_idx on public.questions (user_id, created_at desc);
create index if not exists questions_note_idx on public.questions (note_id);

drop trigger if exists questions_touch on public.questions;
create trigger questions_touch before update on public.questions
  for each row execute function public.kok_touch_updated_at();

-- ---------------------------------------------------------------------
-- cards: 문제마다 복습 상태 (FSRS)
-- ---------------------------------------------------------------------
create table if not exists public.cards (
  question_id uuid primary key references public.questions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  due timestamptz not null default now(),
  state smallint not null default 0,
  fsrs jsonb not null default '{}'::jsonb check (pg_column_size(fsrs) <= 2048),
  reps int not null default 0,
  lapses int not null default 0,
  last_review timestamptz,
  last_correct boolean,
  correct_streak int not null default 0,
  wrong_count int not null default 0,
  in_wrong_note boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.cards add column if not exists wrong_count int not null default 0;
create index if not exists cards_due_idx on public.cards (user_id, due);
create index if not exists cards_wrong_idx on public.cards (user_id) where in_wrong_note;

drop trigger if exists cards_touch on public.cards;
create trigger cards_touch before update on public.cards
  for each row execute function public.kok_touch_updated_at();

-- ---------------------------------------------------------------------
-- review_logs: 푼 기록
-- ---------------------------------------------------------------------
create table if not exists public.review_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- 문제를 지우거나 다시 만들어도 공부한 기록(연속 기록, 오늘 푼 수)은 남긴다
  question_id uuid references public.questions(id) on delete set null,
  subject_id uuid,
  rating smallint not null check (rating between 1 and 4),
  correct boolean not null,
  answer text check (answer is null or char_length(answer) <= 2000),
  ms int,
  reviewed_at timestamptz not null default now()
);
-- 예전 버전으로 만든 표도 같은 규칙으로 바꾼다
alter table public.review_logs alter column question_id drop not null;
alter table public.review_logs drop constraint if exists review_logs_question_id_fkey;
alter table public.review_logs add constraint review_logs_question_id_fkey
  foreign key (question_id) references public.questions(id) on delete set null;
create index if not exists review_logs_user_idx on public.review_logs (user_id, reviewed_at desc);
create index if not exists review_logs_question_idx on public.review_logs (question_id) where question_id is not null;

-- ---------------------------------------------------------------------
-- energy_ledger: 에너지 사용 기록 (서버만 쓴다)
-- ---------------------------------------------------------------------
create table if not exists public.energy_ledger (
  id bigint generated always as identity primary key,
  -- 탈퇴하면 누구 것인지만 지우고(null) 비용 기록은 남긴다 (무료 전체 한도·비용 관리)
  user_id uuid references auth.users(id) on delete set null,
  task text not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  usd numeric(12, 6) not null default 0,
  energy numeric(12, 3) not null default 0,
  plan text,
  source_id uuid,
  created_at timestamptz not null default now()
);
alter table public.energy_ledger alter column user_id drop not null;
alter table public.energy_ledger drop constraint if exists energy_ledger_user_id_fkey;
alter table public.energy_ledger add constraint energy_ledger_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
create index if not exists energy_user_time_idx on public.energy_ledger (user_id, created_at desc);
create index if not exists energy_time_idx on public.energy_ledger (created_at desc);
create index if not exists energy_source_idx on public.energy_ledger (source_id) where source_id is not null;

-- ---------------------------------------------------------------------
-- coupons: Pro 쿠폰 (서버만)
-- ---------------------------------------------------------------------
create table if not exists public.coupons (
  code text primary key,
  days int not null check (days > 0 and days <= 3650),
  max_uses int not null default 1 check (max_uses > 0),
  used int not null default 0,
  note text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.coupon_redemptions (
  code text not null references public.coupons(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

-- ---------------------------------------------------------------------
-- reports: "이상해요" 신고
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('question', 'note', 'visual', 'other')),
  target_id text check (target_id is null or char_length(target_id) <= 100),
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);

-- ---------------------------------------------------------------------
-- app_settings: 운영 설정 (관리자 화면에서 바꾼다)
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('limits', '{
    "freeDaily": 20, "proMonthly": 2000, "proDaily": 300,
    "freeMonthlyBudgetUsd": 10, "usdPerEnergy": 0.001,
    "pdfPagesFree": 20, "pdfPagesPro": 150,
    "imagesFree": 5, "imagesPro": 30,
    "textCharsFree": 20000, "textCharsPro": 100000,
    "fileMbFree": 10, "fileMbPro": 50,
    "ratePerMinute": 10, "freeFileDays": 7
  }'::jsonb),
  ('models', '{
    "fast": "claude-haiku-5-5",
    "careful": "claude-sonnet-5-5",
    "adminTest": "claude-opus-5-5",
    "effort": {"organize": "medium", "merge": "low", "visual": "low", "quiz": "medium", "check": "low", "grade": "low"}
  }'::jsonb),
  ('notice', '{"active": false, "text": ""}'::jsonb),
  ('ai_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- rate_hits: 분당 요청 제한 (서버만)
-- ---------------------------------------------------------------------
create table if not exists public.rate_hits (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'ai',
  at timestamptz not null default now()
);
alter table public.rate_hits add column if not exists kind text not null default 'ai';
drop index if exists public.rate_hits_idx;
create index if not exists rate_hits_kind_idx on public.rate_hits (user_id, kind, at desc);

-- ---------------------------------------------------------------------
-- upload_tickets: 서버가 준 파일 올리기 자리 (서버만). 정리를 시작하지 않은 파일은 나중에 지운다
-- ---------------------------------------------------------------------
create table if not exists public.upload_tickets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  path text not null check (char_length(path) <= 200),
  swept boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists upload_tickets_user_idx on public.upload_tickets (user_id, created_at desc);
create index if not exists upload_tickets_open_idx on public.upload_tickets (created_at) where not swept;

-- ---------------------------------------------------------------------
-- account_tombstones: 탈퇴한 이메일의 해시와 시각 (서버만, 2일 뒤 지운다).
-- 탈퇴하고 바로 다시 가입해 무료 에너지를 다시 받는 것을 막는다
-- ---------------------------------------------------------------------
create table if not exists public.account_tombstones (
  email_hash text primary key check (char_length(email_hash) <= 128),
  deleted_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 한 사람이 표를 끝없이 채우지 못하게 막는다 (학생이 직접 넣는 표만).
-- 서버(service_role)나 서버 함수가 넣을 때는 세지 않는다.
-- 인자: 최대 수, 사람 칸, (하루 단위면) 시각 칸
-- ---------------------------------------------------------------------
create or replace function public.kok_guard_rows()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n int;
  lim int := tg_argv[0]::int;
  who text := tg_argv[1];
  at_col text := case when tg_nargs > 2 then tg_argv[2] else null end;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if at_col is null then
    execute format('select count(*) from public.%I where %I = auth.uid()', tg_table_name, who) into n;
  else
    execute format('select count(*) from public.%I where %I = auth.uid() and %I > now() - interval ''1 day''', tg_table_name, who, at_col) into n;
  end if;
  if n >= lim then
    raise exception 'kok_row_limit: % (%)', tg_table_name, lim using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists subjects_guard on public.subjects;
create trigger subjects_guard before insert on public.subjects
  for each row execute function public.kok_guard_rows('100', 'user_id');
drop trigger if exists questions_guard on public.questions;
create trigger questions_guard before insert on public.questions
  for each row execute function public.kok_guard_rows('20000', 'user_id');
drop trigger if exists review_logs_guard on public.review_logs;
create trigger review_logs_guard before insert on public.review_logs
  for each row execute function public.kok_guard_rows('5000', 'user_id', 'reviewed_at');
drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before insert on public.reports
  for each row execute function public.kok_guard_rows('100', 'reporter_id', 'created_at');

-- ---------------------------------------------------------------------
-- 내 것끼리만 이어지게: 문제는 내 노트·과목에, 카드와 푼 기록은 내 문제에만 붙는다.
-- (남의 노트 번호를 적은 문제를 만들어 남의 노트를 AI로 읽어 내는 것을 막는다)
-- ---------------------------------------------------------------------
create or replace function public.kok_check_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'questions' then
    if new.note_id is not null
       and not exists (select 1 from public.notes n where n.id = new.note_id and n.user_id = new.user_id) then
      raise exception 'kok_owner_mismatch: note' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.subjects s where s.id = new.subject_id and s.user_id = new.user_id) then
      raise exception 'kok_owner_mismatch: subject' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'cards' then
    if not exists (select 1 from public.questions q where q.id = new.question_id and q.user_id = new.user_id) then
      raise exception 'kok_owner_mismatch: question' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.subjects s where s.id = new.subject_id and s.user_id = new.user_id) then
      raise exception 'kok_owner_mismatch: subject' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'review_logs' then
    if new.question_id is not null
       and not exists (select 1 from public.questions q where q.id = new.question_id and q.user_id = new.user_id) then
      raise exception 'kok_owner_mismatch: question' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists questions_owner on public.questions;
create trigger questions_owner before insert or update of user_id, note_id, subject_id on public.questions
  for each row execute function public.kok_check_owner();
drop trigger if exists cards_owner on public.cards;
create trigger cards_owner before insert or update of user_id, question_id, subject_id on public.cards
  for each row execute function public.kok_check_owner();
drop trigger if exists review_logs_owner on public.review_logs;
create trigger review_logs_owner before insert or update of user_id, question_id on public.review_logs
  for each row execute function public.kok_check_owner();

-- =====================================================================
-- 권한(GRANT): 로그인 안 한 사람(anon)은 아무것도 못 하고,
-- 로그인한 사람(authenticated)은 아래에 적은 것만 할 수 있다.
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;

revoke all on
  public.profiles, public.subjects, public.sources, public.notes, public.visuals,
  public.questions, public.cards, public.review_logs, public.energy_ledger,
  public.coupons, public.coupon_redemptions, public.reports, public.app_settings, public.rate_hits,
  public.upload_tickets, public.account_tombstones
from anon, authenticated;

grant all on
  public.profiles, public.subjects, public.sources, public.notes, public.visuals,
  public.questions, public.cards, public.review_logs, public.energy_ledger,
  public.coupons, public.coupon_redemptions, public.reports, public.app_settings, public.rate_hits,
  public.upload_tickets, public.account_tombstones
to service_role;
grant usage, select on all sequences in schema public to service_role;

-- profiles: 내 것만 보기, 닉네임·설정·동의 시각만 고치기
grant select on public.profiles to authenticated;
grant update (nickname, settings, consented_at) on public.profiles to authenticated;

-- 과목: 보기·만들기·고치기 (지우기는 올린 파일도 같이 지우는 서버가 한다)
grant select, insert, update on public.subjects to authenticated;
-- 문제·복습 상태: 내 것만 모두
grant select, insert, update, delete on public.questions to authenticated;
grant select, insert, update, delete on public.cards to authenticated;

-- 자료: 보기·제목 고치기 (만들기와 지우기는 서버가 한다).
-- 처리 중간 결과(partials, draft)는 보여 주지 않는다
grant select (
  id, user_id, subject_id, kind, title, unit, text_content, file_paths, page_count,
  status, step, progress, chunk_index, chunk_total, model, plan_at_start, energy_estimate,
  error, locked_until, files_expire_at, created_at, updated_at
) on public.sources to authenticated;
grant update (title, unit) on public.sources to authenticated;

-- 노트·그림: 보기, 고치기 (지우기는 자료를 지울 때 같이)
grant select on public.notes to authenticated;
grant update (title, body) on public.notes to authenticated;
grant select on public.visuals to authenticated;
grant update (spec) on public.visuals to authenticated;

-- 푼 기록: 보기, 쓰기
grant select, insert on public.review_logs to authenticated;
grant usage, select on sequence public.review_logs_id_seq to authenticated;

-- 에너지 기록: 보기만
grant select on public.energy_ledger to authenticated;

-- 신고: 쓰기, 내 신고 보기
grant select, insert on public.reports to authenticated;
grant usage, select on sequence public.reports_id_seq to authenticated;

-- 운영 설정: 보기만
grant select on public.app_settings to authenticated;

-- =====================================================================
-- RLS: 행마다 "내 것"인지 데이터베이스가 직접 검사한다
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.sources enable row level security;
alter table public.notes enable row level security;
alter table public.visuals enable row level security;
alter table public.questions enable row level security;
alter table public.cards enable row level security;
alter table public.review_logs enable row level security;
alter table public.energy_ledger enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.rate_hits enable row level security;
alter table public.upload_tickets enable row level security;
alter table public.account_tombstones enable row level security;

-- profiles
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- subjects
drop policy if exists "subjects: own" on public.subjects;
create policy "subjects: own" on public.subjects
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- sources
drop policy if exists "sources: read own" on public.sources;
create policy "sources: read own" on public.sources
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "sources: update own" on public.sources;
create policy "sources: update own" on public.sources
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- 지우기는 서버가 한다 (올린 파일도 같이 지워야 해서)
drop policy if exists "sources: delete own" on public.sources;

-- notes
drop policy if exists "notes: read own" on public.notes;
create policy "notes: read own" on public.notes
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notes: update own" on public.notes;
create policy "notes: update own" on public.notes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "notes: delete own" on public.notes;

-- visuals
drop policy if exists "visuals: read own" on public.visuals;
create policy "visuals: read own" on public.visuals
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "visuals: update own" on public.visuals;
create policy "visuals: update own" on public.visuals
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- questions
drop policy if exists "questions: own" on public.questions;
create policy "questions: own" on public.questions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- cards
drop policy if exists "cards: own" on public.cards;
create policy "cards: own" on public.cards
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- review_logs
drop policy if exists "review_logs: read own" on public.review_logs;
create policy "review_logs: read own" on public.review_logs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "review_logs: insert own" on public.review_logs;
create policy "review_logs: insert own" on public.review_logs
  for insert to authenticated with check (user_id = (select auth.uid()));

-- energy_ledger
drop policy if exists "energy: read own" on public.energy_ledger;
create policy "energy: read own" on public.energy_ledger
  for select to authenticated using (user_id = (select auth.uid()));

-- reports
drop policy if exists "reports: read own" on public.reports;
create policy "reports: read own" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));
drop policy if exists "reports: insert own" on public.reports;
create policy "reports: insert own" on public.reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));

-- app_settings
drop policy if exists "settings: read" on public.app_settings;
create policy "settings: read" on public.app_settings
  for select to authenticated using (true);

-- coupons, coupon_redemptions, rate_hits, upload_tickets, account_tombstones: 정책 없음 = 서버(비밀 키)만 사용

-- =====================================================================
-- 서버 전용 함수 (비밀 키로만 부를 수 있다)
-- =====================================================================

-- 자료 처리 잠금: 동시에 두 번 처리되지 않게 한다
create or replace function public.kok_claim_source(p_id uuid, p_seconds int)
returns setof public.sources
language sql
security definer
set search_path = public
as $$
  update public.sources
     set locked_until = now() + make_interval(secs => p_seconds),
         status = case when status = 'queued' then 'processing' else status end
   where id = p_id
     and status in ('queued', 'processing')
     and (locked_until is null or locked_until < now())
  returning *;
$$;

-- 에너지 합계
create or replace function public.kok_energy_since(p_user uuid, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(energy), 0) from public.energy_ledger
   where user_id = p_user and created_at >= p_since;
$$;

-- 무료 사용자 전체가 이번 달에 쓴 금액(달러)
create or replace function public.kok_free_usd_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(usd), 0) from public.energy_ledger
   where plan = 'free' and created_at >= p_since;
$$;

-- 분당 요청 제한: 한도 안이면 true (종류별로 따로 센다: AI 요청, 쿠폰 시도 등)
drop function if exists public.kok_hit_rate(uuid, int, int);
create or replace function public.kok_hit_rate(p_user uuid, p_max int, p_window_seconds int, p_kind text default 'ai')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  -- 같은 사람·같은 종류의 요청은 한 줄로 세운다 (동시에 보내도 한도를 넘지 않게)
  perform pg_advisory_xact_lock(hashtext('kok_rate:' || p_user::text || ':' || p_kind));
  delete from public.rate_hits
   where user_id = p_user and kind = p_kind and at < now() - make_interval(secs => p_window_seconds * 2);
  select count(*) into n from public.rate_hits
   where user_id = p_user and kind = p_kind and at >= now() - make_interval(secs => p_window_seconds);
  if n >= p_max then
    return false;
  end if;
  insert into public.rate_hits (user_id, kind) values (p_user, p_kind);
  return true;
end;
$$;

-- 정리 중인 자료가 앞으로 더 쓸 에너지 (예상 - 지금까지 쓴 것)
create or replace function public.kok_inflight_energy(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(greatest(0, s.energy_estimate - coalesce((
           select sum(e.energy) from public.energy_ledger e
            where e.source_id = s.id and e.user_id = p_user and e.energy > 0), 0))), 0)
    from public.sources s
   where s.user_id = p_user and s.status in ('queued', 'processing');
$$;

-- 자료 만들기: 동시에 정리하는 수와 에너지(정리 중인 것까지 미리 빼고)를 검사하고 행을 만든다.
-- 한 사람의 요청은 한 줄로 세워서, 동시에 여러 개를 보내도 한도를 넘지 않는다.
-- 한도가 null 이면 검사하지 않는다 (관리자).
create or replace function public.kok_create_source(
  p_row jsonb, p_max_parallel int,
  p_day_start timestamptz, p_day_limit numeric,
  p_month_start timestamptz, p_month_limit numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (p_row->>'user_id')::uuid;
  v_id uuid := (p_row->>'id')::uuid;
  v_est numeric := greatest(0, coalesce((p_row->>'energy_estimate')::numeric, 0));
  v_busy int;
  v_inflight numeric;
  v_used numeric;
begin
  perform pg_advisory_xact_lock(hashtext('kok_source:' || v_user::text));
  if exists (select 1 from public.sources where id = v_id) then
    return jsonb_build_object('result', 'duplicate');
  end if;
  select count(*) into v_busy from public.sources where user_id = v_user and status in ('queued', 'processing');
  if p_max_parallel is not null and v_busy >= p_max_parallel then
    return jsonb_build_object('result', 'too_many', 'busy', v_busy);
  end if;
  v_inflight := public.kok_inflight_energy(v_user);
  if p_day_limit is not null then
    v_used := public.kok_energy_since(v_user, p_day_start);
    if v_used + v_inflight + v_est > p_day_limit then
      return jsonb_build_object('result', 'no_energy', 'used', v_used, 'inflight', v_inflight, 'need', v_est, 'limit', p_day_limit, 'period', 'day');
    end if;
  end if;
  if p_month_limit is not null then
    v_used := public.kok_energy_since(v_user, p_month_start);
    if v_used + v_inflight + v_est > p_month_limit then
      return jsonb_build_object('result', 'no_energy', 'used', v_used, 'inflight', v_inflight, 'need', v_est, 'limit', p_month_limit, 'period', 'month');
    end if;
  end if;
  insert into public.sources (
    id, user_id, subject_id, kind, title, text_content, file_paths, page_count,
    status, step, progress, chunk_index, chunk_total, model, plan_at_start, energy_estimate
  ) values (
    v_id, v_user, (p_row->>'subject_id')::uuid, p_row->>'kind', left(coalesce(p_row->>'title', ''), 120),
    p_row->>'text_content',
    array(select jsonb_array_elements_text(coalesce(p_row->'file_paths', '[]'::jsonb))),
    nullif(p_row->>'page_count', '')::int,
    'queued', 'organize', 3, 0, greatest(1, coalesce(nullif(p_row->>'chunk_total', '')::int, 1)),
    p_row->>'model', p_row->>'plan_at_start', v_est
  );
  return jsonb_build_object('result', 'ok');
end;
$$;

-- 실패한 자료 다시 하기: 만들기와 같은 검사를 하고 '대기'로 돌린다.
-- 이미 끝낸 단계는 다시 하지 않으므로, 필요한 에너지는 예상에서 지금까지 쓴 만큼을 뺀 값(적어도 1)이다.
create or replace function public.kok_retry_source(
  p_id uuid, p_user uuid, p_max_parallel int,
  p_day_start timestamptz, p_day_limit numeric,
  p_month_start timestamptz, p_month_limit numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sources%rowtype;
  v_busy int;
  v_inflight numeric;
  v_need numeric;
  v_used numeric;
begin
  perform pg_advisory_xact_lock(hashtext('kok_source:' || p_user::text));
  select * into s from public.sources where id = p_id and user_id = p_user for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if s.status <> 'error' then
    return jsonb_build_object('result', 'not_error', 'status', s.status);
  end if;
  select count(*) into v_busy from public.sources where user_id = p_user and status in ('queued', 'processing');
  if p_max_parallel is not null and v_busy >= p_max_parallel then
    return jsonb_build_object('result', 'too_many', 'busy', v_busy);
  end if;
  v_inflight := public.kok_inflight_energy(p_user);
  v_need := greatest(1, s.energy_estimate - coalesce((
    select sum(e.energy) from public.energy_ledger e
     where e.source_id = s.id and e.user_id = p_user and e.energy > 0), 0));
  if p_day_limit is not null then
    v_used := public.kok_energy_since(p_user, p_day_start);
    if v_used + v_inflight + v_need > p_day_limit then
      return jsonb_build_object('result', 'no_energy', 'used', v_used, 'inflight', v_inflight, 'need', v_need, 'limit', p_day_limit, 'period', 'day');
    end if;
  end if;
  if p_month_limit is not null then
    v_used := public.kok_energy_since(p_user, p_month_start);
    if v_used + v_inflight + v_need > p_month_limit then
      return jsonb_build_object('result', 'no_energy', 'used', v_used, 'inflight', v_inflight, 'need', v_need, 'limit', p_month_limit, 'period', 'month');
    end if;
  end if;
  update public.sources
     set status = 'queued', error = null, locked_until = null,
         draft = coalesce(draft, '{}'::jsonb) || '{"attempts": 0}'::jsonb
   where id = s.id;
  return jsonb_build_object('result', 'ok', 'need', v_need);
end;
$$;

-- 쿠폰 사용: 한 번에 검사하고 Pro 기간을 늘린다
create or replace function public.kok_redeem_coupon(p_code text, p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.coupons%rowtype;
  new_until timestamptz;
begin
  select * into c from public.coupons where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'coupon_not_found';
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    raise exception 'coupon_expired';
  end if;
  if c.used >= c.max_uses then
    raise exception 'coupon_used_up';
  end if;
  if exists (select 1 from public.coupon_redemptions where code = c.code and user_id = p_user) then
    raise exception 'coupon_already_used';
  end if;

  insert into public.coupon_redemptions (code, user_id) values (c.code, p_user);
  update public.coupons set used = used + 1 where code = c.code;

  update public.profiles
     set plan = 'pro',
         pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(days => c.days)
   where id = p_user
  returning pro_until into new_until;

  return new_until;
end;
$$;

-- 관리자 화면 숫자
create or replace function public.kok_admin_stats(p_month_start timestamptz, p_day_start timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'pro_users', (select count(*) from public.profiles where plan = 'pro' and pro_until > now()),
    'active_today', (select count(distinct user_id) from public.review_logs where reviewed_at >= p_day_start),
    'usd_month', (select coalesce(sum(usd), 0) from public.energy_ledger where created_at >= p_month_start),
    'usd_month_free', (select coalesce(sum(usd), 0) from public.energy_ledger where created_at >= p_month_start and plan = 'free'),
    'usd_today', (select coalesce(sum(usd), 0) from public.energy_ledger where created_at >= p_day_start),
    'sources_month', (select count(*) from public.sources where created_at >= p_month_start),
    'open_reports', (select count(*) from public.reports where status = 'open')
  );
$$;

-- 문제 여러 개 넣기 (카드도 같이). p_replace 면 잠그지 않고 고치지 않은 AI 문제를 먼저 지운다
create or replace function public.kok_add_questions(p_note uuid, p_questions jsonb, p_replace boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.notes%rowtype;
  q jsonb;
  qid uuid;
  cnt int := 0;
begin
  select * into n from public.notes where id = p_note for update;
  if not found then
    raise exception 'note_not_found';
  end if;
  if p_replace then
    delete from public.questions
     where note_id = n.id and created_by = 'ai' and locked = false and edited = false;
  end if;
  for q in select * from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    insert into public.questions (
      user_id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted,
      explanation, difficulty, pages, created_by
    ) values (
      n.user_id, n.id, n.subject_id,
      nullif(q->>'key_point_id', ''),
      q->>'type',
      q->>'prompt',
      case when jsonb_typeof(q->'choices') = 'array' then q->'choices' else null end,
      q->'answer',
      case when jsonb_typeof(q->'accepted') = 'array' then q->'accepted' else '[]'::jsonb end,
      coalesce(q->>'explanation', ''),
      coalesce(q->>'difficulty', 'medium'),
      coalesce(
        (select array_agg(x::int) from jsonb_array_elements_text(
           case when jsonb_typeof(q->'pages') = 'array' then q->'pages' else '[]'::jsonb end) x),
        '{}'
      ),
      'ai'
    )
    returning id into qid;
    insert into public.cards (question_id, user_id, subject_id, due)
    values (qid, n.user_id, n.subject_id, now());
    cnt := cnt + 1;
  end loop;
  return cnt;
end;
$$;

-- 자료 처리 마무리: 노트·그림·문제를 한 번에 저장하고 자료를 '완료'로 바꾼다
create or replace function public.kok_finalize_source(
  p_source uuid, p_title text, p_note jsonb, p_visuals jsonb, p_questions jsonb, p_expire timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sources%rowtype;
  nid uuid;
  v jsonb;
begin
  select * into s from public.sources where id = p_source for update;
  if not found then
    raise exception 'source_not_found';
  end if;

  insert into public.notes (user_id, source_id, subject_id, title, body)
  values (s.user_id, s.id, s.subject_id, left(coalesce(nullif(trim(p_title), ''), s.title, ''), 120), p_note)
  on conflict (source_id) do update set title = excluded.title, body = excluded.body
  returning id into nid;

  for v in select * from jsonb_array_elements(coalesce(p_visuals, '[]'::jsonb)) loop
    insert into public.visuals (user_id, note_id, type, spec)
    values (s.user_id, nid, v->>'type', v->'spec')
    on conflict (note_id, type) do update set spec = excluded.spec;
  end loop;

  perform public.kok_add_questions(nid, p_questions, true);

  update public.sources
     set status = 'ready', step = 'done', progress = 100, error = null, locked_until = null,
         partials = '[]'::jsonb, draft = '{}'::jsonb, files_expire_at = p_expire,
         title = case when title = '' then left(coalesce(nullif(trim(p_title), ''), ''), 120) else title end,
         unit = case when unit = '' then left(coalesce(trim(p_note->>'unit'), ''), 40) else unit end
   where id = s.id;
  return nid;
end;
$$;

-- 내가 공부한 날 (한국 시간 날짜). 로그인한 사람의 권한으로 돈다 (RLS 적용)
create or replace function public.kok_my_study_days(p_days int)
returns setof date
language sql
stable
security invoker
set search_path = public
as $$
  select distinct (reviewed_at at time zone 'Asia/Seoul')::date
    from public.review_logs
   where user_id = (select auth.uid())
     and reviewed_at >= now() - make_interval(days => least(greatest(p_days, 1), 400))
   order by 1 desc;
$$;
revoke execute on function public.kok_my_study_days(int) from public, anon;
grant execute on function public.kok_my_study_days(int) to authenticated;

revoke execute on function public.kok_add_questions(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.kok_finalize_source(uuid, text, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.kok_add_questions(uuid, jsonb, boolean) to service_role;
grant execute on function public.kok_finalize_source(uuid, text, jsonb, jsonb, jsonb, timestamptz) to service_role;

revoke execute on function public.kok_claim_source(uuid, int) from public, anon, authenticated;
revoke execute on function public.kok_energy_since(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_free_usd_since(timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_hit_rate(uuid, int, int, text) from public, anon, authenticated;
revoke execute on function public.kok_redeem_coupon(text, uuid) from public, anon, authenticated;
revoke execute on function public.kok_admin_stats(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_handle_new_user() from public, anon, authenticated;
revoke execute on function public.kok_inflight_energy(uuid) from public, anon, authenticated;
revoke execute on function public.kok_create_source(jsonb, int, timestamptz, numeric, timestamptz, numeric) from public, anon, authenticated;
revoke execute on function public.kok_retry_source(uuid, uuid, int, timestamptz, numeric, timestamptz, numeric) from public, anon, authenticated;

grant execute on function public.kok_inflight_energy(uuid) to service_role;
grant execute on function public.kok_create_source(jsonb, int, timestamptz, numeric, timestamptz, numeric) to service_role;
grant execute on function public.kok_retry_source(uuid, uuid, int, timestamptz, numeric, timestamptz, numeric) to service_role;
grant execute on function public.kok_claim_source(uuid, int) to service_role;
grant execute on function public.kok_energy_since(uuid, timestamptz) to service_role;
grant execute on function public.kok_free_usd_since(timestamptz) to service_role;
grant execute on function public.kok_hit_rate(uuid, int, int, text) to service_role;
grant execute on function public.kok_redeem_coupon(text, uuid) to service_role;
grant execute on function public.kok_admin_stats(timestamptz, timestamptz) to service_role;

-- =====================================================================
-- 파일 저장소: 'sources' 버킷 (비공개).
-- 올리기는 서버가 검사하고 준 한 번짜리 주소로만 한다 (학생이 마음대로 올리거나 지우지 못한다).
-- 보기는 경로 첫 폴더가 내 id 일 때만.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources', 'sources', false, 52428800,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kok sources: upload own" on storage.objects;
drop policy if exists "kok sources: delete own" on storage.objects;

drop policy if exists "kok sources: read own" on storage.objects;
create policy "kok sources: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 끝! 아래에 "Success. No rows returned" 가 보이면 성공이에요.
