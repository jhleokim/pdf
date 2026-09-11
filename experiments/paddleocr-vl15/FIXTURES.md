# 동일 이미지 OCR 비교 자료

앱 소스를 변경하지 않고 `tests/create-tools-fixtures.py`의 Pillow RGB 이미지 + Windows 맑은 고딕 렌더링 방법을 재사용했다. 새 패키지 설치나 네트워크 호출은 없다. 모든 내용은 합성 자료다.

| 파일 | 확인할 내용 |
|---|---|
| `fixtures/01-mixed-paragraph.png` | 한글·영문 혼합 본문, 대소문자, 기호, 날짜, 007 같은 앞자리 0 |
| `fixtures/02-expense-receipt.png` | 가상 경비 영수증, 12,300원/4,500원/16,800원, 승인번호, 공급가액과 세액 |
| `fixtures/03-two-columns-table.png` | 왼쪽 열 전체→오른쪽 열 전체 읽기 순서, 표의 행과 셀 순서 |

세 PNG 모두 1400×1800 RGB다. 각 파일의 SHA256, 실제 그린 문장, 블록/문장/셀의 픽셀 좌표, 정답 텍스트와 중요 필드가 `fixtures/truth.json`에 있다. 텍스트 좌표는 `(left, top, right, bottom)`이며 원본 이미지의 픽셀 단위다. 비교하는 두 엔진에는 같은 PNG 바이트를 넣고 런타임의 이미지 축소 여부도 함께 기록한다.

로컬 URL은 `http://127.0.0.1:8765/experiments/paddleocr-vl15/fixtures/01-mixed-paragraph.png` 형태다.

## 생성과 채점

저장소 루트에서 실행한다.

```powershell
python experiments/paddleocr-vl15/generate_fixtures.py
python experiments/paddleocr-vl15/score_predictions.py --self-test
python experiments/paddleocr-vl15/score_predictions.py results.json --output scores.json
```

`results.json`은 아래 레코드 배열 또는 `{"results": [...]}` 형태다. 엔진별로 각 문서의 레코드를 하나씩 넣는다. 실패한 모델은 빈 인식 결과로 포장하지 말고 별도 런타임 실패로 보고한다.

```json
[
  {
    "id": "01-mixed-paragraph",
    "engine": "engine name and version",
    "text": "실제 엔진이 반환한 텍스트",
    "output_format": "plain",
    "elapsed_ms": 1200,
    "model_load_ms": 3000,
    "resize": "none"
  }
]
```

1. Unicode NFC를 적용하고 BOM·zero-width-space를 제거한다. 줄바꿈과 연속 공백은 하나의 공백으로 정규화한다. 대소문자, 문장부호, 소수점, 쉼표, 기호, 숫자 앞의 0은 유지한다. 맞춤법 교정이나 숫자 보정은 하지 않는다.
2. 정규화한 공백을 포함한 CER와 모든 공백을 제외한 CER를 함께 계산한다. CER는 `(삽입+삭제+치환)/정답 문자 수`다. 결과가 크게 잘못됐으면 1보다 클 수 있다. `accuracy_clamped`는 `max(0,1-CER)`로 별도 제공한다.
3. 금액·날짜·식별자는 필드 내부 공백을 무시한 정확 일치를 별도로 검사한다. 표의 수량과 금액이 합쳐지지 않도록 필드 앞뒤의 공백 경계는 유지한다. 숫자/영문 경계를 검사해 `112,300원` 속의 `12,300원`을 정답으로 세지 않는다. `12,300원`과 `12300원`도 엄격 채점에서는 다르다.
4. 읽기 순서는 완전히 일치하는 줄의 등장 순서로 역전 수를 계산한다. 줄 인식 자체가 틀리면 순서를 평가할 수 없으므로 일치 줄 수 및 CER와 함께 읽는다. 두 열의 정답은 왼쪽 열을 끝까지 읽고 오른쪽 열을 읽는 순서다. 표는 머리글과 각 행을 왼쪽→오른쪽으로 읽고 셀 사이를 탭으로 구분한다. 셀 정답 배열도 별도로 제공한다.
5. Paddle이 Markdown을 반환하면 `output_format: "markdown"`을 명시할 수 있다. 제목의 `#`, 코드 울타리 줄, 표의 구분선/셀 구분자, `**`/`__` 강조 표시만 정해진 규칙으로 제거한다. 원시 출력 CER도 같이 남긴다. 숫자 목록이나 실제 구두점은 지우지 않는다. HTML 및 별도 모델 제어 토큰은 자동으로 제거하지 않는다.

이 자료는 깨끗한 인쇄체와 소규모 문서만 다룬다. 손글씨, 흔들린 사진, 기울기, 저해상도, 흐릿한 팩스 또는 다양한 글꼴의 대표 벤치마크가 아니다. 결과만으로 엔진을 교체할 수 있다고 결론 내리지 않는다. 초기 모델 다운로드/준비 시간과 준비 후 인식 시간을 분리해 측정하고, 단일 HTML의 오프라인 구동 가능성은 별도 런타임 검사로 확인해야 한다.

## 현재 Tesseract의 실제 브라우저 기준선

```powershell
node experiments/paddleocr-vl15/create-baseline.cjs
```

`http://127.0.0.1:8765/experiments/paddleocr-vl15/tesseract-baseline.html`을 열고 **실제 인식 시작**을 누른다. `#baselineStatus`에는 진행 상태, `#baselineReport`에는 결과 JSON이 표시된다. 상태는 `idle`, `running`, `complete`, `error`다. 완료 JSON 전체를 파일로 저장하면 위 채점기가 `results` 배열을 읽을 수 있다.

생성기는 현재 `index.html` 번들 전체를 복사하고 PNG 세 장까지 내장한다. 실제 `PDFOCR.session('kor', signal, onProgress, 'auto')` 하나에서 세 이미지를 순서대로 인식한다. 이 앱에서 `kor`는 한글과 영어 데이터를 함께 로드하며 자동 문서 구성은 실제 PSM3/PSM6 결과를 앱의 기존 기준으로 선택한다. 인식 결과나 엔진/fetch 함수는 바꾸지 않는다. HTML의 CSP는 `connect-src 'self' blob: data:`로 외부 연결을 차단하며 모델·언어·이미지는 파일에 내장되어 있다.

`elapsed_ms`는 각 이미지의 `recognize(canvas)` 시간이다. 최초 `session` 준비 시간은 `session.model_load_ms`이며 첫 결과에도 기록한다. 이미지 디코딩 시간은 `fixture_load_ms`로 분리한다. `words`에는 실제 단어·confidence·정규화 bbox가 들어 있고 `chosen_psm`은 선택된 실제 처리 방식이다. 소스 HTML과 각 이미지의 SHA256, 원본1400×1800 여부도 기록한다. 이 파일의 생성/정적 구문 검사는 실제 브라우저에서 엔진 인식에 성공했다는 증거와 구별해야 한다.
