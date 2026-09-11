"""Score captured OCR text without spelling correction or silent number repair."""
from pathlib import Path
import argparse
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parent


def markdown_to_text(text):
    """Explicit, limited removal of presentation syntax, never applied silently."""
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            continue
        if re.fullmatch(r"\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?", stripped):
            continue
        line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
        line = re.sub(r"(\*\*|__)(.*?)\1", r"\2", line)
        if "|" in line:
            cells = re.split(r"(?<!\\)\|", line)
            if cells and not cells[0].strip():
                cells = cells[1:]
            if cells and not cells[-1].strip():
                cells = cells[:-1]
            line = "\t".join(cell.strip() for cell in cells)
        lines.append(line)
    return "\n".join(lines)


def normalize(text, compact=False):
    text = unicodedata.normalize("NFC", str(text)).replace("\ufeff", "").replace("\u200b", "")
    text = " ".join(text.replace("\r\n", "\n").replace("\r", "\n").split())
    return "".join(text.split()) if compact else text


def distance(reference, prediction):
    # O(min(n,m)) memory, standard unit-cost insertion/deletion/substitution CER.
    if len(reference) < len(prediction):
        reference, prediction = prediction, reference
    previous = list(range(len(prediction) + 1))
    for i, a in enumerate(reference, 1):
        current = [i]
        for j, b in enumerate(prediction, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (a != b)))
        previous = current
    return previous[-1]


def cer(reference, prediction, compact=False):
    ref, pred = normalize(reference, compact), normalize(prediction, compact)
    errors = distance(ref, pred)
    return {"reference_characters": len(ref), "prediction_characters": len(pred),
            "edit_distance": errors, "cer": errors / max(1, len(ref)),
            "accuracy_clamped": max(0, 1 - errors / max(1, len(ref)))}


def exact_field(text, expected):
    # Keep whitespace at field boundaries so adjacent table cells (quantity 2,
    # amount 9,600원) do not become one fictitious number 29,600원.
    needle, haystack = normalize(expected, True), normalize(text)
    prefix = r"(?<![A-Za-z0-9])" if needle[:1].isascii() and needle[:1].isalnum() else ""
    suffix = r"(?![A-Za-z0-9])" if needle[-1:].isascii() and needle[-1:].isalnum() else ""
    pattern = r"\s*".join(re.escape(character) for character in needle)
    return bool(re.search(prefix + pattern + suffix, haystack))


def reading_order(expected_lines, text):
    haystack = normalize(text, True)
    matched = []
    missing = []
    used = set()
    for index, line in enumerate(expected_lines):
        needle = normalize(line, True)
        positions = [m.start() for m in re.finditer(re.escape(needle), haystack)]
        at = next((pos for pos in positions if (needle, pos) not in used), -1)
        if at < 0:
            missing.append(index)
        else:
            used.add((needle, at))
            matched.append({"reference_line": index, "prediction_offset": at})
    inversions = sum(a["prediction_offset"] > b["prediction_offset"]
                     for i, a in enumerate(matched) for b in matched[i + 1:])
    pairs = len(matched) * (len(matched) - 1) // 2
    return {"reference_lines": len(expected_lines), "exactly_matched_lines": len(matched),
            "missing_or_nonexact_lines": missing, "inversions": inversions, "comparable_pairs": pairs,
            "inversion_rate": inversions / pairs if pairs else None,
            "all_lines_exact_and_in_order": not missing and inversions == 0,
            "note": "Order is checked only among complete exactly matched lines; read alongside line coverage and CER."}


def score(document, result):
    output_format = result.get("output_format", "plain")
    if output_format not in ("plain", "markdown"):
        raise ValueError("output_format must be plain or markdown; custom parsing must be documented separately")
    raw = result["text"]
    text = markdown_to_text(raw) if output_format == "markdown" else raw
    keys = [{**field, "exact_match": exact_field(text, field["text"])} for field in document["key_fields"]]
    report = {"id": document["id"], "engine": result.get("engine", "unspecified"),
              "output_format": output_format, "image_sha256": document["sha256"],
              "cer_collapsed_whitespace": cer(document["expected_text"], text),
              "cer_without_whitespace": cer(document["expected_text"], text, True),
              "key_fields_matched": sum(field["exact_match"] for field in keys),
              "key_fields_total": len(keys), "key_fields": keys,
              "reading_order": reading_order(document["expected_lines"], text)}
    for key in ("elapsed_ms", "first_run_ms", "model_load_ms", "runtime", "resize", "notes"):
        if key in result:
            report[key] = result[key]
    if output_format == "markdown":
        report["raw_output_cer_without_whitespace"] = cer(document["expected_text"], raw, True)
    return report


def self_test(documents):
    assert distance("abc", "abc") == 0 and distance("abc", "axc") == 1
    assert distance("abcd", "abd") == 1 and distance("ab", "axb") == 1
    assert normalize("한\n 글") == "한 글"
    assert exact_field("금액 12,300원", "12,300원")
    assert not exact_field("금액 112,300원", "12,300원")
    assert not exact_field("승인번호 100010203", "00010203")
    assert exact_field("복사용지 A4\t2\t9,600원", "9,600원")
    assert markdown_to_text("# 제목\n| 항목 | 금액 |\n| --- | --- |\n| **합계** | 12,300원 |") == "제목\n항목\t금액\n합계\t12,300원"
    for document in documents:
        result = score(document, {"text": document["expected_text"], "engine": "self-test only"})
        assert result["cer_collapsed_whitespace"]["cer"] == 0
        assert result["key_fields_matched"] == result["key_fields_total"]
        assert result["reading_order"]["all_lines_exact_and_in_order"]
        reversed_lines = "\n".join(reversed(document["expected_lines"]))
        assert reading_order(document["expected_lines"], reversed_lines)["inversions"] > 0
    receipt = next(d for d in documents if d["id"] == "02-expense-receipt")
    altered = receipt["expected_text"].replace("16,800원", "16,900원")
    bad = score(receipt, {"text": altered})
    assert bad["cer_without_whitespace"]["edit_distance"] == 1
    assert not next(f for f in bad["key_fields"] if f["name"] == "total")["exact_match"]
    print("PASS: normalization, known edit distances, exact numeric boundaries, Markdown syntax, all 3 truth documents, digit corruption, and reversed reading order.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("predictions", nargs="?", type=Path)
    parser.add_argument("--truth", type=Path, default=ROOT / "fixtures" / "truth.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    truth = json.loads(args.truth.read_text(encoding="utf-8"))
    documents = truth["documents"]
    if args.self_test:
        self_test(documents)
        return
    if not args.predictions:
        parser.error("provide a predictions JSON file or --self-test")
    records = json.loads(args.predictions.read_text(encoding="utf-8"))
    if isinstance(records, dict):
        records = records["results"]
    by_id = {document["id"]: document for document in documents}
    reports = [score(by_id[result["id"]], result) for result in records]
    report = {"schema_version": 1, "synthetic_only": True, "results": reports,
              "scope": "Three clean synthetic images. No claim of real-world accuracy, engine viability, or benchmark ranking."}
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
