/*
 * 가족 기프티콘 관리 — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.GCLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 기프티콘 한 장 (화면 안 모양 — DB 칸 이름은 fromRow/toRow 가 바꿔 줌)
 *   { id, familyId, title, brand, expiresOn:'YYYY-MM-DD', memo, imagePath,
 *     isAmount, faceValue, balance,           ← 금액형 상품권(선택): 액면가·잔액(원)
 *     createdBy, reservedBy, used, usedBy, usedAt, createdAt, updatedAt }
 *
 * 유효기간은 「이 날까지 사용 가능」입니다. 남은 날 d = 유효기간 − 오늘.
 *   d < 0 → 만료, d = 0 → 오늘까지(D-DAY), 0 ≤ d ≤ 7 → 곧 만료, 그 밖 → 여유
 * 「사용함」은 사용자가 직접 표시합니다(발행처 자동 조회 없음 — 기획서 5장).
 * 금액형은 나눠 쓴 금액을 빼 가며 잔액을 적고, 잔액이 0 이 되는 순간 「사용함」이 됩니다.
 * 그 뒤에도 「사용함」 체크는 사람이 직접 풀고 다시 걸 수 있습니다.
 */
(function (root) {
  'use strict';

  var SOON_DAYS = 7;                 // 「7일 이내 만료」 기준
  var DEFAULT_ALERT_DAYS = [7, 2, 1]; // 알림 시점 기본값 (D-7, D-2, D-1) — 2026-09-29 수강생 답변
  var OLD_DEFAULT_ALERT_DAYS = [7, 1]; // 1단계 첫 기본값 (저장돼 있으면 새 기본값으로 올림)
  var ALERT_CHOICES = [30, 14, 7, 3, 2, 1, 0];
  var MAX_FACE_VALUE = 10000000;       // 금액형 액면가 한도 1천만 원 (DB CHECK 와 같음)
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 고르기 전 원본 한도 (올릴 때는 줄여서)
  var IMAGE_MAX_SIDE = 1280;

  var STATUS_LABEL = { ok: '사용 가능', soon: '곧 만료', used: '사용함', expired: '만료' };
  var TABS = [
    { id: 'usable', label: '사용 가능' },
    { id: 'soon', label: '7일 이내 만료' },
    { id: 'used', label: '사용함' },
    { id: 'expired', label: '만료' },
    { id: 'all', label: '전체' }
  ];
  var ACTIONS = ['등록', '수정', '사용', '금액사용', '사용취소', '예약', '삭제'];

  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ── 날짜 ──────────────────────────────────────────────────
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  // 2026.10.5 · 2026/10/05 · 20261005 · 2026년 10월 5일 → 2026-10-05
  function normDate(s) {
    s = str(s);
    var m = s.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    var out = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    return isDate(out) ? out : null;
  }
  function dayNum(s) { var p = s.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; }
  function daysLeft(expiresOn, today) { return dayNum(expiresOn) - dayNum(today); }
  function addDays(s, n) {
    var d = new Date(dayNum(s) * 86400000 + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function shortDate(s) {
    var p = s.split('-').map(Number);
    return p[0] + '. ' + p[1] + '. ' + p[2] + '.';
  }

  // ── 상태 ──────────────────────────────────────────────────
  function statusOf(g, today) {
    if (g.used) return 'used';
    var d = daysLeft(g.expiresOn, today);
    if (d < 0) return 'expired';
    if (d <= SOON_DAYS) return 'soon';
    return 'ok';
  }
  // 크게 보이는 배지 글자
  function ddayText(g, today) {
    if (g.used) return '사용함';
    var d = daysLeft(g.expiresOn, today);
    if (d < 0) return '만료';
    if (d === 0) return 'D-DAY';
    return 'D-' + d;
  }
  // 배지 아래 풀이 (색만으로 구분하지 않도록 글자로도 적음)
  function statusText(g, today) {
    if (g.used) return '사용함';
    var d = daysLeft(g.expiresOn, today);
    if (d < 0) return '만료 · ' + (-d) + '일 지남';
    if (d === 0) return '오늘까지 사용';
    if (d <= SOON_DAYS) return '곧 만료 · ' + d + '일 남음';
    return '사용 가능 · ' + d + '일 남음';
  }

  // 요약 — usable 은 「아직 쓸 수 있는 것 전부」, soon 은 그중 7일 이내
  function summarize(list, today) {
    var s = { usable: 0, soon: 0, used: 0, expired: 0, total: list.length };
    list.forEach(function (g) {
      var st = statusOf(g, today);
      if (st === 'used') s.used++;
      else if (st === 'expired') s.expired++;
      else { s.usable++; if (st === 'soon') s.soon++; }
    });
    return s;
  }

  function inTab(g, tab, today) {
    var st = statusOf(g, today);
    if (tab === 'usable') return st === 'ok' || st === 'soon';
    if (tab === 'soon') return st === 'soon';
    if (tab === 'used') return st === 'used';
    if (tab === 'expired') return st === 'expired';
    return true;
  }
  // 정렬: 쓸 수 있는 것(유효기간 빠른 순) → 만료(최근 만료 먼저) → 사용함(최근 사용 먼저)
  function sortList(list, today) {
    var rank = { soon: 0, ok: 0, expired: 1, used: 2 };
    return list.slice().sort(function (a, b) {
      var ra = rank[statusOf(a, today)], rb = rank[statusOf(b, today)];
      if (ra !== rb) return ra - rb;
      if (ra === 0) return a.expiresOn < b.expiresOn ? -1 : a.expiresOn > b.expiresOn ? 1 : str(a.title).localeCompare(str(b.title));
      if (ra === 1) return a.expiresOn > b.expiresOn ? -1 : a.expiresOn < b.expiresOn ? 1 : 0;
      return str(b.usedAt).localeCompare(str(a.usedAt));
    });
  }
  function filterList(list, tab, today) {
    return sortList(list.filter(function (g) { return inTab(g, tab, today); }), today);
  }

  // ── 알림 (1단계: 앱 안 띠·목록) ───────────────────────────
  // '7, 1' · [7,1,'0'] → [7,1] (큰 것부터, 중복·범위 밖 제거)
  function parseAlertDays(v) {
    var arr = Array.isArray(v) ? v : str(v).split(/[\s,·]+/);
    var out = [];
    arr.forEach(function (x) {
      var s = str(x).replace(/^D-?/i, '');
      if (s === '') return;
      if (!/^\d+$/.test(s)) return;
      var n = +s;
      if (n <= 365 && out.indexOf(n) < 0) out.push(n);
    });
    return out.sort(function (a, b) { return b - a; });
  }
  // 알림 대상: 사용 안 함 · 만료 전 · 남은 날 ≤ 가장 큰 알림 시점.
  // level = 남은 날을 덮는 가장 작은 알림 시점 (D-3 이면 [7,1] 중 7 → 「D-7 알림」)
  function alertsFor(list, days, today) {
    days = parseAlertDays(days);
    if (!days.length) return [];
    var max = days[0];
    var out = [];
    list.forEach(function (g) {
      if (g.used) return;
      var d = daysLeft(g.expiresOn, today);
      if (d < 0 || d > max) return;
      var level = max;
      days.forEach(function (x) { if (x >= d && x < level) level = x; });
      out.push({ g: g, d: d, level: level });
    });
    return out.sort(function (a, b) { return a.d - b.d || str(a.g.title).localeCompare(str(b.g.title)); });
  }

  // 저장된 알림 시점 → 쓸 값. 저장값이 없거나, 옛 기본값(D-7·D-1)을 사용자가 고친 적 없이
  // 그대로 들고 있으면 새 기본값(D-7·D-2·D-1). 사용자가 직접 저장한 값(customized)은 그대로.
  function resolveAlertDays(saved, customized) {
    if (saved == null) return DEFAULT_ALERT_DAYS.slice();
    var days = parseAlertDays(saved);
    if (!customized && days.join(',') === OLD_DEFAULT_ALERT_DAYS.join(',')) return DEFAULT_ALERT_DAYS.slice();
    return days;
  }
  function alertDaysText(days) {
    return days.map(function (d) { return d === 0 ? '당일' : 'D-' + d; }).join(' · ');
  }

  // ── 금액형 상품권 ─────────────────────────────────────────
  // '10,000' · '1만원' · '1만 5천원' · '5000원' → 정수(원). 못 읽으면 null, 빈칸은 ''
  function parseWon(v) {
    if (typeof v === 'number') return isFinite(v) && Math.floor(v) === v ? v : null;
    var s = str(v).replace(/[\s,]/g, '').replace(/원$/, '');
    if (s === '') return '';
    if (/^\d+$/.test(s)) return +s;
    var m = s.match(/^(?:(\d+)만)?(?:(\d+)천)?$/);
    if (m && (m[1] || m[2])) return (+(m[1] || 0)) * 10000 + (+(m[2] || 0)) * 1000;
    return null;
  }
  function won(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }
  // 카드에 보이는 잔액 한 줄
  function balanceText(g) {
    if (!g.isAmount) return '';
    return '잔액 ' + won(g.balance) + ' / ' + won(g.faceValue);
  }
  // 나눠 쓰기: 쓴 금액만큼 잔액을 줄입니다. 잔액이 0 이 되면 「사용함」.
  // → { ok, error, balance, used }
  function spendResult(g, amountInput) {
    if (!g.isAmount) return { ok: false, error: '금액형 상품권이 아닙니다.' };
    if (g.used) return { ok: false, error: '이미 「사용함」입니다. 체크를 풀고 다시 해 주세요.' };
    var a = parseWon(amountInput);
    if (a === '' || a == null) return { ok: false, error: '쓴 금액을 숫자로 적어 주세요(예: 4,500).' };
    if (a <= 0) return { ok: false, error: '쓴 금액은 1원 이상이어야 합니다.' };
    if (a > g.balance) return { ok: false, error: '잔액(' + won(g.balance) + ')보다 많이 쓸 수 없습니다.' };
    var b = g.balance - a;
    return { ok: true, error: null, amount: a, balance: b, used: b === 0 };
  }

  // 잔액이 0 이 「되는 순간」 사용함으로 — DB 트리거(giftcons_before_write)와 같은 규칙.
  // 이미 0 인 채로 사람이 체크를 풀면 그대로 둡니다(수동 체크가 이깁니다).
  function autoUsed(before, after) {
    if (!after.isAmount || after.balance !== 0 || after.used) return !!after.used;
    if (!before || !before.isAmount || before.balance == null || before.balance > 0) return true;
    return false;
  }

  // ── 입력 검증 ─────────────────────────────────────────────
  function validateGiftcon(input) {
    var errors = [];
    var v = {
      title: str(input.title),
      brand: str(input.brand),
      expiresOn: normDate(input.expiresOn),
      memo: str(input.memo),
      reservedBy: str(input.reservedBy) || null,
      isAmount: !!input.isAmount,
      faceValue: null,
      balance: null
    };
    if (!v.title) errors.push('상품명을 적어 주세요.');
    else if (v.title.length > 100) errors.push('상품명은 100자까지입니다.');
    if (v.brand.length > 50) errors.push('발행처는 50자까지입니다.');
    if (!str(input.expiresOn)) errors.push('유효기간을 넣어 주세요.');
    else if (!v.expiresOn) errors.push('유효기간을 날짜(예: 2026-10-31)로 넣어 주세요.');
    if (v.memo.length > 500) errors.push('메모는 500자까지입니다.');
    if (v.isAmount) {
      var fv = parseWon(input.faceValue), bal = parseWon(input.balance);
      if (fv === '' || fv == null || fv < 1) errors.push('금액형이면 액면가를 적어 주세요(예: 10,000).');
      else if (fv > MAX_FACE_VALUE) errors.push('액면가는 1천만 원까지입니다.');
      else {
        v.faceValue = fv;
        if (bal === '') v.balance = fv;            // 잔액을 비우면 새것(= 액면가)
        else if (bal == null || bal < 0) errors.push('잔액을 숫자로 적어 주세요.');
        else if (bal > fv) errors.push('잔액이 액면가보다 클 수 없습니다.');
        else v.balance = bal;
      }
    }
    return { ok: errors.length === 0, errors: errors, value: v };
  }
  function validateImageFile(f) {
    if (!f) return null;
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.type || '')) return '사진 파일(JPG·PNG·WEBP)을 골라 주세요.';
    if (f.size > MAX_IMAGE_BYTES) return '사진이 너무 큽니다(10MB 까지).';
    return null;
  }
  // 긴 변을 max 로 줄인 크기 (작으면 그대로)
  function fitSize(w, h, max) {
    max = max || IMAGE_MAX_SIDE;
    if (w <= max && h <= max) return { w: w, h: h };
    var r = w >= h ? max / w : max / h;
    return { w: Math.round(w * r), h: Math.round(h * r) };
  }

  // ── 가족 · 초대 코드 · 연결 설정 ───────────────────────────
  function normalizeInviteCode(s) { return str(s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
  function isInviteCode(s) { return /^[A-HJ-NP-Z2-9]{8}$/.test(s); }
  function formatInviteCode(s) { return s && s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : s; }
  function validateDisplayName(s) {
    s = str(s);
    if (!s) return '표시 이름을 적어 주세요(예: 엄마).';
    if (s.length > 20) return '표시 이름은 20자까지입니다.';
    return null;
  }
  // 사용자가 붙여 넣는 본인 Supabase 주소·anon 키
  function validateConn(url, key) {
    url = str(url).replace(/\/+$/, '');
    key = str(key);
    var errors = [];
    if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(url)) errors.push('Project URL 을 https:// 로 시작하는 주소로 넣어 주세요(예: https://abcd1234.supabase.co).');
    if (!(/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key) || /^sb_publishable_[\w-]{10,}$/.test(key))) errors.push('anon(public) 키를 그대로 붙여 넣어 주세요. service_role·secret 키는 넣지 마세요.');
    else if (/^eyJ/.test(key) && jwtRole(key) && jwtRole(key) !== 'anon') errors.push('이 키는 ' + jwtRole(key) + ' 키입니다. 브라우저에는 anon 키만 넣어야 합니다.');
    return { ok: errors.length === 0, errors: errors, url: url, key: key };
  }
  function jwtRole(key) {
    try {
      var p = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var txt = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('binary');
      return JSON.parse(txt).role || null;
    } catch (e) { return null; }
  }

  function memberName(members, id) {
    if (!id) return '';
    for (var i = 0; i < members.length; i++) if (members[i].userId === id) return members[i].displayName;
    return '(나간 가족)';
  }

  // ── 기록 — DB 트리거(giftcons_write_log)와 같은 규칙 ─────
  // before 가 null 이면 등록, after 가 null 이면 삭제. nameOf(id) 로 예약자 이름.
  function logEntriesFor(before, after, nameOf) {
    nameOf = nameOf || function (x) { return x; };
    var out = [];
    function push(action, g, detail) { out.push({ action: action, giftconId: g.id, title: g.title, detail: detail || null }); }
    if (!before && after) {
      push('등록', after);
      if (after.reservedBy) push('예약', after, '예약: ' + nameOf(after.reservedBy));
      if (after.used) push('사용', after);
      return out;
    }
    if (before && !after) { push('삭제', before); return out; }
    var diff = [];
    [['title', '상품명'], ['brand', '발행처'], ['expiresOn', '유효기간'], ['memo', '메모'], ['imagePath', '사진'],
      ['isAmount', '금액형'], ['faceValue', '액면가']].forEach(function (p) {
      if (str(before[p[0]] || '') !== str(after[p[0]] || '')) diff.push(p[1]);
    });
    // 잔액: 줄면 「금액사용」(얼마 썼는지), 늘거나 금액형을 켜고 끌 때는 「수정」의 바뀐 칸
    var b0 = before.isAmount ? before.balance : null, b1 = after.isAmount ? after.balance : null;
    var spent = before.isAmount && after.isAmount && b1 < b0;
    if (!spent && str(b0) !== str(b1) && diff.indexOf('금액형') < 0) diff.push('잔액');
    if (diff.length) push('수정', after, '바뀐 칸: ' + diff.join(', '));
    if ((before.reservedBy || null) !== (after.reservedBy || null)) {
      push('예약', after, after.reservedBy ? '예약: ' + nameOf(after.reservedBy) : '예약 해제');
    }
    if (spent) push('금액사용', after, won(b0 - b1) + ' 사용 · 잔액 ' + won(b1));
    if (after.used && !before.used) push('사용', after);
    else if (before.used && !after.used) push('사용취소', after);
    return out;
  }

  // ── DB 행 ↔ 화면 모양 ─────────────────────────────────────
  var MAP = [['id', 'id'], ['familyId', 'family_id'], ['title', 'title'], ['brand', 'brand'], ['expiresOn', 'expires_on'],
    ['memo', 'memo'], ['imagePath', 'image_path'], ['createdBy', 'created_by'], ['reservedBy', 'reserved_by'],
    ['isAmount', 'is_amount'], ['faceValue', 'face_value'], ['balance', 'balance'],
    ['used', 'used'], ['usedBy', 'used_by'], ['usedAt', 'used_at'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at']];
  function fromRow(r) {
    var g = {};
    MAP.forEach(function (p) { g[p[0]] = r[p[1]] == null ? null : r[p[1]]; });
    g.used = !!g.used;
    g.isAmount = !!g.isAmount;
    return g;
  }
  // 앱이 보내는 칸만 (등록자·사용자·시각은 DB 트리거가 채움)
  function toRow(v) {
    var r = {};
    if ('title' in v) r.title = v.title;
    if ('brand' in v) r.brand = v.brand || null;
    if ('expiresOn' in v) r.expires_on = v.expiresOn;
    if ('memo' in v) r.memo = v.memo || null;
    if ('reservedBy' in v) r.reserved_by = v.reservedBy || null;
    if ('imagePath' in v) r.image_path = v.imagePath || null;
    if ('used' in v) r.used = !!v.used;
    if ('isAmount' in v) {
      r.is_amount = !!v.isAmount;
      r.face_value = v.isAmount ? v.faceValue : null;
      r.balance = v.isAmount ? v.balance : null;
    }
    return r;
  }

  // ── 사진에서 읽기 (선택 도우미) ─────────────────────────
  // 반자동: 이 요청문과 사진을 ChatGPT·Copilot 에 함께 붙여 넣고, 받은 JSON 을 다시 붙여 넣습니다.
  // 자동: 사용자가 자기 OpenAI 키를 넣었을 때만 같은 요청문으로 브라우저에서 바로 보냅니다(js/ai.js).
  var READ_PROMPT = [
    '첨부한 사진은 모바일 기프티콘(교환권) 캡처입니다.',
    '사진에서 아래 네 가지를 읽어 JSON 하나로만 답해줘. 설명 문장은 쓰지 말아줘.',
    '{"상품명": "", "발행처": "", "유효기간": "YYYY-MM-DD", "금액": null}',
    '- 상품명: 교환할 상품 이름 (예: 아메리카노 Tall)',
    '- 발행처: 브랜드·매장 이름 (예: ○○카페). 모르면 빈 글자',
    '- 유효기간: 이 날까지 쓸 수 있는 마지막 날. 「~까지」 날짜를 YYYY-MM-DD 로',
    '- 금액: 「1만원권」처럼 금액으로 쓰는 상품권이면 원 단위 숫자(예: 10000), 상품 교환권이면 null',
    '- 읽을 수 없는 칸은 빈 글자로 두고 추측하지 말아줘.',
    '- 바코드·쿠폰 번호는 읽지도 적지도 말아줘.'
  ].join('\n');
  var READ_KEYS = {
    title: ['상품명', 'title', 'product', 'name'],
    brand: ['발행처', 'brand', 'issuer', 'store'],
    expiresOn: ['유효기간', 'expiresOn', 'expires_on', 'expiry', 'expire'],
    amount: ['금액', 'amount', 'faceValue', 'face_value']
  };
  // AI 답(글자) → { ok, value:{title,brand,expiresOn,amount}, errors, warnings }
  // 코드 블록·앞뒤 말이 섞여도 첫 { … 마지막 } 을 JSON 으로 읽습니다.
  function parseReadAnswer(text) {
    text = str(text);
    var a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, errors: ['답에서 { … } 모양의 JSON 을 찾지 못했습니다. 답 전체를 그대로 붙여 넣어 주세요.'], warnings: [], value: null };
    var o;
    try { o = JSON.parse(text.slice(a, b + 1)); } catch (e) {
      return { ok: false, errors: ['JSON 을 읽지 못했습니다. 답을 고치지 말고 그대로 붙여 넣어 주세요.'], warnings: [], value: null };
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['JSON 이 { … } 모양이 아닙니다.'], warnings: [], value: null };
    function pick(keys) { for (var i = 0; i < keys.length; i++) if (o[keys[i]] != null && str(o[keys[i]]) !== '') return o[keys[i]]; return null; }
    var warnings = [];
    var v = { title: str(pick(READ_KEYS.title)).slice(0, 100), brand: str(pick(READ_KEYS.brand)).slice(0, 50), expiresOn: null, amount: null };
    var rawExp = pick(READ_KEYS.expiresOn);
    if (rawExp != null) {
      v.expiresOn = normDate(rawExp);
      if (!v.expiresOn) warnings.push('유효기간 「' + str(rawExp) + '」을(를) 날짜로 읽지 못했습니다. 직접 넣어 주세요.');
    } else warnings.push('유효기간을 읽지 못했습니다. 직접 넣어 주세요.');
    var rawAmt = pick(READ_KEYS.amount);
    if (rawAmt != null) {
      var n = parseWon(rawAmt);
      if (typeof n === 'number' && n > 0 && n <= MAX_FACE_VALUE) v.amount = n;
      else warnings.push('금액 「' + str(rawAmt) + '」을(를) 읽지 못했습니다.');
    }
    if (!v.title) warnings.push('상품명을 읽지 못했습니다. 직접 적어 주세요.');
    if (!v.title && !v.brand && !v.expiresOn && v.amount == null) return { ok: false, errors: ['읽은 칸이 하나도 없습니다. 사진이 선명한지 확인해 주세요.'], warnings: warnings, value: null };
    return { ok: true, errors: [], warnings: warnings, value: v };
  }
  // 사용자 OpenAI 키 모양 검사 (브라우저에만 저장)
  function validateOpenAIKey(k) {
    k = str(k);
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(k)) return 'OpenAI API 키(sk- 로 시작)를 그대로 붙여 넣어 주세요.';
    return null;
  }

  // ── 무료 글자 읽기(OCR) 결과 → 칸 (2026-09-29 저녁) ──────────
  // Tesseract.js 가 이 휴대폰 안에서 읽은 글자를 규칙으로 나눕니다. 바코드·쿠폰 번호는 읽지 않습니다:
  // 숫자가 10자리 이상 이어진 줄·「바코드/쿠폰번호/주문번호」 줄은 통째로 버리고 어디에도 두지 않습니다.
  var OCR_SKIP = /바코드|쿠폰\s*번호|주문\s*번호|교환\s*번호|인증\s*번호|PIN|핀\s*번호/i;
  var OCR_EXP_KEY = /유효\s*기[간한]|사용\s*기[간한]|만료|까지|교환\s*기[간한]/;
  var OCR_GENERIC = /^[^가-힣A-Za-z0-9]*(기프티콘|gifticon|기프티쇼|giftishow|모바일\s*(교환권|상품권)|교환권|상품권|선물하기|카카오톡\s*선물하기|선물|쿠폰|gift\s*card|coupon|e-?쿠폰)[^가-힣A-Za-z0-9]*$/i;
  var OCR_HEADER = /선물함|선물하기|쿠폰함|기프티콘함|받은\s*선물|보관함/;   // 앱 머리글 줄 — 상품명 후보에서 뺌
  var OCR_LABEL = /^(상품명|상품|메뉴|교환처|사용처|브랜드|발행처|매장|유효\s*기[간한]|사용\s*기[간한]|금액)\s*[:：]?\s*/;
  // 자주 쓰는 브랜드 — 사진 속 로고·장식 글씨는 OCR 이 한두 글자씩 틀리게 읽습니다(실제 캡처: 「메가MGC커피」 → 「메가\(9ㄷ커피」·「메기1ㄴ커피」).
  // 「사용처·교환처」 라벨이 없을 때 이 목록과 맞으면 바른 이름으로 발행처를 채웁니다. 없는 브랜드는 종전 규칙(상품명 위 줄)으로.
  // (2026-09-30 수강생 실제 캡처 2장으로 보강)
  var BRANDS = [
    ['메가MGC커피', /메[가기]\s*[^\s가-힣]{0,5}\s*[ㄱ-ㅎ]?\s*커\s*피|MGC\s*커피|mega\s*(mgc\s*)?coffee/i],
    ['메가박스', /메가박스|megabox/i],
    ['스타벅스', /스타벅스|starbucks/i],
    ['투썸플레이스', /투썸|twosome/i],
    ['이디야커피', /이디야|ediya/i],
    ['빽다방', /빽다방|paik'?s\s*coffee/i],
    ['컴포즈커피', /컴포즈|compose\s*coffee/i],
    ['할리스', /할리스|hollys/i],
    ['폴바셋', /폴\s*바셋|paul\s*bassett/i],
    ['공차', /공차|gong\s*cha/i],
    ['배스킨라빈스', /배스킨|baskin/i],
    ['던킨', /던킨|dunkin/i],
    ['파리바게뜨', /파리바게[뜨트]|paris\s*baguette/i],
    ['뚜레쥬르', /뚜레쥬르|tous\s*les\s*jours/i],
    ['설빙', /설빙|sulbing/i],
    ['교촌치킨', /교촌/],
    ['BBQ', /\bBBQ\b|비비큐/i],
    ['bhc', /\bbhc\b/i],
    ['굽네치킨', /굽네/],
    ['도미노피자', /도미노|domino/i],
    ['버거킹', /버거킹|burger\s*king/i],
    ['맥도날드', /맥도날드|mcdonald/i],
    ['롯데리아', /롯데리아|lotteria/i],
    ['GS25', /GS\s*25/i],
    ['세븐일레븐', /세븐일레븐|7-?eleven/i],
    ['이마트24', /이마트\s*24|emart\s*24/i],
    ['이마트', /이마트|\be-?mart\b/i],
    ['홈플러스', /홈플러스|homeplus/i],
    ['롯데마트', /롯데마트|lotte\s*mart/i],
    ['올리브영', /올리브영|olive\s*young/i],
    ['다이소', /다이소|daiso/i],
    ['CGV', /\bCGV\b/]
  ];
  // 줄에서 처음 맞는 브랜드 → { name, whole(줄 전체가 브랜드 이름뿐인지) } 또는 null
  function brandIn(line) {
    for (var i = 0; i < BRANDS.length; i++) {
      var m = line.match(BRANDS[i][1]);
      if (m) return { name: BRANDS[i][0], whole: line.replace(m[0], '').replace(/[^가-힣A-Za-z0-9]/g, '') === '' };
    }
    return null;
  }
  function digitRun(s) { var m = s.replace(/[\s\-]/g, '').match(/\d{10,}/); return !!m; }
  // 사람에게 보여 줄 때도 긴 숫자는 가립니다(바코드 번호가 섞여 읽혔을 때)
  // (숫자 10자리 이상이 빈칸·하이픈으로만 이어진 덩어리. 줄은 넘지 않음 — 날짜 2026-10-05 는 8자리라 그대로)
  function maskLongDigits(s) {
    return str(s).replace(/\d[\d \-]{8,}\d/g, function (m) { return m.replace(/\D/g, '').length >= 10 ? m.replace(/\d/g, '*') : m; });
  }
  function cleanLine(x) { return str(x).replace(/[|｜]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function keepLine(x) { return x && !OCR_SKIP.test(x) && !digitRun(x); }
  // 입력: 글자(문자열) 또는 { text, lines:[{text, h(글자 높이 px), conf(0~100)}] } — 줄 높이가 있으면 상품명 고르기에 씁니다.
  function ocrInput(input) {
    if (input && typeof input === 'object' && Array.isArray(input.lines) && input.lines.length) {
      return input.lines.map(function (l) { return { text: cleanLine(l.text), h: +l.h || 0, conf: l.conf == null ? 100 : +l.conf }; })
        .filter(function (l) { return keepLine(l.text); });
    }
    var t = input && typeof input === 'object' ? input.text : input;
    return str(t).split(/\r?\n/).map(function (x) { return { text: cleanLine(x), h: 0, conf: 100 }; }).filter(function (l) { return keepLine(l.text); });
  }
  // 한 줄에서 날짜 후보들 — 전체 날짜(2026.10.31 · 26.10.31 · 2026년 10월 31일)와 월/일(~10/31, 10월 31일까지)
  function datesIn(line, today) {
    var out = [];
    var full = /(20\d{2}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g, m;
    var used = line;
    while ((m = full.exec(line))) {
      var y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
      var d = y + '-' + pad(+m[2]) + '-' + pad(+m[3]);
      if (isDate(d)) out.push({ date: d, full: true, idx: m.index });
      used = used.slice(0, m.index) + Array(m[0].length + 1).join(' ') + used.slice(m.index + m[0].length);
    }
    var md = /(~|까지\s*)?\s*(\d{1,2})\s*[./월]\s*(\d{1,2})\s*(일)?\s*(까지)?/g;
    while ((m = md.exec(used))) {
      if (!(m[1] || m[5] || m[4] || OCR_EXP_KEY.test(line))) continue;
      var yy = +today.slice(0, 4), cand = yy + '-' + pad(+m[2]) + '-' + pad(+m[3]);
      if (!isDate(cand)) continue;
      if (daysLeft(cand, today) < -31) cand = (yy + 1) + cand.slice(4);   // 지난 달보다 오래전이면 내년
      out.push({ date: cand, full: false, idx: m.index });
    }
    return out;
  }
  // → { ok, value:{title,brand,expiresOn,amount}, warnings, errors }
  function parseOcrText(input, today) {
    today = today || todayStr();
    var rows = ocrInput(input);
    var lines = rows.map(function (r) { return r.text; });
    var warnings = [];
    var v = { title: '', brand: '', expiresOn: null, amount: null };
    // 브랜드 목록으로 발행처 찾기 — 읽은 줄 전부(흐린 줄 포함), 없으면 두 번째 읽기(input.alt: 색 배경·형광 밑줄을 지운 그림)
    function brandFromList() {
      var alt = input && typeof input === 'object' && input.alt ? ocrInput(input.alt) : [];
      var pools = [rows, alt];
      for (var p = 0; p < pools.length; p++) for (var i = 0; i < pools[p].length; i++) {
        var b = brandIn(pools[p][i].text);
        if (b) { v.brand = b.name; warnings.push('발행처를 사진 속 브랜드 이름으로 넣었습니다(「' + b.name + '」). 확인해 주세요.'); return; }
      }
    }
    function labeled(re) {
      for (var i = 0; i < lines.length; i++) { var m = lines[i].match(re); if (m && str(m[2])) return str(m[2]); }
      return '';
    }
    v.title = labeled(/^(상품명|상품|메뉴)\s*[:：]\s*(.+)$/).slice(0, 100);
    v.brand = labeled(/^(교환처|사용처|브랜드|발행처|매장)\s*[:：]?\s*(.+)$/).replace(/\s*(전\s*(매장|지점)|전국\s*매장|매장|에서\s*사용)$/, '').slice(0, 50);

    // 유효기간: 「유효기간·까지·~」가 붙은 날짜 중 가장 늦은 것(기간이면 끝 날)
    var keyed = [], all = [];
    lines.forEach(function (ln, i) {
      var ds = datesIn(ln, today);
      var near = OCR_EXP_KEY.test(ln) || (i > 0 && /^(유효\s*기[간한]|사용\s*기[간한])\s*[:：]?$/.test(lines[i - 1]));
      ds.forEach(function (d) { all.push(d); if (near || /~/.test(ln)) keyed.push(d); });
    });
    function latest(arr) { return arr.map(function (d) { return d.date; }).sort().pop(); }
    if (keyed.length) {
      v.expiresOn = latest(keyed);
      if (!keyed.some(function (d) { return d.full && d.date === v.expiresOn; })) warnings.push('유효기간에 연도가 없어 ' + v.expiresOn.slice(0, 4) + '년으로 넣었습니다. 확인해 주세요.');
    } else if (all.length) {
      v.expiresOn = latest(all);
      warnings.push('「유효기간」 글자를 못 찾아 사진 속 가장 늦은 날짜(' + v.expiresOn + ')를 넣었습니다. 꼭 확인해 주세요.');
    } else warnings.push('유효기간을 읽지 못했습니다. 직접 넣어 주세요.');

    if (v.expiresOn && daysLeft(v.expiresOn, today) < 0) warnings.push('유효기간(' + v.expiresOn + ')이 이미 지났습니다. 사진의 날짜와 맞는지 확인해 주세요.');

    // 금액형: 「10,000원권」 · 「1만원권」 · 「금액권 10,000원」 · 줄 끝의 「5만원」(긴 상품명이 「5만원 / 권」으로 줄바꿈된 캡처)
    var joined = lines.join('\n');
    var am = joined.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원\s*(권|상품권|금액권)/) || joined.match(/(\d+\s*만\s*(?:\d\s*천\s*)?)원\s*(권|상품권|금액권)/) ||
      joined.match(/[가-힣A-Za-z].*?(\d+\s*만)\s*원\s*$/m) ||
      (/금액권|상품권/.test(joined) ? joined.match(/(\d{1,3}(?:,\d{3})+|\d+\s*만)\s*원/) : null);
    if (am) {
      var n = parseWon(am[1].replace(/\s/g, '') + (/만|천/.test(am[1]) ? '원' : ''));
      if (typeof n === 'number' && n >= 1000 && n <= MAX_FACE_VALUE) v.amount = n;
    }

    // 상품명 라벨이 없으면: 라벨·날짜·앱 머리글·일반 낱말·흐리게 읽힌 줄을 빼고,
    // 줄 높이를 알면 글자가 가장 큰 줄(보통 상품명이 가장 큼), 모르면 글자가 가장 많은 앞쪽 줄
    if (!v.title) {
      var best = null, cands = [];
      rows.slice(0, 12).forEach(function (r, i) {
        var ln = r.text;
        if (OCR_LABEL.test(ln) || OCR_EXP_KEY.test(ln) || OCR_GENERIC.test(ln) || OCR_HEADER.test(ln) || datesIn(ln, today).length) return;
        if (v.brand && ln === v.brand) return;
        if (r.conf < 60) return;
        var letters = (ln.match(/[가-힣A-Za-z]/g) || []).length;
        if (letters < 2 || ln.length > 40) return;
        if (/^[\d,\s]+(만\s*)?원\s*(권|상품권|금액권)?$/.test(ln) || /^\d+\s*만\s*원\s*(권|상품권|금액권)?$/.test(ln)) return;  // 「10,000원권」만 있는 줄은 금액
        var bi = brandIn(ln);
        if (bi && bi.whole) return;   // 「emart」처럼 브랜드 로고뿐인 줄은 상품명이 아님
        var score = r.h ? r.h * 100 - i : letters - i * 0.5;   // 같으면 위쪽 줄
        cands.push({ ln: ln, score: score, i: i, kor: /[가-힣]/.test(ln) });
      });
      // 한글 줄이 있으면 빈칸 없는 영문 한 낱말 줄(로고 글씨)은 뺍니다
      var anyKor = cands.some(function (c) { return c.kor; });
      cands.forEach(function (c) {
        if (anyKor && !c.kor && !/\s/.test(c.ln)) return;
        if (!best || c.score > best.score) best = c;
      });
      // 발행처 라벨이 없으면: 먼저 브랜드 목록, 다음은 상품명 바로 위의 짧은 줄(선물 화면은 보통 브랜드 → 상품명 순)
      if (!v.brand) brandFromList();
      if (best && !v.brand && best.i > 0) {
        var up = rows[best.i - 1].text;
        if (up.length <= 20 && /[가-힣A-Za-z]{2}/.test(up) && !OCR_HEADER.test(up) && !OCR_LABEL.test(up) && !OCR_GENERIC.test(up) && !datesIn(up, today).length && rows[best.i - 1].conf >= 60) {
          v.brand = up.slice(0, 50);
          warnings.push('발행처를 추측해 넣었습니다(「' + v.brand + '」). 확인해 주세요.');
        }
      }
      // 「이마트/트레이더스 5만원」 + 다음 줄 「권」이 못 읽힌 캡처: 금액을 읽었으면 「권」을 붙입니다
      if (best && v.amount && /(\d+\s*만|\d{1,3}(,\d{3})+)\s*원$/.test(best.ln)) best.ln += '권';
      if (best) { v.title = best.ln.slice(0, 100); warnings.push('상품명을 추측해 넣었습니다(「' + v.title + '」). 사진과 맞는지 확인해 주세요.'); }
      else warnings.push('상품명을 읽지 못했습니다. 직접 적어 주세요.');
    }
    if (!v.brand) brandFromList();
    if (!v.title && !v.brand && !v.expiresOn && v.amount == null) {
      return { ok: false, errors: ['사진에서 읽은 글자가 거의 없습니다. 기프티콘 부분만 잘라 더 선명한 캡처로 다시 해 주세요.'], warnings: warnings, value: null };
    }
    return { ok: true, errors: [], warnings: warnings, value: v };
  }

  // ── 가족에게 보내기 — 휴대폰 공유 창·문자 앱 (무료, 사람이 보내기를 누름) ──
  // '010-1234-5678' · '+82 10 1234 5678' → '01012345678'. 아니면 null
  function normPhone(s) {
    var d = str(s).replace(/[\s\-().]/g, '');
    if (/^\+82/.test(d)) d = '0' + d.slice(3);
    return /^0\d{8,10}$/.test(d) ? d : null;
  }
  function shareLine(g, today, nameOf) {
    var d = daysLeft(g.expiresOn, today);
    var dd = d < 0 ? '만료' : d === 0 ? 'D-DAY' : 'D-' + d;
    var s = '· ' + g.title + (g.brand ? ' (' + g.brand + ')' : '') + ' — ' + dd + ', ' + shortDate(g.expiresOn) + '까지';
    if (g.isAmount) s += ', 잔액 ' + won(g.balance);
    if (g.reservedBy && nameOf) s += ', 예약: ' + nameOf(g.reservedBy);
    return s;
  }
  // 한 장 또는 여러 장(오늘의 알림 모두)을 보낼 글. 바코드·사진은 넣지 않습니다.
  function shareText(list, today, nameOf) {
    list = Array.isArray(list) ? list : [list];
    var head = list.length === 1 ? '[가족 기프티콘] 유효기간이 다가옵니다' : '[가족 기프티콘] 오늘의 알림 ' + list.length + '건';
    return [head].concat(list.map(function (g) { return shareLine(g, today, nameOf); }),
      ['쓰면 보관함에서 「사용함」을 눌러 주세요.']).join('\n');
  }
  // 문자 앱 여는 주소. 본문 붙이는 방식이 다릅니다 — iOS: sms:번호&body= (여러 명이면 sms:/open?addresses=),
  // Android: sms:번호,번호?body=
  function smsHref(phones, body, platform) {
    phones = (phones || []).map(normPhone).filter(Boolean);
    var b = encodeURIComponent(body || '');
    if (platform === 'ios') {
      if (phones.length > 1) return 'sms:/open?addresses=' + phones.join(',') + '&body=' + b;
      return 'sms:' + (phones[0] || '') + '&body=' + b;
    }
    return 'sms:' + phones.join(',') + '?body=' + b;
  }
  function detectPlatform(ua, maxTouch) {
    ua = str(ua);
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'ios';
    return 'android';
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  var api = {
    SOON_DAYS: SOON_DAYS, DEFAULT_ALERT_DAYS: DEFAULT_ALERT_DAYS, ALERT_CHOICES: ALERT_CHOICES, MAX_FACE_VALUE: MAX_FACE_VALUE,
    resolveAlertDays: resolveAlertDays, alertDaysText: alertDaysText,
    parseWon: parseWon, won: won, balanceText: balanceText, spendResult: spendResult, autoUsed: autoUsed,
    READ_PROMPT: READ_PROMPT, parseReadAnswer: parseReadAnswer, validateOpenAIKey: validateOpenAIKey,
    parseOcrText: parseOcrText, maskLongDigits: maskLongDigits, brandIn: brandIn,
    normPhone: normPhone, shareText: shareText, smsHref: smsHref, detectPlatform: detectPlatform,
    STATUS_LABEL: STATUS_LABEL, TABS: TABS, ACTIONS: ACTIONS, IMAGE_MAX_SIDE: IMAGE_MAX_SIDE,
    todayStr: todayStr, isDate: isDate, normDate: normDate, daysLeft: daysLeft, addDays: addDays, shortDate: shortDate,
    statusOf: statusOf, ddayText: ddayText, statusText: statusText, summarize: summarize,
    inTab: inTab, sortList: sortList, filterList: filterList,
    parseAlertDays: parseAlertDays, alertsFor: alertsFor,
    validateGiftcon: validateGiftcon, validateImageFile: validateImageFile, fitSize: fitSize,
    normalizeInviteCode: normalizeInviteCode, isInviteCode: isInviteCode, formatInviteCode: formatInviteCode,
    validateDisplayName: validateDisplayName, validateConn: validateConn, jwtRole: jwtRole,
    memberName: memberName, logEntriesFor: logEntriesFor, fromRow: fromRow, toRow: toRow, fmtDateTime: fmtDateTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GCLogic = api;
})(typeof window !== 'undefined' ? window : this);
