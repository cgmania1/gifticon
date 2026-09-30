# DB 설치 안내 (본인 Supabase 프로젝트)

가족이 함께 쓰려면 DB 가 필요합니다. 무료 등급으로 충분합니다. 한 번만 하면 되고, 가족 모두는 같은 주소·키를 앱에 넣고 각자 가입합니다.

## 1. 프로젝트 만들기

1. https://supabase.com 에 가입하고 **New project** 를 만듭니다(지역은 Seoul 권장). DB 비밀번호는 따로 적어 둡니다.
2. 왼쪽 **SQL Editor** → New query 에 이 폴더의 `schema.sql` 전체를 붙여 넣고 **Run**. 오류 없이 끝나면 됩니다. 여러 번 실행해도 안전합니다(데이터는 지워지지 않음).
   - 표 4개(families · family_members · giftcons · giftcon_log), 가족 RPC 2개, 트리거 2개, 비공개 사진 버킷 `giftcons` 와 정책이 만들어집니다.

## 2. 로그인 설정

- **Authentication → Sign In / Providers → Email** 이 켜져 있어야 합니다(기본값).
- 기본값은 가입하면 **인증 메일**이 가고, 링크를 눌러야 로그인됩니다. 가족끼리만 쓰고 메일 인증이 번거로우면 같은 화면의 **Confirm email** 을 끌 수 있습니다(누구나 아무 이메일로 가입할 수 있게 되지만, 초대 코드 없이는 가족 데이터를 볼 수 없습니다).
- 앱을 GitHub Pages 주소에서 쓰면 **Authentication → URL Configuration → Site URL** 에 `https://aebonlee.github.io/data09-21/` (또는 본인이 올린 주소)를 넣어 두세요. 인증 메일 링크가 그 주소로 돌아옵니다. 파일(file://)로 열어 쓸 때는 메일 링크를 누른 뒤 앱으로 돌아와 로그인하면 됩니다.

## 3. 앱에 연결

1. **Project Settings → API** 에서 **Project URL** 과 **anon public** 키(또는 publishable 키)를 복사합니다.
2. 앱 「설정」 → 「DB 연결」에 붙여 넣고 **연결 시험 후 저장**.
3. 로그인 화면에서 **처음이면 가입** → 로그인 → **새 가족 만들기**. 「가족」 화면의 초대 코드를 가족에게 알려 주면, 가족은 같은 방법으로 연결·가입한 뒤 **초대 코드로 들어가기**를 합니다.

**service_role(secret) 키는 절대 앱에 넣지 마세요.** 모든 보안(RLS)을 건너뛰는 키입니다. 앱은 anon 키가 아니면 거부합니다.

## 이미 실행한 DB 올리기 (2026-09-29 오후 늦게 — 금액형 상품권)

1단계 schema.sql 을 이미 실행했다면 **새 schema.sql 전체를 SQL Editor 에서 한 번 더 실행**하세요. 기존 가족·기프티콘·기록은 그대로 두고 금액형 칸(`is_amount · face_value · balance`), 나눠 쓰기 RPC(`spend_giftcon`), 기록 「금액사용」만 더해집니다. 앱에서 「DB 가 옛 판입니다」가 보이면 이 단계를 빠뜨린 것입니다.

## 보안 요약

- 같은 가족만 기프티콘·사진·기록을 봅니다(RLS, Storage 정책).
- 사용한 사람·등록한 사람·시각은 DB 가 로그인한 사람으로 기록합니다.
- 기록(giftcon_log)은 누구도 고치거나 지울 수 없습니다.
- 금액형 나눠 쓰기는 RPC 가 행을 잠그고 잔액을 줄여, 두 사람이 동시에 써도 잔액이 어긋나지 않습니다.

## 로컬 검증 (개발자용)

`./scripts/sqltest/run.sh` — 임시 PostgreSQL 에 schema.sql 을 두 번 적용하고(1단계 판 위에 다시 실행하는 올림 검사 포함) 권한·RLS·트리거·Storage 정책을 확인합니다(PostgreSQL 16·17 필요). 운영 DB 에서는 검증 파일이 스스로 멈춥니다.
