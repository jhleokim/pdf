from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

p = Path(__file__).parent / 'fixtures'
p.mkdir(exist_ok=True)
f = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', 42)
im = Image.new('RGB', (1400, 1800), 'white')
d = ImageDraw.Draw(im)
lines = ['PDF STUDIO OCR TEST', '문서의 모습은 그대로 유지합니다.',
         '검색과 복사를 할 수 있는 문서입니다.', '계약 금액 123,450원',
         'This page contains searchable text.']
for i, text in enumerate(lines):
    d.text((100, 180+i*150), text, font=f, fill='#202124')
im.save(p / 'ocr-scan.png')
c = canvas.Canvas(str(p / 'ocr-scan.pdf'), pagesize=(595.28, 765.36))
c.drawImage(ImageReader(im), 0, 0, width=595.28, height=765.36)
c.showPage()
c.setPageSize((500, 700))
c.drawImage(ImageReader(im), 0, 0, width=500, height=700)
c.save()
stamp = Image.new('RGB', (650, 500), '#f4f0e8')
d = ImageDraw.Draw(stamp)
d.ellipse((170, 90, 460, 380), outline='#b21f2d', width=10)
d.text((225, 155), '견본', font=ImageFont.truetype('C:/Windows/Fonts/malgunbd.ttf', 70), fill='#b21f2d')
d.line((208, 255, 420, 255), fill='#b21f2d', width=5)
d.text((223, 275), 'SAMPLE', font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 40), fill='#bd6970')
stamp.save(p / 'sample-stamp.jpg', quality=95)
print('Synthetic scan PDF and seal image ready')
