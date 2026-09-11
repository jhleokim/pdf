"""Download a pinned, public ONNX conversion for isolated browser evaluation."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
MODEL = "lbm364dl/PaddleOCR-VL-1.5-ONNX"
REVISION = "213c67b21d0a26d4a5eb364fb20fab55cee2dbff"
DEST = ROOT / "models" / "paddle-vl15"


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "PDF-Studio-local-evaluation/1"}), timeout=120)


def main():
    with request(f"https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true") as response:
        manifest = json.load(response)
    if manifest["sha"] != REVISION:
        raise RuntimeError("Model revision mismatch")
    DEST.mkdir(parents=True, exist_ok=True)
    (ROOT / "model-source.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    files = [item for item in manifest["siblings"] if not item["rfilename"].startswith(".")]

    def download(item):
        name = item["rfilename"]
        target = DEST / name
        expected = item.get("lfs", {}).get("sha256")
        if target.exists() and target.stat().st_size == item.get("size"):
            if not expected or hashlib.file_digest(target.open("rb"), "sha256").hexdigest() == expected:
                print(f"Reused {name}", flush=True)
                return
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        digest = hashlib.sha256()
        size = 0
        print(f"Downloading {name} ({item.get('size', 0):,} bytes)", flush=True)
        with request(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}?download=true") as response, partial.open("wb") as output:
            while chunk := response.read(4 * 1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if size != item.get("size", size) or expected and digest.hexdigest() != expected:
            raise RuntimeError(f"Model integrity check failed: {name}")
        partial.replace(target)
        print(f"Verified {name} ({size:,} bytes)", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(download, files))
    print("Pinned model download and integrity checks complete.", flush=True)


if __name__ == "__main__":
    main()
