/* node tests/create-fixture.cjs
 * Uses only Node built-ins and the PDFLib already bundled in index.html.
 * Windows uses built-in System.Drawing for a real scanner-like JPEG; other hosts
 * generate a deterministic RGB/Flate raster fixture instead, without dependencies.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const dir = path.join(__dirname, 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const jpegPath = path.join(dir, 'smoke-scan.jpg');
if (process.platform === 'win32') {
  const drawing = String.raw`
Add-Type -AssemblyName System.Drawing
$fixtureBitmap = New-Object System.Drawing.Bitmap(2200,3000)
$fixtureGraphics = [System.Drawing.Graphics]::FromImage($fixtureBitmap)
$fixtureGraphics.Clear([System.Drawing.Color]::FromArgb(244,240,224))
$fixtureGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$fixtureGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$fixtureTitle = New-Object System.Drawing.Font('Arial',72,[System.Drawing.FontStyle]::Bold)
$fixtureBody = New-Object System.Drawing.Font('Arial',32)
$fixtureSmall = New-Object System.Drawing.Font('Arial',22)
$fixtureInk = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(36,45,52))
$fixtureAccent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(32,117,120))
$fixtureGraphics.FillRectangle($fixtureAccent,130,155,35,160)
$fixtureGraphics.DrawString('Document quality review',$fixtureTitle,$fixtureInk,210,155)
$fixtureGraphics.DrawString('Scanned source / RGB JPEG / existing searchable text',$fixtureBody,$fixtureInk,140,405)
$fixtureGraphics.DrawString('ABBYY OCR SEARCH 12345',$fixtureBody,$fixtureInk,140,505)
$fixtureRule = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(177,171,153),3)
$fixtureGraphics.DrawLine($fixtureRule,140,650,2040,650)
for ($fixtureRow=0; $fixtureRow -lt 18; $fixtureRow++) {
  $fixtureY = 740 + $fixtureRow * 86
  $fixtureGraphics.DrawString(('Page content line {0:00}: Preserve text, numbers and document layout. 1234567890' -f ($fixtureRow+1)),$fixtureBody,$fixtureInk,140,$fixtureY)
}
$fixtureGraphics.FillRectangle($fixtureAccent,140,2430,570,210)
$fixtureGraphics.DrawString('COLOR SAMPLE',$fixtureBody,[System.Drawing.Brushes]::White,185,2500)
$fixtureGraphics.DrawString('A warm paper background makes grayscale and white-point changes visible.',$fixtureSmall,$fixtureInk,140,2770)
$fixtureBitmap.Save($env:PDF_FIXTURE_JPEG,[System.Drawing.Imaging.ImageFormat]::Jpeg)
$fixtureRule.Dispose()
$fixtureAccent.Dispose()
$fixtureInk.Dispose()
$fixtureTitle.Dispose()
$fixtureBody.Dispose()
$fixtureSmall.Dispose()
$fixtureGraphics.Dispose()
$fixtureBitmap.Dispose()
`;
  const generated = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', drawing], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, PDF_FIXTURE_JPEG: jpegPath }
  });
  if (generated.status !== 0) throw new Error(generated.stderr || 'Could not create the local JPEG fixture.');
}
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).find(script => script.includes('.PDFLib='));
if (!source) throw new Error('Bundled PDFLib was not found.');
const library = { exports: {} };
vm.runInNewContext(source, { exports: library.exports, module: library, Array,
  Uint8Array, ArrayBuffer, Int32Array, Uint32Array, Uint16Array, Int16Array, Int8Array,
  Float32Array, Float64Array, setTimeout, clearTimeout });
const P = library.exports;

(async () => {
  const doc = await P.PDFDocument.create();
  doc.setTitle('PDF Studio Pro — offline processing and OCR preservation fixture');
  const font = await doc.embedFont(P.StandardFonts.Helvetica);
  let scan;
  if (fs.existsSync(jpegPath)) scan = await doc.embedJpg(new Uint8Array(fs.readFileSync(jpegPath)));
  else {
    const width = 2200, height = 3000;
    const raster = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const ink = x > 140 && x < 2040 && y > 700 && y < 2300 && y % 86 < 12;
      raster[i] = ink ? 40 : 244; raster[i+1] = ink ? 48 : 240; raster[i+2] = ink ? 55 : 224;
    }
    const stream = doc.context.stream(new Uint8Array(zlib.deflateSync(raster)), {
      Type: 'XObject', Subtype: 'Image', Width: width, Height: height,
      BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'FlateDecode'
    });
    const ref = doc.context.register(stream);
    scan = { ref, width, height };
  }
  const first = doc.addPage([595,842]);
  // Manual Do operators also work with the raw-raster fallback.
  first.node.set(P.PDFName.of('Resources'), doc.context.obj({ XObject: { Scan: scan.ref } }));
  const firstImage = doc.context.register(doc.context.stream('q 595 0 0 812 0 15 cm /Scan Do Q'));
  first.node.addContentStream(firstImage);
  first.drawText('ABBYY OCR SEARCH 12345', { x:38,y:690,size:12,font,opacity:0 });
  first.drawText('Existing hidden OCR should remain searchable after image optimization.', { x:38,y:665,size:10,font,opacity:0 });
  first.drawText('Hidden amount: 123,456.78 / Reference: 2026-0906', { x:38,y:640,size:10,font,opacity:0 });
  const second = doc.addPage([595,842]);
  second.drawText('Vector text remains sharp', { x:40,y:775,size:25,font,color:P.rgb(.09,.15,.18) });
  second.drawText('Search this: VECTOR SEARCH 67890', { x:40,y:735,size:14,font });
  second.drawRectangle({ x:40,y:650,width:230,height:45,color:P.rgb(.08,.46,.45) });
  second.drawText('Text / vector / shared image', { x:52,y:665,size:12,font,color:P.rgb(1,1,1) });
  second.node.setXObject(P.PDFName.of('SharedScan'), scan.ref);
  second.node.addContentStream(doc.context.register(doc.context.stream('q 260 0 0 355 40 235 cm /SharedScan Do Q')));
  // Dedicated gray Flate sample exercises a second supported decoder and shared resources.
  const gray = Uint8Array.from({length:128*128},(_,i)=>(i%128)*2);
  const grayRef = doc.context.register(doc.context.stream(new Uint8Array(zlib.deflateSync(gray)), {
    Type:'XObject', Subtype:'Image', Width:128, Height:128, BitsPerComponent:8,
    ColorSpace:'DeviceGray', Filter:'FlateDecode'
  }));
  second.node.setXObject(P.PDFName.of('GrayRamp'),grayRef);
  second.node.addContentStream(doc.context.register(doc.context.stream('q 130 0 0 130 350 400 cm /GrayRamp Do Q')));
  second.drawText('Gray ramp (Flate)', {x:350,y:380,size:10,font});
  const target = path.join(dir, 'smoke.pdf');
  fs.writeFileSync(target, await doc.save());
  console.log(target);
  console.log(`${fs.statSync(target).size} bytes, 2 pages, shared RGB scan + gray Flate + hidden OCR + vector text`);
})().catch(error => { console.error(error); process.exitCode = 1; });
