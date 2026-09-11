"""Fetch the pinned public vision model in validated HTTP ranges."""
import concurrent.futures
import hashlib
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parent / 'models' / 'paddle-vl15' / 'onnx'
URL = 'https://huggingface.co/lbm364dl/PaddleOCR-VL-1.5-ONNX/resolve/213c67b21d0a26d4a5eb364fb20fab55cee2dbff/onnx/vision_encoder.onnx'
SIZE = 386709887
SHA = '4d17095c00c73723e51cac636852dca784f46d76dde2bebd08daf7b85e90518e'
CHUNK = 8 * 1024 * 1024


def get_part(start):
    end = min(start + CHUNK, SIZE) - 1
    path = ROOT / f'vision.range-{start}'
    if path.exists() and path.stat().st_size == end-start+1:
        return path
    for attempt in range(3):
        try:
            req = urllib.request.Request(URL + f'?chunk={start}&attempt={attempt}', headers={'Range': f'bytes={start}-{end}'})
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{SIZE}':
                    raise RuntimeError('Incorrect HTTP byte range')
                data = response.read(end-start+2)
            if len(data) != end-start+1:
                raise RuntimeError('Incomplete chunk')
            path.write_bytes(data)
            print(f'Chunk {start//CHUNK+1}/{(SIZE+CHUNK-1)//CHUNK}', flush=True)
            return path
        except Exception as error:
            print(f'Retrying chunk {start//CHUNK+1}: {type(error).__name__}', flush=True)
            if attempt == 2:
                raise
            time.sleep(1)


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        parts = list(pool.map(get_part, range(0, SIZE, CHUNK)))
    target = ROOT / 'vision_encoder.onnx.partial-verified'
    digest = hashlib.sha256()
    with target.open('wb') as output:
        for part in parts:
            data = part.read_bytes()
            output.write(data)
            digest.update(data)
    if digest.hexdigest() != SHA:
        raise RuntimeError('Vision model integrity mismatch')
    target.replace(ROOT / 'vision_encoder.onnx')
    for part in parts:
        part.unlink()
    print('Vision model SHA256 verified.', flush=True)


if __name__ == '__main__':
    main()
