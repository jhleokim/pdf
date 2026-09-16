# v6.2.3 · 스탠드얼론 개인정보 삭제 엔진

## 원인과 수정

기존 privacy Worker는 내부 파일까지 하나로 묶었지만 `type: 'module'`로 실행했습니다. Chromium에서 opaque origin(`null`)의 blob 모듈 로딩이 실패하여 마스킹 미리보기와 저장에 공통으로 사용하는 엔진이 시작되지 않았습니다. 이 실패가 후속 B&W 처리도 막았습니다.

v6.2.2 내장 자산을 사용한 비교에서 일반 HTTP origin은 성공(535ms), sandbox의 opaque origin은 `개인정보 삭제 엔진 오류`로 실패했습니다. 같은 환경의 최소 classic Worker는 정상적으로 시작했습니다.

- MuPDF의 비동기 초기화를 async 함수 안에 묶은 classic Worker로 변경했습니다. 브라우저 Worker에는 모듈 import/export나 `import.meta`가 없습니다.
- SHA-256으로 검사한 내장 WASM을 전달하여 초기화합니다. 단독 HTML은 CDN이나 서버의 엔진 파일에 접근하지 않습니다. 웹은 기존과 같이 필요한 자산만 같은 출처에서 가져옵니다.
- WASM 초기화 실패는 원인을 포함한 오류로 반환합니다.
- 기존 영역 삭제 엔진, 24MiB 한도 캐시, 순차 처리, 취소, 30초 유휴 종료 방식을 유지합니다. 엔진 실패 때 전체 페이지를 이미지로 대체하거나 원문을 저장하는 우회 경로는 없습니다.
- B&W 자체 알고리즘 변경 없이, 선행 엔진 오류 해결 후 실제 이미지 변환과 미리보기·저장의 일치를 검사했습니다. 텍스트와 벡터는 기존 방식대로 보존합니다.

## 검증

- `npm test`: 334개 통과, 실패·건너뜀 0개.
- 실제 배포 Worker 번들로 네트워크 차단 상태의 WASM 초기화, 부분 텍스트 삭제, 비정상 WASM 오류 반환을 검사하는 회귀 테스트 2개 추가.
- 단독 HTML 전체를 외부 HTTP 요청이 금지된 환경에서 실행했습니다. 일반 HTTP origin과 `sandbox="allow-scripts ..."`(same-origin 권한 없음)의 opaque origin에서 각각 34개 통합 검사 통과.
- JPEG·PNG 이미지의 B&W 단독, 마스킹 단독, 두 기능 동시 적용에 대해 현재 미리보기 픽셀과 저장 PDF를 검사했습니다. 검색 가능한 공개 텍스트는 유지되고 가린 텍스트만 추출에서 사라짐을 확인했습니다. 취소 후 재시도, 오류 문서 다음 정상 문서 처리도 통과했습니다.
- 직접 `file://` 탐색은 이 자동화 환경에서 검증하지 않았습니다. 로컬 파일과 동일한 opaque-origin blob 로딩 실패를 재현하고 그 조건에서 전체 앱을 검사했습니다. 특정 사내 브라우저 정책까지 보장하는 검사는 아닙니다.

## 재현

```sh
npm run build
npm run build:standalone
npm test
node tests/create-privacy-standalone.cjs
python -m http.server 8765 --bind 127.0.0.1
```

`work/privacy-fix/standalone-qa.html`과 `opaque-qa.html`에서 `ALL PASSED`를 확인합니다. `web-qa.html`은 웹 빌드와 같은 출처에서의 자산 로딩을 검사합니다. 테스트는 합성 문서만 사용하고 QA 파일은 배포물에서 제외됩니다.

새 파일명은 `PDF-Studio-Standalone-v6.2.3.html`입니다. 이전 HTML 파일은 자동 갱신되지 않으므로 새 파일을 열어 우측 하단 버전을 확인해야 합니다.
