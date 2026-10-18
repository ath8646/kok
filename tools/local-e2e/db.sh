#!/bin/bash
# 시험용 데이터베이스(kokapp) 만들기·초기화. 로컬 Postgres 접속은 PGHOST·PGPORT·PGUSER 를 따른다.
#   bash db.sh setup   # 처음 한 번 (데이터베이스 새로 만들기)
#   bash db.sh reset   # 시험마다 (데이터만 비우기)
set -e
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$HERE/../../supabase"
P="psql -v ON_ERROR_STOP=1 -q"
G='{"provider": "google", "providers": ["google"]}'
USERS="insert into auth.users (id, email, raw_app_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'student@example.com', '$G'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin@example.com', '$G'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'other@example.com', '$G');"
case "${1:-reset}" in
  setup)
    # Supabase 처럼 UTF8 로 만든다 (SQL_ASCII 면 char_length 가 한글을 바이트로 세서 글자 수 검사가 달라진다)
    $P -d postgres -c "drop database if exists kokapp with (force);" -c "create database kokapp template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C';" >/dev/null
    $P -d kokapp -f "$SUPA/test/stub.sql" >/dev/null 2>&1
    $P -d kokapp -f "$SUPA/schema.sql" >/dev/null 2>&1
    $P -d kokapp -c "$USERS" >/dev/null
    ;;
  reset)
    $P -d kokapp -f "$SUPA/test/stub.sql" >/dev/null 2>&1
    $P -d kokapp -c "truncate auth.users cascade; truncate public.coupons cascade; truncate storage.objects; delete from public.app_settings;" >/dev/null 2>&1
    $P -d kokapp -f "$SUPA/schema.sql" >/dev/null 2>&1
    $P -d kokapp -c "truncate public.account_tombstones, public.upload_tickets; truncate public.custom_plans cascade;" >/dev/null
    $P -d kokapp -c "$USERS" >/dev/null
    rm -rf "$HERE/fakebase/files"
    ;;
esac
echo "db $1 ok"
