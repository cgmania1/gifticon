#!/usr/bin/env bash
# ============================================================================
# supabase/schema.sql 을 임시 로컬 PostgreSQL 에 실제로 적용해 검증한다.
#
#   ./scripts/sqltest/run.sh
#
# 운영에서 처음 돌리지 않기 위한 장치다. 브라우저도 빌드도 SQL 은 잡아 주지 않는다.
# 임시 클러스터를 만들어 쓰고 끝나면 지우므로 기존 PostgreSQL 설치에 영향이 없다.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-}"
if [ -z "$PGBIN" ]; then
  for c in /usr/local/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@17/bin \
           /usr/local/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@16/bin; do
    [ -x "$c/initdb" ] && PGBIN="$c" && break
  done
fi
# 데비안·우분투(그리고 GitHub Actions 러너) — 여기서는 initdb 가 PATH 에 없다
if [ -z "$PGBIN" ]; then
  for c in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do
    [ -x "$c/initdb" ] && PGBIN="$c" && break
  done
fi
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  PGBIN="$(dirname "$(command -v initdb)")"
fi
if [ -z "$PGBIN" ]; then
  echo "PostgreSQL 을 찾지 못했습니다." >&2
  echo "  macOS  : brew install postgresql@17" >&2
  echo "  우분투 : sudo apt-get install -y postgresql" >&2
  exit 1
fi

TMP="$(mktemp -d)"; PGDATA="$TMP/data"; PGSOCK="$TMP/sock"; mkdir -p "$PGSOCK"
cleanup() { "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "임시 PostgreSQL 준비 중…"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-k $PGSOCK -h '' -c listen_addresses=''" -w start >/dev/null
"$PGBIN/createdb" -h "$PGSOCK" -U postgres sqltest

PSQL=("$PGBIN/psql" -h "$PGSOCK" -U postgres -d sqltest -v ON_ERROR_STOP=1 -q)

echo "① Supabase 환경 스텁"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/00_supabase_stub.local.sql"

echo "② schema.sql 적용"
PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -f "$ROOT/supabase/schema.sql"

echo "③ 재적용 (재실행 안전한가)"
PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -f "$ROOT/supabase/schema.sql"

echo "④ 공통 불변식 검증"
"${PSQL[@]}" -f "$ROOT/scripts/sqltest/10_common.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'

if [ -f "$ROOT/scripts/sqltest/20_project.local.sql" ]; then
  echo "⑤ 프로젝트별 검증"
  "${PSQL[@]}" -f "$ROOT/scripts/sqltest/20_project.local.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //'
fi

# 이미 옛 판(1단계) 스키마로 쓰던 DB 에 새 판을 다시 실행해도 데이터가 남고 칸이 더해지는가
OLD_REV="${OLD_SCHEMA_REV:-67783ad}"
if git -C "$ROOT" cat-file -e "$OLD_REV:supabase/schema.sql" 2>/dev/null; then
  echo "⑤-2 올림 검사 — $OLD_REV 판 스키마 위에 새 schema.sql 적용"
  "$PGBIN/createdb" -h "$PGSOCK" -U postgres sqltest_up
  UP=("$PGBIN/psql" -h "$PGSOCK" -U postgres -d sqltest_up -v ON_ERROR_STOP=1 -q)
  "${UP[@]}" -f "$ROOT/scripts/sqltest/00_supabase_stub.local.sql" >/dev/null
  git -C "$ROOT" show "$OLD_REV:supabase/schema.sql" | PGOPTIONS='-c client_min_messages=warning' "${UP[@]}"
  "${UP[@]}" -c "insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com') on conflict do nothing"
  "${UP[@]}" <<'SQL'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $x$ begin perform public.create_family('옛 가족', '엄마'); end $x$;
insert into public.giftcons (family_id, title, expires_on) select family_id, '옛 기프티콘', current_date from public.family_members;
SQL
  PGOPTIONS='-c client_min_messages=warning' "${UP[@]}" -f "$ROOT/supabase/schema.sql"
  "${UP[@]}" <<'SQL' 2>&1 | sed 's/^.*NOTICE:  //'
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$
declare g public.giftcons;
begin
  select * into g from public.giftcons where title = '옛 기프티콘';
  if g.id is null or g.is_amount or g.face_value is not null then raise exception 'FAIL  옛 기프티콘이 남고 금액형 아님으로 채워져야 한다'; end if;
  raise notice '  OK   옛 판 DB 에 다시 실행 — 기존 기프티콘은 그대로, is_amount = false';
  insert into public.giftcons (family_id, title, expires_on, is_amount, face_value, balance)
  values (g.family_id, '새 상품권', current_date, true, 5000, 5000) returning * into g;
  g := public.spend_giftcon(g.id, 1000);
  if g.balance <> 4000 or not exists (select 1 from public.giftcon_log where action = '금액사용') then
    raise exception 'FAIL  올린 DB 에서 금액사용 기록이 되어야 한다';
  end if;
  raise notice '  OK   올린 DB 에서 나눠 쓰기·「금액사용」 기록(바뀐 action CHECK) 동작';
end $t$;
SQL
fi

echo "⑥ 운영 가드 자가검사 (운영 흔적이 보이면 검증 파일이 스스로 멈추는가)"
guard_check() {
  local label="$1" setup="$2" teardown="$3" f
  "${PSQL[@]}" -c "$setup"
  for f in 00_supabase_stub 10_common 20_project; do
    [ -f "$ROOT/scripts/sqltest/$f.local.sql" ] || continue
    # 다른 이유로 실패한 것을 가드로 오인하지 않도록 가드 문구까지 확인한다
    local out
    out="$("${PSQL[@]}" -f "$ROOT/scripts/sqltest/$f.local.sql" 2>&1 || true)"
    if [[ "$out" == *"로컬 검증 전용"* ]]; then :; else
      echo "  FAIL  $label 가 있는데 $f.local.sql 의 가드가 멈추지 않았습니다" >&2
      "${PSQL[@]}" -c "$teardown"; exit 1
    fi
    echo "  OK   $label → $f.local.sql 실행 거부"
  done
  "${PSQL[@]}" -c "$teardown"
}
guard_check "authenticator 역할"  "create role authenticator nologin"  "drop role authenticator"
guard_check "supabase_admin 역할" "create role supabase_admin nologin" "drop role supabase_admin"
guard_check "graphql 스키마"      "create schema graphql"              "drop schema graphql"

echo ""
echo "SQL 검증 통과."
