/*
 * 사진에서 읽기 — 자동 모드 (선택). 이 도구에서 OpenAI 로 요청을 보내는 유일한 곳입니다.
 *
 * - 사용자가 「등록」 화면의 「사진에서 채우기」에 자기 OpenAI API 키를 넣었을 때만 부릅니다.
 *   키는 이 브라우저 localStorage 에만 두고, 코드·리포에는 없습니다(공개 리포).
 * - 보내는 것: 요청문(GCLogic.READ_PROMPT)과 고른 사진 한 장(줄인 JPEG). 사진에 바코드가 있으면
 *   바코드도 함께 나가므로, 화면에서 먼저 안내합니다.
 * - 답은 칸을 「미리 채우기」만 합니다. 저장은 사람이 확인하고 「등록」을 눌러야 됩니다.
 */
(function (root) {
  'use strict';
  var ENDPOINT = 'https://api.openai.com/v1/chat/completions';

  // opts: { key, prompt, image(dataUrl), model } → Promise(답 글자)
  function readPhoto(opts) {
    if (!opts.key) return Promise.reject(new Error('OpenAI API 키를 먼저 넣어 주세요.'));
    if (!opts.image) return Promise.reject(new Error('먼저 사진을 골라 주세요.'));
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.key },
      body: JSON.stringify({
        model: opts.model || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: opts.prompt },
          { type: 'image_url', image_url: { url: opts.image, detail: 'high' } }
        ] }]
      })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (j) {
        if (!res.ok) {
          if (res.status === 401) throw new Error('OpenAI 키가 맞지 않습니다. 키를 다시 확인해 주세요.');
          if (res.status === 429) throw new Error('OpenAI 사용 한도에 걸렸습니다. 잠시 뒤 다시 하거나 결제 설정을 확인해 주세요.');
          throw new Error((j && j.error && j.error.message) || ('OpenAI 요청 실패 (HTTP ' + res.status + ')'));
        }
        return j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content || '' : '';
      });
    }, function () { throw new Error('OpenAI 에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); });
  }

  root.GCAI = { readPhoto: readPhoto, ENDPOINT: ENDPOINT };
})(window);
