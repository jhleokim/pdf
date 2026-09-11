# PaddleOCR-VL-1.5 교체 시험 결과

2026-09-11 · PDF Studio v4.0 · 설치 없는 단일 HTML 조건

**실제 브라우저 인식과 PDF Studio 연동에 성공했다.** 운영 엔진을 교체할 만큼 가볍거나 충분히 검증된 상태는 아니다. 깨끗한 합성 본문·영수증에서는 기존 엔진보다 문자 오류가 줄었지만, 처리 시간이 약 15배 길고 단일 HTML은 약 1.24GB다. 표의 읽기 순서와 부분 선택 위치에도 한계가 있다. 현재 운영 사이트의 Tesseract와 배포 파일은 변경하지 않았다.

## 무엇을 실행했나

- [PaddleOCR-VL-1.5 공식 모델](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5)의 [ONNX Community 변환본](https://huggingface.co/onnx-community/PaddleOCR-VL-1.5-ONNX/tree/ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4)을 revision `ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4`로 고정했다.
- Q4 vision/decoder, embedding, tokenizer를 ONNX Runtime Web 1.29.0과 WebGPU로 실행했다. 공식 전체 문서 분석 파이프라인이나 PP-OCRv5로 바꾸어 시험한 것이 아니다.
- 공식 전처리·프롬프트를 참조해 실제 이미지 입력, 이미지 임베딩, 자기회귀 디코딩과 Spotting 좌표 해석을 연결했다. Python은 공개 모델 다운로드와 채점에만 사용했고 추론에는 사용하지 않았다.
- 시험 장치: Windows, RTX 2080 SUPER 8GB, i9-10900K, RAM 약 64GB. 다른 GPU·브라우저·모바일에서의 성능은 측정하지 않았다.
- 합성 문서만 사용했다. 외부 OCR API, Gemini, Tesseract의 숨은 대체 호출은 사용하지 않았다. 비교 기준선은 별도 화면에서 기존 Tesseract 7.0.0을 실제로 실행했다.

처음 조사한 `lbm364dl` 변환본은 고정 이미지 토큰 크기 때문에 일반 페이지 비율의 실제 실행에서 실패했다. 단순히 엔진 로딩 성공을 OCR 성공으로 취급하지 않고, 동적 크기가 동작하는 위 변환본으로 변경했다.

## 같은 원본 이미지 3장의 비교

1400×1800 PNG에 대한 단일 측정이다. 시간은 모델 다운로드·초기 준비를 제외한 페이지 처리 시간이다. Paddle은 내부에서 868×1120으로 축소하고 Tesseract는 원본 크기를 사용하므로, 같은 파일을 사용했지만 내부 처리 조건까지 같지는 않다.

CER는 NFC 정규화 후 **공백을 제외한 문자 오류율**이며 낮을수록 좋다. 맞춤법 수정이나 숫자 보정을 하지 않았다.

| 합성 문서 | 기존 Tesseract CER | Paddle CER | 기존 시간 | Paddle 시간 |
|---|---:|---:|---:|---:|
| 한글·영문 본문 | 2.97% | 0.37% | 2.17초 | 34.46초 |
| 날짜·금액 영수증 | 15.61% | 0.00% | 1.68초 | 25.91초 |
| 두 열 본문·짧은 표 | 46.30% | 22.18% | 2.09초 | 30.26초 |

영수증 한 장에서 오류가 없었다는 결과를 일반적인 정확도 100%로 해석하면 안 된다. 표의 CER에는 읽기 순서 차이도 포함된다. 표 안의 핵심 숫자·날짜는 Paddle이 5/5개, Tesseract가 1/5개 보존했지만, Paddle도 셀을 열 단위로 읽거나 글자를 잘못 읽었다. 본문에는 소문자 `l`을 숫자 `1`로 읽는 오류가 있었다.

원시 출력과 채점 결과: [Paddle 입력 결과](evaluation/paddle-ocr-comparison.json), [Paddle 점수](evaluation/paddle-ocr-scores.json), [Tesseract 실제 출력](evaluation/tesseract-baseline.json), [Tesseract 점수](evaluation/tesseract-scores.json). 정답은 [fixtures/truth.json](fixtures/truth.json)에 있다.

## 위치 인식과 PDF Studio 동작

검색 가능한 PDF에는 텍스트만으로 부족하므로 실제 `Spotting` 출력을 별도로 시험했다. 본문 13줄을 모두 찾아 누락·추가·읽기 순서 역전은 없었다. 평균 위치 IoU는 0.693, 원본 이미지 기준 중심 오차는 평균 3.41px였다. 예측 상자 높이는 정답보다 평균 1.44배 넓었다. 이 수치는 글줄 경계 비교이며 개별 문자 좌표의 정확도를 뜻하지 않는다.

엔진 시험 화면의 Spotting은 38.98초, PDF Studio에서 이미지 PDF를 다시 렌더링한 첫 실제 흐름은 37.90초였다. 저장 방식 수정 후 다시 인식한 흐름은 41.91초였다. 모두 344개 토큰으로 끝까지 생성했다. 반복 평균이나 일정한 처리 시간의 보장은 아니다.

실제 UI에서 다음을 확인했다.

- 진행 표시가 실제 Paddle 모델 준비·토큰 처리를 반영한다. 근거 없는 완료율이나 신뢰도 점수를 표시하지 않는다.
- 인식 도중 취소하면 세션이 정리되고, 다시 실행하면 새로운 세션으로 완료된다.
- 같은 페이지·설정의 완료 결과는 재사용한다. 이미 검색 가능한 페이지는 건너뛴다.
- 사용자가 확인하기 전에는 새 OCR 텍스트를 PDF에 넣지 않는다. 확인한 결과만 포함한다.
- 페이지를 회전한 뒤에는 기존 결과를 오래된 것으로 표시하고 재확정·내보내기를 차단한다.

증거: [실제 실행·취소·저장](evaluation/pdf-studio-browser-flow.json), [재사용·건너뛰기](evaluation/pdf-studio-reuse-skip.json), [회전 후 상태](evaluation/pdf-studio-stale-guard.json), [잘못된 좌표의 내보내기 차단](evaluation/pdf-studio-stale-export.json).

PDF 확인 전후의 원본 이미지 XObject 바이트와 페이지 크기가 동일했다. pypdf와 pdfplumber에서 13줄·330자가 추출됐고, 날짜·금액·선행 0이 있는 숫자가 보존됐다. Poppler 렌더 결과는 모든 RGB 픽셀이 동일했다. 이는 문서 외관 보존과 텍스트 추출에 대한 검증이다.

초기 연결에서는 기존 PDF 작성기의 고정 문자 폭 때문에 혼합 언어 줄 안의 단어 선택 위치가 어긋났다. 실험용 작성기를 내장 NanumGothic의 문자별 폭과 PDF CID `/W`를 사용하도록 수정했다. 수정 후에도 13줄·330자, 핵심 필드 6/6, 원본 이미지와 렌더 픽셀 동일성이 유지됐다.

알고 있는 합성 문서 글꼴의 advance를 기준으로 핵심 필드 6개 양끝 12곳을 비교했다. 원본 1400px 폭에서 평균 절대 위치 오차는 **18.46px → 8.50px**, 최대는 **46.16px → 18.32px**였다. 평균 약 54% 감소했지만 `007개`의 시작점은 오히려 2.53px에서 6.17px로 늘었다. 별도의 인식 실행으로 만든 전후 PDF 비교여서 모델 상자 위치 변화도 수치에 영향을 줄 수 있다. 모든 단어 위치가 개선됐거나 실제 문서의 글자 좌표가 정확하다는 뜻은 아니다.

OCR 결과 UI에도 줄 단위 좌표와 원본 대신 내장 글꼴의 폭을 이용한 근사라는 점을 명시했다. 원본 스캔의 글꼴 정보는 알 수 없으므로 개별 문자 위치를 정확하게 복원했다고 주장하지 않는다. [수정 전 PDF 검증](evaluation/pdf-studio-paddle-pdf-validation.json)과 [수정 후 독립 검증](evaluation/pdf-studio-paddle-pdf-validation-proportional.json), [수정 후 실제 실행 기록](evaluation/pdf-studio-browser-flow-proportional.json)을 보존했다.

## 단일 HTML과 남은 제한

모델 가중치 약 888MB, tokenizer, WebGPU 실행 파일, 기존 PDF Studio UI·폰트·라이선스를 한 HTML에 내장했다. 모델·패키지를 따로 설치하거나 OCR 서버를 띄우도록 요구하는 배포 형태가 아니다. 외부 import와 native 코드 의존성이 없는 번들을 만들었고, 내장 자산의 SHA-256·반복 세션 캐시·외부 요청 차단을 정적으로 확인했다.

최종 PDF Studio HTML은 **1,242,645,348 bytes**(약 1.24GB / 1.16GiB)다. 내장 자산 25개·60개 블록의 해시가 원본과 모두 일치했다. HTML SHA-256은 `194e3c6d3d2ccd48962c519f6da01194c1c5bc0c6ff8a90aa38b5178470585d4`다. [패키지 검사](evaluation/package-verification.json)와 [빌드 검사 범위](evaluation/package-build.json)를 별도로 기록했다.

**직접 `file://` 실행은 미검증이다.** 브라우저 도구의 보안 정책이 해당 파일 열기를 차단했으며 다른 경로로 우회하지 않았다. 실제 GPU 인식·UI 검증은 기존 localhost 개발판에서 수행했다. 따라서 단일 파일의 해시·번들 검사 성공을 직접 파일 실행 성공으로 대신하지 않는다.

남은 실사용 검증은 단일 파일의 직접 실행, 다양한 GPU·브라우저의 메모리 사용과 초기 로딩, 실제 스캔 문서의 표·읽기 순서·부분 선택 위치다. 현재 결과로는 Tesseract 기본 엔진을 즉시 대체하기보다 고성능 PC용 실험판으로 다루는 것이 적절하다.

재현 방법: [README.md](README.md).
