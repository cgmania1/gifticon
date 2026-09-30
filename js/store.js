/*
 * 저장소 — 화면은 이 인터페이스 하나만 씁니다. 모든 함수는 Promise 를 돌려줍니다.
 *
 *   체험 모드(demo) : 이 브라우저 localStorage 에 예시 가족·기프티콘을 둡니다. 로그인 없음.
 *   DB 모드(db)     : 「설정」에 넣은 본인 Supabase 프로젝트(주소·anon 키)를 씁니다.
 *                     이메일·비밀번호 로그인, 가족 공유, 사진은 비공개 Storage 버킷.
 *
 *   mode · needsLogin() · session() · signIn/signUp/signOut
 *   myFamily() → { family:{id,name,inviteCode}, members:[{userId,displayName,role}], me } | null
 *   createFamily(name, displayName) · joinFamily(code, displayName) · renameMe(displayName)
 *   listGiftcons() · addGiftcon(value, imageBlob) · updateGiftcon(id, patch, imageBlob)
 *   setUsed(id, bool) · setReserved(id, userId|null) · spend(id, 원) · deleteGiftcon(id)
 *   imageUrl(g) · listLog()
 *
 * Supabase 주소·키는 이 파일에 없습니다. 사용자가 「설정」에 넣은 값을 localStorage 에만 둡니다.
 */
(function (root) {
  'use strict';
  var L = root.GCLogic;
  var KEY_DEMO = 'data09-21.demo';
  var KEY_CONN = 'data09-21.conn';
  var KEY_SETTINGS = 'data09-21.settings';
  var KEY_OPENAI = 'data09-21.openai';   // 사진 읽기 자동 모드용 사용자 본인 키 — 이 브라우저에만
  var memory = {};
  var storageOk = true;

  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { storageOk = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); return true; } catch (e) { storageOk = false; memory[k] = v; return false; }
  }
  function del(k) { try { root.localStorage.removeItem(k); } catch (e) { delete memory[k]; } }
  function readJson(k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } }

  // ── 설정(알림 시점 등) — 기기마다 ─────────────────────────
  function loadSettings() {
    var s = readJson(KEY_SETTINGS) || {};
    var days = L.resolveAlertDays(s.alertDays, !!s.alertCustom);
    // phones: { 구성원 userId: '01012345678' } — 「가족에게 보내기」 문자 받을 번호(선택). DB 에 올리지 않고 이 기기에만.
    var phones = s.phones && typeof s.phones === 'object' ? s.phones : {};
    return { alertDays: days, alertCustom: !!s.alertCustom, tab: s.tab || 'usable', demoMe: s.demoMe || null, phones: phones };
  }
  function saveSettings(s) { return set(KEY_SETTINGS, JSON.stringify(s)); }

  function loadConn() { var c = readJson(KEY_CONN); return c && c.url && c.key ? c : null; }
  function saveConn(url, key) { return set(KEY_CONN, JSON.stringify({ url: url, key: key })); }
  function clearConn() { del(KEY_CONN); }
  function loadOpenAIKey() { return get(KEY_OPENAI) || ''; }
  function saveOpenAIKey(k) { return set(KEY_OPENAI, k); }
  function clearOpenAIKey() { del(KEY_OPENAI); }

  function uid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function blobToDataUrl(blob) {
    return new Promise(function (ok, fail) {
      var r = new FileReader();
      r.onload = function () { ok(r.result); };
      r.onerror = function () { fail(new Error('사진을 읽지 못했습니다.')); };
      r.readAsDataURL(blob);
    });
  }

  // ════════════════════════════════════════════════════════
  // 체험 모드
  // ════════════════════════════════════════════════════════
  function DemoStore() {
    var db = readJson(KEY_DEMO);
    if (!db || !db.family || !Array.isArray(db.giftcons)) db = root.GCSample.build();
    var self = this;
    function save() {
      if (!set(KEY_DEMO, JSON.stringify(db))) throw new Error('브라우저 저장 공간이 가득 찼거나 막혀 있습니다. 사진이 많으면 몇 장 지워 주세요.');
    }
    function name(id) { return L.memberName(db.members, id); }
    function me() { return db.members.filter(function (m) { return m.userId === db.me; })[0] || db.members[0]; }
    function log(before, after) {
      L.logEntriesFor(before, after, name).forEach(function (e) {
        db.log.push(Object.assign(e, { id: ++db.seq, actor: me().userId, actorName: me().displayName, createdAt: new Date().toISOString() }));
      });
    }
    function find(id) {
      var g = db.giftcons.filter(function (x) { return x.id === id; })[0];
      if (!g) throw new Error('기프티콘을 찾지 못했습니다. 화면을 새로 고쳐 주세요.');
      return g;
    }
    function done(v) { return Promise.resolve(v); }
    function attempt(fn) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }

    this.mode = 'demo';
    this.isSample = function () { return !!db._sample; };
    this.needsLogin = function () { return false; };
    this.session = function () { return done({ user: { id: db.me, email: '' } }); };
    this.myFamily = function () {
      return done({ family: db.family, members: db.members.slice(), me: db.me });
    };
    // 체험 모드에서만: 지금 쓰는 사람 바꾸기(가족이 한 기기를 돌려 쓰는 상황 흉내)
    this.setDemoMe = function (id) { db.me = id; save(); };
    this.renameMe = function (displayName) { return attempt(function () { me().displayName = displayName; save(); }); };
    this.listGiftcons = function () { return done(db.giftcons.map(function (g) { return Object.assign({}, g); })); };
    this.addGiftcon = function (v, imageBlob) {
      return (imageBlob ? blobToDataUrl(imageBlob) : Promise.resolve(null)).then(function (dataUrl) {
        var g = {
          id: 'g-' + uid(), familyId: db.family.id, title: v.title, brand: v.brand || '', expiresOn: v.expiresOn,
          memo: v.memo || '', imagePath: null, createdBy: db.me, reservedBy: v.reservedBy || null,
          isAmount: !!v.isAmount, faceValue: v.isAmount ? v.faceValue : null, balance: v.isAmount ? v.balance : null,
          used: false, usedBy: null, usedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        if (L.autoUsed(null, g)) { g.used = true; g.usedBy = db.me; g.usedAt = g.createdAt; }
        if (dataUrl) { g.imagePath = 'demo:' + g.id; db.images[g.id] = dataUrl; }
        db.giftcons.push(g);
        log(null, g);
        save();
        return Object.assign({}, g);
      });
    };
    this.updateGiftcon = function (id, patch, imageBlob) {
      return (imageBlob ? blobToDataUrl(imageBlob) : Promise.resolve(null)).then(function (dataUrl) {
        var g = find(id), before = Object.assign({}, g);
        ['title', 'brand', 'expiresOn', 'memo', 'reservedBy', 'isAmount', 'faceValue', 'balance'].forEach(function (k) { if (k in patch) g[k] = patch[k]; });
        if (!g.isAmount) { g.faceValue = null; g.balance = null; }
        if (dataUrl) { g.imagePath = 'demo:' + g.id + ':' + Date.now(); db.images[g.id] = dataUrl; }
        if (!g.used && L.autoUsed(before, g)) { g.used = true; g.usedBy = db.me; g.usedAt = new Date().toISOString(); }
        g.updatedAt = new Date().toISOString();
        log(before, g);
        save();
        return Object.assign({}, g);
      });
    };
    this.setUsed = function (id, used) {
      return attempt(function () {
        var g = find(id), before = Object.assign({}, g);
        if (!!g.used === !!used) return Object.assign({}, g);
        g.used = !!used;
        g.usedBy = used ? db.me : null;
        g.usedAt = used ? new Date().toISOString() : null;
        g.updatedAt = new Date().toISOString();
        log(before, g);
        save();
        return Object.assign({}, g);
      });
    };
    // 금액형 나눠 쓰기 — 잔액이 0 이 되면 사용함
    this.spend = function (id, amount) {
      return attempt(function () {
        var g = find(id), before = Object.assign({}, g);
        var r = L.spendResult(g, amount);
        if (!r.ok) throw new Error(r.error);
        g.balance = r.balance;
        if (L.autoUsed(before, g)) { g.used = true; g.usedBy = db.me; g.usedAt = new Date().toISOString(); }
        g.updatedAt = new Date().toISOString();
        log(before, g);
        save();
        return Object.assign({}, g);
      });
    };
    this.setReserved = function (id, userId) {
      return attempt(function () {
        var g = find(id), before = Object.assign({}, g);
        g.reservedBy = userId || null;
        log(before, g);
        save();
        return Object.assign({}, g);
      });
    };
    this.deleteGiftcon = function (id) {
      return attempt(function () {
        var g = find(id);
        db.giftcons = db.giftcons.filter(function (x) { return x.id !== id; });
        delete db.images[id];
        log(g, null);
        save();
      });
    };
    this.imageUrl = function (g) { return done(g.imagePath ? db.images[g.id] || null : null); };
    this.listLog = function () { return done(db.log.slice().reverse()); };
    // 체험 데이터 관리
    this.resetSample = function () { db = root.GCSample.build(); save(); };
    this.clearAll = function () {
      db = { family: db.family, members: db.members, me: db.me, giftcons: [], images: {}, log: [], seq: 0 };
      save();
    };
    void self;
  }

  // ════════════════════════════════════════════════════════
  // DB 모드 (본인 Supabase)
  // ════════════════════════════════════════════════════════
  var BUCKET = 'giftcons';

  function niceError(e) {
    var msg = (e && (e.message || e.error_description)) || String(e);
    if (/Invalid login credentials/i.test(msg)) return new Error('이메일 또는 비밀번호가 맞지 않습니다.');
    if (/Email not confirmed/i.test(msg)) return new Error('이메일 인증이 아직 안 됐습니다. 받은 메일의 링크를 누른 뒤 다시 로그인해 주세요.');
    if (/User already registered/i.test(msg)) return new Error('이미 가입된 이메일입니다. 로그인해 주세요.');
    if (/Password should be/i.test(msg)) return new Error('비밀번호는 6자 이상이어야 합니다.');
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new Error('Supabase 에 연결하지 못했습니다. 인터넷 연결과 「설정」의 주소를 확인해 주세요.');
    if (/relation .* does not exist|Could not find the table|schema cache/i.test(msg)) return new Error('DB 표가 없습니다. supabase/schema.sql 을 SQL Editor 에서 먼저 실행해 주세요.');
    if (/초대 코드|이미 가족|로그인이 필요|잔액|금액형|사용함/.test(msg)) return new Error(msg);
    if (/is_amount|face_value|spend_giftcon/.test(msg)) return new Error('DB 가 옛 판입니다. supabase/schema.sql 을 SQL Editor 에서 다시 실행해 주세요(데이터는 그대로).');
    if (e && e.code === '42501' || /row-level security/i.test(msg)) return new Error('권한이 없습니다(같은 가족만 볼 수 있습니다).');
    return new Error(msg);
  }
  function unwrap(res) { if (res.error) throw niceError(res.error); return res.data; }

  function DbStore(conn) {
    if (!root.supabase || !root.supabase.createClient) throw new Error('vendor/supabase.js 를 불러오지 못했습니다.');
    var sb = root.supabase.createClient(conn.url, conn.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'data09-21.auth' }
    });
    var cache = { family: null, urls: {} };
    function userId() { return sb.auth.getSession().then(function (r) { return r.data.session ? r.data.session.user.id : null; }); }
    function famId() {
      if (cache.family) return Promise.resolve(cache.family.family.id);
      return self.myFamily().then(function (f) { if (!f) throw new Error('먼저 가족을 만들거나 초대 코드로 들어가 주세요.'); return f.family.id; });
    }
    var self = this;

    this.mode = 'db';
    this.client = sb;
    this.isSample = function () { return false; };
    this.needsLogin = function () { return true; };
    this.session = function () { return sb.auth.getSession().then(function (r) { return r.data.session; }); };
    this.signIn = function (email, pw) {
      return sb.auth.signInWithPassword({ email: email, password: pw }).then(unwrap);
    };
    this.signUp = function (email, pw) {
      var opts = /^https?:/.test(root.location.protocol) ? { emailRedirectTo: root.location.href.split('#')[0] } : {};
      return sb.auth.signUp({ email: email, password: pw, options: opts }).then(unwrap);
    };
    this.signOut = function () { cache.family = null; cache.urls = {}; return sb.auth.signOut(); };
    this.myFamily = function () {
      return userId().then(function (me) {
        if (!me) return null;
        return sb.from('family_members').select('family_id').eq('user_id', me).maybeSingle().then(unwrap).then(function (row) {
          if (!row) { cache.family = null; return null; }
          return Promise.all([
            sb.from('families').select('id,name,invite_code').eq('id', row.family_id).single().then(unwrap),
            sb.from('family_members').select('user_id,display_name,role').eq('family_id', row.family_id).order('joined_at').then(unwrap)
          ]).then(function (r) {
            cache.family = {
              family: { id: r[0].id, name: r[0].name, inviteCode: r[0].invite_code },
              members: r[1].map(function (m) { return { userId: m.user_id, displayName: m.display_name, role: m.role }; }),
              me: me
            };
            return cache.family;
          });
        });
      });
    };
    this.createFamily = function (name, displayName) {
      return sb.rpc('create_family', { p_name: name, p_display_name: displayName }).then(unwrap).then(function () { cache.family = null; });
    };
    this.joinFamily = function (code, displayName) {
      return sb.rpc('join_family', { p_code: code, p_display_name: displayName }).then(unwrap).then(function () { cache.family = null; });
    };
    this.renameMe = function (displayName) {
      return userId().then(function (me) {
        return sb.from('family_members').update({ display_name: displayName }).eq('user_id', me).then(unwrap);
      }).then(function () { cache.family = null; });
    };
    this.listGiftcons = function () {
      return famId().then(function (fid) {
        return sb.from('giftcons').select('*').eq('family_id', fid).order('expires_on').then(unwrap);
      }).then(function (rows) { return rows.map(L.fromRow); });
    };
    function upload(fid, blob) {
      if (!blob) return Promise.resolve(null);
      var path = fid + '/' + uid() + '.jpg';
      return sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
        .then(unwrap).then(function () { return path; });
    }
    function removeFile(path) {
      if (!path) return Promise.resolve();
      return sb.storage.from(BUCKET).remove([path]).then(function () {}, function () {});
    }
    this.addGiftcon = function (v, blob) {
      return famId().then(function (fid) {
        return upload(fid, blob).then(function (path) {
          var row = L.toRow({ title: v.title, brand: v.brand, expiresOn: v.expiresOn, memo: v.memo, reservedBy: v.reservedBy, imagePath: path,
            isAmount: v.isAmount, faceValue: v.faceValue, balance: v.balance });
          row.family_id = fid;
          return sb.from('giftcons').insert(row).select().single().then(function (res) {
            if (res.error) { removeFile(path); throw niceError(res.error); }
            return L.fromRow(res.data);
          });
        });
      });
    };
    this.updateGiftcon = function (id, patch, blob) {
      return famId().then(function (fid) {
        return sb.from('giftcons').select('image_path').eq('id', id).single().then(unwrap).then(function (old) {
          return upload(fid, blob).then(function (path) {
            var p = Object.assign({}, patch);
            if (path) p.imagePath = path;
            return sb.from('giftcons').update(L.toRow(p)).eq('id', id).select().single().then(function (res) {
              if (res.error) { removeFile(path); throw niceError(res.error); }
              if (path && old.image_path) removeFile(old.image_path);
              return L.fromRow(res.data);
            });
          });
        });
      });
    };
    this.setUsed = function (id, used) {
      return sb.from('giftcons').update({ used: !!used }).eq('id', id).select().single().then(unwrap).then(L.fromRow);
    };
    // 나눠 쓰기는 RPC 로 — 두 사람이 동시에 써도 DB 가 잔액을 한 번에 줄이고 모자라면 거절
    this.spend = function (id, amount) {
      var a = L.parseWon(amount);
      return sb.rpc('spend_giftcon', { p_id: id, p_amount: a }).then(unwrap).then(L.fromRow);
    };
    this.setReserved = function (id, userId) {
      return sb.from('giftcons').update({ reserved_by: userId || null }).eq('id', id).select().single().then(unwrap).then(L.fromRow);
    };
    this.deleteGiftcon = function (id) {
      return sb.from('giftcons').delete().eq('id', id).select('image_path').then(unwrap).then(function (rows) {
        if (!rows.length) throw new Error('지우지 못했습니다(이미 지워졌거나 권한이 없습니다).');
        return removeFile(rows[0].image_path);
      });
    };
    this.imageUrl = function (g) {
      if (!g.imagePath) return Promise.resolve(null);
      var c = cache.urls[g.imagePath];
      if (c && c.until > Date.now()) return Promise.resolve(c.url);
      return sb.storage.from(BUCKET).createSignedUrl(g.imagePath, 3600).then(function (res) {
        if (res.error) return null;
        cache.urls[g.imagePath] = { url: res.data.signedUrl, until: Date.now() + 50 * 60 * 1000 };
        return res.data.signedUrl;
      });
    };
    this.listLog = function () {
      return famId().then(function (fid) {
        return sb.from('giftcon_log').select('*').eq('family_id', fid).order('id', { ascending: false }).limit(300).then(unwrap);
      }).then(function (rows) {
        return rows.map(function (r) {
          return { id: r.id, action: r.action, giftconId: r.giftcon_id, title: r.title, detail: r.detail,
            actor: r.actor, actorName: r.actor_name, createdAt: r.created_at };
        });
      });
    };
  }

  root.GCStore = {
    open: function () {
      var c = loadConn();
      if (c) {
        try { return new DbStore(c); }
        catch (e) { var d = new DemoStore(); d.connError = e.message; return d; }
      }
      return new DemoStore();
    },
    loadConn: loadConn, saveConn: saveConn, clearConn: clearConn,
    loadSettings: loadSettings, saveSettings: saveSettings,
    loadOpenAIKey: loadOpenAIKey, saveOpenAIKey: saveOpenAIKey, clearOpenAIKey: clearOpenAIKey,
    storageOk: function () { get(KEY_SETTINGS); return storageOk; },
    // 연결 시험: 주소·키로 표가 있는지 확인(로그인 전이라 행은 0개가 정상)
    testConn: function (url, key) {
      var sb = root.supabase.createClient(url, key, { auth: { persistSession: false } });
      return sb.from('giftcons').select('id', { head: true, count: 'exact' }).then(function (res) {
        if (res.error) throw niceError(res.error);
        return true;
      }, function (e) { throw niceError(e); });
    }
  };
})(window);
