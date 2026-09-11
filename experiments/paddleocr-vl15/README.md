# PDF Studio · PaddleOCR-VL-1.5 브라우저 실험 기록

이 폴더는 **2026-09-11에 v4.0 앱을 바탕으로 수행한 실험의 보관본**이다. PDF Studio 실험 빌더는 당시 앱 소스를 문자열 치환하여 별도 HTML을 만드는 방식이며, 기준 커밋은 **`1e68a378a6b3a21b11a013f224de4a4445c3152a`**다. 당시 실험에서는 운영 앱의 Tesseract 엔진과 배포를 변경하지 않았다.

현재 v5.0 웹의 Paddle 빌드·배포는 루트의 `src/paddle/`, `scripts/build-paddle-web.mjs`와 [운영 README](../../README.md)를 따른다. 이 폴더의 패치 빌더는 v5.0 소스에 적용하기 위한 빌드 경로가 아니다. 아래 실험 수치와 단일 HTML 크기·제약은 당시 결과이며 현재 웹 배포 성공이나 운영 성능을 뜻하지 않는다.

실험의 목표는 최종 사용자가 모델·런타임이 포함된 HTML 파일 하나를 받고 Python, npm, 서버 설치 없이 실행하는 구조였다. 아래 설치 명령은 **그 실험 HTML을 만드는 개발자용**이다. 당시 생성한 PDF Studio 단일 파일은 1,242,645,348바이트(약 1.16GiB / 1.24GB)다. 파일 크기와 별도로 모델을 메모리에 올릴 공간이 필요하다. 현재 v5.0의 일반 standalone 배포물은 Tesseract를 내장하며 Gemini를 제외한다.

2026-09-11 시험에서는 localhost 개발판에서 실제 WebGPU 추론을 확인했다. **단일 HTML을 `file://`로 직접 실행하는 검증은 사용한 브라우저 제어 환경의 보안 정책에 막혀 완료하지 못했다.** 내장 자산의 해시·로더·번들을 정적으로 검증한 사실과, 파일을 직접 열어 동작을 확인한 사실을 구분한다. 설치 없는 직접 실행이 모든 환경에서 검증됐다는 의미는 아니다.

## 사용 모델과 범위

- 모델: [ONNX Community PaddleOCR-VL-1.5](https://huggingface.co/onnx-community/PaddleOCR-VL-1.5-ONNX/tree/ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4), 고정 revision `ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4`.
- Q4 vision/decoder와 해당 변환본의 embedding을 사용한다. 공식 PaddleOCR 전체 문서 분석 파이프라인과 동일한 구성이 아니다.
- ONNX Runtime Web `1.29.0`, Transformers.js `4.2.0`, 개발 번들러 esbuild `0.25.10`을 lockfile로 고정했다.
- PDF Studio 어댑터는 실제 **Spotting** 결과의 글줄 좌표를 사용한다. 좌표가 없거나 생성이 잘린 결과를 검색 가능한 PDF 완료로 처리하지 않는다. 엔진이 제공하지 않는 신뢰도 점수를 만들지 않는다.
- WebGPU와 그래픽 장치가 필요하다. 어댑터는 `maxStorageBufferBindingSize`가 512MiB 미만인 환경을 명시적으로 거절한다. HTTP 시험은 localhost 같은 secure context에서 연다.
- 모델 다운로드는 개발 단계에 일어난다. 개발판은 로컬 HTTP로 자산을 읽고, 단일 파일판은 내장 바이트와 Blob URL을 사용한다. 문서는 외부 OCR 서버로 보내지 않는다.

## 개발판 재현

PDF Studio 실험 HTML을 재현하려면 먼저 기준 커밋 `1e68a378a6b3a21b11a013f224de4a4445c3152a`의 별도 체크아웃을 준비하고, 현재 보관된 `experiments/paddleocr-vl15/`의 Git 추적 소스를 그 체크아웃의 같은 상대 경로로 복사한다. 기준 커밋 자체에는 이 실험 폴더가 없으므로 소스 복사가 필요하다. 모델·`node_modules`·생성 HTML을 복사할 필요는 없다. 기존 v5.0 작업 디렉터리의 소스를 되돌리거나 실험용 패치를 덮어쓰지 않는다.

Python 3.11 이상(`hashlib.file_digest` 사용)과 Node.js가 필요하다. 실제 시험 환경의 Node 버전은 실행 기록과 함께 남긴다. **아래 빌드 명령의 저장소 루트는 위에서 준비한 v4.0 기준 체크아웃**을 뜻한다. 정답 채점과 저장된 PDF 검증 도구는 기록 파일을 읽으므로 앱을 과거 버전으로 빌드하지 않아도 사용할 수 있다.

```powershell
npm ci --prefix experiments/paddleocr-vl15
npm ci --prefix experiments/paddleocr-vl15/bundle-tools
python experiments/paddleocr-vl15/prepare-community.py
node experiments/paddleocr-vl15/build-pdf-studio-experiment.mjs --check
node experiments/paddleocr-vl15/build-dev.mjs
python -m http.server 8765 --bind 127.0.0.1
```

`prepare-community.py`는 공개 모델을 지정 revision으로 내려받아 크기와 LFS SHA256을 확인한다. 모델은 Git에서 제외된 `models/paddle-vl15-community/`에 저장하며 출처 스냅샷은 `community-model-source.json`이다. 모델과 npm 패키지를 처음 준비할 때는 인터넷 연결이 필요하다. 이미 같은 포트에 저장소 루트 서버가 있으면 새 서버를 띄울 필요가 없다.

브라우저에서 다음 주소를 연다.

- PDF Studio 실험 UI: `http://127.0.0.1:8765/experiments/paddleocr-vl15/pdf-studio-paddle-dev.html`
- 엔진 비교 화면: `http://127.0.0.1:8765/experiments/paddleocr-vl15/index.html`

PDF Studio에서 합성 PNG를 불러오고 Pro → 텍스트 인식 → 먼저 한 페이지 인식을 실행한다. 글자와 줄 위치를 검토한 다음 PDF 포함을 선택하고 결과를 만든다. PDF에 포함하기 전까지 새 검색 텍스트는 확정되지 않는다. 보정·회전·주석 등이 바뀌면 이전 좌표 결과를 그대로 재사용하지 않는다.

엔진 비교 화면에서는 **ONNX Community 변환본**을 선택하고 환경 확인 → 엔진 불러오기 → 문서·이미지 상한 선택 → 인식을 실행한다. 아래 OCR 속도표는 이미지 상한 1,003,520픽셀에서 측정했다. 결과 JSON은 화면의 `#result`에 표시된다. 고정 크기 제약을 조사한 `lbm364dl` 변환본과 `prepare-model.py`/`fetch-vision.py`도 이력 재현용으로 보존했지만 기본 시험·단일 파일 빌드에 필요하지 않다.

`node experiments/paddleocr-vl15/build-dev.mjs --qa`는 실제 엔진 호출과 PDF 저장 내용을 화면에 보여 주는 개발 관찰 패널을 추가한다. 이 패널은 시험용 합성 문서에만 사용하고, 배포용 단일 파일에는 넣지 않는다.

## 단일 HTML 생성과 정적 검증

위 npm·모델 준비가 끝난 뒤 실행한다.

```powershell
node experiments/paddleocr-vl15/bundle-tools/standalone-contract.test.mjs
node experiments/paddleocr-vl15/build-pdf-studio-standalone.mjs --check
node experiments/paddleocr-vl15/build-pdf-studio-standalone.mjs
node experiments/paddleocr-vl15/bundle-tools/verify-package.mjs experiments/paddleocr-vl15/pdf-studio-paddle-standalone-experiment.html
```

PDF Studio 실험판은 `pdf-studio-paddle-standalone-experiment.html`로 출력한다. `.build.json`은 빌드 조건, `.verification.json`은 HTML 및 내장 자산의 검증 결과다. 패키저는 큰 단일 문자열 대신 스트리밍으로 모델을 내장한다. 번들러·검증기는 Node에서 실행하지만 생성 파일 안의 추론은 브라우저에서 실행한다.

엔진 비교 화면만 단일 파일로 만들려면 `node experiments/paddleocr-vl15/build-standalone.mjs`를 실행한다. `paddle-vl15-standalone-experiment.html`이 생성된다. 이것은 PDF Studio 전체 UI를 포함한 파일과 별개다.

Git에는 모델 가중치, `node_modules`, 생성 HTML을 넣지 않는다. 이번 합성 문서 시험의 작은 검증 기록은 `evaluation/`에 보존한다. 두 개의 `package-lock.json`은 재현을 위해 추적한다. 원본 모델·런타임의 고지는 `bundle-tools/licenses/`에 있고, 배포 파일에는 관련 모델 카드와 패키지 라이선스도 함께 포함된다.

## 동일 이미지 비교 결과

1400×1800의 합성 PNG 3개만 시험했다. 아래 시간은 모델 다운로드·초기 준비를 제외한 페이지 인식 시간이며, CER는 **Unicode NFC 정규화 후 공백을 제외한 문자 오류율**이다. 낮을수록 좋다. Paddle은 동일 원본을 위 1MP 상한으로 축소하고, Tesseract는 원본 해상도를 사용했다. 따라서 입력 파일은 같지만 내부 해상도와 처리 방법까지 같지는 않다.

| 합성 문서 | Paddle 시간 | Paddle CER | 기존 Tesseract 시간 | 기존 Tesseract CER |
|---|---:|---:|---:|---:|
| 한글·영문 혼합 본문 | 34.46초 | 0.37% | 2.17초 | 2.97% |
| 금액·날짜 영수증 | 25.91초 | 0.00% | 1.68초 | 15.61% |
| 두 열과 짧은 표 | 30.26초 | 22.18% | 2.09초 | 46.30% |

이 표의 Paddle `ocr` 작업은 텍스트 비교용이다. 검색용 PDF에는 별도의 `spotting` 작업이 필요하다. 본문 한 페이지의 Spotting은 **38.98초**, 13줄 모두 대응, 평균 위치 IoU **0.693**이었다. 정답은 합성 이미지 생성 시 Pillow가 반환한 글줄 경계다. 예측 높이는 정답보다 평균 약 1.44배 넓어서 위치 IoU가 낮아질 수 있으며, 글자 선택 영역과 실제 PDF 결과는 별도로 확인해야 한다.

깨끗한 합성 문서 3장에 대한 단일 환경 결과다. 손글씨·기울어진 스캔·저해상도·복잡한 실제 표·다른 GPU·모바일을 대표하지 않으며, 반복 측정의 평균이나 운영 품질 보장이 아니다. 당시 표와 두 열의 오류가 여전히 크고 인식 시간이 길었다. 이 실험 단계에서는 운영 엔진을 Tesseract로 유지했으며, 이후 v5.0 웹 통합과 그 운영 조건은 루트 README에서 별도로 관리한다.

## 정답 자료와 재검증

정답·숫자 필드·읽기 순서·채점 규칙은 [FIXTURES.md](FIXTURES.md)와 `fixtures/truth.json`에 있다. 포함된 PNG가 비교 기준이므로 다른 OS에서 이미지를 다시 만들 필요는 없다. 재생성은 Pillow와 Windows 맑은 고딕 글꼴이 필요하며, 글꼴이나 Pillow 버전이 달라지면 이미지 해시도 달라질 수 있다.

```powershell
node experiments/paddleocr-vl15/create-baseline.cjs
python experiments/paddleocr-vl15/score_predictions.py --self-test
python experiments/paddleocr-vl15/score_predictions.py results.json --output scores.json
python experiments/paddleocr-vl15/validate-spotting.py community-browser-results.json
```

Tesseract 기준선은 생성된 `tesseract-baseline.html`을 같은 localhost 경로로 열어 실제 인식을 시작한다. 기준 커밋의 `PDFOCR.session('kor', ..., 'auto')`를 그대로 호출하고 결과·신뢰도·실제 단어 좌표·시간을 `#baselineReport`에 기록한다. 이 환경에서 `kor`는 한글과 영어 데이터를 함께 쓰며 자동 모드는 PSM3/PSM6 중 앱 기준에 맞는 결과를 고른다.

채점기는 결과 레코드 배열 또는 `{ "results": [...] }`를 읽는다. Spotting 검증기는 엔진 비교 화면에서 저장한 `{ "runs": [...] }`를 읽고, 마지막으로 완료된 Spotting 결과를 정답 좌표와 비교한다. 실제 인식 결과 없이 가짜 성공 결과를 만들지는 않는다.

전처리 검증은 선택 사항이다. Pillow와 NumPy를 준비한 개발 환경에서 `python experiments/paddleocr-vl15/validate-preprocess.py`를 실행하면 독립 Python 참조값과 JavaScript의 resize·패치 순서·좌표 파서를 비교한다. 이는 전처리 정적 검증이며 실제 GPU 추론 성공 검증과 구분한다.

당시 실행 중 사용한 `work/paddle-vl15-browser/`에서 허용 목록만 복사했다. 설명 경로와 검증기의 CLI 입력을 이식성 있게 정리하고, 비교 화면은 실제 성공한 Community 변환본·1MP를 기본으로 설정했다. PDF Studio 실험용 저장기는 내장 글꼴의 문자별 비례 폭을 반영한다. 글줄 좌표에서 원본의 정확한 문자 위치를 복원하는 기능은 아니며, 부분 선택 오차를 UI에서 안내한다. 이 문단의 운영 앱 미변경 범위는 v4.0 기준 실험 당시를 가리킨다.

실제 측정과 남은 제한은 [EVALUATION.md](EVALUATION.md)를 확인한다.

### 저장 PDF 독립 검증

`validate-paddle-pdf.py`는 실제 UI가 저장한 PDF의 텍스트·이미지·Poppler 렌더와 부분 선택 좌표를 확인한다. pypdf, pdfplumber, Pillow, NumPy와 Poppler가 필요하다. PDF를 편집하지 않고 JSON·검사용 PNG만 출력한다.

```powershell
python experiments/paddleocr-vl15/validate-paddle-pdf.py --result experiments/paddleocr-vl15/evaluation/pdf-studio-paddle-result-proportional.pdf --original experiments/paddleocr-vl15/evaluation/pdf-studio-paddle-unaccepted.pdf --flow experiments/paddleocr-vl15/evaluation/pdf-studio-browser-flow-proportional.json --before experiments/paddleocr-vl15/evaluation/pdf-studio-paddle-pdf-validation.json --output experiments/paddleocr-vl15/results/pdf-validation.json
```

Poppler가 PATH에 없으면 `--poppler`로 `pdftoppm` 실행 파일을 지정한다. 부분 선택 위치의 합성 정답 계산에는 원래 이미지 생성에 사용한 맑은 고딕 글꼴 해시가 맞아야 한다. `--font`와 `--bold-font`로 경로를 지정할 수 있으며, 일치하는 글꼴이 없으면 해당 위치 점수는 건너뛰고 PDF 자체 검증만 수행한다.
