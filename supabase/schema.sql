-- ============================================================================
-- data09-21 — 가족 기프티콘 관리
-- Supabase(PostgreSQL) 스키마 + RLS + Storage 정책
--
--  무엇인가 : 가족이 함께 쓰는 기프티콘 보관함의 DB 입니다. 앱(index.html)의 「설정」에
--             본인 Supabase 주소·anon 키를 넣으면 이 표들을 씁니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 이 파일 전체를 한 번 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행,
--             버킷은 ON CONFLICT 로 설정만 다시 맞춤). 데이터는 지워지지 않습니다.
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 표 이름에 접두사를 붙이지 않았습니다.
--  Supabase 주소·키는 이 파일 어디에도 없습니다.
--
--  표 목록
--    families        가족 (이름 · 초대 코드)
--    family_members  가족 구성원 (표시 이름 · 만든 사람/구성원) — 한 사람은 한 가족에만
--    giftcons        기프티콘 (사진 경로 · 상품명 · 발행처 · 유효기간 · 메모 · 등록자 · 예약자 · 사용 여부
--                    · 금액형이면 액면가·잔액)
--    giftcon_log     기록 — 등록 · 수정 · 사용 · 금액사용 · 사용취소 · 예약 · 삭제 (덧붙이기만, 고치기·지우기 불가)
--
--  판 기록
--    2026-09-29 오후 늦게 — 금액형 상품권: giftcons.is_amount · face_value · balance, RPC spend_giftcon,
--                          기록 「금액사용」. 잔액이 0 이 되는 순간 「사용함」(체크는 사람이 다시 풀 수 있음).
--                          이미 1단계 스키마를 실행한 DB 에 이 파일을 다시 실행하면 칸만 더해집니다.
--  Storage
--    버킷 giftcons (비공개) — 파일 경로 「<가족 id>/<파일 이름>」, 같은 가족만 읽고 올리고 지움
--
--  보안
--    · 모든 표 RLS 켬. 행은 같은 가족 구성원만 봅니다(판정 함수 is_family_member).
--    · 가족 만들기·들어가기는 RPC(create_family · join_family)로만 합니다. 표에 직접 넣는 정책이 없습니다.
--    · 누가 사용했는지(used_by · used_at)와 등록자(created_by)는 트리거가 로그인한 사람으로 채웁니다.
--      앱이 다른 사람 이름을 보내도 바뀌지 않습니다.
--    · 기록(giftcon_log)은 트리거만 씁니다. 사용자에게는 읽기 정책만 있고 INSERT·UPDATE·DELETE 정책이 없습니다.
--    · 함수 EXECUTE 는 PUBLIC·anon 에서 걷고 authenticated 에만 남깁니다(RLS 정책이 판정 함수를 부르므로
--      authenticated 는 남겨야 합니다).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.families (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 40),
  invite_code  text not null,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  -- 헷갈리는 글자(I·O·0·1)를 뺀 대문자·숫자 8자리
  constraint families_invite_code_format check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint families_invite_code_key unique (invite_code)
);

create table if not exists public.family_members (
  family_id     uuid not null references public.families(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  display_name  text not null check (length(btrim(display_name)) between 1 and 20),
  role          text not null default 'member' check (role in ('owner', 'member')),
  joined_at     timestamptz not null default now(),
  constraint family_members_pkey primary key (family_id, user_id),
  -- 1단계는 한 사람이 한 가족에만 들어갑니다(앱이 「내 가족」을 하나로 봄)
  constraint family_members_user_key unique (user_id)
);

create table if not exists public.giftcons (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 100),   -- 상품명
  brand        text check (brand is null or length(brand) <= 50),              -- 발행처(브랜드)
  expires_on   date not null,                                                  -- 유효기간(이 날까지 사용 가능)
  memo         text check (memo is null or length(memo) <= 500),
  image_path   text,                                                           -- Storage 경로 '<family_id>/<파일>'
  created_by   uuid not null default auth.uid(),                               -- 등록자 (트리거가 채움)
  reserved_by  uuid,                                                           -- 예약자 (가족 구성원 중에서)
  used         boolean not null default false,                                 -- 「사용함」 — 사용자가 직접 표시
  used_by      uuid,                                                           -- 사용 표시한 사람 (트리거가 채움)
  used_at      timestamptz,                                                    -- 사용 표시 시각 (트리거가 채움)
  is_amount    boolean not null default false,                                 -- 금액형 상품권(나눠 씀)
  face_value   integer,                                                        -- 액면가(원) — 금액형만
  balance      integer,                                                        -- 잔액(원) — 금액형만
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 사진은 자기 가족 폴더에만
  constraint giftcons_image_in_family check (image_path is null or split_part(image_path, '/', 1) = family_id::text),
  -- 사용함이면 누가·언제가 있고, 아니면 둘 다 비어 있음
  constraint giftcons_used_consistent check (
    (used and used_by is not null and used_at is not null) or (not used and used_by is null and used_at is null)),
  -- 예약자는 같은 가족 구성원이어야 함. 구성원이 가족에서 나가면 예약만 풀림
  constraint giftcons_reserved_member_fkey foreign key (family_id, reserved_by)
    references public.family_members(family_id, user_id) on delete set null (reserved_by)
);
create index if not exists giftcons_family_expires_idx on public.giftcons (family_id, expires_on);

-- 1단계 스키마를 이미 실행한 DB 에 금액형 칸을 더합니다 (새 DB 에서는 위 create 가 이미 만들었으므로 건너뜀)
alter table public.giftcons add column if not exists is_amount  boolean not null default false;
alter table public.giftcons add column if not exists face_value integer;
alter table public.giftcons add column if not exists balance    integer;
-- 금액형이면 액면가 1원~1천만 원, 잔액 0~액면가. 아니면 둘 다 비어 있음
alter table public.giftcons drop constraint if exists giftcons_amount_consistent;
alter table public.giftcons add constraint giftcons_amount_consistent check (
  (not is_amount and face_value is null and balance is null)
  or (is_amount and face_value is not null and balance is not null      -- NULL 이면 CHECK 가 통과해 버리므로 명시
      and face_value between 1 and 10000000 and balance between 0 and face_value));

create table if not exists public.giftcon_log (
  id          bigint generated always as identity primary key,
  family_id   uuid not null references public.families(id) on delete cascade,
  giftcon_id  uuid not null,              -- 기프티콘을 지워도 기록은 남도록 FK 를 두지 않음
  action      text not null,
  title       text not null,              -- 그때의 상품명
  detail      text,                       -- 예) '예약: 엄마' · '예약 해제' · '바뀐 칸: 유효기간'
  actor       uuid,                       -- 한 사람
  actor_name  text,                       -- 그때의 표시 이름 (가족에서 나가도 기록에 남음)
  created_at  timestamptz not null default now()
);
create index if not exists giftcon_log_family_idx on public.giftcon_log (family_id, created_at desc);
-- 기록 종류 (「금액사용」은 2026-09-29 오후 늦게 더함 — 옛 DB 의 자동 이름 제약을 바꿔 끼웁니다)
alter table public.giftcon_log drop constraint if exists giftcon_log_action_check;
alter table public.giftcon_log add constraint giftcon_log_action_check
  check (action in ('등록', '수정', '사용', '금액사용', '사용취소', '예약', '삭제'));

-- ----------------------------------------------------------------------------
-- 2. 판정 함수 — security definer 인 이유
--    family_members 의 RLS 정책이 다시 family_members 를 읽으면 정책이 자기 자신을 부르는
--    무한 반복이 됩니다. 정의자 권한으로 읽어 이를 끊습니다. 결과는 참/거짓뿐입니다.
-- ----------------------------------------------------------------------------

-- 지금 로그인한 사람이 그 가족의 구성원인가
create or replace function public.is_family_member(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.family_members m
                  where m.family_id = p_family and m.user_id = auth.uid());
$fn$;

-- Storage 파일 경로 '<가족 id>/<파일>' 의 가족 구성원인가 (첫 칸이 uuid 모양이 아니면 거짓)
create or replace function public.can_access_family_file(p_name text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and split_part(p_name, '/', 2) <> ''
      then public.is_family_member(split_part(p_name, '/', 1)::uuid)
    else false
  end;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. RPC — 가족 만들기 · 초대 코드로 들어가기
-- ----------------------------------------------------------------------------

create or replace function public.create_family(p_name text, p_display_name text)
returns public.families language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_fam  public.families;
  v_code text;
  v_abc  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception '로그인이 필요합니다' using errcode = '28000'; end if;
  if exists (select 1 from public.family_members where user_id = v_uid) then
    raise exception '이미 가족에 들어가 있습니다' using errcode = '23505';
  end if;
  loop
    select string_agg(substr(v_abc, 1 + floor(random() * 32)::int, 1), '') into v_code
      from generate_series(1, 8);
    exit when not exists (select 1 from public.families where invite_code = v_code);
  end loop;
  insert into public.families (name, invite_code, created_by)
       values (btrim(p_name), v_code, v_uid) returning * into v_fam;
  insert into public.family_members (family_id, user_id, display_name, role)
       values (v_fam.id, v_uid, btrim(p_display_name), 'owner');
  return v_fam;
end;
$fn$;

create or replace function public.join_family(p_code text, p_display_name text)
returns public.families language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_fam  public.families;
begin
  if v_uid is null then raise exception '로그인이 필요합니다' using errcode = '28000'; end if;
  if exists (select 1 from public.family_members where user_id = v_uid) then
    raise exception '이미 가족에 들어가 있습니다' using errcode = '23505';
  end if;
  -- 소문자·빈칸·하이픈을 섞어 적어도 찾습니다
  select * into v_fam from public.families
   where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then raise exception '초대 코드를 찾지 못했습니다' using errcode = 'P0002'; end if;
  insert into public.family_members (family_id, user_id, display_name, role)
       values (v_fam.id, v_uid, btrim(p_display_name), 'member');
  return v_fam;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 4. 트리거 — 등록자·사용자 채우기, 기록 남기기
-- ----------------------------------------------------------------------------

-- 쓰기 전: 앱이 보낸 값보다 로그인한 사람을 믿습니다
create or replace function public.giftcons_before_write()
returns trigger language plpgsql set search_path = public as $fn$
begin
  -- 금액형이 아니면 금액 칸을 비웁니다
  if not new.is_amount then new.face_value := null; new.balance := null; end if;
  -- 잔액이 0 이 「되는 순간」 사용함 (이미 0 인 채 사람이 체크를 풀면 그대로 둠) — js/logic.js autoUsed 와 같음
  if new.is_amount and new.balance = 0 and not new.used
     and (tg_op = 'INSERT' or not old.is_amount or old.balance is null or old.balance > 0) then
    new.used := true;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    if new.used then new.used_by := auth.uid(); new.used_at := now();
    else new.used_by := null; new.used_at := null; end if;
  else
    -- 가족·등록자·만든 시각은 바꿀 수 없음
    new.id := old.id; new.family_id := old.family_id;
    new.created_by := old.created_by; new.created_at := old.created_at;
    if new.used and not old.used then new.used_by := auth.uid(); new.used_at := now();
    elsif new.used then new.used_by := old.used_by; new.used_at := old.used_at;
    else new.used_by := null; new.used_at := null; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

-- 쓴 뒤: 기록 표에 덧붙입니다 (사용자에게는 기록 표 INSERT 정책이 없으므로 정의자 권한)
create or replace function public.giftcons_write_log()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_row   public.giftcons := case when tg_op = 'DELETE' then old else new end;
  v_name  text;
  v_res   text;
  v_diff  text[] := '{}';
  v_spent boolean := false;
begin
  select display_name into v_name from public.family_members
   where family_id = v_row.family_id and user_id = auth.uid();

  if tg_op = 'INSERT' then
    insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
    values (new.family_id, new.id, '등록', new.title, null, auth.uid(), v_name);
    if new.reserved_by is not null then
      select display_name into v_res from public.family_members where family_id = new.family_id and user_id = new.reserved_by;
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '예약', new.title, '예약: ' || coalesce(v_res, '?'), auth.uid(), v_name);
    end if;
    if new.used then
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '사용', new.title, null, auth.uid(), v_name);
    end if;
  elsif tg_op = 'UPDATE' then
    if new.title is distinct from old.title then v_diff := array_append(v_diff, '상품명'); end if;
    if new.brand is distinct from old.brand then v_diff := array_append(v_diff, '발행처'); end if;
    if new.expires_on is distinct from old.expires_on then v_diff := array_append(v_diff, '유효기간'); end if;
    if new.memo is distinct from old.memo then v_diff := array_append(v_diff, '메모'); end if;
    if new.image_path is distinct from old.image_path then v_diff := array_append(v_diff, '사진'); end if;
    if new.is_amount is distinct from old.is_amount then v_diff := array_append(v_diff, '금액형'); end if;
    if new.face_value is distinct from old.face_value then v_diff := array_append(v_diff, '액면가'); end if;
    -- 잔액: 줄면 「금액사용」, 늘면(바로잡기) 「수정」의 바뀐 칸
    v_spent := old.is_amount and new.is_amount and new.balance < old.balance;
    if not v_spent and new.is_amount = old.is_amount and new.balance is distinct from old.balance then
      v_diff := array_append(v_diff, '잔액');
    end if;
    if cardinality(v_diff) > 0 then
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '수정', new.title, '바뀐 칸: ' || array_to_string(v_diff, ', '), auth.uid(), v_name);
    end if;
    if new.reserved_by is distinct from old.reserved_by then
      if new.reserved_by is null then v_res := null;
      else select display_name into v_res from public.family_members where family_id = new.family_id and user_id = new.reserved_by;
      end if;
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '예약', new.title,
              case when new.reserved_by is null then '예약 해제' else '예약: ' || coalesce(v_res, '?') end,
              auth.uid(), v_name);
    end if;
    if v_spent then
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '금액사용', new.title,
              to_char(old.balance - new.balance, 'FM999,999,999') || '원 사용 · 잔액 ' || to_char(new.balance, 'FM999,999,999') || '원',
              auth.uid(), v_name);
    end if;
    if new.used and not old.used then
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '사용', new.title, null, auth.uid(), v_name);
    elsif old.used and not new.used then
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (new.family_id, new.id, '사용취소', new.title, null, auth.uid(), v_name);
    end if;
  else
    -- 가족 자체가 지워지며 딸려 지워질 때는 기록할 가족이 없으므로 건너뜁니다
    if exists (select 1 from public.families where id = old.family_id) then
      insert into public.giftcon_log (family_id, giftcon_id, action, title, detail, actor, actor_name)
      values (old.family_id, old.id, '삭제', old.title, null, auth.uid(), v_name);
    end if;
  end if;
  return null;
end;
$fn$;

drop trigger if exists giftcons_before_write on public.giftcons;
create trigger giftcons_before_write before insert or update on public.giftcons
  for each row execute function public.giftcons_before_write();

drop trigger if exists giftcons_write_log on public.giftcons;
create trigger giftcons_write_log after insert or update or delete on public.giftcons
  for each row execute function public.giftcons_write_log();

-- ----------------------------------------------------------------------------
-- 4-1. RPC — 금액형 나눠 쓰기
--    두 가족이 같은 상품권을 동시에 써도 잔액을 한 번에 줄이고(행 잠금), 모자라면 거절합니다.
--    security invoker — 호출한 사람의 RLS 가 그대로 걸리므로 다른 가족 것은 「찾지 못했습니다」.
-- ----------------------------------------------------------------------------
create or replace function public.spend_giftcon(p_id uuid, p_amount integer)
returns public.giftcons language plpgsql security invoker set search_path = public as $fn$
declare
  g public.giftcons;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '28000'; end if;
  if p_amount is null or p_amount < 1 then
    raise exception '쓴 금액은 1원 이상이어야 합니다' using errcode = '22023';
  end if;
  select * into g from public.giftcons where id = p_id for update;
  if not found then raise exception '기프티콘을 찾지 못했습니다' using errcode = 'P0002'; end if;
  if not g.is_amount then raise exception '금액형 상품권이 아닙니다' using errcode = '22023'; end if;
  if g.used then raise exception '이미 사용함입니다. 체크를 풀고 다시 해 주세요' using errcode = '22023'; end if;
  if p_amount > g.balance then
    raise exception '잔액(%원)보다 많이 쓸 수 없습니다', to_char(g.balance, 'FM999,999,999') using errcode = '22023';
  end if;
  update public.giftcons set balance = balance - p_amount where id = p_id returning * into g;
  return g;
end;
$fn$;

-- ----------------------------------------------------------------------------
-- 5. 함수 권한 — 두 겹을 모두 걷습니다
--    ① PostgreSQL 이 함수를 만들 때 PUBLIC 에 EXECUTE 를 줍니다
--    ② Supabase 가 기본 권한으로 anon·authenticated 에 EXECUTE 를 줍니다
--    PUBLIC 만 걷으면 anon 이 남아 비로그인 호출이 뚫립니다. authenticated 는 남깁니다.
-- ----------------------------------------------------------------------------
revoke all on function public.is_family_member(uuid)             from public, anon;
revoke all on function public.can_access_family_file(text)       from public, anon;
revoke all on function public.create_family(text, text)          from public, anon;
revoke all on function public.join_family(text, text)            from public, anon;
revoke all on function public.giftcons_before_write()            from public, anon;
revoke all on function public.giftcons_write_log()               from public, anon;
revoke all on function public.spend_giftcon(uuid, integer)       from public, anon;
grant execute on function public.is_family_member(uuid)          to authenticated;
grant execute on function public.can_access_family_file(text)    to authenticated;
grant execute on function public.create_family(text, text)       to authenticated;
grant execute on function public.join_family(text, text)         to authenticated;
grant execute on function public.giftcons_before_write()         to authenticated;
grant execute on function public.giftcons_write_log()            to authenticated;
grant execute on function public.spend_giftcon(uuid, integer)     to authenticated;

-- 표시 이름만 고칠 수 있게: 구성원 표는 칸 단위로 UPDATE 를 엽니다(가족 옮기기·역할 바꾸기 차단)
revoke update on public.family_members from anon, authenticated;
grant update (display_name) on public.family_members to authenticated;

-- ----------------------------------------------------------------------------
-- 6. RLS 정책 — 같은 가족만
-- ----------------------------------------------------------------------------
alter table public.families       enable row level security;
alter table public.family_members enable row level security;
alter table public.giftcons       enable row level security;
alter table public.giftcon_log    enable row level security;

-- families: 읽기만 (만들기는 create_family RPC). 초대 코드는 그 가족만 봅니다
drop policy if exists families_select on public.families;
create policy families_select on public.families for select to authenticated
  using (public.is_family_member(id));

-- family_members: 같은 가족 읽기, 내 표시 이름 고치기, 가족에서 나가기(내 행 지우기)
drop policy if exists family_members_select on public.family_members;
create policy family_members_select on public.family_members for select to authenticated
  using (public.is_family_member(family_id));
drop policy if exists family_members_update_self on public.family_members;
create policy family_members_update_self on public.family_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists family_members_delete_self on public.family_members;
create policy family_members_delete_self on public.family_members for delete to authenticated
  using (user_id = auth.uid());

-- giftcons: 같은 가족이면 읽기·등록·고치기·지우기
drop policy if exists giftcons_select on public.giftcons;
create policy giftcons_select on public.giftcons for select to authenticated
  using (public.is_family_member(family_id));
drop policy if exists giftcons_insert on public.giftcons;
create policy giftcons_insert on public.giftcons for insert to authenticated
  with check (public.is_family_member(family_id));
drop policy if exists giftcons_update on public.giftcons;
create policy giftcons_update on public.giftcons for update to authenticated
  using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
drop policy if exists giftcons_delete on public.giftcons;
create policy giftcons_delete on public.giftcons for delete to authenticated
  using (public.is_family_member(family_id));

-- giftcon_log: 읽기만. INSERT 는 트리거(정의자 권한)만, UPDATE·DELETE 정책은 두지 않습니다(사후 조작 방지)
drop policy if exists giftcon_log_select on public.giftcon_log;
create policy giftcon_log_select on public.giftcon_log for select to authenticated
  using (public.is_family_member(family_id));

-- ----------------------------------------------------------------------------
-- 7. Storage — 비공개 버킷 giftcons, 경로 첫 칸 = 가족 id
--    앱은 사진을 긴 변 1280px JPEG 로 줄여 올리고, 볼 때는 1시간짜리 서명 URL 을 씁니다.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('giftcons', 'giftcons', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists giftcons_files_select on storage.objects;
create policy giftcons_files_select on storage.objects for select to authenticated
  using (bucket_id = 'giftcons' and public.can_access_family_file(name));
drop policy if exists giftcons_files_insert on storage.objects;
create policy giftcons_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'giftcons' and public.can_access_family_file(name));
drop policy if exists giftcons_files_update on storage.objects;
create policy giftcons_files_update on storage.objects for update to authenticated
  using (bucket_id = 'giftcons' and public.can_access_family_file(name))
  with check (bucket_id = 'giftcons' and public.can_access_family_file(name));
drop policy if exists giftcons_files_delete on storage.objects;
create policy giftcons_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'giftcons' and public.can_access_family_file(name));

-- ⚠ 이 스키마에는 upsert 를 쓰는 곳이 없습니다. 앞으로 쓰게 되면 onConflict 를 아래 UNIQUE 와
--   글자까지 같게 지정하세요:  family_members → 'user_id'  ·  families → 'invite_code'
