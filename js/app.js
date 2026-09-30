/* 가족 기프티콘 관리 — 화면 (보관함 · 등록 · 기록 · 가족 · 설정, DB 모드의 로그인·가족 만들기) */
(function () {
  'use strict';
  var L = window.GCLogic;
  var Store = window.GCStore;

  var store = Store.open();
  var settings = Store.loadSettings();
  var fam = null;        // { family, members, me }
  var items = [];        // 기프티콘 목록
  var today = L.todayStr();

  // ── 작은 도구 ─────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function main() { return document.getElementById('main'); }
  function show() {
    var m = main();
    m.innerHTML = '';
    for (var i = 0; i < arguments.length; i++) add(m, arguments[i]);
  }
  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function fail(e) { toast((e && e.message) || String(e), true); }
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  function memberSelect(name, value, emptyLabel) {
    var s = h('select', { name: name });
    s.appendChild(h('option', { value: '' }, emptyLabel || '예약 없음'));
    (fam ? fam.members : []).forEach(function (m) {
      s.appendChild(h('option', { value: m.userId, selected: m.userId === value }, m.displayName + (fam && m.userId === fam.me ? ' (나)' : '')));
    });
    return s;
  }
  function nameOf(id) { return fam ? L.memberName(fam.members, id) : ''; }
  function saveSettings() { Store.saveSettings(settings); }
  function route() { return (location.hash || '#/').slice(1) || '/'; }
  function go(r) { if (location.hash === '#' + r) render(); else location.hash = r; }

  // ── 사진: 줄여서 JPEG 로 ───────────────────────────────────
  function shrinkImage(file, maxSide) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = L.fitSize(img.naturalWidth, img.naturalHeight, maxSide);
        var c = document.createElement('canvas');
        c.width = s.w; c.height = s.h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.w, s.h);
        ctx.drawImage(img, 0, 0, s.w, s.h);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : bad(new Error('사진을 줄이지 못했습니다.')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('이 사진 형식은 브라우저가 열지 못합니다. JPG·PNG 로 저장해 다시 골라 주세요.')); };
      img.src = url;
    });
  }
  function openImage(url, title) {
    var d = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var c = document.getElementById('dialogContent');
    c.innerHTML = '';
    c.appendChild(h('img', { class: 'big-img', src: url, alt: title + ' 사진' }));
    var a = document.getElementById('dialogActions');
    a.innerHTML = '';
    a.appendChild(h('button', { class: 'btn', value: 'close' }, '닫기'));
    d.showModal();
  }
  function thumb(g) {
    var box = h('button', { type: 'button', class: 'thumb', 'aria-label': g.title + ' 사진 크게 보기' }, h('span', { class: 'thumb-empty' }, '사진 없음'));
    if (!g.imagePath) { box.disabled = true; return box; }
    store.imageUrl(g).then(function (url) {
      if (!url) return;
      box.innerHTML = '';
      box.appendChild(h('img', { src: url, alt: '', loading: 'lazy' }));
      box.addEventListener('click', function () { openImage(url, g.title); });
    });
    return box;
  }

  // ── 머리·안내 띠 ───────────────────────────────────────────
  function paintChrome() {
    var r = route();
    document.querySelectorAll('#nav a').forEach(function (a) {
      var on = r === a.getAttribute('data-route') || (a.getAttribute('data-route') === '/' && (r === '/' || r === ''));
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var demo = store.mode === 'demo';
    document.getElementById('demoBanner').hidden = !demo;
    document.getElementById('connError').hidden = !store.connError;
    document.getElementById('connError').textContent = store.connError ? 'DB 연결 설정을 열지 못해 체험 모드로 열었습니다: ' + store.connError : '';
    document.getElementById('storeBanner').hidden = Store.storageOk();
    var who = document.getElementById('who');
    who.textContent = fam ? fam.family.name + ' · ' + nameOf(fam.me) + (demo ? ' (체험)' : '') : (demo ? '체험 모드' : 'DB 모드');
  }

  // ════════════════════════════════════════════════════════
  // 보관함 (첫 화면)
  // ════════════════════════════════════════════════════════
  function viewBox() {
    var s = L.summarize(items, today);
    var tab = settings.tab || 'usable';
    var alerts = L.alertsFor(items, settings.alertDays, today);

    var tiles = h('div', { class: 'tiles', role: 'group', 'aria-label': '상태별 보기' });
    [['usable', s.usable, '사용 가능'], ['soon', s.soon, '7일 이내 만료'], ['used', s.used, '사용함'], ['expired', s.expired, '만료']].forEach(function (t) {
      tiles.appendChild(h('button', {
        type: 'button', class: 'tile tile-' + t[0], 'aria-pressed': String(tab === t[0]), 'data-tab': t[0],
        onclick: function () { settings.tab = t[0]; saveSettings(); render(); }
      }, h('span', { class: 'tile-num', 'data-count': t[0] }, String(t[1])), h('span', { class: 'tile-label' }, t[2])));
    });
    var allBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(tab === 'all'), 'data-tab': 'all',
      onclick: function () { settings.tab = 'all'; saveSettings(); render(); } }, '전체 ' + s.total + '장 보기');

    var alertBox = null;
    if (alerts.length) {
      alertBox = h('section', { class: 'alert-box', 'aria-label': '유효기간 알림' },
        h('h2', null, '가족 알림 ' + alerts.length + '건 — 유효기간이 다가옵니다'),
        h('ul', null, alerts.slice(0, 5).map(function (a) {
          return h('li', null,
            h('strong', { class: 'alert-d' }, a.d === 0 ? 'D-DAY' : 'D-' + a.d), ' ',
            a.g.title, a.g.brand ? ' (' + a.g.brand + ')' : '',
            a.g.isAmount ? h('span', { class: 'muted' }, ' · 잔액 ' + L.won(a.g.balance)) : null,
            a.g.reservedBy ? h('span', { class: 'muted' }, ' · 예약: ' + nameOf(a.g.reservedBy)) : null);
        })),
        alerts.length > 5 ? h('p', { class: 'muted' }, '외 ' + (alerts.length - 5) + '건') : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small primary send-all',
          onclick: function () { openSend(alerts.map(function (a) { return a.g; })); } }, '오늘의 알림 모두 가족에게 보내기')),
        h('p', { class: 'hint' }, '가족 누구나 보관함을 열면 이 알림을 봅니다. 알림 시점: ' + L.alertDaysText(settings.alertDays) + ' — 「설정」에서 바꿉니다. 「가족에게 보내기」는 휴대폰의 카카오톡·문자로 무료로 보내지만, 보내기 버튼은 직접 눌러야 합니다.'));
    }

    var list = L.filterList(items, tab, today);
    var tabLabel = L.TABS.filter(function (t) { return t.id === tab; })[0].label;
    var cards = h('div', { class: 'cards' }, list.map(card));
    return [
      h('div', { class: 'box-head' },
        h('h1', null, '기프티콘 보관함'),
        h('a', { class: 'btn primary', href: '#/add' }, '+ 기프티콘 등록')),
      alertBox,
      tiles,
      h('div', { class: 'list-head' }, h('h2', { id: 'listTitle' }, tabLabel + ' ' + list.length + '장'), allBtn),
      list.length ? cards : h('p', { class: 'empty' }, items.length ? '이 상태의 기프티콘이 없습니다.' : '아직 등록한 기프티콘이 없습니다. 「+ 기프티콘 등록」을 눌러 사진과 함께 넣어 주세요.')
    ];
  }

  function card(g) {
    var st = L.statusOf(g, today);
    var usedBox = h('input', { type: 'checkbox', checked: g.used, 'aria-describedby': 'st-' + g.id });
    usedBox.addEventListener('change', function () {
      usedBox.disabled = true;
      store.setUsed(g.id, usedBox.checked).then(function () {
        toast(usedBox.checked ? '「' + g.title + '」을(를) 사용함으로 표시했습니다. 잘못 눌렀으면 다시 누르면 취소됩니다.' : '「' + g.title + '」 사용을 취소했습니다.');
        return reload();
      }).catch(function (e) { usedBox.checked = !usedBox.checked; usedBox.disabled = false; fail(e); });
    });
    var resv = memberSelect('reserve', g.reservedBy, '예약 없음');
    resv.setAttribute('aria-label', g.title + ' 예약자');
    resv.addEventListener('change', function () {
      store.setReserved(g.id, resv.value || null).then(function () {
        toast(resv.value ? nameOf(resv.value) + ' 님 예약으로 표시했습니다.' : '예약을 풀었습니다.');
        return reload();
      }).catch(fail);
    });
    var meta = [g.brand || '발행처 미입력', L.shortDate(g.expiresOn) + '까지'].join(' · ');
    var spendBtn = g.isAmount && !g.used
      ? h('button', { type: 'button', class: 'btn small', onclick: function () { spendGiftcon(g); } }, '금액 사용') : null;
    var inAlert = !g.used && L.alertsFor([g], settings.alertDays, today).length > 0;
    var sendBtn = inAlert ? h('button', { type: 'button', class: 'btn small send-one', onclick: function () { openSend([g]); } }, '가족에게 보내기') : null;
    var usedLine = g.used ? '사용: ' + nameOf(g.usedBy) + (g.usedAt ? ' · ' + L.fmtDateTime(g.usedAt) : '') : null;
    return h('article', { class: 'card st-' + st, 'data-id': g.id },
      h('div', { class: 'card-top' },
        thumb(g),
        h('div', { class: 'card-body' },
          h('h3', { class: 'card-title' }, g.title),
          h('p', { class: 'card-meta' }, meta),
          g.isAmount ? h('p', { class: 'card-balance' }, L.balanceText(g)) : null,
          g.reservedBy ? h('p', { class: 'card-resv' }, '예약: ' + nameOf(g.reservedBy)) : null,
          usedLine ? h('p', { class: 'card-used' }, usedLine) : null,
          g.memo ? h('p', { class: 'card-memo' }, g.memo) : null),
        h('div', { class: 'dday' },
          h('span', { class: 'dday-big' }, L.ddayText(g, today)),
          h('span', { class: 'dday-text', id: 'st-' + g.id }, L.statusText(g, today)))),
      h('div', { class: 'card-actions' },
        h('label', { class: 'used-toggle' }, usedBox, h('span', null, '사용함')),
        spendBtn,
        sendBtn,
        resv,
        h('a', { class: 'btn small', href: '#/edit/' + encodeURIComponent(g.id) }, '고치기'),
        h('button', { type: 'button', class: 'btn small danger', onclick: function () { removeGiftcon(g); } }, '삭제')));
  }

  // 금액형 나눠 쓰기 — 쓴 금액만 적으면 잔액이 줄고, 0 이 되면 「사용함」
  function spendGiftcon(g) {
    var v = window.prompt('「' + g.title + '」에서 쓴 금액을 적어 주세요. 지금 잔액 ' + L.won(g.balance) + '\n(예: 4,500 · 5천원)', '');
    if (v == null) return;
    var r = L.spendResult(g, v);
    if (!r.ok) { toast(r.error, true); return; }
    store.spend(g.id, r.amount).then(function (x) {
      toast(L.won(r.amount) + ' 썼습니다. 잔액 ' + L.won(x.balance) + (x.used ? ' — 다 써서 「사용함」으로 표시했습니다.' : '.'));
      return reload();
    }).catch(fail);
  }

  function removeGiftcon(g) {
    if (!window.confirm('「' + g.title + '」을(를) 지울까요? 사진도 함께 지워집니다. 기록에는 「삭제」로 남습니다.')) return;
    store.deleteGiftcon(g.id).then(function () { toast('지웠습니다.'); return reload(); }).catch(fail);
  }

  // 가족에게 보내기 — 휴대폰 공유 창(카카오톡·문자 등 고르기) 또는 문자 앱. 무료, 보내기는 사람이 누름.
  function openSend(list) {
    var text = L.shareText(list, today, nameOf);
    var d = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = '가족에게 보내기' + (list.length > 1 ? ' (' + list.length + '건)' : '');
    var c = document.getElementById('dialogContent');
    c.innerHTML = '';
    var box = h('textarea', { class: 'send-text', rows: String(Math.min(10, list.length + 3)), 'aria-label': '보낼 글' }, text);
    var phones = (fam ? fam.members : []).map(function (m) { return (settings.phones || {})[m.userId]; }).filter(Boolean);
    phones = phones.filter(function (p, i) { return phones.indexOf(p) === i; });
    var platform = L.detectPlatform(navigator.userAgent, navigator.maxTouchPoints || 0);
    var sms = h('a', { class: 'btn', href: L.smsHref(phones, text, platform) }, phones.length ? '문자로 보내기 (' + phones.length + '명)' : '문자 앱 열기');
    box.addEventListener('input', function () { sms.href = L.smsHref(phones, box.value, platform); });
    var canShare = typeof navigator.share === 'function';
    var shareBtn = canShare ? h('button', { type: 'button', class: 'btn primary', onclick: function () {
      navigator.share({ title: '가족 기프티콘', text: box.value }).then(function () { d.close(); }, function (e) {
        if (e && e.name === 'AbortError') return;
        toast('공유 창을 열지 못했습니다. 「글 복사」 뒤 카카오톡에 붙여 넣어 주세요.', true);
      });
    } }, '카카오톡 등으로 공유') : null;
    var copyBtn = h('button', { type: 'button', class: 'btn', onclick: function () {
      var ok = function () { toast('글을 복사했습니다. 카카오톡 가족 대화방에 붙여 넣어 주세요.'); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(box.value).then(ok, function () { box.select(); });
      else { box.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* 직접 복사 */ } }
    } }, '글 복사');
    add(c, [
      h('p', { class: 'hint' }, '휴대폰에 있는 카카오톡·문자로 보내므로 추가 비용이 없습니다. 다만 받는 사람을 고르고 「보내기」를 누르는 것은 직접 해야 합니다.'),
      box,
      h('div', { class: 'row send-row' }, shareBtn, sms, copyBtn),
      h('p', { class: 'hint' }, (canShare ? '「카카오톡 등으로 공유」를 누르면 휴대폰 공유 창이 열립니다. 카카오톡 → 가족 대화방을 고르세요. ' : '이 브라우저에는 공유 창이 없습니다(PC 등). 「글 복사」 뒤 붙여 넣어 주세요. ') +
        (phones.length ? '「문자로 보내기」는 「가족」 화면에 넣은 번호로 문자 앱을 엽니다.' : '문자 받을 번호는 「가족」 화면에서 넣을 수 있습니다(선택, 이 기기에만 저장).'))
    ]);
    var a = document.getElementById('dialogActions');
    a.innerHTML = '';
    a.appendChild(h('button', { class: 'btn', value: 'close' }, '닫기'));
    d.showModal();
  }

  // ════════════════════════════════════════════════════════
  // 등록 · 고치기
  // ════════════════════════════════════════════════════════
  function viewForm(id) {
    var g = id ? items.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !g) return [h('h1', null, '기프티콘 고치기'), h('p', { class: 'empty' }, '이 기프티콘을 찾지 못했습니다. 이미 지워졌을 수 있습니다.'), h('a', { class: 'btn', href: '#/' }, '보관함으로')];
    var blob = null, original = null;
    var preview = h('div', { class: 'preview' }, h('span', { class: 'muted' }, '사진을 고르면 여기에 보입니다. 사진을 보면서 옆 칸을 채워 주세요.'));
    if (g && g.imagePath) store.imageUrl(g).then(function (u) { if (u) { preview.innerHTML = ''; preview.appendChild(h('img', { src: u, alt: '지금 사진' })); } });
    var file = h('input', { type: 'file', name: 'photo', accept: 'image/*' });
    file.addEventListener('change', function () {
      var f = file.files[0];
      var err = L.validateImageFile(f);
      if (err) { toast(err, true); file.value = ''; return; }
      if (!f) return;
      original = f;
      shrinkImage(f, store.mode === 'demo' ? 900 : L.IMAGE_MAX_SIDE).then(function (b) {
        blob = b;
        preview.innerHTML = '';
        preview.appendChild(h('img', { src: URL.createObjectURL(b), alt: '고른 사진' }));
      }).catch(function (e) { file.value = ''; fail(e); });
    });
    var title = h('input', { name: 'title', required: true, maxlength: '100', value: g ? g.title : '', placeholder: '예) 아메리카노 Tall', autocomplete: 'off' });
    var brand = h('input', { name: 'brand', maxlength: '50', value: g ? g.brand || '' : '', placeholder: '예) ○○카페', autocomplete: 'off' });
    var exp = h('input', { name: 'expiresOn', type: 'date', required: true, value: g ? g.expiresOn : '' });
    var memo = h('textarea', { name: 'memo', rows: '3', maxlength: '500', placeholder: '예) 생일 선물용' }, g ? g.memo || '' : '');
    // 금액형 상품권(선택) — 켜면 액면가·잔액 칸이 보입니다
    var isAmt = h('input', { type: 'checkbox', name: 'isAmount', checked: !!(g && g.isAmount) });
    var face = h('input', { name: 'faceValue', inputmode: 'numeric', placeholder: '예) 10,000', value: g && g.isAmount ? String(g.faceValue) : '' });
    var bal = h('input', { name: 'balance', inputmode: 'numeric', placeholder: '비우면 액면가 그대로', value: g && g.isAmount ? String(g.balance) : '' });
    var amtBox = h('div', { class: 'amount-box' },
      field('액면가 (원)', face),
      field('잔액 (원)', bal, '나눠 쓸 때는 보관함 카드의 「금액 사용」을 누르면 쓴 금액이 기록에 남습니다.'));
    amtBox.hidden = !isAmt.checked;
    isAmt.addEventListener('change', function () { amtBox.hidden = !isAmt.checked; });
    var amtField = h('div', { class: 'field' },
      h('label', { class: 'check' }, isAmt, '금액형 상품권 (예: 1만원권을 나눠 씀)'), amtBox);
    var resv = memberSelect('reservedBy', g ? g.reservedBy : '', '예약 없음');
    var errBox = h('div', { class: 'form-errors', role: 'alert' });
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' }, g ? '고친 내용 저장' : '등록');
    var form = h('form', { class: 'panel gform', novalidate: true },
      h('div', { class: 'gform-photo' }, preview, field('사진 (기프티콘 캡처)', file, '긴 변 ' + (store.mode === 'demo' ? 900 : L.IMAGE_MAX_SIDE) + 'px 로 줄여 저장합니다.'),
        readHelper(function () { return blob; }, function () { return original || blob; }, function (v) {
          if (v.title) title.value = v.title;
          if (v.brand) brand.value = v.brand;
          if (v.expiresOn) exp.value = v.expiresOn;
          if (v.amount) { isAmt.checked = true; amtBox.hidden = false; face.value = String(v.amount); if (!g) bal.value = ''; }
        })),
      h('div', { class: 'gform-fields' },
        field('상품명 (필수)', title),
        field('발행처(브랜드)', brand),
        field('유효기간 (필수)', exp, '이 날까지 쓸 수 있는 마지막 날'),
        field('예약자', resv, '누가 쓸지 정해 두면 카드에 표시됩니다.'),
        amtField,
        field('메모', memo),
        errBox,
        h('div', { class: 'row' }, saveBtn, h('a', { class: 'btn', href: '#/' }, '취소'))));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var r = L.validateGiftcon({ title: title.value, brand: brand.value, expiresOn: exp.value, memo: memo.value, reservedBy: resv.value,
        isAmount: isAmt.checked, faceValue: face.value, balance: bal.value });
      errBox.innerHTML = '';
      if (!r.ok) { r.errors.forEach(function (m) { errBox.appendChild(h('p', null, m)); }); return; }
      saveBtn.disabled = true;
      var p = g ? store.updateGiftcon(g.id, r.value, blob) : store.addGiftcon(r.value, blob);
      p.then(function () {
        toast(g ? '고친 내용을 저장했습니다.' : '「' + r.value.title + '」을(를) 등록했습니다.');
        settings.tab = 'usable'; saveSettings();
        return reload().then(function () { go('/'); });
      }).catch(function (e) { saveBtn.disabled = false; fail(e); });
    });
    return [h('h1', null, g ? '기프티콘 고치기' : '기프티콘 등록'),
      h('p', { class: 'lead' }, '사진은 확인용으로 보관합니다. 상품명과 유효기간은 사진을 보며 적어 주세요. 사진 아래 「사진에서 채우기」로 무료 글자 읽기를 쓸 수도 있습니다(선택).'),
      form];
  }

  // 사진에서 채우기 (선택, 기본 접힘) — ① 무료 글자 읽기(이 기기 안 OCR) ② 무료 AI 채팅 반자동 ③ 내 OpenAI 키
  // getBlob(): 지금 고른 사진(줄인 JPEG) · getOriginal(): 고른 원본(OCR 용, 저장 안 함) · fill(v): 칸 채우기(저장은 사람이)
  function readHelper(getBlob, getOriginal, fill) {
    var msg = h('div', { class: 'read-msg', role: 'status' });
    function say(lines, isErr) {
      msg.innerHTML = '';
      lines.forEach(function (t) { msg.appendChild(h('p', { class: isErr ? 'error-text' : 'hint' }, t)); });
    }
    function apply(text) {
      var r = L.parseReadAnswer(text);
      if (!r.ok) { say(r.errors, true); return; }
      fill(r.value);
      say(['칸을 채웠습니다. 사진과 맞는지 확인한 뒤 「등록」을 눌러 주세요.'].concat(r.warnings));
    }

    // ① 무료 글자 읽기 — 엔진(약 8MB)은 누를 때 처음 받습니다. 사진은 이 기기 밖으로 나가지 않습니다.
    var ocrMsg = h('div', { class: 'read-msg ocr-msg', role: 'status' });
    var ocrRaw = h('details', { class: 'ocr-raw', hidden: true }, h('summary', null, '읽은 글자 보기 (긴 숫자는 가림)'), h('pre', null, ''));
    var ocrBtn = h('button', { type: 'button', class: 'btn small primary ocr-btn' }, '사진 글자 읽기 (무료)');
    ocrBtn.addEventListener('click', function () {
      var img = getOriginal();
      ocrMsg.innerHTML = '';
      if (!img) { ocrMsg.appendChild(h('p', { class: 'error-text' }, '먼저 위에서 사진을 골라 주세요.')); return; }
      ocrBtn.disabled = true;
      var line = h('p', { class: 'hint' }, '준비 중…');
      ocrMsg.appendChild(line);
      var prog = function (t) { line.textContent = t; };
      window.GCOCR.readText(img, prog).then(function (res) {
        // 발행처를 못 찾았으면 색 배경·형광 밑줄을 지운 그림으로 한 번 더 읽습니다(브랜드 이름 찾기에만 씀)
        var r0 = L.parseOcrText(res, today);
        if (!r0.ok || r0.value.brand) return res;
        return window.GCOCR.readText(img, function (t) { prog('발행처 다시 읽는 중 · ' + t); }, { bright: true })
          .then(function (alt) { res.alt = alt; return res; }, function () { return res; });
      }).then(function (res) {
        ocrRaw.hidden = false;
        ocrRaw.querySelector('pre').textContent = L.maskLongDigits(res.text);
        var r = L.parseOcrText(res, today);
        ocrMsg.innerHTML = '';
        if (!r.ok) { r.errors.forEach(function (m) { ocrMsg.appendChild(h('p', { class: 'error-text' }, m)); }); return; }
        fill(r.value);
        ['칸을 채웠습니다. 글자 읽기는 틀릴 수 있으니 사진과 한 칸씩 맞춰 본 뒤 「등록」을 눌러 주세요.'].concat(r.warnings)
          .forEach(function (m) { ocrMsg.appendChild(h('p', { class: 'hint' }, m)); });
      }, function (e) {
        ocrMsg.innerHTML = '';
        ocrMsg.appendChild(h('p', { class: 'error-text' }, e.message));
      }).then(function () { ocrBtn.disabled = false; });
    });
    var copyBtn = h('button', { type: 'button', class: 'btn small' }, '요청문 복사');
    copyBtn.addEventListener('click', function () {
      var done = function () { toast('요청문을 복사했습니다. Copilot·Gemini·ChatGPT 에 사진과 함께 붙여 넣어 주세요.'); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(L.READ_PROMPT).then(done, function () { promptBox.select(); });
      else { promptBox.select(); try { document.execCommand('copy'); done(); } catch (e) { /* 직접 복사 */ } }
    });
    var promptBox = h('textarea', { class: 'read-prompt', rows: '5', readonly: true, 'aria-label': '요청문' }, L.READ_PROMPT);
    var answer = h('textarea', { name: 'readAnswer', rows: '4', placeholder: '{"상품명": "…", "발행처": "…", "유효기간": "2026-10-31", "금액": null}' });
    var applyBtn = h('button', { type: 'button', class: 'btn small primary', onclick: function () { apply(answer.value); } }, '답으로 칸 채우기');

    var savedKey = Store.loadOpenAIKey();
    var keyIn = h('input', { type: 'password', name: 'openaiKey', autocomplete: 'off', spellcheck: 'false', placeholder: savedKey ? '저장된 키 있음 (바꾸려면 새로 넣기)' : 'sk-…' });
    var autoBtn = h('button', { type: 'button', class: 'btn small primary' }, '이 사진 바로 읽기');
    autoBtn.addEventListener('click', function () {
      var b = getBlob();
      if (!b) { say(['먼저 위에서 사진을 골라 주세요(새로 고른 사진만 보냅니다).'], true); return; }
      var k = keyIn.value.trim() || Store.loadOpenAIKey();
      var err = L.validateOpenAIKey(k);
      if (err) { say([err], true); return; }
      if (keyIn.value.trim()) { Store.saveOpenAIKey(k); keyIn.value = ''; keyIn.placeholder = '저장된 키 있음 (바꾸려면 새로 넣기)'; }
      autoBtn.disabled = true;
      say(['사진을 읽는 중…']);
      var fr = new FileReader();
      fr.onload = function () {
        window.GCAI.readPhoto({ key: k, prompt: L.READ_PROMPT, image: fr.result })
          .then(apply, function (e) { say([e.message], true); })
          .then(function () { autoBtn.disabled = false; });
      };
      fr.onerror = function () { autoBtn.disabled = false; say(['사진을 읽지 못했습니다.'], true); };
      fr.readAsDataURL(b);
    });
    var forget = h('button', { type: 'button', class: 'btn small', onclick: function () {
      Store.clearOpenAIKey(); keyIn.value = ''; keyIn.placeholder = 'sk-…'; toast('이 브라우저에서 OpenAI 키를 지웠습니다.');
    } }, '키 지우기');

    return h('details', { class: 'read-helper' },
      h('summary', null, '사진에서 채우기 (선택)'),
      h('p', { class: 'hint' }, '사진에서 상품명·발행처·유효기간(금액형이면 금액)을 읽어 칸을 채웁니다. 어느 방법이든 채운 뒤에는 꼭 사진과 대조해 주세요. 바코드·쿠폰 번호는 읽지도 저장하지도 않습니다.'),
      h('h3', null, '방법 1 — 무료 글자 읽기 (이 기기 안에서, 키 필요 없음)'),
      h('p', { class: 'hint' }, '사진을 어디에도 보내지 않고 이 휴대폰·PC 안에서 글자를 읽습니다. 처음 누를 때 글자 읽기 엔진과 한국어 데이터(약 8MB)를 한 번 받으니 와이파이에서 해 주세요. 인쇄체는 잘 읽지만 작은 글씨·장식 글꼴은 틀리기 쉽습니다. 파일로 연 화면(file://)에서는 브라우저가 막으니 Pages 주소에서 써 주세요.'),
      h('div', { class: 'row' }, ocrBtn),
      ocrMsg,
      ocrRaw,
      h('h3', null, '방법 2 — 무료 AI 채팅에 붙여 넣기 (Copilot·Gemini·ChatGPT 무료판)'),
      h('ol', { class: 'steps' },
        h('li', null, '「요청문 복사」를 누릅니다.'),
        h('li', null, 'Copilot·Gemini·ChatGPT(무료로 로그인해도 됨)에 기프티콘 사진을 올리고 요청문을 붙여 넣습니다. 사진에 바코드가 있으면 그 서비스로 함께 가니, 걱정되면 바코드를 가린 캡처를 쓰세요.'),
        h('li', null, '받은 답(JSON)을 아래 칸에 그대로 붙여 넣고 「답으로 칸 채우기」를 누릅니다.')),
      h('div', { class: 'row' }, copyBtn),
      promptBox,
      field('AI 답 붙여 넣기', answer),
      h('div', { class: 'row' }, applyBtn),
      h('h3', null, '방법 3 — 내 OpenAI 키로 바로 읽기 (선택, 유료 키가 있을 때만)'),
      h('p', { class: 'hint' }, '본인 OpenAI API 키가 있으면 위에서 고른 사진을 이 브라우저에서 바로 보냅니다(건당 몇 원 수준, 본인 계정에 청구). 키는 이 브라우저에만 저장되고 가족·서버와 나누지 않습니다.'),
      field('OpenAI API 키', keyIn),
      h('div', { class: 'row' }, autoBtn, forget),
      msg);
  }

  // ════════════════════════════════════════════════════════
  // 기록
  // ════════════════════════════════════════════════════════
  function viewLog() {
    var wrap = h('div', null, h('p', { class: 'muted' }, '불러오는 중…'));
    store.listLog().then(function (rows) {
      wrap.innerHTML = '';
      if (!rows.length) { wrap.appendChild(h('p', { class: 'empty' }, '아직 기록이 없습니다.')); return; }
      wrap.appendChild(h('ol', { class: 'log' }, rows.map(function (e) {
        return h('li', { class: 'log-item act-' + e.action },
          h('span', { class: 'log-act' }, e.action),
          h('span', { class: 'log-main' }, h('strong', null, e.title), e.detail ? ' — ' + e.detail : ''),
          h('span', { class: 'log-sub' }, (e.actorName || '(알 수 없음)') + ' · ' + L.fmtDateTime(e.createdAt)));
      })));
    }).catch(function (e) { wrap.innerHTML = ''; wrap.appendChild(h('p', { class: 'error-text' }, e.message)); });
    return [h('h1', null, '기록'), h('p', { class: 'lead' }, '등록 · 수정 · 사용 · 금액사용(쓴 금액·잔액) · 사용취소 · 예약 · 삭제가 최근 순으로 남습니다. 기록은 고치거나 지울 수 없습니다.'), wrap];
  }

  // ════════════════════════════════════════════════════════
  // 가족
  // ════════════════════════════════════════════════════════
  function viewFamily() {
    var demo = store.mode === 'demo';
    var myName = h('input', { name: 'displayName', maxlength: '20', value: nameOf(fam.me) });
    var nameForm = h('form', { class: 'row' }, myName, h('button', { type: 'submit', class: 'btn' }, '표시 이름 바꾸기'));
    nameForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = L.validateDisplayName(myName.value);
      if (err) { toast(err, true); return; }
      store.renameMe(myName.value.trim()).then(function () { toast('표시 이름을 바꿨습니다.'); return reload(); }).catch(fail);
    });
    var who = null;
    if (demo) {
      var sel = memberSelect('demoMe', fam.me, '');
      sel.removeChild(sel.firstChild);
      sel.addEventListener('change', function () { store.setDemoMe(sel.value); reload().then(function () { toast(nameOf(sel.value) + ' (으)로 바꿨습니다.'); }); });
      who = h('section', { class: 'panel' }, h('h2', null, '지금 쓰는 사람 (체험 모드)'),
        h('p', { class: 'hint' }, '체험 모드에는 로그인이 없어, 누가 사용·예약했는지 기록되는 모습을 보려면 여기서 사람을 바꿔 보세요.'),
        field('지금 쓰는 사람', sel));
    }
    return [
      h('h1', null, '가족'),
      h('section', { class: 'panel' },
        h('h2', null, fam.family.name),
        h('p', null, '초대 코드 ', h('strong', { class: 'code' }, L.formatInviteCode(fam.family.inviteCode))),
        h('p', { class: 'hint' }, demo ? '체험 모드의 초대 코드는 예시입니다.' : '가족에게 이 코드를 알려 주세요. 가족은 앱에서 가입·로그인한 뒤 「초대 코드로 들어가기」에 넣으면 됩니다.'),
        h('h3', null, '구성원 ' + fam.members.length + '명'),
        h('ul', { class: 'members' }, fam.members.map(function (m) {
          return h('li', null, m.displayName, m.role === 'owner' ? h('span', { class: 'tag' }, '만든 사람') : null, m.userId === fam.me ? h('span', { class: 'tag me' }, '나') : null);
        }))),
      who,
      phonePanel(),
      h('section', { class: 'panel' }, h('h2', null, '내 표시 이름'), nameForm)
    ];
  }

  // 문자 받을 번호 (선택) — 「가족에게 보내기 → 문자로 보내기」에 받는 사람으로 미리 들어갑니다.
  // 번호는 가족 DB 에 올리지 않고 이 기기에만 저장합니다(DB 칸을 늘리지 않음 · 보내는 사람의 휴대폰에만 있으면 됨).
  function phonePanel() {
    var inputs = fam.members.map(function (m) {
      return { m: m, el: h('input', { type: 'tel', inputmode: 'tel', name: 'phone-' + m.userId, placeholder: '예) 010-1234-5678', autocomplete: 'off',
        value: (settings.phones || {})[m.userId] || '' }) };
    });
    var form = h('form', { class: 'panel phone-form' },
      h('h2', null, '문자 받을 번호 (선택)'),
      h('p', { class: 'hint' }, '「가족에게 보내기 → 문자로 보내기」를 누르면 이 번호들이 받는 사람으로 들어간 문자 앱이 열립니다. 번호는 이 기기에만 저장되고 가족 DB·서버로 가지 않습니다. 카카오톡으로만 보낼 거면 비워 두셔도 됩니다.'),
      inputs.map(function (x) { return field(x.m.displayName + (x.m.userId === fam.me ? ' (나)' : ''), x.el); }),
      h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, '번호 저장')));
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var next = {}, bad = [];
      inputs.forEach(function (x) {
        var v = x.el.value.trim();
        if (!v) return;
        var n = L.normPhone(v);
        if (n) next[x.m.userId] = n; else bad.push(x.m.displayName);
      });
      if (bad.length) { toast(bad.join(', ') + ' 번호를 확인해 주세요(예: 010-1234-5678).', true); return; }
      settings.phones = next; saveSettings();
      toast('번호를 이 기기에 저장했습니다(' + Object.keys(next).length + '명).');
    });
    return form;
  }

  // ════════════════════════════════════════════════════════
  // 설정 — 알림 시점 · DB 연결 · 체험 데이터
  // ════════════════════════════════════════════════════════
  function viewSettings() {
    // 알림 시점
    var checks = L.ALERT_CHOICES.map(function (d) {
      return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'alert', value: String(d), checked: settings.alertDays.indexOf(d) >= 0 }), d === 0 ? '당일' : 'D-' + d);
    });
    var custom = h('input', { name: 'alertCustom', placeholder: '예) 10, 5', value: settings.alertDays.filter(function (d) { return L.ALERT_CHOICES.indexOf(d) < 0; }).join(', ') });
    var alertForm = h('form', { class: 'panel' },
      h('h2', null, '알림 시점'),
      h('p', { class: 'hint' }, '사용하지 않은 기프티콘의 유효기간이 이 날짜 안으로 들어오면 보관함 맨 위에 가족 알림으로 보여 줍니다. 기본값은 D-7 · D-2 · D-1 입니다. 이 설정은 이 기기에만 저장됩니다. 가족에게 알리려면 알림 띠의 「가족에게 보내기」를 눌러 주세요.'),
      h('div', { class: 'checks' }, checks),
      field('직접 넣기 (며칠 전, 쉼표로)', custom),
      h('div', { class: 'row' },
        h('button', { type: 'submit', class: 'btn primary' }, '알림 시점 저장'),
        h('button', { type: 'button', class: 'btn', onclick: function () {
          settings.alertDays = L.DEFAULT_ALERT_DAYS.slice(); settings.alertCustom = false; saveSettings();
          toast('기본값으로 돌렸습니다: ' + L.alertDaysText(settings.alertDays)); render();
        } }, '기본값(D-7 · D-2 · D-1)으로')));
    alertForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var picked = Array.prototype.filter.call(alertForm.querySelectorAll('input[name=alert]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      settings.alertDays = L.parseAlertDays(picked.concat(L.parseAlertDays(custom.value)));
      settings.alertCustom = true;
      saveSettings();
      toast(settings.alertDays.length ? '알림 시점을 저장했습니다: ' + L.alertDaysText(settings.alertDays) : '알림을 껐습니다.');
      render();
    });

    // DB 연결
    var conn = Store.loadConn() || { url: '', key: '' };
    var url = h('input', { name: 'sbUrl', placeholder: 'https://xxxx.supabase.co', value: conn.url, autocomplete: 'off', spellcheck: 'false' });
    var key = h('input', { name: 'sbKey', placeholder: 'anon public 키', value: conn.key, autocomplete: 'off', spellcheck: 'false' });
    var connErr = h('div', { class: 'form-errors', role: 'alert' });
    var connForm = h('form', { class: 'panel' },
      h('h2', null, 'DB 연결 (가족 공유)'),
      h('p', null, '지금은 ', h('strong', null, store.mode === 'demo' ? '체험 모드' : 'DB 모드'), '입니다. ',
        store.mode === 'demo' ? '가족이 함께 쓰려면 본인 Supabase 프로젝트를 만들고 아래에 주소와 anon 키를 넣어 주세요.' : '가족 모두가 같은 주소·키를 넣고 각자 로그인합니다.'),
      h('ol', { class: 'steps' },
        h('li', null, 'supabase.com 에서 새 프로젝트를 만듭니다(무료).'),
        h('li', null, 'SQL Editor 에 이 저장소의 supabase/schema.sql 전체를 붙여 넣고 실행합니다.'),
        h('li', null, 'Project Settings → API 의 Project URL 과 anon public 키를 아래에 붙여 넣습니다.')),
      field('Project URL', url),
      field('anon public 키', key, 'service_role 키는 절대 넣지 마세요. 값은 이 브라우저에만 저장됩니다.'),
      connErr,
      h('div', { class: 'row' },
        h('button', { type: 'submit', class: 'btn primary' }, '연결 시험 후 저장'),
        store.mode === 'db' ? h('button', { type: 'button', class: 'btn', onclick: function () {
          if (!window.confirm('DB 연결을 끊고 체험 모드로 돌아갈까요? DB 의 데이터는 지워지지 않습니다.')) return;
          (store.signOut ? store.signOut() : Promise.resolve()).then(function () { Store.clearConn(); location.hash = '#/settings'; location.reload(); });
        } }, '연결 끊기(체험 모드로)') : null));
    connForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var r = L.validateConn(url.value, key.value);
      connErr.innerHTML = '';
      if (!r.ok) { r.errors.forEach(function (m) { connErr.appendChild(h('p', null, m)); }); return; }
      Store.testConn(r.url, r.key).then(function () {
        Store.saveConn(r.url, r.key);
        toast('연결했습니다. 로그인 화면으로 갑니다.');
        location.hash = '#/';
        location.reload();
      }).catch(function (e) { connErr.appendChild(h('p', null, e.message)); });
    });

    var demoPanel = null;
    if (store.mode === 'demo') {
      demoPanel = h('section', { class: 'panel' }, h('h2', null, '체험 데이터'),
        h('p', { class: 'hint' }, '체험 모드의 데이터는 이 브라우저에만 있습니다.'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: function () {
            if (!window.confirm('예시 데이터로 다시 채울까요? 지금 체험 데이터는 사라집니다.')) return;
            store.resetSample(); reload().then(function () { toast('예시 데이터로 다시 채웠습니다.'); go('/'); });
          } }, '예시 데이터 다시 채우기'),
          h('button', { type: 'button', class: 'btn danger', onclick: function () {
            if (!window.confirm('체험 데이터를 모두 지울까요?')) return;
            store.clearAll(); reload().then(function () { toast('모두 지웠습니다.'); go('/'); });
          } }, '모두 지우기')));
    }
    var account = null;
    if (store.mode === 'db') {
      account = h('section', { class: 'panel' }, h('h2', null, '계정'),
        h('button', { type: 'button', class: 'btn', onclick: function () { store.signOut().then(function () { fam = null; items = []; go('/'); }); } }, '로그아웃'));
    }
    return [h('h1', null, '설정'), alertForm, connForm, account, demoPanel];
  }

  // ════════════════════════════════════════════════════════
  // DB 모드 — 로그인 · 가족 만들기/들어가기
  // ════════════════════════════════════════════════════════
  function viewLogin() {
    var email = h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true });
    var pw = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: '6' });
    var msg = h('div', { class: 'form-errors', role: 'alert' });
    function run(kind) {
      msg.innerHTML = '';
      if (!email.value.trim() || pw.value.length < 6) { msg.appendChild(h('p', null, '이메일과 6자 이상 비밀번호를 넣어 주세요.')); return; }
      var p = kind === 'up' ? store.signUp(email.value.trim(), pw.value) : store.signIn(email.value.trim(), pw.value);
      p.then(function (d) {
        if (kind === 'up' && !(d && d.session)) {
          msg.appendChild(h('p', { class: 'ok-text' }, '가입했습니다. 받은 메일의 인증 링크를 누른 뒤 여기서 로그인해 주세요.'));
          return;
        }
        render();
      }).catch(function (e) { msg.appendChild(h('p', null, e.message)); });
    }
    var form = h('form', { class: 'panel narrow' },
      h('h2', null, '로그인'),
      field('이메일', email), field('비밀번호 (6자 이상)', pw), msg,
      h('div', { class: 'row' },
        h('button', { type: 'submit', class: 'btn primary' }, '로그인'),
        h('button', { type: 'button', class: 'btn', onclick: function () { run('up'); } }, '처음이면 가입')));
    form.addEventListener('submit', function (ev) { ev.preventDefault(); run('in'); });
    return [h('h1', null, '가족 기프티콘 보관함'), h('p', { class: 'lead' }, '가족 각자 이메일로 가입·로그인합니다.'), form,
      h('p', { class: 'hint' }, '주소·키를 바꾸려면 「설정」으로 가세요.')];
  }

  function viewSetupFamily() {
    var dn1 = h('input', { name: 'dn1', maxlength: '20', placeholder: '예) 엄마' });
    var fname = h('input', { name: 'fname', maxlength: '40', placeholder: '예) 우리 가족' });
    var dn2 = h('input', { name: 'dn2', maxlength: '20', placeholder: '예) 아빠' });
    var code = h('input', { name: 'code', maxlength: '12', placeholder: '예) ABCD-2345', autocapitalize: 'characters' });
    var f1 = h('form', { class: 'panel' }, h('h2', null, '새 가족 만들기'),
      field('가족 이름', fname), field('내 표시 이름', dn1), h('button', { type: 'submit', class: 'btn primary' }, '가족 만들기'));
    var f2 = h('form', { class: 'panel' }, h('h2', null, '초대 코드로 들어가기'),
      field('초대 코드 (8자리)', code), field('내 표시 이름', dn2), h('button', { type: 'submit', class: 'btn primary' }, '들어가기'));
    f1.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var e = L.validateDisplayName(dn1.value);
      if (!fname.value.trim()) e = '가족 이름을 적어 주세요.';
      if (e) { toast(e, true); return; }
      store.createFamily(fname.value.trim(), dn1.value.trim()).then(function () { toast('가족을 만들었습니다. 「가족」에서 초대 코드를 확인하세요.'); return reload(); }).then(function () { go('/family'); }).catch(fail);
    });
    f2.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var c = L.normalizeInviteCode(code.value);
      var e = L.isInviteCode(c) ? L.validateDisplayName(dn2.value) : '초대 코드 8자리를 확인해 주세요(0·1·I·O 는 쓰지 않습니다).';
      if (e) { toast(e, true); return; }
      store.joinFamily(c, dn2.value.trim()).then(function () { toast('가족에 들어갔습니다.'); return reload(); }).then(function () { go('/'); }).catch(fail);
    });
    return [h('h1', null, '가족 연결'), h('p', { class: 'lead' }, '한 사람이 가족을 만들고, 나머지는 초대 코드로 들어옵니다.'),
      h('div', { class: 'two' }, f1, f2),
      h('button', { type: 'button', class: 'btn', onclick: function () { store.signOut().then(function () { go('/'); }); } }, '로그아웃')];
  }

  // ════════════════════════════════════════════════════════
  // 흐름
  // ════════════════════════════════════════════════════════
  function reload() {
    today = L.todayStr();
    return store.myFamily().then(function (f) {
      fam = f;
      if (!f) { items = []; return; }
      return store.listGiftcons().then(function (list) { items = list; });
    }).then(render);
  }

  function render() {
    var r = route();
    paintChrome();
    if (r === '/settings') { show(viewSettings()); return; }
    if (store.needsLogin()) {
      store.session().then(function (s) {
        if (!s) { show(viewLogin()); return; }
        if (!fam) {
          store.myFamily().then(function (f) {
            if (f) { reload(); return; }
            show(viewSetupFamily());
          }).catch(function (e) { show(h('h1', null, '연결 오류'), h('p', { class: 'error-text' }, e.message), h('a', { class: 'btn', href: '#/settings' }, '설정으로')); });
          return;
        }
        route2(r);
      });
      return;
    }
    if (!fam) { show(h('p', { class: 'muted' }, '불러오는 중…')); return; }
    route2(r);
  }
  function route2(r) {
    paintChrome();
    if (r === '/add') show(viewForm(null));
    else if (r.indexOf('/edit/') === 0) show(viewForm(decodeURIComponent(r.slice(6))));
    else if (r === '/log') show(viewLog());
    else if (r === '/family') show(viewFamily());
    else show(viewBox());
  }

  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  document.getElementById('dialog').addEventListener('click', function (ev) { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  if (store.client) {
    store.client.auth.onAuthStateChange(function (ev) {
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') reload().catch(function () { render(); });
    });
  }
  reload().catch(function (e) { fail(e); render(); });
})();
