/*
 * 체험 모드 예시 데이터 — 가상의 가족(엄마·아빠·첫째·둘째)과 기프티콘 8장.
 * 유효기간은 「오늘」을 기준으로 만들어 언제 열어도 곧 만료·여유·사용함·만료가 섞여 보입니다.
 * 사진은 실제 기프티콘이 아니라 SVG 로 그린 예시 그림입니다(상표·바코드 모두 가짜).
 */
(function (root) {
  'use strict';
  var L = root.GCLogic || (typeof require === 'function' ? require('./logic.js') : null);

  var MEMBERS = [
    { userId: 'm-mom', displayName: '엄마', role: 'owner' },
    { userId: 'm-dad', displayName: '아빠', role: 'member' },
    { userId: 'm-kid1', displayName: '첫째', role: 'member' },
    { userId: 'm-kid2', displayName: '둘째', role: 'member' }
  ];
  // [상품명, 발행처, 남은 날, 예약자, 사용(며칠 전, 누가), 메모, 색, 금액형(액면가, 잔액, 쓴 사람)]
  var ITEMS = [
    ['아메리카노 Tall 2잔', '카페 A', 1, 'm-kid1', null, '', '#2e6b4f'],
    ['치킨 한 마리 세트', '치킨 B', 3, null, null, '금요일 저녁에 쓰기로', '#b5541c'],
    ['모바일 상품권 1만원', '편의점 C', 6, null, null, '', '#3b5ba5', [10000, 6500, 'm-kid2']],
    ['생일 케이크 교환권', '베이커리 D', 20, 'm-mom', null, '할머니 생신용', '#9b3d6b'],
    ['아이스크림 파인트', '아이스크림 E', 45, null, null, '', '#c2477a'],
    ['버블티 L', '카페 F', 0, null, null, '', '#6b4a2e'],
    ['햄버거 세트', '버거 G', 10, null, [2, 'm-dad'], '', '#a33a2a'],
    ['도넛 6개', '도넛 H', -3, null, null, '', '#7a5a12']
  ];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // 예시 그림: 발행처·상품명·가짜 바코드·유효기간
  function svgCard(title, brand, expiresOn, color, seed) {
    var bars = '', x = 60, n = seed * 7 + 3;
    while (x < 540) {
      n = (n * 1103515245 + 12345) % 2147483648;
      var w = 2 + (n % 4) * 2;
      bars += '<rect x="' + x + '" y="250" width="' + w + '" height="70" fill="#1b2430"/>';
      x += w + 2 + ((n >> 4) % 3) * 2;
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">' +
      '<rect width="600" height="400" rx="24" fill="#ffffff"/>' +
      '<rect width="600" height="120" rx="24" fill="' + color + '"/><rect y="96" width="600" height="24" fill="' + color + '"/>' +
      '<text x="40" y="74" font-family="sans-serif" font-size="40" font-weight="700" fill="#ffffff">' + esc(brand) + '</text>' +
      '<text x="560" y="74" font-family="sans-serif" font-size="22" fill="#ffffff" text-anchor="end">예시 이미지</text>' +
      '<text x="40" y="180" font-family="sans-serif" font-size="34" font-weight="700" fill="#1b2430">' + esc(title) + '</text>' +
      '<text x="40" y="224" font-family="sans-serif" font-size="24" fill="#56616f">유효기간 ' + expiresOn.replace(/-/g, '.') + ' 까지</text>' +
      bars +
      '<text x="300" y="360" font-family="monospace" font-size="24" fill="#1b2430" text-anchor="middle">0000 0000 0000 ' + (1000 + seed) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function isoDaysAgo(today, days, hh) {
    var d = L.addDays(today, -days).split('-').map(Number);
    return new Date(d[0], d[1] - 1, d[2], hh || 12, 10).toISOString();
  }

  // 체험 모드 데이터베이스 한 벌
  function build(today) {
    today = today || L.todayStr();
    var db = {
      _sample: true,
      family: { id: 'demo-family', name: '우리 가족(예시)', inviteCode: 'DEMO2345' },
      members: MEMBERS.map(function (m) { return Object.assign({}, m); }),
      me: 'm-mom',
      giftcons: [], images: {}, log: [], seq: 0
    };
    function name(id) { return L.memberName(db.members, id); }
    ITEMS.forEach(function (it, i) {
      var id = 'demo-' + (i + 1);
      var exp = L.addDays(today, it[2]);
      var addedDaysAgo = 12 - i;
      var g = {
        id: id, familyId: 'demo-family', title: it[0], brand: it[1], expiresOn: exp, memo: it[5],
        imagePath: 'demo:' + id, createdBy: MEMBERS[i % 4].userId, reservedBy: it[3],
        isAmount: !!it[7], faceValue: it[7] ? it[7][0] : null, balance: it[7] ? it[7][0] : null,
        used: !!it[4], usedBy: it[4] ? it[4][1] : null, usedAt: it[4] ? isoDaysAgo(today, it[4][0], 19) : null,
        createdAt: isoDaysAgo(today, addedDaysAgo, 9), updatedAt: isoDaysAgo(today, addedDaysAgo, 9)
      };
      db.giftcons.push(g);
      db.images[id] = svgCard(it[0], it[1], exp, it[6], i + 1);
      var by = MEMBERS[i % 4];
      L.logEntriesFor(null, Object.assign({}, g, { used: false }), name).forEach(function (e) {
        db.log.push(Object.assign(e, { id: ++db.seq, actor: by.userId, actorName: by.displayName, createdAt: g.createdAt }));
      });
      if (it[7]) {  // 금액형: 한 번 나눠 씀 → 「금액사용」 기록
        var spentBy = it[7][2], before = Object.assign({}, g);
        g.balance = it[7][1];
        L.logEntriesFor(before, g, name).forEach(function (e) {
          db.log.push(Object.assign(e, { id: ++db.seq, actor: spentBy, actorName: name(spentBy), createdAt: isoDaysAgo(today, 1, 18) }));
        });
      }
      if (g.used) {
        db.log.push({ id: ++db.seq, action: '사용', giftconId: id, title: g.title, detail: null,
          actor: g.usedBy, actorName: name(g.usedBy), createdAt: g.usedAt });
      }
    });
    db.log.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    db.log.forEach(function (e, i) { e.id = i + 1; });
    db.seq = db.log.length;
    return db;
  }

  var api = { build: build, MEMBERS: MEMBERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GCSample = api;
})(typeof window !== 'undefined' ? window : this);
