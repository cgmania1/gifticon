/*
 * 사진 글자 읽기 — 무료 OCR (Tesseract.js, 이 휴대폰·PC 안에서만 돎). 2026-09-29 저녁 추가.
 *
 * - 사진은 어디로도 보내지 않습니다. 글자 읽기 엔진과 한국어·영어 학습 데이터는 이 저장소 vendor/tesseract/ 에 있고,
 *   「사진 글자 읽기」를 처음 누를 때만 받습니다(약 8.4MB, 브라우저가 기억해 두 번째부터 빠름).
 *   페이지를 열 때는 아무것도 더 받지 않습니다.
 * - 읽은 글자에서 칸을 나누는 규칙은 GCLogic.parseOcrText. 바코드·쿠폰 번호 줄은 버립니다.
 * - 브라우저는 파일로 연 페이지(file://)에서 Web Worker·데이터 받기를 막습니다. 그때는 안내 문구를 돌려주고,
 *   Pages 주소(https://aebonlee.github.io/data09-21/)에서 쓰도록 합니다.
 */
(function (root) {
  'use strict';
  var BASE = 'vendor/tesseract/';
  var loading = null;   // 라이브러리 스크립트 한 번만
  var workerP = null;   // 엔진 한 번만 만들어 재사용

  function abs(p) { return new URL(p, root.location.href).href; }
  function isFileUrl() { return root.location.protocol === 'file:'; }
  var FILE_MSG = '파일로 연 화면(file://)에서는 브라우저가 글자 읽기 엔진을 막습니다. https://aebonlee.github.io/data09-21/ 에서 해 주세요. 파일로 연 채로는 아래 방법 2(무료 AI 채팅)를 써 주세요.';

  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (loading) return loading;
    loading = new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = BASE + 'tesseract.min.js';
      s.onload = function () { root.Tesseract ? ok(root.Tesseract) : bad(new Error('글자 읽기 엔진을 불러오지 못했습니다.')); };
      s.onerror = function () { loading = null; bad(new Error('글자 읽기 엔진 파일을 받지 못했습니다. 인터넷 연결을 확인해 주세요.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  var onProgress = null;
  function getWorker() {
    if (workerP) return workerP;
    workerP = loadLib().then(function (T) {
      return T.createWorker(['kor', 'eng'], 1 /* LSTM_ONLY */, {
        workerPath: abs(BASE + 'worker.min.js'),
        corePath: abs(BASE + 'core'),
        langPath: abs(BASE + 'lang'),
        gzip: true,
        workerBlobURL: false,
        logger: function (m) { if (onProgress) onProgress(m); },
        errorHandler: function () { /* 아래 catch 에서 안내 */ }
      });
    });
    workerP.catch(function () { workerP = null; });
    return workerP;
  }

  // 두 번째 읽기용 그림 — 점마다 R·G·B 중 가장 밝은 값으로 회색을 만듭니다(2026-09-30).
  // 검은·회색 글씨는 그대로 어둡고, 파랑·분홍 같은 색 배경·형광 밑줄은 밝아져 지워집니다.
  // 실제 캡처에서 파란 밑줄이 깔린 브랜드 줄(「메가MGC커피」)을 첫 읽기가 통째로 놓쳐 넣었습니다.
  function brightCanvas(image) {
    var mk = root.createImageBitmap ? root.createImageBitmap(image) : Promise.reject(new Error('이 브라우저는 그림 바꾸기를 못 합니다.'));
    return mk.then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      var x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      var id = x.getImageData(0, 0, c.width, c.height), d = id.data;
      for (var i = 0; i < d.length; i += 4) { var g = Math.max(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = g; }
      x.putImageData(id, 0, 0);
      return c;
    });
  }

  // image: File·Blob·canvas → Promise({ text, lines }) — 읽은 글자와 줄마다 높이·확신도
  // progress(글자): 「엔진 받는 중 37%」 같은 진행 안내
  // opts.bright: 색 배경을 지운 그림으로 읽기(발행처를 못 찾았을 때 두 번째로)
  function readText(image, progress, opts) {
    if (!image) return Promise.reject(new Error('먼저 사진을 골라 주세요.'));
    if (opts && opts.bright) return brightCanvas(image).then(function (c) { return readText(c, progress); });
    onProgress = function (m) {
      if (!progress || !m) return;
      var pct = typeof m.progress === 'number' ? ' ' + Math.round(m.progress * 100) + '%' : '';
      var what = /recogniz/.test(m.status) ? '글자 읽는 중' : /load|init/.test(m.status) ? '엔진·한국어 데이터 준비 중(처음 한 번 약 8MB)' : '준비 중';
      progress(what + pct);
    };
    return getWorker().then(function (w) {
      return w.recognize(image, {}, { text: true, blocks: true });
    }).then(function (r) {
      // → { text, lines:[{text, h, conf}] } — 줄 높이는 상품명(가장 큰 글자) 고르기에 씁니다
      var d = (r && r.data) || {}, lines = [];
      (d.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) {
        var hh = l.rowAttributes && l.rowAttributes.row_height ? l.rowAttributes.row_height : (l.bbox ? l.bbox.y1 - l.bbox.y0 : 0);
        lines.push({ text: l.text, h: hh, conf: l.confidence });
      }); }); });
      return { text: d.text || '', lines: lines };
    }, function (e) {
      var msg = (e && e.message) || String(e);
      if (isFileUrl()) { if (root.console) root.console.warn('OCR:', msg); msg = FILE_MSG; }
      throw new Error(msg);
    });
  }

  root.GCOCR = { readText: readText, isFileUrl: isFileUrl, FILE_MSG: FILE_MSG, BASE: BASE };
})(window);
