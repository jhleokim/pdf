"""Deterministic, synthetic OCR images; reuse the repository's Pillow/font method.

No app sources, network calls, new packages, or private documents are used.
Run with the existing Python environment: python experiments/paddleocr-vl15/generate_fixtures.py
"""
from pathlib import Path
import hashlib
import json
import platform

from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "fixtures"
FONT = Path("C:/Windows/Fonts/malgun.ttf")
BOLD = Path("C:/Windows/Fonts/malgunbd.ttf")
WIDTH, HEIGHT = 1400, 1800
INK = "#202124"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Document:
    def __init__(self, name, description, order):
        self.name, self.description, self.order = name, description, order
        self.image = Image.new("RGB", (WIDTH, HEIGHT), "white")
        self.draw = ImageDraw.Draw(self.image)
        self.blocks, self.fields = [], []

    def text(self, x, y, text, size=42, bold=False):
        font = ImageFont.truetype(str(BOLD if bold else FONT), size)
        bbox = tuple(self.draw.textbbox((x, y), text, font=font, anchor="lt"))
        assert bbox[0] >= 0 and bbox[1] >= 0 and bbox[2] < WIDTH and bbox[3] < HEIGHT, (text, bbox)
        self.draw.text((x, y), text, font=font, anchor="lt", fill=INK)
        return {"text": text, "bbox_xyxy_px": list(bbox), "font_size_px": size, "bold": bold}

    def block(self, block_id, kind, lines):
        # Callers append blocks in the explicit intended reading order.
        all_boxes = [cell["bbox_xyxy_px"] for line in lines for cell in line["cells"]]
        box = [min(b[0] for b in all_boxes), min(b[1] for b in all_boxes),
               max(b[2] for b in all_boxes), max(b[3] for b in all_boxes)]
        self.blocks.append({"id": block_id, "type": kind, "reading_order": len(self.blocks),
                            "bbox_xyxy_px": box, "lines": lines})

    def line(self, x, y, text, size=42, bold=False):
        return {"text": text, "cells": [self.text(x, y, text, size, bold)]}

    def row(self, y, cells, size=38, bold=False):
        painted = [self.text(x, y, text, size, bold) for x, text in cells]
        return {"text": "\t".join(c["text"] for c in painted), "cells": painted}

    def key(self, name, text, kind="exact"):
        self.fields.append({"name": name, "text": text, "kind": kind})

    def save(self):
        path = OUT / (self.name + ".png")
        self.image.save(path, optimize=True)
        lines = [line["text"] for block in self.blocks for line in block["lines"]]
        # Ground-truth contains only the text that was actually painted.
        return {"id": self.name, "description": self.description, "image": path.name,
                "sha256": sha(path), "bytes": path.stat().st_size,
                "width": WIDTH, "height": HEIGHT, "mode": "RGB", "format": "PNG",
                "reading_order_rule": self.order, "expected_text": "\n".join(lines),
                "expected_lines": lines, "blocks": self.blocks, "key_fields": self.fields}


def paragraph():
    d = Document("01-mixed-paragraph", "짧은 한글·영문 혼합 본문과 숫자/기호",
                 "제목부터 본문, 바닥 문구까지 위에서 아래로 읽는다.")
    d.block("heading", "heading", [d.line(90, 100, "PDF Studio 문서 인식 시험", 52, True),
                                     d.line(90, 185, "가상 문서 · Synthetic document", 34)])
    texts = ["한글과 English를 함께 읽습니다.",
             "자동 인식 결과의 숫자를 비교합니다.",
             "공백, 쉼표, 괄호와 기호를 그대로 확인합니다.",
             "문서번호: TEST-2026-0911-A",
             "작성일: 2026-09-11 / 검토 시간: 09:05",
             "계약 금액은 123,450원입니다.",
             "비율은 12.5%이며 수량은 007개입니다.",
             "대문자 O와 숫자 0, 소문자 l과 숫자 1.",
             "Project status: Ready for review.",
             "Contact: demo@example.test"]
    d.block("body", "paragraph", [d.line(90, 340 + i * 104, text) for i, text in enumerate(texts)])
    d.block("footer", "footer", [d.line(90, 1620, "TEST ONLY · 실제 업무 문서가 아닙니다.", 34)])
    for name, text, kind in [("document_id", "TEST-2026-0911-A", "identifier"),
                             ("date", "2026-09-11", "date"), ("time", "09:05", "time"),
                             ("amount", "123,450원", "money"), ("percentage", "12.5%", "number"),
                             ("leading_zero", "007개", "number")]:
        d.key(name, text, kind)
    return d.save()


def receipt():
    d = Document("02-expense-receipt", "가상 경비 영수증의 금액·날짜·승인번호",
                 "제목/거래 정보 순서 후 항목표를 각 행 왼쪽→오른쪽, 위→아래로 읽고 바닥 문구를 읽는다.")
    d.block("heading", "heading", [d.line(90, 95, "경비 사용 영수증", 56, True),
                                     d.line(90, 185, "SYNTHETIC RECEIPT", 36)])
    meta = ["가상 상호: 한빛 테스트 주차장", "거래일시: 2026-09-11 14:35", "승인번호: 00010203",
            "결제수단: 법인카드 (가상)"]
    d.block("transaction", "paragraph", [d.line(90, 320 + i * 88, text) for i, text in enumerate(meta)])
    d.draw.line((90, 700, 1300, 700), fill="#5f6368", width=2)
    rows = [("항목", "금액"), ("통행료", "12,300원"), ("주차료", "4,500원"),
            ("합계", "16,800원"), ("공급가액", "15,273원"), ("부가세", "1,527원")]
    lines = [d.row(740 + i * 110, [(100, name), (920, value)], 42, i in (0, 3))
             for i, (name, value) in enumerate(rows)]
    d.block("amounts", "table", lines)
    d.draw.line((90, 1410, 1300, 1410), fill="#5f6368", width=2)
    d.block("footer", "footer", [d.line(90, 1480, "처리 상태: 정산 검토 중 / Pending", 38),
                                   d.line(90, 1620, "TEST ONLY · 실제 결제 내역이 아닙니다.", 34)])
    for name, text, kind in [("date_time", "2026-09-11 14:35", "datetime"),
                             ("approval", "00010203", "identifier"),
                             ("toll", "12,300원", "money"), ("parking", "4,500원", "money"),
                             ("total", "16,800원", "money"), ("supply", "15,273원", "money"),
                             ("vat", "1,527원", "money")]:
        d.key(name, text, kind)
    return d.save()


def layout():
    d = Document("03-two-columns-table", "두 열 읽기 순서와 짧은 표의 행/열 관계",
                 "제목→왼쪽 열 전체→오른쪽 열 전체→표 제목→표 머리글→각 표 행 왼쪽부터 오른쪽→바닥 문구. 두 열을 줄마다 번갈아 읽지 않는다.")
    d.block("heading", "heading", [d.line(90, 95, "출장 자료 / 확인표", 54, True),
                                     d.line(90, 180, "가상 문서 · Layout and table test", 34)])
    left = ["왼쪽 열 / 작성 안내", "1. 문서 제목을 확인합니다.", "2. 한글과 English를 읽습니다.", "3. 날짜는 2026-09-11입니다."]
    right = ["오른쪽 열 / 검토 사항", "A. 금액 12,300원을 확인합니다.", "B. 문서번호 TEST-03을 비교합니다.", "C. O와 0, I와 1을 구분합니다."]
    d.block("left-column", "column", [d.line(90, 330 + i * 92, text, 34, i == 0) for i, text in enumerate(left)])
    d.block("right-column", "column", [d.line(740, 330 + i * 92, text, 34, i == 0) for i, text in enumerate(right)])
    d.draw.line((695, 320, 695, 680), fill="#b8bdc0", width=2)
    d.block("table-heading", "heading", [d.line(90, 805, "구매 내역 / Purchase list", 42, True)])
    table = [("품목", "수량", "금액"), ("복사용지 A4", "2", "9,600원"),
             ("파일철 (Blue)", "3", "7,200원"), ("합계", "5", "16,800원")]
    x_edges = [90, 780, 970, 1310]
    for x in x_edges:
        d.draw.line((x, 905, x, 1405), fill="#969ba0", width=2)
    for y in [905, 1030, 1155, 1280, 1405]:
        d.draw.line((90, y, 1310, y), fill="#969ba0", width=2)
    d.block("purchase-table", "table", [d.row(945 + i * 125, list(zip([115, 820, 1000], row)), 38, i in (0, 3))
                                           for i, row in enumerate(table)])
    d.block("footer", "footer", [d.line(90, 1520, "가상 표입니다. 서명이나 개인정보는 없습니다.", 34),
                                   d.line(90, 1620, "TEST ONLY · End of document", 34)])
    for name, text, kind in [("date", "2026-09-11", "date"), ("document_id", "TEST-03", "identifier"),
                             ("paper", "9,600원", "money"), ("folder", "7,200원", "money"),
                             ("total", "16,800원", "money")]:
        d.key(name, text, kind)
    result = d.save()
    result["expected_table"] = {"block_id": "purchase-table", "cells_by_row": [list(row) for row in table]}
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if not FONT.is_file() or not BOLD.is_file():
        raise SystemExit("Existing Windows Malgun fonts are required; no fallback font or download is used.")
    documents = [paragraph(), receipt(), layout()]
    manifest = {"schema_version": 1, "synthetic_only": True,
                "purpose": "Same-image Tesseract and PaddleOCR-VL-1.5 browser comparison; not a representative accuracy benchmark.",
                "provenance": "Rendering approach reused from tests/create-tools-fixtures.py: Pillow RGB image + Windows Malgun font.",
                "generator": {"file": "../generate_fixtures.py", "python": platform.python_version(),
                              "pillow": pillow_version, "font_sha256": sha(FONT), "bold_font_sha256": sha(BOLD)},
                "comparison": {"normalization": "NFC; remove BOM/zero-width-space; normalize line endings; collapse whitespace. Preserve case, punctuation, separators, decimal points, signs and leading zeroes.",
                               "metrics": ["CER with collapsed whitespace", "CER ignoring whitespace", "exact numeric/date/identifier fields", "reading-order inversions among exactly matched lines"],
                               "notes": "Use identical PNG bytes and record any runtime resize. Markdown stripping must be explicitly selected. Do not use spelling correction or number repair."},
                "documents": documents}
    (OUT / "truth.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUT), "images": [{"id": d["id"], "bytes": d["bytes"], "sha256": d["sha256"]} for d in documents]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
