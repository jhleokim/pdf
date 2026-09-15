# v6.2.2 · Acrobat 글꼴 호환성 및 하나 서체

OCR 검색층은 이전에 FontDescriptor와 ToUnicode만 만들고 실제 TTF를 넣지 않았습니다. Acrobat Pro DC(32-bit)에서 이 출력물을 열었을 때 `PDFStudioOCR` 글꼴을 찾거나 만들 수 없다는 경고를 재현했습니다.

- Tesseract 공식 GlyphLessFont(572바이트)를 포함하고, 각 CID를 실제 존재하는 빈 글리프 1에 연결합니다. Unicode 대응표와 단어·교정 글줄의 폭 및 좌표는 유지합니다. 한 문서의 검색 글꼴들은 같은 TTF 객체를 공유합니다.
- 나눔고딕·나눔명조의 전체 TTF 포함 방식을 유지하고 PDF 글꼴 이름을 실제 PostScript 이름과 일치시켰습니다. 최신 코드의 단순 나눔 입력 PDF에서는 별도 경고를 재현하지 못했으며, 원본 TTF가 누락·변형되지 않는 회귀 검사를 추가했습니다.
- 공식 하나2.0 Regular와 Bold를 텍스트 도구에 추가했습니다. 배포받은 TTF를 변경하지 않고 보관·포함합니다. 글꼴은 선택할 때 해석하고, 출력에는 사용한 서체만 문서당 한 번 포함합니다. 서체의 별도 사용 조건과 출처·해시도 웹 및 단독 HTML에 포함됩니다.
- 단독 HTML에는 OCR 엔진·모델·서체가 모두 포함됩니다. 크기는 96,537,503바이트(약 96.5MB)이며 하나 서체 추가로 이전 버전보다 약 8MB 커졌습니다. Google Vision 클라우드 옵션은 포함하지 않습니다.

## 검증

- `node --test tests/*.test.cjs`: 332개 통과, 실패·건너뜀 0개.
- 5개 신규 PDF 검증: OCR TTF 원본·문자 매핑·프로그램 공유·Unicode 검색, 나눔/하나 4종의 실제 마크업 저장·전체 TTF 동일성·중복 포함 방지·한글 검색.
- 웹 브라우저 8개 검사: 서체 선택, 입력창 글꼴, 4종 저장 및 렌더링, OCR 동시 검색, 전체 페이지 미리보기, 외부 HTTP 차단 상태의 글꼴 사용.
- Acrobat Pro DC(32-bit): 수정 전 OCR PDF 경고 재현 → 수정 후 경고 없음 → 문서 속성에서 `GlyphLessFont (포함)` 확인. 나눔 2종의 강조·기울임·취소선 PDF도 화면에 표시됨을 확인했습니다. 하나 2종의 렌더링은 PDF.js에서 검증했습니다.
- 단독 HTML의 글꼴 데이터와 관련 실행 코드가 브라우저에서 검증한 웹 빌드와 동일함을 확인했습니다. 이번 자동화 환경의 URL 정책이 `file://` 탐색을 차단하여 직접 파일 실행은 검사하지 않았습니다.

## 재현

```sh
npm run build
npm run build:standalone
npm test
node tests/create-font-fixture.cjs
```

로컬 서버에서 `tests/fixtures/font-web.html`의 PASS 결과를 확인합니다. 단독 파일을 직접 실행할 수 있는 환경에서는 `tests/fixtures/font-standalone.html`을 열어 동일 검사를 실행할 수 있습니다. `PDF_FONT_QA_DIR` 환경변수로 지정한 로컬 경로에 글꼴 검사 PDF를 생성할 수 있습니다. 사용자 문서를 서버로 보내는 검사는 없습니다.

이미 만들어진 오류 PDF를 자동 복구하는 기능은 포함하지 않습니다. 원본 문서에서 v6.2.2로 다시 내보내세요.
