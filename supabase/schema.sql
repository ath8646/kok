-- =====================================================================
-- KOK v0.1 데이터베이스
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
  step text not null default 'organize' check (step in ('organize', 'merge', 'figures', 'visual', 'quiz', 'check', 'done')),
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
-- custom_plans: 관리자가 만드는 플랜 (시험용, 서버만).
-- 코드(쿠폰)로 나눠 주고, 코드를 쓴 때부터 코드에 정한 기간 동안 이 플랜이 적용된다.
-- 그동안은 Pro·무료 대신 이 플랜의 번개(에너지) 총량과 한도를 쓰고, 끝나면 원래 플랜으로 돌아간다.
-- ---------------------------------------------------------------------
create table if not exists public.custom_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  -- 기간 전체에 쓸 수 있는 번개(에너지) 총량, 하루 최대 (null = 하루 제한 없음)
  energy_total numeric(12, 1) not null check (energy_total >= 0 and energy_total <= 10000000),
  energy_daily numeric(12, 1) check (energy_daily is null or (energy_daily >= 0 and energy_daily <= 10000000)),
  pdf_pages int not null check (pdf_pages between 1 and 2000),
  images int not null check (images between 1 and 60),
  text_chars int not null check (text_chars between 100 and 200000),
  file_mb int not null check (file_mb between 1 and 5000),
  -- 꼼꼼 모델을 쓸 수 있는지
  careful boolean not null default true,
  note text check (note is null or char_length(note) <= 100),
  created_at timestamptz not null default now()
);

-- 사용자가 지금 쓰는 테스트 플랜 (코드를 쓴 시각부터 끝나는 시각까지). 학생은 보기만 한다
alter table public.profiles add column if not exists custom_plan_id uuid references public.custom_plans(id) on delete set null;
alter table public.profiles add column if not exists custom_plan_start timestamptz;
alter table public.profiles add column if not exists custom_plan_until timestamptz;

-- ---------------------------------------------------------------------
-- coupons: Pro·테스트 플랜 코드 (서버만)
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

-- 이 코드가 주는 플랜 (null = Pro). 플랜을 지우면 그 플랜의 코드도 지워진다
alter table public.coupons add column if not exists plan_id uuid references public.custom_plans(id) on delete cascade;

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
    "fileMbFree": 10, "fileMbPro": 200,
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
-- 노트에 자료 더하기와 버전 (Pro)
-- 더한 자료는 부모 자료(parent_id)를 가리키는 자료 행으로 처리하고, 끝나면 노트의 새 버전이 된다.
-- 자료함·목록에는 부모가 없는 자료만 보인다.
-- 지금 버전의 내용은 늘 notes·visuals·questions 에 있고, note_versions 에는 버전마다 그때의 정리·그림·문제 목록을 둔다.
-- 자료를 더하기 전의 노트는 버전 행이 없고 '버전 1'로 본다 (처음 더할 때 버전 1을 저장한다).
-- ---------------------------------------------------------------------
alter table public.sources add column if not exists parent_id uuid references public.sources(id) on delete cascade;
create index if not exists sources_parent_idx on public.sources (parent_id) where parent_id is not null;

alter table public.notes add column if not exists current_version int not null default 1;
-- 지금까지 만든 가장 큰 버전 번호. 버전을 지워도 번호를 다시 쓰지 않는다 (같은 번호가 다른 내용을 가리키지 않게)
alter table public.notes add column if not exists version_seq int not null default 0;

create table if not exists public.note_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  number int not null check (number >= 1),
  title text not null default '' check (char_length(title) <= 120),
  body jsonb not null default '{}'::jsonb check (pg_column_size(body) <= 524288),
  -- [{ type, spec }]
  visuals jsonb not null default '[]'::jsonb check (pg_column_size(visuals) <= 786432),
  question_ids uuid[] not null default '{}',
  -- 이 버전에 들어간 자료 [{ source_id, kind, title, page_count }]
  materials jsonb not null default '[]'::jsonb check (pg_column_size(materials) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id, number)
);
create index if not exists note_versions_user_idx on public.note_versions (user_id);

drop trigger if exists note_versions_touch on public.note_versions;
create trigger note_versions_touch before update on public.note_versions
  for each row execute function public.kok_touch_updated_at();

-- 버전이 생긴 까닭: first(처음 자료) · append(자료를 더함) · reorganize(합친 노트를 AI 로 다시 정리) · merge(다른 노트를 합침).
-- 예전 버전은 null (번호 1이면 처음 자료, 아니면 더한 자료로 본다). 학생은 읽기만 한다
alter table public.note_versions add column if not exists kind text;
-- 'merge' 가 없는 예전 검사만 바꾼다 (매번 바꾸면 표 전체를 잠그고 다시 검사한다)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.note_versions'::regclass and conname = 'note_versions_kind_check'
       and pg_get_constraintdef(oid) like '%merge%'
  ) then
    alter table public.note_versions drop constraint if exists note_versions_kind_check;
    alter table public.note_versions add constraint note_versions_kind_check
      check (kind is null or kind in ('first', 'append', 'reorganize', 'merge'));
  end if;
end $$;
-- 버전마다 그 버전의 문제가 가리키던 개념 번호 {문제 번호: 개념 번호 (null 이면 개념 없음)}.
-- 'AI로 다시 정리'는 문제의 개념 번호를 바꾸니까, 버전을 바꾸면 그 버전의 번호로 되돌린다. 예전 행은 null (되돌리지 않는다).
-- 지난 버전을 보며 문제의 개념을 바꾸면 화면이 그 버전 행의 qkeys 를 고친다 (지금 버전의 문제 행은 그대로)
alter table public.note_versions add column if not exists qkeys jsonb;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.note_versions'::regclass and conname = 'note_versions_qkeys_check'
       and pg_get_constraintdef(oid) like '%pg_column_size%'
  ) then
    alter table public.note_versions drop constraint if exists note_versions_qkeys_check;
    alter table public.note_versions add constraint note_versions_qkeys_check
      check (qkeys is null or (jsonb_typeof(qkeys) = 'object' and pg_column_size(qkeys) <= 262144));
  end if;
end $$;

-- version_seq 가 생기기 전에 만든 버전 번호도 다시 쓰지 않게 채운다 (모자란 노트만 한 번 바뀐다)
update public.notes n
   set version_seq = v.top
  from (select note_id, max(number) as top from public.note_versions group by note_id) v
 where v.note_id = n.id and n.version_seq < v.top;

-- 문제 상태 hidden: 지금 쓰는 버전에 없는 문제 (그 버전으로 바꾸면 돌아온다). 복습에는 active 만 나온다
alter table public.questions drop constraint if exists questions_status_check;
alter table public.questions add constraint questions_status_check check (status in ('active', 'suspended', 'hidden'));
-- 쉬게 한 문제(suspended)가 숨겨지면 여기에 남긴다: 그 문제가 있는 버전으로 돌아오면 다시 '쉬는 중'이 된다
alter table public.questions add column if not exists rested_hidden boolean not null default false;

-- ---------------------------------------------------------------------
-- chat_messages: 노트 채팅 (노트마다 저장, 쓰기는 서버만)
-- ---------------------------------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  model text,
  energy numeric(10, 3) not null default 0,
  -- AI 가 '넣을까요?' 하고 내민 것 { kind: 'questions' | 'note', ..., status: 'pending' | 'applied' | 'cancelled' }
  proposal jsonb check (proposal is null or pg_column_size(proposal) <= 65536),
  created_at timestamptz not null default now()
);
create index if not exists chat_note_idx on public.chat_messages (note_id, created_at);
create index if not exists chat_user_idx on public.chat_messages (user_id, created_at desc);
-- 채팅에 붙인 사진·파일 [{ kind, name, path? }] (path 는 Pro 만 보관: 내id/chat/자료id/…), AI 가 풀어 준 문제 { problem, steps, figure, question, subject, unit, saved? }
alter table public.chat_messages add column if not exists attachments jsonb check (attachments is null or pg_column_size(attachments) <= 8192);
alter table public.chat_messages add column if not exists solution jsonb check (solution is null or pg_column_size(solution) <= 65536);

-- 문제 그림(설계도: 좌표와 도형 목록, 그림은 앱이 그린다)과 단계 풀이 [{ text, add, focus }]. 예전 문제는 null
alter table public.questions add column if not exists figure jsonb check (figure is null or pg_column_size(figure) <= 32768);
alter table public.questions add column if not exists steps jsonb check (steps is null or pg_column_size(steps) <= 16384);
-- 자료 그림 문제: 문제에 붙은 자료 그림 한 장을 그대로 남긴다 { id, kind, title, caption, page, crop(원본에서 자른 그림 경로), w, h, art(KOK 스타일로 다시 그린 설계도, Pro) }
alter table public.questions add column if not exists source_figure jsonb check (source_figure is null or pg_column_size(source_figure) <= 65536);
-- 자료 처리 단계에 '그림 다시 그리기'(figures, Pro)를 더한다 (정리·합치기 다음, 그림 앞).
-- 이미 바꿨으면 건너뛴다 (다시 실행할 때마다 표 전체를 다시 검사하지 않게)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sources'::regclass and conname = 'sources_step_check'
       and pg_get_constraintdef(oid) like '%figures%'
  ) then
    alter table public.sources drop constraint if exists sources_step_check;
    alter table public.sources add constraint sources_step_check check (step in ('organize', 'merge', 'figures', 'visual', 'quiz', 'check', 'done'));
  end if;
end $$;

-- 테스트 플랜: 자료 더하기·테마·그림 풀이(문제 그림·단계 풀이)를 쓸 수 있는지
alter table public.custom_plans add column if not exists can_append boolean not null default false;
alter table public.custom_plans add column if not exists can_theme boolean not null default false;
alter table public.custom_plans add column if not exists can_figures boolean not null default false;

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
-- 테마 (Pro): 내가 만든 테마와 배경 그림. 쓰기는 서버만 (색·그림을 검사하고 넣는다), 읽기는 내 것만.
-- spec: { light: {bg, surface, accent}, dark: {...}, image: {kind:'file', id} | {kind:'pattern', svg} | null, dim, font, paper }
-- ---------------------------------------------------------------------
create table if not exists public.user_themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  spec jsonb not null check (pg_column_size(spec) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_themes_user_idx on public.user_themes (user_id, created_at);
drop trigger if exists user_themes_touch on public.user_themes;
create trigger user_themes_touch before update on public.user_themes
  for each row execute function public.kok_touch_updated_at();

-- 한 사람 테마는 20개까지 (서버가 넣을 때도: 동시에 여러 번 보내도 넘지 않게 한 사람씩 줄을 세운다)
create or replace function public.kok_guard_user_themes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('kok_themes:' || new.user_id::text));
  select count(*) into n from public.user_themes where user_id = new.user_id;
  if n >= 20 then
    raise exception 'kok_theme_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists user_themes_guard on public.user_themes;
create trigger user_themes_guard before insert on public.user_themes
  for each row execute function public.kok_guard_user_themes();

-- 배경 그림 파일 ('theme-images' 버킷의 내id/그림id.확장자). 올린 것(upload)과 AI 가 그린 것(ai)
create table if not exists public.theme_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('upload', 'ai')),
  path text not null check (char_length(path) <= 300),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes int not null check (bytes > 0),
  width int,
  height int,
  -- AI 그림을 다시 그릴 때 쓰는 프롬프트 (영어)
  prompt text check (prompt is null or char_length(prompt) <= 600),
  created_at timestamptz not null default now()
);
create index if not exists theme_images_user_idx on public.theme_images (user_id, created_at);

-- 서비스 전체의 하루 수 (예: AI 그림 무료 몫). 날짜는 UTC (Cloudflare 무료 몫이 UTC 0시에 다시 찬다). 서버만
create table if not exists public.app_counters (
  day date not null,
  kind text not null,
  n int not null default 0,
  primary key (day, kind)
);

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

-- ---------------------------------------------------------------------
-- 자료함 정리: 노트(자료)마다 복습에 넣을지(in_review), 별표(starred), 내가 정한 순서(position)
-- in_review 가 false 인 노트의 문제는 오늘 복습·기간 복습·오답 다시 풀기에 나오지 않는다 (노트에서 직접 푸는 것은 된다).
-- position 은 과목 안의 순서 (작을수록 앞, 비어 있으면 새 자료처럼 맨 앞). 별표한 자료가 늘 먼저다.
-- ---------------------------------------------------------------------
alter table public.sources add column if not exists in_review boolean not null default true;
alter table public.sources add column if not exists starred boolean not null default false;
alter table public.sources add column if not exists position int;

-- ---------------------------------------------------------------------
-- 과목 서랍 (과목이 많을 때): 위에 고정(pinned), 보관(archived: 자료함 '전체'·과목 칩·자료 넣기·복습 고르기 목록에서만 뺀다.
-- 그 과목의 복습 카드는 그대로 나온다), 최근 쓴 때(used_at: 자료를 넣으면 지금으로. 보관한 과목에 자료를 넣으면 보관도 푼다).
-- 학생은 과목 칸을 모두 고칠 수 있다 (과목 표는 내 것만 보기·만들기·고치기)
-- ---------------------------------------------------------------------
alter table public.subjects add column if not exists pinned boolean not null default false;
alter table public.subjects add column if not exists archived boolean not null default false;
alter table public.subjects add column if not exists used_at timestamptz;
-- 예전 과목: 마지막으로 자료를 넣은 때로 채운다 (빈 것만, 여러 번 실행해도 같다)
update public.subjects s
   set used_at = x.last
  from (select subject_id, max(created_at) as last from public.sources group by subject_id) x
 where s.id = x.subject_id
   and s.used_at is null;

create or replace function public.kok_touch_subject()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 같은 과목에 자료를 한꺼번에 넣어도 과목 행은 몇 초에 한 번만 고친다
  update public.subjects
     set used_at = now(), archived = false
   where id = new.subject_id
     and (used_at is null or used_at < now() - interval '10 seconds' or archived);
  return new;
end;
$$;
revoke execute on function public.kok_touch_subject() from public, anon, authenticated;
drop trigger if exists sources_touch_subject on public.sources;
create trigger sources_touch_subject after insert on public.sources
  for each row execute function public.kok_touch_subject();

-- =====================================================================
-- 권한(GRANT): 로그인 안 한 사람(anon)은 아무것도 못 하고,
-- 로그인한 사람(authenticated)은 아래에 적은 것만 할 수 있다.
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;

revoke all on
  public.profiles, public.subjects, public.sources, public.notes, public.visuals,
  public.questions, public.cards, public.review_logs, public.energy_ledger,
  public.coupons, public.coupon_redemptions, public.reports, public.app_settings, public.rate_hits,
  public.upload_tickets, public.account_tombstones, public.custom_plans,
  public.note_versions, public.chat_messages, public.user_themes, public.theme_images, public.app_counters
from anon, authenticated;

grant all on
  public.profiles, public.subjects, public.sources, public.notes, public.visuals,
  public.questions, public.cards, public.review_logs, public.energy_ledger,
  public.coupons, public.coupon_redemptions, public.reports, public.app_settings, public.rate_hits,
  public.upload_tickets, public.account_tombstones, public.custom_plans,
  public.note_versions, public.chat_messages, public.user_themes, public.theme_images, public.app_counters
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
  error, locked_until, files_expire_at, created_at, updated_at, parent_id,
  in_review, starred, position
) on public.sources to authenticated;
-- 자료함 정리(복습에 넣기·별표·순서)도 학생이 직접 고친다
grant update (title, unit, in_review, starred, position) on public.sources to authenticated;

-- 노트·그림: 보기, 고치기 (지우기는 자료를 지울 때 같이)
grant select on public.notes to authenticated;
grant update (title, body) on public.notes to authenticated;
grant select on public.visuals to authenticated;
grant update (spec) on public.visuals to authenticated;

-- 노트 버전: 보기, 지난 버전의 정리·그림·문제 목록 고치기 (만들기·바꾸기·지우기는 서버가 한다)
grant select on public.note_versions to authenticated;
grant update (title, body, visuals, question_ids) on public.note_versions to authenticated;
-- 지난 버전에서 문제의 개념 바꾸기 (지금 버전 행은 RLS 가 막는다). 칸이 없는 예전 DB 면 건너뛴다
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'note_versions' and column_name = 'qkeys') then
    grant update (qkeys) on public.note_versions to authenticated;
  end if;
end $$;

-- 노트 채팅: 보기, 지우기 (쓰기는 서버가 AI 답과 함께 한다)
grant select, delete on public.chat_messages to authenticated;

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

-- user_themes: 내 테마 읽기만 (만들기·고치기·지우기는 서버가 검사하고 한다). theme_images 는 서버만
grant select (id, user_id, name, spec, created_at, updated_at) on public.user_themes to authenticated;

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
alter table public.custom_plans enable row level security;
alter table public.note_versions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_themes enable row level security;
alter table public.theme_images enable row level security;
alter table public.app_counters enable row level security;

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

-- note_versions
drop policy if exists "note_versions: read own" on public.note_versions;
create policy "note_versions: read own" on public.note_versions
  for select to authenticated using (user_id = (select auth.uid()));
-- 지난 버전만 고칠 수 있다. 지금 버전의 행은 다음에 버전을 바꿀 때 노트로 다시 채워지므로 고쳐도 남지 않는다
-- (다른 기기에서 그 버전을 지금 버전으로 바꾼 뒤 예전 화면에서 고친 경우: 0행이 바뀌고 화면이 다시 읽는다)
drop policy if exists "note_versions: update own" on public.note_versions;
create policy "note_versions: update own" on public.note_versions
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and not exists (select 1 from public.notes n where n.id = note_versions.note_id and n.current_version = note_versions.number)
  )
  with check (user_id = (select auth.uid()));

-- chat_messages
drop policy if exists "chat: read own" on public.chat_messages;
create policy "chat: read own" on public.chat_messages
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "chat: delete own" on public.chat_messages;
create policy "chat: delete own" on public.chat_messages
  for delete to authenticated using (user_id = (select auth.uid()));

-- questions
drop policy if exists "user_themes: read own" on public.user_themes;
create policy "user_themes: read own" on public.user_themes
  for select to authenticated using (user_id = (select auth.uid()));

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

-- 서비스 전체의 하루 수를 하나 올린다 (오늘 p_max 에 닿았으면 올리지 않고 false). 날짜는 UTC
create or replace function public.kok_bump_counter(p_kind text, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_n int;
begin
  insert into public.app_counters as c (day, kind, n) values (v_day, p_kind, 1)
  on conflict (day, kind) do update set n = c.n + 1 where c.n < p_max
  returning n into v_n;
  -- 오래된 날은 지운다
  delete from public.app_counters where day < v_day - 7;
  return v_n is not null;
end;
$$;

-- 어느 테마도 쓰지 않는 배경 그림 행을 지우고 파일 경로를 돌려준다 (서버가 저장소에서 파일을 지운다).
-- p_before 보다 오래된 것만 (새로 올리고 아직 테마에 저장하지 않은 그림은 둔다), p_user 를 주면 그 사람 것만, 오래된 것부터 p_limit 개
create or replace function public.kok_take_unused_theme_images(p_before timestamptz, p_user uuid, p_limit int)
returns setof text
language sql
security definer
set search_path = public
as $$
  with gone as (
    select i.id
    from public.theme_images i
    where i.created_at < p_before
      and (p_user is null or i.user_id = p_user)
      and not exists (
        select 1 from public.user_themes t
        where t.user_id = i.user_id
          and t.spec -> 'image' ->> 'kind' = 'file'
          and t.spec -> 'image' ->> 'id' = i.id::text
      )
    order by i.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 1000))
    for update of i skip locked
  )
  delete from public.theme_images d using gone where d.id = gone.id
  returning d.path;
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
  -- 한 노트에는 자료를 하나씩 더한다 (버전이 차례대로 쌓이게)
  if nullif(p_row->>'parent_id', '') is not null
     and exists (select 1 from public.sources where parent_id = (p_row->>'parent_id')::uuid and status in ('queued', 'processing')) then
    return jsonb_build_object('result', 'append_busy');
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
    status, step, progress, chunk_index, chunk_total, model, plan_at_start, energy_estimate, parent_id
  ) values (
    v_id, v_user, (p_row->>'subject_id')::uuid, p_row->>'kind', left(coalesce(p_row->>'title', ''), 120),
    p_row->>'text_content',
    array(select jsonb_array_elements_text(coalesce(p_row->'file_paths', '[]'::jsonb))),
    nullif(p_row->>'page_count', '')::int,
    'queued', 'organize', 3, 0, greatest(1, coalesce(nullif(p_row->>'chunk_total', '')::int, 1)),
    p_row->>'model', p_row->>'plan_at_start', v_est, nullif(p_row->>'parent_id', '')::uuid
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
  -- 노트에 더하는 자료는 한 노트에 하나씩
  if s.parent_id is not null
     and exists (select 1 from public.sources where parent_id = s.parent_id and id <> s.id and status in ('queued', 'processing')) then
    return jsonb_build_object('result', 'append_busy');
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
         draft = coalesce(draft, '{}'::jsonb) || '{"attempts": 0, "remerged": 0}'::jsonb
   where id = s.id;
  return jsonb_build_object('result', 'ok', 'need', v_need);
end;
$$;

-- 쿠폰 사용: 한 번에 검사하고 Pro 또는 테스트 플랜을 켠다.
-- 테스트 플랜이 켜져 있는 동안 Pro 는 멈춘다:
--   * Pro 코드는 켜진 테스트 플랜이 끝난 뒤에 이어 붙인다
--   * 테스트 플랜 코드는 남은 Pro 기간을 플랜이 끝난 뒤로 미룬다 (Pro 가 숨어 있는 동안 줄지 않게)
--   * 다른 테스트 플랜이 켜져 있으면 p_replace 가 true 일 때만 바꾼다 ('plan_active')
-- 번개 총량은 테스트 플랜을 켠 때부터 새로 센다
drop function if exists public.kok_redeem_coupon(text, uuid);
create or replace function public.kok_redeem_coupon(p_code text, p_user uuid, p_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.coupons%rowtype;
  p public.profiles%rowtype;
  plan_end timestamptz;
  new_end timestamptz;
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

  select * into p from public.profiles where id = p_user for update;
  if not found then
    raise exception 'profile_not_found';
  end if;
  -- 지금 켜진 테스트 플랜이 끝나는 때 (없으면 지금)
  plan_end := case when p.custom_plan_id is not null and p.custom_plan_until > now() then p.custom_plan_until else now() end;
  if c.plan_id is not null and plan_end > now() and not coalesce(p_replace, false) then
    raise exception 'plan_active';
  end if;

  insert into public.coupon_redemptions (code, user_id) values (c.code, p_user);
  update public.coupons set used = used + 1 where code = c.code;

  if c.plan_id is null then
    update public.profiles
       set plan = 'pro',
           pro_until = greatest(coalesce(pro_until, now()), plan_end) + make_interval(days => c.days)
     where id = p_user
    returning * into p;
    return jsonb_build_object('kind', 'pro', 'until', p.pro_until, 'starts', plan_end);
  end if;

  new_end := now() + make_interval(days => c.days);
  update public.profiles
     set custom_plan_id = c.plan_id,
         custom_plan_start = now(),
         custom_plan_until = new_end,
         pro_until = case when plan = 'pro' and pro_until > plan_end then pro_until + (new_end - plan_end) else pro_until end
   where id = p_user
  returning * into p;
  return jsonb_build_object(
    'kind', 'custom',
    'until', new_end,
    'pro_until', case when p.plan = 'pro' and p.pro_until > new_end then p.pro_until end
  );
end;
$$;

-- 테스트 플랜을 지금 끝낸다 (한 사람 또는 한 플랜을 쓰는 모든 사람). 플랜 뒤로 미뤘던 Pro 는 다시 당긴다.
-- 끝난 시각은 custom_plan_until 에 남겨, 그 뒤의 무료·Pro 에너지를 플랜에서 쓴 것과 따로 센다
create or replace function public.kok_end_custom_plan(p_user uuid default null, p_plan uuid default null)
returns int
language sql
security definer
set search_path = public
as $$
  with ended as (
    update public.profiles
       set pro_until = case when plan = 'pro' and pro_until > custom_plan_until then pro_until - (custom_plan_until - now()) else pro_until end,
           custom_plan_id = null,
           custom_plan_until = now()
     where custom_plan_id is not null
       and custom_plan_until > now()
       and (p_user is not null or p_plan is not null)
       and (p_user is null or id = p_user)
       and (p_plan is null or custom_plan_id = p_plan)
    returning 1
  )
  select count(*)::int from ended;
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
    'custom_users', (select count(*) from public.profiles where custom_plan_id is not null and custom_plan_until > now()),
    'active_today', (select count(distinct user_id) from public.review_logs where reviewed_at >= p_day_start),
    'usd_month', (select coalesce(sum(usd), 0) from public.energy_ledger where created_at >= p_month_start),
    'usd_month_free', (select coalesce(sum(usd), 0) from public.energy_ledger where created_at >= p_month_start and plan = 'free'),
    'usd_today', (select coalesce(sum(usd), 0) from public.energy_ledger where created_at >= p_day_start),
    'sources_month', (select count(*) from public.sources where created_at >= p_month_start),
    'open_reports', (select count(*) from public.reports where status = 'open')
  );
$$;

-- 문제 여러 개 넣기 (카드도 같이). p_replace 면 잠그지 않고 고치지 않은 AI 문제를 먼저 지운다.
-- 지난 버전에 들어 있는 문제는 지우지 않고 숨긴다 (그 버전으로 돌아가면 다시 나온다. 쉬게 한 문제는 다시 '쉬는 중')
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
    update public.questions q set status = 'hidden', rested_hidden = (q.status = 'suspended')
     where q.note_id = n.id and q.created_by = 'ai' and q.locked = false and q.edited = false and q.status <> 'hidden'
       and exists (select 1 from public.note_versions v
                    where v.note_id = n.id and v.number <> n.current_version and q.id = any(v.question_ids));
    delete from public.questions
     where note_id = n.id and created_by = 'ai' and locked = false and edited = false and status <> 'hidden';
  end if;
  for q in select * from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    insert into public.questions (
      user_id, note_id, subject_id, key_point_id, type, prompt, choices, answer, accepted,
      explanation, difficulty, pages, created_by, figure, steps, source_figure
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
      'ai',
      -- 그림·단계 풀이 (Pro 가 노트를 만들 때). 없거나 칸 한도보다 크면 null (풀이 때문에 노트 저장이 멈추지 않게)
      case when jsonb_typeof(q->'figure') = 'object' and pg_column_size(q->'figure') <= 32768 then q->'figure' else null end,
      case when jsonb_typeof(q->'steps') = 'array' and jsonb_array_length(q->'steps') > 0 and pg_column_size(q->'steps') <= 16384
           then q->'steps' else null end,
      -- 자료 그림 문제의 그림. 없거나 칸 한도보다 크면 null
      case when jsonb_typeof(q->'source_figure') = 'object' and pg_column_size(q->'source_figure') <= 65536 then q->'source_figure' else null end
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

-- ---------------------------------------------------------------------
-- 노트 버전 (서버 전용)
-- ---------------------------------------------------------------------
-- 지금 버전 문제들이 가리키는 개념 번호 {문제 번호: 개념 번호} (note_versions.qkeys).
-- 칸 한도보다 크면 null (그 버전은 되돌리지 않는다: 버전 저장이 멈추지 않게)
create or replace function public.kok_note_qkeys(p_note uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when pg_column_size(m) <= 262144 then m end
    from (
      select coalesce(jsonb_object_agg(q.id::text, q.key_point_id), '{}'::jsonb) as m
        from public.questions q
       where q.note_id = p_note and q.status <> 'hidden'
    ) x;
$$;

-- 버전 자료 목록에서 '이 버전에 새로 들어온 자료' 표시(added)를 뗀다 (새 버전으로 옮겨 적을 때)
create or replace function public.kok_strip_added(p jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'added' else e end order by i), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as t(e, i);
$$;

-- 지금 노트(notes·visuals·questions)를 지금 버전 행에 저장한다. 버전 행이 하나도 없으면 버전 1을 만든다
create or replace function public.kok_note_snapshot(p_note uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.notes%rowtype;
  v_visuals jsonb;
  v_qids uuid[];
  v_qkeys jsonb;
  v_materials jsonb;
  v_first boolean;
begin
  select * into n from public.notes where id = p_note;
  if not found then
    raise exception 'note_not_found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'spec', spec) order by type), '[]'::jsonb)
    into v_visuals from public.visuals where note_id = n.id;
  select coalesce(array_agg(id order by created_at, id), '{}')
    into v_qids from public.questions where note_id = n.id and status <> 'hidden';
  v_qkeys := public.kok_note_qkeys(n.id);
  update public.note_versions
     set title = n.title, body = n.body, visuals = v_visuals, question_ids = v_qids, qkeys = v_qkeys
   where note_id = n.id and number = n.current_version;
  if not found then
    -- 처음 버전을 만들 때 (자료를 처음 더하거나 AI 로 다시 정리할 때): 지금 노트가 버전 1.
    -- 자료는 처음 넣은 자료와, 노트를 합쳐서 들어온 자료 (정리를 마친 더한 자료. 지금 더하는 자료는 아직 정리 중이라 빠진다)
    v_first := not exists (select 1 from public.note_versions where note_id = n.id);
    if v_first then
      select coalesce(jsonb_agg(jsonb_build_object('source_id', x.id, 'kind', x.kind, 'title', x.title, 'page_count', x.page_count)
                                order by (x.id = n.source_id) desc, x.created_at, x.id), '[]'::jsonb)
        into v_materials
        from public.sources x
       where x.id = n.source_id or (x.parent_id = n.source_id and x.status = 'ready');
    else
      v_materials := '[]'::jsonb;
    end if;
    insert into public.note_versions (user_id, note_id, number, title, body, visuals, question_ids, qkeys, materials, kind)
    values (n.user_id, n.id, n.current_version, n.title, n.body, v_visuals, v_qids, v_qkeys, v_materials, case when v_first then 'first' end);
  end if;
end;
$$;

-- 자료를 더할 때 합치는 바탕이 된 노트의 지문: 정리 내용(보기 설정·추천 그림 빼고)과 마인드맵.
-- 합친 뒤에 노트가 바뀌었는지(다른 버전으로 바뀜, 학생이 고침) 알아본다. 같은 내용이면 같은 값이다
create or replace function public.kok_note_base(p_note uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(
    coalesce((select (n.body - 'view' - 'recommended')::text from public.notes n where n.id = p_note), '')
    || '|' ||
    coalesce((select v.spec::text from public.visuals v where v.note_id = p_note and v.type = 'mindmap'), '')
  );
$$;

-- 합칠 때 읽을 노트: 내용과 그 지문을 한 번에 (사이에 바뀌지 않게)
create or replace function public.kok_note_for_merge(p_source uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', n.id, 'body', n.body, 'base', public.kok_note_base(n.id))
    from public.notes n where n.source_id = p_source;
$$;

-- 더한 자료의 정리를 마치면: 지금 버전을 저장하고, 합친 노트를 새 버전으로 만들어 지금 버전으로 쓴다.
-- 기존 문제와 복습 기록은 그대로 두고 새 문제만 더한다. 새 버전 번호는 지운 번호도 다시 쓰지 않는다.
-- p_base: 합칠 때 쓴 노트의 지문(kok_note_base). 그 뒤에 노트가 바뀌었으면(실패한 자료를 나중에 다시 하기 등)
-- 저장하지 않고 'stale_base' 를 낸다. 서버가 지금 노트에 다시 합친다
drop function if exists public.kok_finalize_append(uuid, jsonb, jsonb, jsonb, timestamptz);
drop function if exists public.kok_finalize_append(uuid, jsonb, jsonb, jsonb, timestamptz, int);
create or replace function public.kok_finalize_append(
  p_child uuid, p_note jsonb, p_visuals jsonb, p_questions jsonb, p_expire timestamptz, p_base text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.sources%rowtype;
  n public.notes%rowtype;
  v jsonb;
  v_no int;
  v_materials jsonb;
  v_visuals jsonb;
  v_qids uuid[];
begin
  select * into c from public.sources where id = p_child for update;
  if not found or c.parent_id is null then
    raise exception 'source_not_found';
  end if;
  select * into n from public.notes where source_id = c.parent_id for update;
  if not found then
    raise exception 'note_not_found';
  end if;
  -- 그림 행도 잠근다: 지문을 확인한 뒤 지금 버전을 저장하기 전에 그림을 고치면 어느 버전에도 남지 않으니까
  perform 1 from public.visuals where note_id = n.id for update;
  if p_base is not null and public.kok_note_base(n.id) <> p_base then
    raise exception 'stale_base';
  end if;

  perform public.kok_note_snapshot(n.id);
  select greatest(coalesce(max(number), 0), n.version_seq, n.current_version) + 1 into v_no from public.note_versions where note_id = n.id;
  select materials into v_materials from public.note_versions where note_id = n.id and number = n.current_version;
  -- 새 버전의 자료 = 지금 버전의 자료 + 이번에 더한 자료 (added: 버전 기록에 '더한 자료'로 보인다)
  v_materials := public.kok_strip_added(v_materials)
    || jsonb_build_array(jsonb_build_object('source_id', c.id, 'kind', c.kind, 'title', c.title, 'page_count', c.page_count, 'added', true));

  update public.notes set body = p_note, current_version = v_no, version_seq = v_no where id = n.id;
  delete from public.visuals where note_id = n.id;
  for v in select * from jsonb_array_elements(coalesce(p_visuals, '[]'::jsonb)) loop
    insert into public.visuals (user_id, note_id, type, spec) values (n.user_id, n.id, v->>'type', v->'spec');
  end loop;
  perform public.kok_add_questions(n.id, p_questions, false);

  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'spec', spec) order by type), '[]'::jsonb)
    into v_visuals from public.visuals where note_id = n.id;
  select coalesce(array_agg(id order by created_at, id), '{}')
    into v_qids from public.questions where note_id = n.id and status <> 'hidden';
  insert into public.note_versions (user_id, note_id, number, title, body, visuals, question_ids, qkeys, materials, kind)
  values (n.user_id, n.id, v_no, n.title, p_note, v_visuals, v_qids, public.kok_note_qkeys(n.id), v_materials, 'append');

  update public.sources
     set status = 'ready', step = 'done', progress = 100, error = null, locked_until = null,
         partials = '[]'::jsonb, draft = '{}'::jsonb, files_expire_at = p_expire
   where id = c.id;
  return v_no;
end;
$$;

-- 버전 바꾸기: 지금 노트를 저장하고, 고른 버전의 정리·그림을 꺼내고, 그 버전에 없는 문제는 숨긴다(hidden).
-- 쉬게 한 문제(suspended)도 그 버전에 없으면 숨기고(rested_hidden), 돌아오면 다시 '쉬는 중'으로 둔다
create or replace function public.kok_switch_version(p_note uuid, p_user uuid, p_number int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.notes%rowtype;
  t public.note_versions%rowtype;
  v jsonb;
begin
  select * into n from public.notes where id = p_note and user_id = p_user for update;
  if not found then
    raise exception 'note_not_found';
  end if;
  if exists (select 1 from public.sources where parent_id = n.source_id and status in ('queued', 'processing')) then
    raise exception 'append_running';
  end if;
  if p_number = n.current_version then
    return p_number;
  end if;
  select * into t from public.note_versions where note_id = n.id and number = p_number;
  if not found then
    raise exception 'version_not_found';
  end if;
  perform public.kok_note_snapshot(n.id);

  update public.notes
     set body = t.body, current_version = p_number, title = case when t.title <> '' then t.title else title end
   where id = n.id;
  delete from public.visuals where note_id = n.id;
  for v in select * from jsonb_array_elements(coalesce(t.visuals, '[]'::jsonb)) loop
    insert into public.visuals (user_id, note_id, type, spec) values (n.user_id, n.id, v->>'type', v->'spec');
  end loop;
  update public.questions set status = 'hidden', rested_hidden = (status = 'suspended')
   where note_id = n.id and status in ('active', 'suspended') and not (id = any(t.question_ids));
  update public.questions set status = case when rested_hidden then 'suspended' else 'active' end, rested_hidden = false
   where note_id = n.id and status = 'hidden' and id = any(t.question_ids);
  -- 그 버전의 문제가 가리키던 개념 번호로 ('AI로 다시 정리'가 바꾼 번호를 되돌린다. qkeys 가 없는 예전 행은 그대로)
  if t.qkeys is not null then
    update public.questions q
       set key_point_id = t.qkeys->>(q.id::text)
     where q.note_id = n.id and q.id = any(t.question_ids) and t.qkeys ? (q.id::text)
       and q.key_point_id is distinct from t.qkeys->>(q.id::text);
  end if;
  return p_number;
end;
$$;

-- 버전 지우기: 지금 버전이면 가장 최근의 다른 버전으로 바꾼 뒤 지운다. 마지막 하나는 지울 수 없다.
-- 어느 버전에도 없는 숨긴 문제와, 어느 버전에도 안 쓰이는 더한 자료는 지운다 (지울 파일 경로를 돌려준다)
create or replace function public.kok_delete_version(p_note uuid, p_user uuid, p_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.notes%rowtype;
  v_other int;
  v_paths text[];
  v_gone uuid[];
begin
  select * into n from public.notes where id = p_note and user_id = p_user for update;
  if not found then
    raise exception 'note_not_found';
  end if;
  if exists (select 1 from public.sources where parent_id = n.source_id and status in ('queued', 'processing')) then
    raise exception 'append_running';
  end if;
  if not exists (select 1 from public.note_versions where note_id = n.id and number = p_number) then
    raise exception 'version_not_found';
  end if;
  -- 지운 번호를 다시 쓰지 않게, 지우기 전에 지금까지 쓴 가장 큰 번호를 남긴다 (version_seq 가 생기기 전에 만든 버전도)
  update public.notes
     set version_seq = greatest(version_seq, current_version, (select max(number) from public.note_versions where note_id = n.id))
   where id = n.id
     and version_seq < greatest(current_version, (select max(number) from public.note_versions where note_id = n.id));
  select max(number) into v_other from public.note_versions where note_id = n.id and number <> p_number;
  if v_other is null then
    raise exception 'last_version';
  end if;
  if n.current_version = p_number then
    perform public.kok_switch_version(n.id, p_user, v_other);
  end if;
  delete from public.note_versions where note_id = n.id and number = p_number;

  -- 어느 버전에도 없는 숨긴 문제 (카드는 문제와 함께 지워진다)
  delete from public.questions q
   where q.note_id = n.id and q.status = 'hidden'
     and not exists (select 1 from public.note_versions v where v.note_id = n.id and q.id = any(v.question_ids));

  -- 어느 버전에도 안 쓰이는, 정리를 마친 더한 자료 (처음 넣은 자료는 노트와 함께 남는다)
  select coalesce(array_agg(fp), '{}') into v_paths
    from public.sources s, unnest(s.file_paths) fp
   where s.parent_id = n.source_id and s.status = 'ready'
     and not exists (select 1 from public.note_versions v, jsonb_array_elements(v.materials) m
                      where v.note_id = n.id and m->>'source_id' = s.id::text);
  -- 지운 더한 자료 번호도 돌려준다 (자료 그림을 잘라 둔 폴더 {user_id}/figs/{자료 id}/ 를 서버가 지운다)
  with gone as (
    delete from public.sources s
     where s.parent_id = n.source_id and s.status = 'ready'
       and not exists (select 1 from public.note_versions v, jsonb_array_elements(v.materials) m
                        where v.note_id = n.id and m->>'source_id' = s.id::text)
    returning s.id
  )
  select coalesce(array_agg(id), '{}') into v_gone from gone;
  return jsonb_build_object(
    'paths', to_jsonb(v_paths),
    'sources', to_jsonb(v_gone),
    'current', (select current_version from public.notes where id = n.id)
  );
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

-- 자료함 순서 바꾸기: 받은 순서대로 position 을 0, 1, 2 … 로 (내 자료만, 2000개까지).
-- 로그인한 사람의 권한으로 돌아서 RLS 와 칸 권한(position)이 그대로 적용된다
create or replace function public.kok_reorder_sources(p_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.sources s
     set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id
     and s.user_id = (select auth.uid())
     and cardinality(p_ids) <= 2000;
$$;
revoke execute on function public.kok_reorder_sources(uuid[]) from public, anon;
grant execute on function public.kok_reorder_sources(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 자료함 정리 2: 고정한 과목의 순서, 자료 옮기기, 과목 합치기, 노트 합치기, 합친 노트를 AI 로 다시 정리
-- ---------------------------------------------------------------------

-- 과목 순서 바꾸기 (고정한 과목을 꾹 눌러 끌어서): 받은 순서대로 position 을 0, 1, 2 … 로 (내 과목만, 500개까지).
-- 로그인한 사람의 권한으로 돌아서 RLS 가 그대로 적용된다
create or replace function public.kok_reorder_subjects(p_ids uuid[])
returns void
language sql
security invoker
set search_path = public
as $$
  update public.subjects s
     set position = o.ord - 1
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id
     and s.user_id = (select auth.uid())
     and cardinality(p_ids) <= 500;
$$;
revoke execute on function public.kok_reorder_subjects(uuid[]) from public, anon;
grant execute on function public.kok_reorder_subjects(uuid[]) to authenticated, service_role;

-- 자료 옮기기 (서버 전용): 내 자료(처음 넣은 자료)를 다른 내 과목으로. 더한 자료·노트·문제·복습 카드·푼 기록의 과목도 같이 바꾼다.
-- 옮긴 자료는 새 과목에서 새 자료처럼 맨 앞에 온다 (내가 정한 순서 position 을 비운다). 보관한 과목으로 옮기면 보관을 푼다.
-- 정리 중인 자료도 옮길 수 있다 (노트는 마무리할 때의 과목에 만들어진다). 옮긴 자료 수를 돌려준다
create or replace function public.kok_move_sources(p_user uuid, p_ids uuid[], p_subject uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_top uuid[];
  v_notes uuid[];
begin
  if p_ids is null or cardinality(p_ids) > 500 then
    raise exception 'too_many';
  end if;
  if not exists (select 1 from public.subjects where id = p_subject and user_id = p_user) then
    raise exception 'subject_not_found';
  end if;
  -- 처음 넣은 자료만 (더한 자료는 노트를 따라간다). 이미 그 과목에 있는 것은 그대로
  select coalesce(array_agg(s.id), '{}') into v_top
    from public.sources s
   where s.id = any(p_ids) and s.user_id = p_user and s.parent_id is null and s.subject_id <> p_subject;
  if cardinality(v_top) = 0 then
    return 0;
  end if;
  update public.sources set subject_id = p_subject, position = null where id = any(v_top);
  update public.sources set subject_id = p_subject where parent_id = any(v_top) and user_id = p_user;
  select coalesce(array_agg(n.id), '{}') into v_notes from public.notes n where n.source_id = any(v_top);
  update public.notes set subject_id = p_subject where id = any(v_notes);
  update public.questions set subject_id = p_subject where note_id = any(v_notes);
  update public.cards c set subject_id = p_subject
    from public.questions q
   where q.id = c.question_id and q.note_id = any(v_notes) and c.subject_id <> p_subject;
  update public.review_logs r set subject_id = p_subject
    from public.questions q
   where q.id = r.question_id and q.note_id = any(v_notes);
  -- 자료를 넣을 때처럼: 최근 쓴 과목이 되고, 보관한 과목이면 보관을 푼다 (옮긴 노트가 '전체'에서 사라지지 않게)
  update public.subjects set used_at = now(), archived = false where id = p_subject;
  return cardinality(v_top);
end;
$$;

-- 과목 합치기 (서버 전용): p_from 과목의 자료·노트·문제(노트 없는 문제도)·복습 카드·푼 기록을 모두 p_into 과목으로 옮기고
-- p_from 과목은 지운다. p_into 의 이름·색은 그대로, 시험 날이 없으면 p_from 의 것을 쓴다.
-- 둘 중 하나라도 고정이면 고정, 둘 다 보관이었을 때만 보관. 순서를 정해 둔 자료는 p_into 의 자료 뒤에 그 차례 그대로 붙는다.
-- 옮긴 자료 수를 돌려준다
create or replace function public.kok_merge_subjects(p_user uuid, p_from uuid, p_into uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.subjects%rowtype;
  t public.subjects%rowtype;
  v_shift int;
  v_n int;
begin
  if p_from = p_into then
    raise exception 'same_subject';
  end if;
  -- 두 과목을 같은 차례로 잠근다 (동시에 서로를 합쳐도 멈추지 않게)
  perform 1 from public.subjects where id in (p_from, p_into) and user_id = p_user order by id for update;
  select * into f from public.subjects where id = p_from and user_id = p_user;
  if not found then
    raise exception 'subject_not_found';
  end if;
  select * into t from public.subjects where id = p_into and user_id = p_user;
  if not found then
    raise exception 'subject_not_found';
  end if;
  select count(*) into v_n from public.sources where subject_id = p_from and parent_id is null;
  select coalesce(max(position), -1) + 1 into v_shift from public.sources where subject_id = p_into and parent_id is null;
  update public.sources
     set subject_id = p_into,
         position = case when position is null then null else position + v_shift end
   where subject_id = p_from;
  update public.notes set subject_id = p_into where subject_id = p_from;
  update public.questions set subject_id = p_into where subject_id = p_from;
  update public.cards set subject_id = p_into where subject_id = p_from;
  update public.review_logs set subject_id = p_into where subject_id = p_from and user_id = p_user;
  update public.subjects
     set exam_date = coalesce(t.exam_date, f.exam_date),
         pinned = t.pinned or f.pinned,
         archived = t.archived and f.archived,
         used_at = greatest(t.used_at, f.used_at)
   where id = p_into;
  delete from public.subjects where id = p_from;
  return v_n;
end;
$$;

-- 노트 합치기 (서버 전용, AI 없이): p_from 노트들을 p_into 노트에 합친다. 합친 정리·그림은 서버가 만들어 보낸다 (p_body, p_visuals).
-- - 합쳐지는 노트의 문제는 p_into 노트로 옮긴다: 개념 번호는 p_maps({노트 번호: {예전 번호: 새 번호}})로 바꾸고 출처 쪽은 비운다
--   (다른 자료의 쪽이라서). 푼 기록·복습 카드는 그대로 (과목만 따라간다)
-- - 합쳐지는 노트는 지금 쓰는 버전만 들어간다 (지난 버전에만 있던 숨긴 문제는 지운다). 자료는 지우지 않는다:
--   지금 쓰는 버전에 없는 더한 자료(지난 버전을 쓰고 있거나, 다른 갈래의 버전에만 있는 것)가 있으면 'note_old_version <노트 번호>',
--   더하지 못하고 멈춘 자료가 있으면 'failed_append <노트 번호>' 를 내고 합치지 않는다
-- - 채팅도 옮긴다 (넣기를 기다리던 제안은 그만둔다: 예전 노트의 개념 번호라서)
-- - 합쳐지는 노트의 자료는 p_into 의 더한 자료가 된다 (원본 탭에 남는다)
-- - p_into 에 버전이 있으면 합치기 전 노트를 지금 버전 행에 남기고, 합친 노트는 새 버전(kind 'merge')이 된다.
--   새 버전의 자료 = 지금 버전의 자료 + 합쳐 들어온 자료(added 표시). 버전을 바꾸거나 지워도 합친 자료·문제가 다른 버전과 엉키지 않는다.
--   버전이 없는 노트는 그대로 고친다 (버전을 처음 만들 때 합쳐 들어온 자료가 버전 1의 자료가 된다)
-- - 별표·복습은 하나라도 켜져 있으면 켠다 (복습에 나오던 문제가 빠지지 않게)
-- p_updated: 노트마다 읽은 때의 updated_at ({노트 번호: 값}), p_vis_at: 그림 행마다 읽은 때의 updated_at ({노트 번호: {종류: 값}}).
-- 그사이 바뀐 것이 있으면 'stale_note'. {merged: 합친 노트 수, version: 새 버전 번호 (버전이 없는 노트면 null)} 를 돌려준다
drop function if exists public.kok_merge_notes(uuid, uuid, uuid[], jsonb, jsonb, jsonb, jsonb);
create or replace function public.kok_merge_notes(
  p_user uuid, p_into uuid, p_from uuid[], p_body jsonb, p_visuals jsonb, p_maps jsonb, p_updated jsonb, p_vis_at jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.notes%rowtype;
  m public.notes%rowtype;
  v_from uuid;
  v_all uuid[];
  v_mat jsonb := '[]'::jsonb;
  v_mmat jsonb;
  v_base jsonb;
  v_moved uuid[];
  v_star boolean := false;
  v_review boolean := false;
  v_versioned boolean;
  v_no int;
  v_visuals jsonb;
  v_qids uuid[];
  v jsonb;
begin
  if p_from is null or cardinality(p_from) < 1 or cardinality(p_from) > 20 or p_into = any(p_from)
     or cardinality(p_from) <> (select count(distinct x) from unnest(p_from) x) then
    raise exception 'bad_notes';
  end if;
  v_all := p_from || p_into;
  -- 모든 노트를 같은 차례로 잠근다 (동시에 다른 차례로 합쳐도 멈추지 않게). 그 다음 그림 행도
  perform 1 from public.notes where id = any(v_all) order by id for update;
  if (select count(*) from public.notes where id = any(v_all) and user_id = p_user) <> cardinality(v_all) then
    raise exception 'note_not_found';
  end if;
  perform 1 from public.visuals where note_id = any(v_all) order by id for update;
  -- 읽은 뒤에 바뀐 노트·그림이 있으면 합치지 않는다 (고친 것을 덮어쓰지 않게)
  if exists (
    select 1 from public.notes n
     where n.id = any(v_all)
       and n.updated_at is distinct from nullif(p_updated->>(n.id::text), '')::timestamptz
  ) then
    raise exception 'stale_note';
  end if;
  if p_vis_at is null or jsonb_typeof(p_vis_at) <> 'object'
     or exists (
       select 1 from public.visuals x
        where x.note_id = any(v_all)
          and x.updated_at is distinct from nullif(p_vis_at->(x.note_id::text)->>x.type, '')::timestamptz
     )
     or exists (
       select 1
         from jsonb_each(p_vis_at) e(nid, types),
              jsonb_object_keys(case when jsonb_typeof(e.types) = 'object' then e.types else '{}'::jsonb end) t(type)
        where not exists (select 1 from public.visuals x where x.note_id::text = e.nid and x.type = t.type)
     ) then
    raise exception 'stale_note';
  end if;
  -- 정리를 마친 처음 자료의 노트만, 자료를 더하는 중이 아닐 때만
  if exists (
    select 1 from public.notes n join public.sources s on s.id = n.source_id
     where n.id = any(v_all) and (s.parent_id is not null or s.status <> 'ready')
  ) then
    raise exception 'not_ready';
  end if;
  if exists (
    select 1 from public.notes n join public.sources c on c.parent_id = n.source_id
     where n.id = any(v_all) and c.status in ('queued', 'processing')
  ) then
    raise exception 'append_running';
  end if;

  -- 합쳐지는 노트의 지금 자료: 버전이 있으면 지금 버전의 자료(처음 자료는 늘), 없으면 처음 자료와 정리를 마친 더한 자료.
  -- 그 밖의 더한 자료(지난 버전에만 있는 것, 멈춘 것)가 있으면 합치지 않는다 (지우지 않게: 화면이 미리 알려 준다)
  foreach v_from in array p_from loop
    select * into m from public.notes where id = v_from;
    if exists (select 1 from public.note_versions where note_id = m.id) then
      select materials into v_mmat from public.note_versions where note_id = m.id and number = m.current_version;
      v_mmat := coalesce(v_mmat, '[]'::jsonb);
      if not exists (select 1 from jsonb_array_elements(v_mmat) e where e->>'source_id' = m.source_id::text) then
        select jsonb_build_array(jsonb_build_object('source_id', x.id, 'kind', x.kind, 'title', x.title, 'page_count', x.page_count)) || v_mmat
          into v_mmat from public.sources x where x.id = m.source_id;
      end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('source_id', x.id, 'kind', x.kind, 'title', x.title, 'page_count', x.page_count)
                                order by (x.id = m.source_id) desc, x.created_at, x.id), '[]'::jsonb)
        into v_mmat
        from public.sources x
       where x.id = m.source_id or (x.parent_id = m.source_id and x.status = 'ready');
    end if;
    if exists (select 1 from public.sources x where x.parent_id = m.source_id and x.status = 'error') then
      raise exception 'failed_append %', m.id;
    end if;
    if exists (
      select 1 from public.sources x
       where x.parent_id = m.source_id
         and not exists (select 1 from jsonb_array_elements(v_mmat) e where e->>'source_id' = x.id::text)
    ) then
      raise exception 'note_old_version %', m.id;
    end if;
    v_mat := v_mat || (select coalesce(jsonb_agg(e || '{"added": true}'::jsonb order by i), '[]'::jsonb)
                         from jsonb_array_elements(v_mmat) with ordinality as t(e, i));
  end loop;

  select * into k from public.notes where id = p_into;
  v_versioned := exists (select 1 from public.note_versions where note_id = k.id);
  if v_versioned then
    -- 합치기 전 노트를 지금 버전 행에 남긴다 (합쳐 들어오는 문제가 섞이기 전에)
    perform public.kok_note_snapshot(k.id);
    select materials into v_base from public.note_versions where note_id = k.id and number = k.current_version;
  end if;

  foreach v_from in array p_from loop
    select * into m from public.notes where id = v_from;
    -- 지난 버전에만 있던 숨긴 문제는 지운다 (합친 노트에는 지금 버전만 들어간다)
    delete from public.questions where note_id = m.id and status = 'hidden';
    with moved as (
      update public.questions q
         set note_id = k.id,
             subject_id = k.subject_id,
             key_point_id = case when q.key_point_id is null then null else nullif(p_maps->(m.id::text)->>q.key_point_id, '') end,
             pages = '{}'
       where q.note_id = m.id
      returning q.id
    )
    select coalesce(array_agg(moved.id), '{}') into v_moved from moved;
    update public.cards set subject_id = k.subject_id where question_id = any(v_moved) and subject_id <> k.subject_id;
    update public.review_logs set subject_id = k.subject_id where question_id = any(v_moved);

    update public.chat_messages
       set note_id = k.id,
           proposal = case when proposal is not null and proposal->>'status' = 'pending'
                           then jsonb_set(proposal, '{status}', '"cancelled"') else proposal end
     where note_id = m.id;

    select v_star or coalesce(x.starred, false), v_review or coalesce(x.in_review, true)
      into v_star, v_review
      from public.sources x where x.id = m.source_id;
    delete from public.notes where id = m.id;
    update public.sources
       set parent_id = k.source_id, subject_id = k.subject_id
     where id = m.source_id or parent_id = m.source_id;
  end loop;

  update public.notes set body = p_body where id = k.id;
  delete from public.visuals where note_id = k.id;
  for v in select * from jsonb_array_elements(coalesce(p_visuals, '[]'::jsonb)) loop
    insert into public.visuals (user_id, note_id, type, spec) values (k.user_id, k.id, v->>'type', v->'spec');
  end loop;
  if v_versioned then
    select greatest(coalesce(max(number), 0), k.version_seq, k.current_version) + 1 into v_no from public.note_versions where note_id = k.id;
    update public.notes set current_version = v_no, version_seq = v_no where id = k.id;
    select coalesce(jsonb_agg(jsonb_build_object('type', type, 'spec', spec) order by type), '[]'::jsonb)
      into v_visuals from public.visuals where note_id = k.id;
    select coalesce(array_agg(id order by created_at, id), '{}')
      into v_qids from public.questions where note_id = k.id and status <> 'hidden';
    insert into public.note_versions (user_id, note_id, number, title, body, visuals, question_ids, qkeys, materials, kind)
    values (k.user_id, k.id, v_no, k.title, p_body, v_visuals, v_qids, public.kok_note_qkeys(k.id),
            public.kok_strip_added(v_base) || v_mat, 'merge');
  end if;
  update public.sources
     set starred = starred or v_star, in_review = in_review or v_review
   where id = k.source_id;
  return jsonb_build_object('merged', cardinality(p_from), 'version', v_no);
end;
$$;

-- 합친 노트를 AI 로 다시 정리한 결과를 새 버전으로 저장한다 (서버 전용). 다시 정리하기 전의 노트는 그 버전 행에 남는다
-- (버전 기록에서 돌아갈 수 있다. 돌아가면 문제의 개념 번호도 그 버전의 번호로 돌아온다: qkeys).
-- 문제의 개념 번호는 p_qmap({예전 번호: 새 번호, '' 는 개념 없음})으로 바꾸고, 마인드맵은 p_mindmap(개념 번호를 바꾼 것,
-- null 이면 그대로)으로. p_updated: 읽은 때의 노트 updated_at, p_mindmap_at: p_mindmap 을 만든 마인드맵의 updated_at
-- (그사이 바뀌었으면 'stale_note'). 새 버전 번호를 돌려준다
drop function if exists public.kok_reorganize_note(uuid, uuid, jsonb, jsonb, jsonb, timestamptz);
create or replace function public.kok_reorganize_note(
  p_user uuid, p_note uuid, p_body jsonb, p_qmap jsonb, p_mindmap jsonb, p_updated timestamptz, p_mindmap_at timestamptz
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.notes%rowtype;
  v_no int;
  v_materials jsonb;
  v_visuals jsonb;
  v_qids uuid[];
  v_mm boolean := p_mindmap is not null and jsonb_typeof(p_mindmap) = 'object';
begin
  select * into n from public.notes where id = p_note and user_id = p_user for update;
  if not found then
    raise exception 'note_not_found';
  end if;
  if n.updated_at is distinct from p_updated then
    raise exception 'stale_note';
  end if;
  if exists (select 1 from public.sources where parent_id = n.source_id and status in ('queued', 'processing')) then
    raise exception 'append_running';
  end if;
  perform 1 from public.visuals where note_id = n.id order by id for update;
  if v_mm and (select updated_at from public.visuals where note_id = n.id and type = 'mindmap') is distinct from p_mindmap_at then
    raise exception 'stale_note';
  end if;
  perform public.kok_note_snapshot(n.id);
  select greatest(coalesce(max(number), 0), n.version_seq, n.current_version) + 1 into v_no from public.note_versions where note_id = n.id;
  select materials into v_materials from public.note_versions where note_id = n.id and number = n.current_version;

  update public.notes set body = p_body, current_version = v_no, version_seq = v_no where id = n.id;
  update public.questions q
     set key_point_id = nullif(p_qmap->>q.key_point_id, '')
   where q.note_id = n.id and q.status <> 'hidden' and q.key_point_id is not null and p_qmap ? q.key_point_id;
  if v_mm then
    update public.visuals set spec = p_mindmap where note_id = n.id and type = 'mindmap';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'spec', spec) order by type), '[]'::jsonb)
    into v_visuals from public.visuals where note_id = n.id;
  select coalesce(array_agg(id order by created_at, id), '{}')
    into v_qids from public.questions where note_id = n.id and status <> 'hidden';
  insert into public.note_versions (user_id, note_id, number, title, body, visuals, question_ids, qkeys, materials, kind)
  values (n.user_id, n.id, v_no, n.title, p_body, v_visuals, v_qids, public.kok_note_qkeys(n.id),
          public.kok_strip_added(v_materials), 'reorganize');
  return v_no;
end;
$$;

revoke execute on function public.kok_move_sources(uuid, uuid[], uuid) from public, anon, authenticated;
revoke execute on function public.kok_merge_subjects(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.kok_merge_notes(uuid, uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.kok_reorganize_note(uuid, uuid, jsonb, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_note_qkeys(uuid) from public, anon, authenticated;
revoke execute on function public.kok_strip_added(jsonb) from public, anon, authenticated;
grant execute on function public.kok_move_sources(uuid, uuid[], uuid) to service_role;
grant execute on function public.kok_merge_subjects(uuid, uuid, uuid) to service_role;
grant execute on function public.kok_merge_notes(uuid, uuid, uuid[], jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.kok_reorganize_note(uuid, uuid, jsonb, jsonb, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.kok_note_qkeys(uuid) to service_role;
grant execute on function public.kok_strip_added(jsonb) to service_role;

revoke execute on function public.kok_add_questions(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.kok_finalize_source(uuid, text, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_note_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public.kok_finalize_append(uuid, jsonb, jsonb, jsonb, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.kok_note_base(uuid) from public, anon, authenticated;
revoke execute on function public.kok_note_for_merge(uuid) from public, anon, authenticated;
revoke execute on function public.kok_switch_version(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public.kok_delete_version(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.kok_add_questions(uuid, jsonb, boolean) to service_role;
grant execute on function public.kok_note_snapshot(uuid) to service_role;
grant execute on function public.kok_finalize_append(uuid, jsonb, jsonb, jsonb, timestamptz, text) to service_role;
grant execute on function public.kok_note_base(uuid) to service_role;
grant execute on function public.kok_note_for_merge(uuid) to service_role;
grant execute on function public.kok_switch_version(uuid, uuid, int) to service_role;
grant execute on function public.kok_delete_version(uuid, uuid, int) to service_role;
grant execute on function public.kok_finalize_source(uuid, text, jsonb, jsonb, jsonb, timestamptz) to service_role;

revoke execute on function public.kok_claim_source(uuid, int) from public, anon, authenticated;
revoke execute on function public.kok_energy_since(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_free_usd_since(timestamptz) from public, anon, authenticated;
revoke execute on function public.kok_hit_rate(uuid, int, int, text) from public, anon, authenticated;
revoke execute on function public.kok_bump_counter(text, int) from public, anon, authenticated;
revoke execute on function public.kok_take_unused_theme_images(timestamptz, uuid, int) from public, anon, authenticated;
revoke execute on function public.kok_redeem_coupon(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.kok_end_custom_plan(uuid, uuid) from public, anon, authenticated;
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
grant execute on function public.kok_bump_counter(text, int) to service_role;
grant execute on function public.kok_take_unused_theme_images(timestamptz, uuid, int) to service_role;
grant execute on function public.kok_redeem_coupon(text, uuid, boolean) to service_role;
grant execute on function public.kok_end_custom_plan(uuid, uuid) to service_role;
grant execute on function public.kok_admin_stats(timestamptz, timestamptz) to service_role;

-- =====================================================================
-- 파일 저장소: 'sources' 버킷 (비공개).
-- 올리기는 서버가 검사하고 준 한 번짜리 주소로만 한다 (학생이 마음대로 올리거나 지우지 못한다).
-- 보기는 경로 첫 폴더가 내 id 일 때만.
-- =====================================================================
-- 파일 한 개 200MB 까지 (Supabase 유료 플랜 필요: Storage 설정의 전체 업로드 한도도 200MB 이상으로 올린다).
-- 이 값은 src/lib/settings.ts 의 MAX_FILE_MB 와 같아야 한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources', 'sources', false, 209715200,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 테마 배경 그림 (비공개, 3MB). 올리기·보기 모두 서버가 한다 (학생 정책 없음: 보기는 /api/themes/images 가 한 번짜리 주소로 보낸다)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('theme-images', 'theme-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
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
