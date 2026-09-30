-- ============================================================================
-- 로컬 검증 전용 — data09-21 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 흉내: set role authenticated + request.jwt.claim.sub 에 uuid 를 넣으면
--  스텁의 auth.uid() 가 그 값을 돌려줍니다. anon 은 set role anon.
--  등장인물: A(가족을 만든 사람) · B(초대 코드로 들어온 가족) · C(다른 가족)
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 문장이 지정한 SQLSTATE 로 실패하는지 본다. p_state 가 null 이면 「성공해야 함」. (이름이 _assert 로 시작해 권한 검사에서 빠진다)
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is not distinct from p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, coalesce(p_state, '성공'), coalesce(v_state, '성공함');
  end if;
end;
$fn$;

-- 영향받은 행 수를 확인한다 (RLS 로 가려진 SELECT/UPDATE/DELETE 는 0 행)
create or replace function public._assert_rows(p_sql text, p_expected int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n = p_expected then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 % 행, 실제 % 행)', p_label, p_expected, v_n;
  end if;
end;
$fn$;

grant execute on function public._assert_raises(text, text, text) to anon, authenticated;
grant execute on function public._assert_rows(text, int, text) to anon, authenticated;
grant execute on function public._assert(boolean, text) to anon, authenticated;

do $t$ begin raise notice '[프로젝트] 재실행 안전 · 정책 수 · 함수 권한'; end $t$;

do $t$
declare v_bad text;
begin
  select string_agg(relname || '=' || n || '(기대 ' || want || ')', ', ') into v_bad from (
    select c.relname, count(p.oid) as n,
           case c.relname when 'families' then 1 when 'family_members' then 3
                          when 'giftcons' then 4 when 'giftcon_log' then 1 end as want
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where s.nspname = 'public' and c.relkind = 'r'
     group by c.relname) x
   where n is distinct from want;
  perform public._assert(v_bad is null, '두 번 적용 후 표별 정책 수 families 1 · family_members 3 · giftcons 4 · giftcon_log 1' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                              join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'storage' and c.relname = 'objects' and p.polname like 'giftcons\_files\_%'),
    4::bigint, '두 번 적용 후 Storage 정책 4개');
  perform public._assert_eq((select count(*) from pg_trigger where tgrelid = 'public.giftcons'::regclass and not tgisinternal),
    2::bigint, '두 번 적용 후 giftcons 트리거 2개');
  perform public._assert_eq((select count(*) from storage.buckets where id = 'giftcons' and not public), 1::bigint, '버킷 giftcons 는 비공개');
  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                             where c.relname = 'giftcon_log' and p.polcmd <> 'r'), 0::bigint, '기록 표에는 읽기 외 정책이 없다');
  perform public._assert((select prosecdef from pg_proc where proname = 'is_family_member')
                     and (select 'search_path=public' = any(proconfig) from pg_proc where proname = 'is_family_member'),
    'is_family_member: security definer + search_path=public 고정');
end $t$;

-- ----------------------------------------------------------------------------
-- 사용자 준비 (auth.users 는 postgres 로)
-- ----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'c@example.com')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- anon — RPC·표·파일 모두 불가
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] anon — 아무것도 못 한다'; end $t$;
set role anon;
set request.jwt.claim.sub = '';
do $t$
begin
  perform public._assert_raises($q$select public.create_family('x', 'y')$q$, '42501', 'anon 은 create_family 를 실행하지 못한다');
  perform public._assert_raises($q$select public.join_family('ABCDEFGH', 'y')$q$, '42501', 'anon 은 join_family 를 실행하지 못한다');
  perform public._assert_raises($q$select public.is_family_member(gen_random_uuid())$q$, '42501', 'anon 은 is_family_member 를 실행하지 못한다');
end $t$;
reset role;

-- ----------------------------------------------------------------------------
-- A 가 가족을 만들고, B 가 초대 코드로 들어오고, C 는 따로 가족을 만든다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 가족 만들기 · 초대 코드로 들어가기'; end $t$;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$
declare v public.families;
begin
  v := public.create_family('  우리 가족 ', '엄마');
  perform public._assert(v.invite_code ~ '^[A-HJ-NP-Z2-9]{8}$', '초대 코드는 헷갈리는 글자 없는 8자리 (' || v.invite_code || ')');
  perform public._assert_eq(v.name, '우리 가족', '가족 이름 앞뒤 빈칸 정리');
  perform set_config('test.fam_a', v.id::text, false);
  perform set_config('test.code_a', v.invite_code, false);
  perform public._assert_eq((select role from public.family_members where user_id = auth.uid()), 'owner', '만든 사람은 owner');
  perform public._assert_raises($q$select public.create_family('또', '엄마')$q$, '23505', '이미 가족이 있으면 또 만들 수 없다');
  perform public._assert_raises($q$insert into public.families (name, invite_code) values ('x', 'ABCDEFGH')$q$, '42501', '가족 표에 직접 넣을 수 없다(RPC 만)');
  perform public._assert_raises(format($q$insert into public.family_members (family_id, display_name) values (%L, 'x')$q$, current_setting('test.fam_a')),
    '42501', '구성원 표에 직접 넣을 수 없다(RPC 만)');
end $t$;

set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $t$
declare v public.families; v_code text := current_setting('test.code_a');
begin
  perform public._assert_rows('select 1 from public.families', 0, '들어가기 전 B 에게는 A 의 가족(초대 코드)이 안 보인다');
  perform public._assert_raises($q$select public.join_family('ZZZZZZZZ', '아빠')$q$, 'P0002', '없는 코드는 「찾지 못했습니다」');
  -- 소문자·하이픈을 섞어 적어도 들어가진다
  v := public.join_family(lower(substr(v_code, 1, 4)) || '-' || substr(v_code, 5), ' 아빠 ');
  perform public._assert_eq(v.id::text, current_setting('test.fam_a'), 'B 는 소문자·하이픈 섞인 코드로도 A 의 가족에 들어간다');
  perform public._assert_eq((select count(*) from public.family_members), 2::bigint, 'B 에게 가족 구성원 2명이 보인다');
  perform public._assert_raises(format($q$select public.join_family(%L, '아빠')$q$, v_code), '23505', '이미 들어간 사람은 다시 못 들어간다');
end $t$;

set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
do $t$
declare v public.families;
begin
  v := public.create_family('다른 가족', '이웃');
  perform set_config('test.fam_c', v.id::text, false);
  perform public._assert(v.invite_code <> current_setting('test.code_a'), '가족마다 초대 코드가 다르다');
end $t$;

-- ----------------------------------------------------------------------------
-- 기프티콘 등록·예약·사용·사용취소 — 누가·언제는 트리거가 채운다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 기프티콘 등록 · 예약 · 사용 · 기록'; end $t$;

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$
declare v_fam uuid := current_setting('test.fam_a')::uuid; v_id uuid; g public.giftcons;
begin
  -- 등록자를 C 로 속여 보내도 A 로 기록된다
  insert into public.giftcons (family_id, title, brand, expires_on, created_by, reserved_by, image_path)
  values (v_fam, '아메리카노 T', '카페 A', current_date + 5, 'cccccccc-0000-0000-0000-000000000003',
          'bbbbbbbb-0000-0000-0000-000000000002', v_fam::text || '/g1.jpg')
  returning * into g;
  perform set_config('test.g1', g.id::text, false);
  perform public._assert_eq(g.created_by, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, '등록자는 로그인한 사람(A)으로 채워진다 — 속인 값 무시');
  perform public._assert_eq(g.reserved_by, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, '예약자로 같은 가족 B 를 고를 수 있다');
  perform public._assert_eq((select string_agg(action || coalesce(':' || detail, ''), ' / ' order by id) from public.giftcon_log where giftcon_id = g.id),
    '등록 / 예약:예약: 아빠', '등록하면 「등록」·「예약」 기록이 남는다');

  perform public._assert_raises(format($q$insert into public.giftcons (family_id, title, expires_on, reserved_by) values (%L, 'x', current_date, 'cccccccc-0000-0000-0000-000000000003')$q$, v_fam),
    '23503', '다른 가족(C)은 예약자로 고를 수 없다(FK)');
  perform public._assert_raises(format($q$insert into public.giftcons (family_id, title, expires_on, image_path) values (%L, 'x', current_date, %L)$q$, v_fam, current_setting('test.fam_c') || '/x.jpg'),
    '23514', '사진 경로는 자기 가족 폴더만');
  perform public._assert_raises(format($q$insert into public.giftcons (family_id, title, expires_on) values (%L, '   ', current_date)$q$, v_fam),
    '23514', '빈 상품명은 CHECK 가 막는다');
  perform public._assert_raises(format($q$insert into public.giftcons (family_id, title, expires_on) values (%L, 'x', current_date)$q$, current_setting('test.fam_c')),
    '42501', '다른 가족 보관함에는 넣을 수 없다');
end $t$;

-- B 가 「사용함」 표시 — used_by 를 C 로 속여 보내도 B 로 기록
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $t$
declare v_id uuid := current_setting('test.g1')::uuid; g public.giftcons;
begin
  update public.giftcons set used = true, used_by = 'cccccccc-0000-0000-0000-000000000003', used_at = '2000-01-01'
   where id = v_id returning * into g;
  perform public._assert_eq(g.used_by, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, '사용한 사람은 로그인한 사람(B)으로 채워진다');
  perform public._assert(g.used_at > now() - interval '1 minute', '사용 시각은 지금으로 채워진다');
  -- 가족·등록자는 바꿀 수 없다
  update public.giftcons set family_id = current_setting('test.fam_c')::uuid, created_by = auth.uid() where id = v_id returning * into g;
  perform public._assert_eq(g.family_id::text, current_setting('test.fam_a'), '가족(family_id)은 바꿀 수 없다');
  perform public._assert_eq(g.created_by, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, '등록자는 바꿀 수 없다');
  update public.giftcons set used = false where id = v_id returning * into g;
  perform public._assert(g.used_by is null and g.used_at is null, '사용취소하면 누가·언제가 비워진다');
  update public.giftcons set reserved_by = null, expires_on = expires_on + 1, memo = '메모' where id = v_id;
  perform public._assert_eq((select string_agg(action || coalesce(':' || detail, '') || ':' || coalesce(actor_name, '-'), ' / ' order by id)
                               from public.giftcon_log where giftcon_id = v_id),
    '등록:엄마 / 예약:예약: 아빠:엄마 / 사용:아빠 / 사용취소:아빠 / 수정:바뀐 칸: 유효기간, 메모:아빠 / 예약:예약 해제:아빠',
    '사용 · 사용취소 · 수정 · 예약 해제가 한 사람 이름과 함께 기록된다');
end $t$;

-- ----------------------------------------------------------------------------
-- 기록 표는 덧붙이기만 — 사용자는 넣지도 고치지도 지우지도 못한다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 기록 표 — 사후 조작 불가'; end $t$;
do $t$
declare v_n bigint := (select count(*) from public.giftcon_log);
begin
  perform public._assert_raises(format($q$insert into public.giftcon_log (family_id, giftcon_id, action, title) values (%L, gen_random_uuid(), '사용', '가짜')$q$, current_setting('test.fam_a')),
    '42501', '사용자는 기록을 직접 넣지 못한다');
  perform public._assert_rows($q$update public.giftcon_log set detail = '조작'$q$, 0, '사용자는 기록을 고치지 못한다(0행)');
  perform public._assert_rows('delete from public.giftcon_log', 0, '사용자는 기록을 지우지 못한다(0행)');
  perform public._assert_eq((select count(*) from public.giftcon_log), v_n, '기록 수 그대로');
end $t$;

-- ----------------------------------------------------------------------------
-- 다른 가족(C)과 격리
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 다른 가족(C)과 격리'; end $t$;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
do $t$
begin
  perform public._assert_rows('select 1 from public.giftcons', 0, 'C 에게 A 가족 기프티콘이 안 보인다');
  perform public._assert_rows('select 1 from public.giftcon_log', 0, 'C 에게 A 가족 기록이 안 보인다');
  perform public._assert_rows('select 1 from public.families', 1, 'C 에게는 자기 가족 하나만 보인다(A 의 초대 코드 안 보임)');
  perform public._assert_rows('select 1 from public.family_members', 1, 'C 에게는 자기 가족 구성원만 보인다');
  perform public._assert_rows($q$update public.giftcons set used = true$q$, 0, 'C 는 A 가족 기프티콘을 사용 표시하지 못한다');
  perform public._assert_rows('delete from public.giftcons', 0, 'C 는 A 가족 기프티콘을 지우지 못한다');
  perform public._assert_eq(public.is_family_member(current_setting('test.fam_a')::uuid), false, '판정 함수: C 는 A 가족이 아니다');
end $t$;

-- ----------------------------------------------------------------------------
-- 구성원 표 — 내 표시 이름만 고친다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 구성원 — 내 표시 이름만'; end $t$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $t$
begin
  perform public._assert_rows($q$update public.family_members set display_name = '아빠(B)' where user_id = auth.uid()$q$, 1, 'B 는 자기 표시 이름을 고친다');
  perform public._assert_rows($q$update public.family_members set display_name = '누구' where user_id <> auth.uid()$q$, 0, 'B 는 A 의 표시 이름을 못 고친다(0행)');
  perform public._assert_raises(format($q$update public.family_members set family_id = %L where user_id = auth.uid()$q$, current_setting('test.fam_c')),
    '42501', 'B 는 가족을 옮길 수 없다(칸 권한)');
  perform public._assert_raises($q$update public.family_members set role = 'owner' where user_id = auth.uid()$q$,
    '42501', 'B 는 자기 역할을 owner 로 못 바꾼다(칸 권한)');
end $t$;

-- ----------------------------------------------------------------------------
-- 금액형 상품권 — 나눠 쓰기(RPC) · 잔액 0 이면 사용함 · 수동 체크 우선 · 기록
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 금액형 상품권 — 잔액 · 나눠 쓰기'; end $t$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$
declare v_fam uuid := current_setting('test.fam_a')::uuid; g public.giftcons; v_plain uuid;
begin
  insert into public.giftcons (family_id, title, expires_on, is_amount, face_value, balance)
  values (v_fam, '상품권 1만원', current_date + 20, true, 10000, 10000) returning * into g;
  perform set_config('test.amt', g.id::text, false);
  perform public._assert(g.is_amount and g.face_value = 10000 and g.balance = 10000 and not g.used, '금액형 등록: 액면가·잔액 1만 원, 아직 사용 안 함');

  g := public.spend_giftcon(g.id, 3500);
  perform public._assert_eq(g.balance, 6500, '3,500원 나눠 쓰면 잔액 6,500원');
  perform public._assert(not g.used, '잔액이 남으면 사용함이 아니다');
  perform public._assert_eq((select detail from public.giftcon_log where giftcon_id = g.id and action = '금액사용' order by id desc limit 1),
    '3,500원 사용 · 잔액 6,500원', '기록에 「금액사용 — 쓴 금액 · 잔액」이 남는다');

  perform public._assert_raises(format($q$select public.spend_giftcon(%L, 7000)$q$, g.id), '22023', '잔액보다 많이 쓸 수 없다');
  perform public._assert_raises(format($q$select public.spend_giftcon(%L, 0)$q$, g.id), '22023', '0원 이하는 거절');
  perform public._assert_raises(format($q$update public.giftcons set balance = 20000 where id = %L$q$, g.id), '23514', '잔액은 액면가를 넘을 수 없다(CHECK)');
  perform public._assert_raises(format($q$insert into public.giftcons (family_id, title, expires_on, is_amount, face_value) values (%L, 'x', current_date, true, 5000)$q$, v_fam),
    '23514', '금액형인데 잔액이 비면 CHECK 가 막는다');

  insert into public.giftcons (family_id, title, expires_on, face_value, balance) values (v_fam, '커피', current_date + 3, 500, 500) returning id into v_plain;
  perform public._assert((select face_value is null and balance is null from public.giftcons where id = v_plain), '금액형이 아니면 트리거가 금액 칸을 비운다');
  perform public._assert_raises(format($q$select public.spend_giftcon(%L, 100)$q$, v_plain), '22023', '금액형이 아니면 나눠 쓰기 거절');

  g := public.spend_giftcon(g.id, 6500);
  perform public._assert(g.balance = 0 and g.used and g.used_by = auth.uid() and g.used_at is not null, '잔액 0 이 되면 사용함(누가·언제 채움)');
  perform public._assert_raises(format($q$select public.spend_giftcon(%L, 1)$q$, g.id), '22023', '사용함이 된 뒤에는 나눠 쓰기 거절');

  update public.giftcons set used = false where id = g.id returning * into g;
  perform public._assert(not g.used and g.balance = 0, '잔액 0 인 채 사람이 체크를 풀면 그대로(수동 우선)');
  update public.giftcons set balance = 2000 where id = g.id returning * into g;
  perform public._assert(not g.used and g.balance = 2000, '잔액을 바로잡아 늘릴 수 있다');
  update public.giftcons set balance = 0 where id = g.id returning * into g;
  perform public._assert(g.used, '다시 0 이 되면 또 사용함');

  perform public._assert_eq((select string_agg(action || coalesce(':' || detail, ''), ' / ' order by id) from public.giftcon_log where giftcon_id = g.id),
    '등록 / 금액사용:3,500원 사용 · 잔액 6,500원 / 금액사용:6,500원 사용 · 잔액 0원 / 사용 / 사용취소 / 수정:바뀐 칸: 잔액 / 금액사용:2,000원 사용 · 잔액 0원 / 사용',
    '기록 순서: 등록 · 금액사용 · (다 쓰면) 사용 · 사용취소 · 잔액 바로잡기 = 수정');

  insert into public.giftcons (family_id, title, expires_on, is_amount, face_value, balance) values (v_fam, '다 쓴 상품권', current_date, true, 3000, 0) returning * into g;
  perform public._assert(g.used and g.used_by = auth.uid(), '잔액 0 으로 등록하면 바로 사용함');
end $t$;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
do $t$ begin
  perform public._assert_raises(format($q$select public.spend_giftcon(%L, 100)$q$, current_setting('test.amt')), 'P0002', '다른 가족(C)은 A 가족 상품권을 나눠 쓸 수 없다(RLS → 찾지 못함)');
end $t$;
set role anon;
set request.jwt.claim.sub = '';
do $t$ begin
  perform public._assert_raises(format($q$select public.spend_giftcon(%L, 100)$q$, current_setting('test.amt')), '42501', 'anon 은 spend_giftcon 을 실행하지 못한다');
end $t$;
set role authenticated;

-- ----------------------------------------------------------------------------
-- Storage — 같은 가족 폴더만
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] Storage — 같은 가족 폴더만'; end $t$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$
declare fa text := current_setting('test.fam_a');
begin
  perform public._assert_raises(format($q$insert into storage.objects (bucket_id, name) values ('giftcons', %L)$q$, fa || '/g1.jpg'),
    null, 'A 는 자기 가족 폴더에 사진을 올린다');
  perform public._assert_raises(format($q$insert into storage.objects (bucket_id, name) values ('giftcons', %L)$q$, current_setting('test.fam_c') || '/x.jpg'),
    '42501', 'A 는 다른 가족 폴더에 올리지 못한다');
  perform public._assert_raises($q$insert into storage.objects (bucket_id, name) values ('giftcons', 'abc/x.jpg')$q$,
    '42501', '가족 id 가 아닌 폴더에는 올리지 못한다');
  perform public._assert_raises(format($q$insert into storage.objects (bucket_id, name) values ('giftcons', %L)$q$, fa || '/'),
    '42501', '파일 이름이 빈 경로는 막는다');
end $t$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $t$ begin
  perform public._assert_rows($q$select 1 from storage.objects where bucket_id = 'giftcons'$q$, 1, '같은 가족 B 는 사진을 본다');
end $t$;
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
do $t$ begin
  perform public._assert_rows($q$select 1 from storage.objects$q$, 0, '다른 가족 C 는 사진을 못 본다');
  perform public._assert_rows($q$delete from storage.objects$q$, 0, '다른 가족 C 는 사진을 못 지운다');
end $t$;
set role anon;
set request.jwt.claim.sub = '';
do $t$ begin
  perform public._assert_rows($q$select 1 from storage.objects$q$, 0, 'anon 은 사진을 못 본다');
  perform public._assert_rows($q$select 1 from public.giftcons$q$, 0, 'anon 은 기프티콘을 못 본다');
end $t$;
reset role;

-- ----------------------------------------------------------------------------
-- 삭제 — 기록은 남는다 / 구성원이 나가면 예약만 풀린다
-- ----------------------------------------------------------------------------
do $t$ begin raise notice '[프로젝트] 삭제 · 가족에서 나가기'; end $t$;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$
declare v_fam uuid := current_setting('test.fam_a')::uuid; v_id uuid;
begin
  insert into public.giftcons (family_id, title, expires_on, reserved_by)
  values (v_fam, '치킨 세트', current_date + 30, 'bbbbbbbb-0000-0000-0000-000000000002') returning id into v_id;
  perform set_config('test.g2', v_id::text, false);
  perform public._assert_rows(format('delete from public.giftcons where id = %L', current_setting('test.g1')), 1, 'A 는 가족 기프티콘을 지운다');
  perform public._assert_eq((select action from public.giftcon_log where giftcon_id = current_setting('test.g1')::uuid order by id desc limit 1),
    '삭제', '지워도 「삭제」 기록이 남고 이전 기록도 그대로');
  perform public._assert_eq((select title from public.giftcon_log where giftcon_id = current_setting('test.g1')::uuid order by id desc limit 1),
    '아메리카노 T', '삭제 기록에 그때의 상품명이 남는다');
end $t$;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
do $t$ begin
  perform public._assert_rows('delete from public.family_members where user_id = auth.uid()', 1, 'B 는 가족에서 나갈 수 있다');
end $t$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $t$ begin
  perform public._assert((select reserved_by is null from public.giftcons where id = current_setting('test.g2')::uuid),
    'B 가 나가면 B 의 예약만 풀린다(기프티콘은 남음)');
end $t$;
reset role;

-- 제약 (postgres 로)
do $t$
begin
  perform public._assert_raises(format($q$insert into public.giftcons (family_id, title, expires_on, created_by, used, used_by) values (%L, 'x', current_date, gen_random_uuid(), false, gen_random_uuid())$q$, current_setting('test.fam_a')),
    null, '(트리거가 사용 안 함이면 used_by 를 비워 CHECK 를 지킨다)');
  perform public._assert_raises($q$insert into public.families (name, invite_code) values ('x', 'ABCDEFG0')$q$, '23514', '초대 코드 형식(0 포함)은 CHECK 가 막는다');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
