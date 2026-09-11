"""Pinned alternate ONNX export, with authenticated-by-hash public downloads."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import time
import urllib.request

ROOT = Path(__file__).resolve().parent
MODEL = 'onnx-community/PaddleOCR-VL-1.5-ONNX'
REVISION = 'ebc8e65ff106df8088bbb3f31ce00bf2fccb24b4'
DEST = ROOT / 'models' / 'paddle-vl15-community'
CHUNK = 8 * 1024 * 1024


def main():
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{MODEL}/revision/{REVISION}?blobs=true', timeout=30) as response:
        manifest = json.load(response)
    if manifest['sha'] != REVISION:
        raise RuntimeError('Model revision mismatch')
    DEST.mkdir(parents=True, exist_ok=True)
    (ROOT / 'community-model-source.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    required = {'onnx/vision_encoder_q4.onnx', 'onnx/decoder_q4.onnx', 'onnx/embedding.onnx', 'onnx/embedding.onnx.data'}
    selected = [f for f in manifest['siblings'] if f['rfilename'] in required or '/' not in f['rfilename'] and f['rfilename'].endswith(('.json', '.jinja', '.md', '.model'))]
    for item in selected:
        name, size = item['rfilename'], item['size']
        target = DEST / name
        expected = item.get('lfs', {}).get('sha256')
        if target.exists() and target.stat().st_size == size:
            with target.open('rb') as source:
                if not expected or hashlib.file_digest(source, 'sha256').hexdigest() == expected:
                    print('Reused ' + name, flush=True)
                    continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://huggingface.co/{MODEL}/resolve/{REVISION}/{name}'
        print(f'Downloading {name}: {size:,} bytes', flush=True)
        if size < CHUNK:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read()
            if len(data) != size or expected and hashlib.sha256(data).hexdigest() != expected:
                raise RuntimeError('Integrity mismatch: ' + name)
            target.write_bytes(data)
            continue

        def part(start):
            end = min(start+CHUNK,size)-1
            path = target.with_name(target.name+f'.range-{start}')
            if path.exists() and path.stat().st_size == end-start+1:
                return path
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url+f'?chunk={start}&attempt={attempt}', headers={'Range':f'bytes={start}-{end}'})
                    with urllib.request.urlopen(req, timeout=25) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                            raise RuntimeError('Incorrect byte range')
                        data = response.read(end-start+2)
                    if len(data) != end-start+1:
                        raise RuntimeError('Incomplete range')
                    path.write_bytes(data)
                    return path
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(1)

        with ThreadPoolExecutor(max_workers=6) as pool:
            parts = list(pool.map(part,range(0,size,CHUNK)))
        partial = target.with_name(target.name+'.verified-partial')
        digest = hashlib.sha256()
        with partial.open('wb') as output:
            for p in parts:
                data = p.read_bytes()
                output.write(data)
                digest.update(data)
        if expected and digest.hexdigest() != expected:
            raise RuntimeError('SHA256 mismatch: '+name)
        partial.replace(target)
        for p in parts:
            p.unlink()
        print('Verified '+name, flush=True)
    print('Alternate export ready.', flush=True)


if __name__ == '__main__':
    main()
