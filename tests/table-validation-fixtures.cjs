'use strict';

// Independent known-answer fixture: no user document or OCR service is involved.
// The title spans four columns. Row 3 / column 4 is deliberately empty.
const width = 1200, height = 1500;
const xs = [100, 350, 600, 850, 1100];
const ys = [350, 480, 610, 740, 870, 1000];
const values = [
  ['합성 계약서 · 검증용', null, null, null],
  ['항목', '성명', '금액(원)', '비고'],
  ['계약금', '김하나', '1,250,000', ''],
  ['중도금', '이우리', '2,500,000', '2026-09-14'],
  ['정산', '박누리', '-50,000', '확인']
];
const expectedCells = values.flatMap((row, r) => row.flatMap((text, c) => text === null ? [] : [{
  row: r, col: c, rowSpan: 1, colSpan: r === 0 ? 4 : 1, text,
  box: [xs[c] / width, ys[r] / height, xs[r === 0 ? 4 : c + 1] / width, ys[r + 1] / height]
}]));
const lines = [
  ...ys.map(y => ({ x1: xs[0], y1: y, x2: xs[4], y2: y })),
  ...xs.map((x, i) => ({ x1: x, y1: i === 0 || i === 4 ? ys[0] : ys[1], x2: x, y2: ys[5] }))
];

function word(text, left, top, right, bottom, extra = {}) {
  return { text, box: [left / width, top / height, right / width, bottom / height], confidence: 96, separator: '\n', ...extra };
}

function words({ crossingLine = false, includeOutside = true } = {}) {
  const out = expectedCells.filter(c => c.text).map(cell => {
    const [left, top, right, bottom] = cell.box;
    const n = [...cell.text].length;
    const textWidth = Math.min((right - left) * width - 36, n * 21);
    return word(cell.text, left * width + 18, top * height + 44,
      left * width + 18 + textWidth, top * height + 82);
  });
  if (crossingLine) {
    // A PP-OCRv5 line can span several cells; no safe character-to-cell split exists.
    const start = out.findIndex(w => w.text === '중도금');
    out.splice(start, 4, word('중도금 이우리 2,500,000 2026-09-14', 118, 784, 1080, 822));
  }
  if (includeOutside) {
    out.unshift(word('TABLE STRUCTURE VALIDATION', 100, 140, 950, 195));
    out.push(word('모든 성명과 금액은 테스트용 가상 데이터입니다.', 100, 1110, 1080, 1150));
  }
  return out;
}

function imageData({ borderless = false, broken = false, ink = true, scale = 1 } = {}) {
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  function rect(left, top, right, bottom, gray = 25) {
    for (let y = Math.max(0, Math.floor(top * scale)); y < Math.min(h, Math.ceil(bottom * scale)); y++) {
      for (let x = Math.max(0, Math.floor(left * scale)); x < Math.min(w, Math.ceil(right * scale)); x++) {
        const p = (y * w + x) * 4; data[p] = data[p + 1] = data[p + 2] = gray;
      }
    }
  }
  if (!borderless) for (const line of lines) {
    rect(line.x1 - 1, line.y1 - 1, line.x2 + 2, line.y2 + 2);
    if (broken && line.y1 === line.y2) rect(702, line.y1 - 2, 707, line.y2 + 3, 255);
  }
  if (ink) for (const w of words()) {
    const [l, t, r, b] = w.box.map((v, i) => v * (i % 2 ? height : width));
    // Disconnected short glyph strokes avoid accidentally creating table rules.
    for (let x = l; x < r - 10; x += 21) {
      rect(x, t, x + 13, t + 4); rect(x, t, x + 3, b); rect(x, b - 4, x + 13, b);
    }
  }
  return { data, width: w, height: h };
}

function record(options = {}) {
  const result = words(options);
  return { source: 'paddle-v5', granularity: 'line', page: 1, width, height,
    words: result, text: result.map(w => w.text + w.separator).join('') };
}

module.exports = { width, height, xs, ys, values, lines, expectedCells, word, words, imageData, record };

if (require.main === module) {
  // Optional visual fixture generation uses the Windows font renderer. The core
  // fixture above remains portable and dependency-free for Node unit tests.
  const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
  if (process.platform !== 'win32') throw new Error('PNG generation requires Windows System.Drawing. Geometry fixtures run on every platform.');
  const output = path.join(__dirname, 'fixtures', 'table-contract.png');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const spec = Buffer.from(JSON.stringify({ width, height, lines, words: words() })).toString('base64');
  const script = String.raw`
Add-Type -AssemblyName System.Drawing
$tableSpec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TABLE_FIXTURE_SPEC)) | ConvertFrom-Json
$tableBitmap = New-Object System.Drawing.Bitmap($tableSpec.width,$tableSpec.height)
$tableGraphics = [System.Drawing.Graphics]::FromImage($tableBitmap)
$tableGraphics.Clear([System.Drawing.Color]::White)
$tableGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$tablePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(35,35,35),3)
$tableFont = New-Object System.Drawing.Font('Malgun Gothic',28,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
foreach ($tableLine in $tableSpec.lines) {
  $tableGraphics.DrawLine($tablePen,[single]$tableLine.x1,[single]$tableLine.y1,[single]$tableLine.x2,[single]$tableLine.y2)
}
foreach ($tableWord in $tableSpec.words) {
  $tableX = [single]($tableWord.box[0] * $tableSpec.width)
  $tableY = [single]($tableWord.box[1] * $tableSpec.height)
  $tableGraphics.DrawString($tableWord.text,$tableFont,[System.Drawing.Brushes]::Black,$tableX,$tableY)
}
$tableBitmap.Save($env:TABLE_FIXTURE_OUTPUT,[System.Drawing.Imaging.ImageFormat]::Png)
$tableFont.Dispose()
$tablePen.Dispose()
$tableGraphics.Dispose()
$tableBitmap.Dispose()
`;
  const generated = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, TABLE_FIXTURE_SPEC: spec, TABLE_FIXTURE_OUTPUT: output }
  });
  if (generated.status !== 0) throw new Error(generated.stderr || 'Could not generate table fixture.');
  console.log(output);
  console.log('Synthetic 4-column, 5-row contract table: merged title, empty cell, Korean text, signed amount.');
}
