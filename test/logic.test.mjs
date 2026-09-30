// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const TODAY = '2026-09-29';
const g = (over) => Object.assign({ id: 'x', title: '상품', brand: '', expiresOn: TODAY, used: false, reservedBy: null }, over || {});

console.log('날짜');
test('날짜 형식 여러 가지 → YYYY-MM-DD, 없는 날은 null', () => {
  assert.equal(L.normDate('2026.10.5'), '2026-10-05');
  assert.equal(L.normDate('2026/10/05'), '2026-10-05');
  assert.equal(L.normDate('20261005'), '2026-10-05');
  assert.equal(L.normDate('2026년 10월 5일'), '2026-10-05');
  assert.equal(L.normDate('2026-02-30'), null);
  assert.equal(L.normDate('내일'), null);
});
test('남은 날 — 월·해 경계, 음수(지남)', () => {
  assert.equal(L.daysLeft('2026-10-01', '2026-09-29'), 2);
  assert.equal(L.daysLeft('2027-01-01', '2026-12-31'), 1);
  assert.equal(L.daysLeft('2026-09-26', '2026-09-29'), -3);
  assert.equal(L.addDays('2026-09-29', 3), '2026-10-02');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
});

console.log('상태 · D-day');
test('유효기간 당일은 아직 사용 가능(D-DAY), 다음 날부터 만료', () => {
  assert.equal(L.statusOf(g({ expiresOn: TODAY }), TODAY), 'soon');
  assert.equal(L.ddayText(g({ expiresOn: TODAY }), TODAY), 'D-DAY');
  assert.equal(L.statusText(g({ expiresOn: TODAY }), TODAY), '오늘까지 사용');
  assert.equal(L.statusOf(g({ expiresOn: '2026-09-28' }), TODAY), 'expired');
  assert.equal(L.statusText(g({ expiresOn: '2026-09-28' }), TODAY), '만료 · 1일 지남');
});
test('7일 이내 = 곧 만료, 8일부터 여유', () => {
  assert.equal(L.statusOf(g({ expiresOn: L.addDays(TODAY, 7) }), TODAY), 'soon');
  assert.equal(L.statusOf(g({ expiresOn: L.addDays(TODAY, 8) }), TODAY), 'ok');
  assert.equal(L.ddayText(g({ expiresOn: L.addDays(TODAY, 8) }), TODAY), 'D-8');
});
test('사용함이 만료보다 먼저 (사용한 뒤 기한이 지나도 「사용함」)', () => {
  const x = g({ expiresOn: '2026-09-01', used: true });
  assert.equal(L.statusOf(x, TODAY), 'used');
  assert.equal(L.ddayText(x, TODAY), '사용함');
});
test('상태 글자에 색 없이도 알 수 있는 말이 들어 있다', () => {
  assert.match(L.statusText(g({ expiresOn: L.addDays(TODAY, 3) }), TODAY), /곧 만료/);
  assert.match(L.statusText(g({ expiresOn: L.addDays(TODAY, 30) }), TODAY), /사용 가능/);
});

console.log('요약 · 거르기 · 정렬');
const LIST = [
  g({ id: 'a', title: 'A', expiresOn: L.addDays(TODAY, 1) }),
  g({ id: 'b', title: 'B', expiresOn: L.addDays(TODAY, 30) }),
  g({ id: 'c', title: 'C', expiresOn: L.addDays(TODAY, 0) }),
  g({ id: 'd', title: 'D', expiresOn: L.addDays(TODAY, 5), used: true, usedAt: '2026-09-28T10:00:00Z' }),
  g({ id: 'e', title: 'E', expiresOn: L.addDays(TODAY, -2) }),
  g({ id: 'f', title: 'F', expiresOn: L.addDays(TODAY, -10) }),
  g({ id: 'h', title: 'H', expiresOn: L.addDays(TODAY, 9), used: true, usedAt: '2026-09-29T10:00:00Z' })
];
test('요약: 사용 가능(곧 만료 포함) · 7일 이내 · 사용함 · 만료', () => {
  assert.deepEqual(L.summarize(LIST, TODAY), { usable: 3, soon: 2, used: 2, expired: 2, total: 7 });
  assert.deepEqual(L.summarize([], TODAY), { usable: 0, soon: 0, used: 0, expired: 0, total: 0 });
});
test('탭 거르기 + 유효기간 빠른 순', () => {
  assert.deepEqual(L.filterList(LIST, 'usable', TODAY).map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(L.filterList(LIST, 'soon', TODAY).map((x) => x.id), ['c', 'a']);
  assert.deepEqual(L.filterList(LIST, 'used', TODAY).map((x) => x.id), ['h', 'd']);
  assert.deepEqual(L.filterList(LIST, 'expired', TODAY).map((x) => x.id), ['e', 'f']);
});
test('전체: 쓸 수 있는 것 → 만료 → 사용함 순', () => {
  assert.deepEqual(L.filterList(LIST, 'all', TODAY).map((x) => x.id), ['c', 'a', 'b', 'e', 'f', 'h', 'd']);
});
test('탭 목록의 수 = 요약 수 (화면 숫자와 목록이 어긋나지 않음)', () => {
  const s = L.summarize(LIST, TODAY);
  for (const t of ['usable', 'soon', 'used', 'expired']) assert.equal(L.filterList(LIST, t, TODAY).length, s[t], t);
  assert.equal(L.filterList(LIST, 'all', TODAY).length, s.total);
});

console.log('알림');
test('알림 시점 읽기: 쉼표·D- 접두·중복·범위 밖', () => {
  assert.deepEqual(L.parseAlertDays('7, 1'), [7, 1]);
  assert.deepEqual(L.parseAlertDays('D-1, d7 · 7 0'), [7, 1, 0]);
  assert.deepEqual(L.parseAlertDays(['3', 'x', '400', '']), [3]);
  assert.deepEqual(L.parseAlertDays(''), []);
});
test('알림 대상: 사용 안 함 · 만료 전 · 가장 큰 시점 안, 남은 날 순', () => {
  const a = L.alertsFor(LIST, [7, 1], TODAY);
  assert.deepEqual(a.map((x) => [x.g.id, x.d, x.level]), [['c', 0, 1], ['a', 1, 1]]);
  const b = L.alertsFor(LIST.concat(g({ id: 'k', expiresOn: L.addDays(TODAY, 3) })), [7, 1], TODAY);
  assert.deepEqual(b.map((x) => [x.g.id, x.level]), [['c', 1], ['a', 1], ['k', 7]]);
});
test('알림 시점을 D-30 으로 넓히면 30일 남은 것도, 비우면 알림 없음', () => {
  assert.equal(L.alertsFor(LIST, [30], TODAY).length, 3);
  assert.equal(L.alertsFor(LIST, [], TODAY).length, 0);
  assert.deepEqual(L.alertsFor(LIST, [0], TODAY).map((x) => x.g.id), ['c']);
});

test('알림 기본값 D-7 · D-2 · D-1 (2026-09-29 수강생 답변), 옛 기본값 D-7 · D-1 은 새 기본값으로 올림', () => {
  assert.deepEqual(L.DEFAULT_ALERT_DAYS, [7, 2, 1]);
  assert.deepEqual(L.resolveAlertDays(undefined, false), [7, 2, 1]);
  assert.deepEqual(L.resolveAlertDays([7, 1], false), [7, 2, 1]);
  assert.deepEqual(L.resolveAlertDays([7, 1], true), [7, 1], '사용자가 직접 저장한 값은 그대로');
  assert.deepEqual(L.resolveAlertDays([30, 3], false), [30, 3]);
  assert.deepEqual(L.resolveAlertDays([], true), [], '알림 끔도 그대로');
  assert.ok(L.ALERT_CHOICES.includes(2));
  assert.equal(L.alertDaysText([7, 2, 1, 0]), 'D-7 · D-2 · D-1 · 당일');
});
test('기본 시점으로 D-2 남은 것은 「D-2 알림」, D-5 는 「D-7 알림」', () => {
  const x = [g({ id: 'p', expiresOn: L.addDays(TODAY, 2) }), g({ id: 'q', expiresOn: L.addDays(TODAY, 5) })];
  assert.deepEqual(L.alertsFor(x, L.DEFAULT_ALERT_DAYS, TODAY).map((a) => [a.g.id, a.level]), [['p', 2], ['q', 7]]);
});

console.log('금액형 상품권');
test('금액 읽기: 쉼표·원·만/천 단위, 못 읽으면 null', () => {
  assert.equal(L.parseWon('10,000'), 10000);
  assert.equal(L.parseWon('5000원'), 5000);
  assert.equal(L.parseWon('1만원'), 10000);
  assert.equal(L.parseWon('1만 5천원'), 15000);
  assert.equal(L.parseWon('3천'), 3000);
  assert.equal(L.parseWon(''), '');
  assert.equal(L.parseWon('만원쯤'), null);
  assert.equal(L.parseWon('-100'), null);
  assert.equal(L.parseWon(4500), 4500);
  assert.equal(L.won(1234567), '1,234,567원');
});
test('금액형 검증: 액면가 필수, 잔액 비우면 액면가, 잔액 ≤ 액면가, 한도 1천만', () => {
  const base = { title: '상품권', expiresOn: TODAY, isAmount: true };
  assert.deepEqual(L.validateGiftcon(Object.assign({}, base, { faceValue: '1만원', balance: '' })).value.balance, 10000);
  const v = L.validateGiftcon(Object.assign({}, base, { faceValue: '10,000', balance: '3,500' }));
  assert.equal(v.ok, true);
  assert.deepEqual([v.value.faceValue, v.value.balance], [10000, 3500]);
  assert.equal(L.validateGiftcon(Object.assign({}, base, { faceValue: '', balance: '' })).ok, false);
  assert.match(L.validateGiftcon(Object.assign({}, base, { faceValue: '5000', balance: '6000' })).errors[0], /액면가보다/);
  assert.equal(L.validateGiftcon(Object.assign({}, base, { faceValue: '20000000' })).ok, false);
  assert.equal(L.validateGiftcon(Object.assign({}, base, { faceValue: '5000', balance: '0' })).value.balance, 0);
  // 금액형을 끄면 금액 칸은 버림
  const off = L.validateGiftcon({ title: 'x', expiresOn: TODAY, isAmount: false, faceValue: '5000', balance: '1' });
  assert.deepEqual([off.value.faceValue, off.value.balance], [null, null]);
});
const nameOfA = (id) => ({ u1: '엄마', u2: '아빠' })[id] || '?';
const AMT = g({ id: 'm', title: '상품권', isAmount: true, faceValue: 10000, balance: 6500 });
test('나눠 쓰기: 잔액이 줄고, 0 이 되면 사용함, 잔액보다 많이는 못 씀', () => {
  assert.deepEqual(L.spendResult(AMT, '4,500'), { ok: true, error: null, amount: 4500, balance: 2000, used: false });
  assert.deepEqual(L.spendResult(AMT, 6500), { ok: true, error: null, amount: 6500, balance: 0, used: true });
  assert.match(L.spendResult(AMT, '7000').error, /잔액/);
  assert.match(L.spendResult(AMT, '0').error, /1원 이상/);
  assert.match(L.spendResult(AMT, '').error, /숫자/);
  assert.match(L.spendResult(g(), '100').error, /금액형 상품권이 아닙니다/);
  assert.match(L.spendResult(Object.assign({}, AMT, { used: true }), '100').error, /사용함/);
  assert.equal(L.balanceText(AMT), '잔액 6,500원 / 10,000원');
  assert.equal(L.balanceText(g()), '');
});
test('잔액 0 이 「되는 순간」만 자동 사용함 — 이미 0 인 채 체크를 풀면 그대로(수동 우선)', () => {
  const zero = Object.assign({}, AMT, { balance: 0 });
  assert.equal(L.autoUsed(AMT, zero), true);
  assert.equal(L.autoUsed(null, zero), true, '잔액 0 으로 등록하면 사용함');
  assert.equal(L.autoUsed(zero, Object.assign({}, zero, { used: false })), false, '0 인 채 체크 풀기는 그대로');
  assert.equal(L.autoUsed(AMT, Object.assign({}, AMT, { balance: 100 })), false);
  assert.equal(L.autoUsed(g(), g({ used: true })), true, '금액형이 아니면 체크 그대로');
  assert.equal(L.autoUsed(g(), g()), false);
});
test('기록: 나눠 쓰면 「금액사용 N원 · 잔액」, 다 쓰면 + 「사용」, 잔액을 늘려 고치면 「수정: 잔액」', () => {
  assert.deepEqual(L.logEntriesFor(AMT, Object.assign({}, AMT, { balance: 2000 }), nameOfA).map((x) => [x.action, x.detail]),
    [['금액사용', '4,500원 사용 · 잔액 2,000원']]);
  assert.deepEqual(L.logEntriesFor(AMT, Object.assign({}, AMT, { balance: 0, used: true }), nameOfA).map((x) => x.action), ['금액사용', '사용']);
  assert.deepEqual(L.logEntriesFor(AMT, Object.assign({}, AMT, { balance: 8000 }), nameOfA).map((x) => [x.action, x.detail]),
    [['수정', '바뀐 칸: 잔액']]);
  assert.deepEqual(L.logEntriesFor(g(), Object.assign({}, g(), { isAmount: true, faceValue: 5000, balance: 5000 }), nameOfA).map((x) => [x.action, x.detail]),
    [['수정', '바뀐 칸: 금액형, 액면가']]);
});

console.log('사진에서 채우기 (선택 도우미)');
test('요청문: 네 칸을 JSON 으로, 바코드는 읽지 말라고 요청형으로', () => {
  assert.match(L.READ_PROMPT, /"상품명".*"발행처".*"유효기간".*"금액"/);
  assert.match(L.READ_PROMPT, /바코드/);
  assert.match(L.READ_PROMPT, /해줘/);
});
test('AI 답 읽기: 코드 블록·앞뒤 말 섞여도, 날짜 형식 바로잡기, 금액 숫자로', () => {
  const r = L.parseReadAnswer('여기 있습니다.\n```json\n{"상품명": " 아메리카노 T ", "발행처": "카페 A", "유효기간": "2026.10.5", "금액": null}\n```');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { title: '아메리카노 T', brand: '카페 A', expiresOn: '2026-10-05', amount: null });
  assert.deepEqual(r.warnings, []);
  const e = L.parseReadAnswer('{"title":"상품권","expiresOn":"2027-01-31","amount":"1만원"}');
  assert.deepEqual(e.value, { title: '상품권', brand: '', expiresOn: '2027-01-31', amount: 10000 });
});
test('AI 답 읽기: 못 읽은 칸은 경고, JSON 없으면 실패, 빈 답은 실패', () => {
  const r = L.parseReadAnswer('{"상품명":"케이크","유효기간":"다음 달"}');
  assert.equal(r.ok, true);
  assert.equal(r.value.expiresOn, null);
  assert.match(r.warnings.join(' '), /날짜로 읽지 못했/);
  assert.equal(L.parseReadAnswer('사진이 흐립니다').ok, false);
  assert.equal(L.parseReadAnswer('{"상품명": 이상}').ok, false);
  assert.equal(L.parseReadAnswer('{"상품명":"","유효기간":""}').ok, false);
  assert.equal(L.parseReadAnswer('[1,2]').ok, false);
});
test('OpenAI 키 모양 검사 (브라우저에만 저장)', () => {
  assert.equal(L.validateOpenAIKey('sk-proj-abcdefghijklmnopqrstuvwxyz0123'), null);
  assert.ok(L.validateOpenAIKey(''));
  assert.ok(L.validateOpenAIKey('eyJhbGciOi.xxx.yyy'));
});

console.log('입력 검증');
test('상품명·유효기간 필수, 날짜 형식 바로잡기', () => {
  const r = L.validateGiftcon({ title: '  아메리카노 ', brand: '카페', expiresOn: '2026.10.5', memo: '', reservedBy: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { title: '아메리카노', brand: '카페', expiresOn: '2026-10-05', memo: '', reservedBy: null, isAmount: false, faceValue: null, balance: null });
  const bad = L.validateGiftcon({ title: ' ', expiresOn: '' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 2);
  assert.match(L.validateGiftcon({ title: 'x', expiresOn: '10월 말' }).errors[0], /날짜/);
});
test('길이 제한 (DB CHECK 와 같음: 상품명 100 · 발행처 50 · 메모 500)', () => {
  assert.equal(L.validateGiftcon({ title: 'a'.repeat(101), expiresOn: TODAY }).ok, false);
  assert.equal(L.validateGiftcon({ title: 'a', brand: 'b'.repeat(51), expiresOn: TODAY }).ok, false);
  assert.equal(L.validateGiftcon({ title: 'a', memo: 'm'.repeat(501), expiresOn: TODAY }).ok, false);
  assert.equal(L.validateGiftcon({ title: 'a'.repeat(100), brand: 'b'.repeat(50), memo: 'm'.repeat(500), expiresOn: TODAY }).ok, true);
});
test('사진 파일 검사와 줄이기 크기', () => {
  assert.equal(L.validateImageFile({ type: 'image/jpeg', size: 1000 }), null);
  assert.match(L.validateImageFile({ type: 'application/pdf', size: 1000 }), /사진/);
  assert.match(L.validateImageFile({ type: 'image/png', size: 11 * 1024 * 1024 }), /10MB/);
  assert.deepEqual(L.fitSize(3000, 1500, 1280), { w: 1280, h: 640 });
  assert.deepEqual(L.fitSize(1080, 2340, 1280), { w: 591, h: 1280 });
  assert.deepEqual(L.fitSize(800, 600, 1280), { w: 800, h: 600 });
});

console.log('가족 · 연결 설정');
test('초대 코드: 소문자·하이픈·빈칸 정리, 헷갈리는 글자(0·1·I·O) 거부', () => {
  assert.equal(L.normalizeInviteCode(' abcd-2345 '), 'ABCD2345');
  assert.equal(L.isInviteCode('ABCD2345'), true);
  assert.equal(L.isInviteCode('ABCD2340'), false);
  assert.equal(L.isInviteCode('ABCI2345'), false);
  assert.equal(L.isInviteCode('ABC2345'), false);
  assert.equal(L.formatInviteCode('ABCD2345'), 'ABCD-2345');
});
test('표시 이름 1~20자', () => {
  assert.equal(L.validateDisplayName('엄마'), null);
  assert.ok(L.validateDisplayName('  '));
  assert.ok(L.validateDisplayName('가'.repeat(21)));
});
function fakeJwt(role) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ iss: 'supabase', ref: 'example', role }) + '.sig';
}
test('연결 설정: https 주소 + anon 키만, service_role 키는 거부', () => {
  const ok = L.validateConn('https://abcd1234.supabase.co/', fakeJwt('anon'));
  assert.equal(ok.ok, true);
  assert.equal(ok.url, 'https://abcd1234.supabase.co');
  assert.equal(L.validateConn('https://abcd1234.supabase.co', 'sb_publishable_abcdefghij12').ok, true);
  const sr = L.validateConn('https://abcd1234.supabase.co', fakeJwt('service_role'));
  assert.equal(sr.ok, false);
  assert.match(sr.errors[0], /service_role/);
  assert.equal(L.validateConn('http://abcd1234.supabase.co', fakeJwt('anon')).ok, false);
  assert.equal(L.validateConn('https://abcd1234.supabase.co', '').ok, false);
  assert.equal(L.jwtRole('not-a-jwt'), null);
});
test('구성원 이름 찾기 — 나간 사람은 「(나간 가족)」', () => {
  const m = [{ userId: 'u1', displayName: '엄마' }];
  assert.equal(L.memberName(m, 'u1'), '엄마');
  assert.equal(L.memberName(m, 'u9'), '(나간 가족)');
  assert.equal(L.memberName(m, null), '');
});

console.log('기록 (DB 트리거와 같은 규칙)');
const nameOf = (id) => ({ u1: '엄마', u2: '아빠' })[id] || '?';
test('등록: 등록 + (예약자 있으면) 예약', () => {
  const e = L.logEntriesFor(null, g({ id: 'g1', title: '커피', reservedBy: 'u2' }), nameOf);
  assert.deepEqual(e.map((x) => [x.action, x.detail]), [['등록', null], ['예약', '예약: 아빠']]);
});
test('사용 · 사용취소 · 예약 해제 · 수정(바뀐 칸) · 삭제', () => {
  const a = g({ id: 'g1', title: '커피', reservedBy: 'u2', memo: '' });
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { used: true }), nameOf).map((x) => x.action), ['사용']);
  assert.deepEqual(L.logEntriesFor(Object.assign({}, a, { used: true }), a, nameOf).map((x) => x.action), ['사용취소']);
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { reservedBy: null }), nameOf).map((x) => x.detail), ['예약 해제']);
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { expiresOn: '2026-10-10', memo: '잔액 3천원' }), nameOf).map((x) => [x.action, x.detail]),
    [['수정', '바뀐 칸: 유효기간, 메모']]);
  assert.deepEqual(L.logEntriesFor(a, null, nameOf).map((x) => [x.action, x.title]), [['삭제', '커피']]);
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a), nameOf), []);
});
test('빈 칸 null ↔ \'\' 은 바뀐 것으로 보지 않는다', () => {
  const a = g({ memo: null, brand: null });
  assert.deepEqual(L.logEntriesFor(a, Object.assign({}, a, { memo: '', brand: '' }), nameOf), []);
});

console.log('DB 행 ↔ 화면 모양');
test('fromRow / toRow — 누가·언제는 앱이 보내지 않는다', () => {
  const r = { id: 'i', family_id: 'f', title: 't', brand: null, expires_on: '2026-10-01', memo: null, image_path: 'f/a.jpg',
    created_by: 'u1', reserved_by: null, used: true, used_by: 'u2', used_at: '2026-09-29T01:00:00Z', created_at: 'c', updated_at: 'u' };
  const x = L.fromRow(r);
  assert.equal(x.expiresOn, '2026-10-01');
  assert.equal(x.usedBy, 'u2');
  assert.equal(x.used, true);
  const back = L.toRow(Object.assign({}, x, { brand: '' }));
  assert.deepEqual(Object.keys(back).sort(), ['balance', 'brand', 'expires_on', 'face_value', 'image_path', 'is_amount', 'memo', 'reserved_by', 'title', 'used'].sort());
  assert.equal(back.is_amount, false);
  assert.equal(back.face_value, null);
  const amt = L.fromRow(Object.assign({}, r, { is_amount: true, face_value: 10000, balance: 3000 }));
  assert.deepEqual([amt.isAmount, amt.faceValue, amt.balance], [true, 10000, 3000]);
  assert.deepEqual(L.toRow({ isAmount: false, faceValue: 5, balance: 5 }), { is_amount: false, face_value: null, balance: null });
  assert.equal(back.brand, null);
  assert.ok(!('used_by' in back) && !('created_by' in back) && !('family_id' in back));
});

console.log('체험 모드 예시 데이터');
test('예시: 8장 — 사용 가능 6 · 7일 이내 4 · 사용함 1 · 만료 1 (오늘 기준으로 만들어짐)', () => {
  for (const day of [TODAY, '2027-02-28', '2026-12-31']) {
    const db = Sample.build(day);
    assert.equal(db.giftcons.length, 8);
    assert.deepEqual(L.summarize(db.giftcons, day), { usable: 6, soon: 4, used: 1, expired: 1, total: 8 }, day);
  }
});
test('예시: 모든 카드에 사진 · 예약자는 구성원 · 기록이 등록 순서로 있다', () => {
  const db = Sample.build(TODAY);
  const ids = db.members.map((m) => m.userId);
  for (const x of db.giftcons) {
    assert.ok(db.images[x.id] && db.images[x.id].startsWith('data:image/svg+xml'), x.id);
    if (x.reservedBy) assert.ok(ids.includes(x.reservedBy));
    assert.ok(L.validateGiftcon(x).ok, x.title);
  }
  assert.equal(db.log.filter((e) => e.action === '등록').length, 8);
  assert.equal(db.log.filter((e) => e.action === '사용').length, 1);
  assert.equal(db.log.filter((e) => e.action === '예약').length, 2);
  assert.equal(db.log.filter((e) => e.action === '금액사용').length, 1);
  const amt = db.giftcons.filter((x) => x.isAmount);
  assert.deepEqual(amt.map((x) => [x.faceValue, x.balance, x.used]), [[10000, 6500, false]]);
  for (let i = 1; i < db.log.length; i++) assert.ok(db.log[i - 1].createdAt <= db.log[i].createdAt);
});

console.log('무료 글자 읽기(OCR) 결과 나누기 — 2026-09-29 저녁');
// 아래 글자는 test/ocr-samples/ 가짜 기프티콘을 Tesseract.js 로 실제로 읽은 결과(바코드 번호는 가짜)
const OCR_CAFE = '선물함 (예시ㆍ가짜 쿠폰)\n하늘카페\n아메리카노 Tall\n교환처 : 하늘카페\n유효기간 2026.10.31\n9000 1111 2222 33';
test('라벨 있는 캡처: 교환처·유효기간, 상품명은 머리글(선물함)을 건너뜀', () => {
  const r = L.parseOcrText(OCR_CAFE, TODAY);
  assert.ok(r.ok);
  assert.deepEqual(r.value, { title: '아메리카노 Tall', brand: '하늘카페', expiresOn: '2026-10-31', amount: null });
});
test('바코드·쿠폰·주문번호는 어느 칸에도 들어가지 않는다', () => {
  const t = '8801234567890\n쿠폰번호 1234-5678-9012\n주문번호 20260929-771\n치즈케이크\n유효기간 ~ 2026.11.01\n1234 5678 9012 3456';
  const r = L.parseOcrText(t, TODAY);
  const all = JSON.stringify(r);
  for (const bad of ['8801234567890', '1234', '9012', '771']) assert.ok(!all.includes(bad), bad);
  assert.equal(r.value.title, '치즈케이크');
  assert.equal(r.value.expiresOn, '2026-11-01');
});
test('날짜 모양: 2026년 12월 24일까지 · 26.10.09 · 기간(시작 ~ 끝)은 끝 날 · ~10/20 은 올해', () => {
  assert.equal(L.parseOcrText('치킨\n유효기간 2026년 12월 24일까지', TODAY).value.expiresOn, '2026-12-24');
  assert.equal(L.parseOcrText('라떼\n교환 기한 26.10.09', TODAY).value.expiresOn, '2026-10-09');
  assert.equal(L.parseOcrText('케이크\n유효기간\n2026.09.01 ~ 2026.11.15', TODAY).value.expiresOn, '2026-11-15');
  const r = L.parseOcrText('아이스크림 파인트\n~10/20 까지 사용', TODAY);
  assert.equal(r.value.expiresOn, '2026-10-20');
  assert.ok(r.warnings.some((w) => w.includes('연도가 없어')));
  // 연도 없는 날짜가 한참 지난 달이면 내년
  assert.equal(L.parseOcrText('빵\n~01/15 까지', TODAY).value.expiresOn, '2027-01-15');
});
test('「유효기간」 글자가 없으면 가장 늦은 날짜 + 확인 경고, 날짜가 없으면 경고만', () => {
  const r = L.parseOcrText('도넛\n발행 2026.09.01\n2026.12.31', TODAY);
  assert.equal(r.value.expiresOn, '2026-12-31');
  assert.ok(r.warnings.some((w) => w.includes('가장 늦은 날짜')));
  const r2 = L.parseOcrText('도넛 세트', TODAY);
  assert.equal(r2.value.expiresOn, null);
  assert.ok(r2.warnings.some((w) => w.includes('유효기간을 읽지 못했습니다')));
});
test('금액형: 10,000원권 · 1만원권 → 금액, 「10,000원권」 줄은 상품명이 아님, 「전 매장」은 발행처에서 뗌', () => {
  const r = L.parseOcrText('선물함\n별빛마트 모바일 상품권\n10,000원권\n사용처 : 별빛마트 전 매장\n사용기한 ~ 2026-10-05\n8800 1234 5678 90', TODAY);
  assert.deepEqual(r.value, { title: '별빛마트 모바일 상품권', brand: '별빛마트', expiresOn: '2026-10-05', amount: 10000 });
  assert.equal(L.parseOcrText('편의점 상품권\n1만원권\n유효기간 2026.12.01', TODAY).value.amount, 10000);
  assert.equal(L.parseOcrText('아메리카노\n유효기간 2026.12.01', TODAY).value.amount, null);
});
test('줄 높이를 알면 가장 큰 글자가 상품명, 그 위 짧은 줄이 발행처(추측 경고), 흐린 줄(확신도 낮음)은 제외', () => {
  const r = L.parseOcrText({ text: '', lines: [
    { text: 'MEE (예시 가짜)', h: 22, conf: 41 },
    { text: '달빛베이커리', h: 22, conf: 92 },
    { text: '생크림 케이크 1호', h: 32, conf: 95 },
    { text: '유효기간', h: 22, conf: 90 },
    { text: '2026.09.01 ~ 2026.11.15', h: 22, conf: 90 }] }, TODAY);
  assert.deepEqual(r.value, { title: '생크림 케이크 1호', brand: '달빛베이커리', expiresOn: '2026-11-15', amount: null });
  assert.ok(r.warnings.some((w) => w.includes('발행처를 추측')));
});
test('읽은 것이 없으면 실패 · 보여 줄 때 긴 숫자(10자리 이상)만 가림, 날짜는 그대로', () => {
  assert.equal(L.parseOcrText('', TODAY).ok, false);
  assert.equal(L.parseOcrText('1234 5678 9012 3456\n== ==', TODAY).ok, false);
  assert.equal(L.maskLongDigits('유효기간 2026.10.31\n9000 1111 2222 33'), '유효기간 2026.10.31\n**** **** **** **');
  assert.equal(L.maskLongDigits('사용기한 ~ 2026-10-05'), '사용기한 ~ 2026-10-05');
});

console.log('무료 글자 읽기 — 실제 캡처 2장으로 보강 (2026-09-30)');
// 수강생 실제 기프티콘 캡처를 Tesseract.js 로 읽은 줄(글자·높이·확신도). 사진 자체는 저장소에 넣지 않았습니다.
// 두 사진의 배치를 흉내 낸 예시 그림은 test/ocr-samples/8_voucher_wrap.jpg · 9_highlight_brand.jpg
const ln = (arr) => ({ text: '', lines: arr.map(([text, h, conf]) => ({ text, h, conf })) });
const REAL_VOUCHER = ln([['LIT', 35, 19], ['emart', 25, 88], ['이마트/트레이더스 5만원', 23, 93], ['8.          A', 20, 48],
  ['50,000       수랭금액. 1개', 20, 75], ['사용기한 _. ~2024.02.23', 16, 71], ['사용처      이마트', 18, 94], ['® gifticon', 16, 38],
  ['기프티콘 Aoj= 공짜 무료티콘이 많다던데..', 18, 84]]);
const REAL_COFFEE = ln([['12:15', 47, 52], ['<                            쿠폰함                           X', 53, 89], ['더블 따아 세트', 64, 87],
  ['유효기간 : 2026.09.16 ~ 2026.09.30', 43, 92], ['ㅇㅇ', 23, 62], ['INnUNMber', 52, 2], ['= 상품은 무상제공되어', 35, 91],
  ['유효기간 연장 및 EHEO| 불가합니다.', 34, 88], ['I]                  O                   <', 57, 71]]);
// 같은 사진을 「색 배경 지운 그림」으로 두 번째 읽은 결과 — 파란 밑줄 깔린 브랜드 줄이 비로소 (틀린 글자로) 읽힘
const REAL_COFFEE_ALT = ln([['<                           쿠폰함                          X', 53, 89], ['~ _', 69, 64],
  ['.메가\\(9ㄷ커피,', 64, 66], ['더블 Wot 세트', 63, 89], ['유효기간 : 2026.09.16 ~ 2026.09.30', 43, 92]]);
test('실제 금액권 캡처: 로고 「emart」는 상품명이 아님, 줄 끝 「5만원」 = 금액 + 줄바꿈된 「권」, 지난 날짜 경고', () => {
  const r = L.parseOcrText(REAL_VOUCHER, TODAY);
  assert.deepEqual(r.value, { title: '이마트/트레이더스 5만원권', brand: '이마트', expiresOn: '2024-02-23', amount: 50000 });
  assert.ok(r.warnings.some((w) => w.includes('이미 지났습니다')));
});
test('실제 교환권 캡처: 첫 읽기엔 발행처가 없고, 두 번째 읽기(alt)의 흐린 브랜드 글자를 목록으로 바로잡음', () => {
  const r1 = L.parseOcrText(REAL_COFFEE, TODAY);
  assert.deepEqual(r1.value, { title: '더블 따아 세트', brand: '', expiresOn: '2026-09-30', amount: null });
  const r2 = L.parseOcrText(Object.assign({ alt: REAL_COFFEE_ALT }, REAL_COFFEE), TODAY);
  assert.deepEqual(r2.value, { title: '더블 따아 세트', brand: '메가MGC커피', expiresOn: '2026-09-30', amount: null });
  assert.ok(r2.warnings.some((w) => w.includes('브랜드 이름으로')));
  assert.ok(!r2.warnings.some((w) => w.includes('이미 지났습니다')));   // 오늘(9/29) 기준 아직 유효
});
test('브랜드 목록: OCR 이 틀리게 읽은 모양도 바른 이름으로, 로고뿐인 줄 표시, 모르는 이름은 null', () => {
  assert.equal(L.brandIn('.메가\\(9ㄷ커피,').name, '메가MGC커피');
  assert.equal(L.brandIn('메기1ㄴ커피').name, '메가MGC커피');
  assert.equal(L.brandIn('메가박스 관람권').name, '메가박스');
  assert.equal(L.brandIn('이마트24 모바일').name, '이마트24');
  assert.deepEqual(L.brandIn('emart'), { name: '이마트', whole: true });
  assert.equal(L.brandIn('스타벅스 아메리카노 T').whole, false);
  assert.equal(L.brandIn('하늘카페'), null);
  assert.equal(L.brandIn('summary'), null);   // 낱말 안의 「mart」 같은 조각은 브랜드가 아님
});
test('라벨 있는 발행처가 목록보다 먼저, 상품명 줄 속 브랜드는 발행처로', () => {
  assert.equal(L.parseOcrText('사용처 : 우리동네 스타벅스점\n아메리카노\n유효기간 2026.12.01', TODAY).value.brand, '우리동네 스타벅스점');
  const r = L.parseOcrText('스타벅스 카페 라떼 T\n유효기간 2026.12.01', TODAY);
  assert.deepEqual([r.value.title, r.value.brand], ['스타벅스 카페 라떼 T', '스타벅스']);
});
test('금액: 줄 끝 「3만원」은 금액, 줄 가운데 「3만원」·그냥 가격은 금액 아님', () => {
  assert.equal(L.parseOcrText('별빛마트/달빛마켓 3만원\n사용기한 ~ 2026.12.23', TODAY).value.amount, 30000);
  assert.equal(L.parseOcrText('별빛마트/달빛마켓 3만원\n사용기한 ~ 2026.12.23', TODAY).value.title, '별빛마트/달빛마켓 3만원권');
  assert.equal(L.parseOcrText('치킨 3만원 세트\n유효기간 2026.12.01', TODAY).value.amount, null);
  assert.equal(L.parseOcrText('아메리카노 4,500원\n유효기간 2026.12.01', TODAY).value.amount, null);
});

console.log('가족에게 보내기 (휴대폰 공유 창 · 문자 앱)');
test('전화번호 정리: 하이픈·빈칸·+82 → 010…, 이상한 값은 null', () => {
  assert.equal(L.normPhone('010-1234-5678'), '01012345678');
  assert.equal(L.normPhone('+82 10 3333 4444'), '01033334444');
  assert.equal(L.normPhone('02-123-4567'), '021234567');
  assert.equal(L.normPhone('12'), null);
  assert.equal(L.normPhone(''), null);
});
test('문자 주소: Android 는 ?body=, iOS 는 &body= (여러 명이면 /open?addresses=), 본문 인코딩', () => {
  assert.equal(L.smsHref(['010-1111-2222', '01033334444'], 'a b&c', 'android'), 'sms:01011112222,01033334444?body=a%20b%26c');
  assert.equal(L.smsHref(['01011112222'], '안녕', 'ios'), 'sms:01011112222&body=%EC%95%88%EB%85%95');
  assert.equal(L.smsHref(['01011112222', '01033334444'], 'x', 'ios'), 'sms:/open?addresses=01011112222,01033334444&body=x');
  assert.equal(L.smsHref([], 'x', 'ios'), 'sms:&body=x');
  assert.equal(L.smsHref(['bad'], 'x', 'android'), 'sms:?body=x');
});
test('기기 판별: iPhone·iPad(데스크톱 모드 포함)=ios, 그 밖=android', () => {
  assert.equal(L.detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5), 'ios');
  assert.equal(L.detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'ios');
  assert.equal(L.detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'android');
  assert.equal(L.detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5), 'android');
});
test('보낼 글: 한 장 / 여러 장, D-day·잔액·예약자, 바코드·메모는 넣지 않음', () => {
  const one = L.shareText(g({ title: '아메리카노', brand: '카페', expiresOn: '2026-10-01', memo: '비밀 메모' }), TODAY, () => '');
  assert.equal(one, '[가족 기프티콘] 유효기간이 다가옵니다\n· 아메리카노 (카페) — D-2, 2026. 10. 1.까지\n쓰면 보관함에서 「사용함」을 눌러 주세요.');
  const many = L.shareText([g({ title: 'A', expiresOn: TODAY }), g({ title: 'B', expiresOn: '2026-10-05', isAmount: true, balance: 6500, reservedBy: 'u1' })], TODAY, (id) => id === 'u1' ? '엄마' : '');
  assert.ok(many.startsWith('[가족 기프티콘] 오늘의 알림 2건'));
  assert.ok(many.includes('· A — D-DAY, 2026. 9. 29.까지'));
  assert.ok(many.includes('· B — D-6, 2026. 10. 5.까지, 잔액 6,500원, 예약: 엄마'));
  assert.ok(!one.includes('비밀 메모'));
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' · 실패 있음' : ''));
