# vendor/tesseract — 무료 글자 읽기(OCR) 엔진

「등록 → 사진에서 채우기 → 사진 글자 읽기 (무료)」를 **누를 때만** 불러옵니다. 페이지를 열 때는 받지 않습니다.
사진은 기기 밖으로 나가지 않습니다(모두 브라우저 안 WebAssembly 로 돎).

| 파일 | 출처 · 판 | 크기 | 라이선스 |
|---|---|---|---|
| `tesseract.min.js` · `worker.min.js` | npm `tesseract.js` 7.0.0 `dist/` | 62KB · 109KB | Apache-2.0 (`tesseract.js-LICENSE`) |
| `core/tesseract-core-*-lstm.wasm.js` | npm `tesseract.js-core` 7.0.0 (LSTM 전용 3종: relaxedsimd · simd · 기본) | 각 3.9MB, **기기마다 1개만** 받음 | Apache-2.0 (`core/tesseract.js-core-LICENSE`) |
| `lang/kor.traineddata.gz` · `lang/eng.traineddata.gz` | npm `@tesseract.js-data/kor`·`eng` 1.0.0 `4.0.0_best_int` (tesseract-ocr/tessdata_best 정수판) | 1.5MB · 2.9MB | Apache-2.0 |

- 처음 한 번 받는 양: 스크립트 0.17MB + 엔진 3.9MB + 한국어·영어 4.4MB ≈ **8.5MB**. 두 번째부터는 브라우저 캐시·IndexedDB 에서 읽습니다.
- 저장소에 더해진 양: 약 16MB(엔진 3종을 모두 두기 때문).
- **파일로 연 화면(file://)에서는 동작하지 않습니다** — 브라우저가 file:// 스크립트로 Web Worker 를 만드는 것을 막습니다(Chromium 실측: `Failed to construct 'Worker' … cannot be accessed from origin 'null'`). Pages 주소나 `python3 -m http.server` 로 연 화면에서 씁니다.
