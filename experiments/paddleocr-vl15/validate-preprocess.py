"""Compare JS preprocessing with independent Pillow + official NumPy tensor order.

Uses existing Python/Pillow/NumPy and Node; creates only validate-preprocess.json.
Does not load models, install packages, control browsers, or modify application code.
"""
from pathlib import Path
import base64
import json
import math
import subprocess
import numpy as np
from PIL import Image, __version__ as pillow_version

ROOT=Path(__file__).resolve().parent

def smart_resize(h,w,min_pixels,max_pixels,factor=28):
    if h<factor:
        w=round(w*factor/h);h=factor
    if w<factor:
        h=round(h*factor/w);w=factor
    if max(h,w)/min(h,w)>200:
        raise ValueError('aspect ratio')
    rh=round(h/factor)*factor;rw=round(w/factor)*factor
    if rh*rw>max_pixels:
        beta=math.sqrt(h*w/max_pixels)
        rh=math.floor(h/beta/factor)*factor;rw=math.floor(w/beta/factor)*factor
    elif rh*rw<min_pixels:
        beta=math.sqrt(min_pixels/(h*w))
        rh=math.ceil(h*beta/factor)*factor;rw=math.ceil(w*beta/factor)*factor
    return rh,rw

def compare(name,image,options):
    original=image.convert('RGBA')
    # Opaque fixtures avoid canvas premultiplication or alpha-compositing differences.
    reference=image.convert('RGB')
    if options.get('spottingUpscale') and reference.width<1500 and reference.height<1500:
        reference=reference.resize((reference.width*2,reference.height*2),Image.Resampling.LANCZOS)
    rh,rw=smart_resize(reference.height,reference.width,options['minPixels'],options['maxPixels'])
    reference=reference.resize((rw,rh),Image.Resampling.BICUBIC)
    arr=np.asarray(reference,dtype=np.float32)/np.float32(255)
    arr=(arr-np.float32(.5))/np.float32(.5)
    chw=arr.transpose(2,0,1)[None,...]
    # Official Paddle ordering, not the Qwen2 merge-block ordering.
    patches=chw.reshape(1,1,3,rh//14,14,rw//14,14)
    expected=patches.transpose(0,3,5,2,1,4,6).reshape(-1,3,14,14).astype('<f4')
    payload={'name':name,'width':original.width,'height':original.height,'options':options,
             'expectedSize':[rw,rh],'rgba':base64.b64encode(original.tobytes()).decode(),
             'reference':base64.b64encode(expected.tobytes()).decode()}
    result=subprocess.run(['node',str(ROOT/'validate-preprocess.mjs')],input=json.dumps(payload),
                          text=True,capture_output=True,check=True)
    return json.loads(result.stdout)

def main():
    original=Image.open(ROOT/'fixtures/01-mixed-paragraph.png')
    cases=[]
    for cap in (262144,1003520,1605632):
        cases.append(compare(f'fixture01-bicubic-{cap}',original,
                             {'task':'spotting','spottingUpscale':False,'minPixels':112896,'maxPixels':cap}))
    small=original.resize((700,900),Image.Resampling.BICUBIC)
    cases.append(compare('fixture01-small-lanczos-then-bicubic',small,
                         {'task':'spotting','spottingUpscale':True,'minPixels':112896,'maxPixels':1605632}))
    # Every spatial coordinate has distinctive color, so incorrect 2x2 patch
    # regrouping cannot hide behind the document's large white background.
    yy,xx=np.indices((56,84))
    colorful=np.stack(((xx*17+yy*3)%256,(yy*19+xx*5)%256,(xx*7+yy*11)%256),axis=-1).astype(np.uint8)
    cases.append(compare('color-grid-no-resize-raster-order',Image.fromarray(colorful),
                         {'task':'ocr','spottingUpscale':False,'minPixels':4704,'maxPixels':4704}))
    # Negative control: the common Qwen2 2x2 merge-block ordering is a different
    # tensor despite having exactly the same dimensions and source pixels.
    chw=colorful.transpose(2,0,1)[None,...]
    raster=chw.reshape(1,1,3,4,14,6,14).transpose(0,3,5,2,1,4,6).reshape(-1,3,14,14)
    qwen=chw.reshape(1,1,3,2,2,14,3,2,14).transpose(0,3,6,4,7,2,1,5,8).reshape(-1,3,14,14)
    wrong_order_error=np.abs(raster.astype(np.int16)-qwen.astype(np.int16))
    report={'pillow':pillow_version,'numpy':np.__version__,'reference':'Pillow RGB resize + official NumPy raster transpose',
            'interpretation':'Byte errors measure resampling. Float-only differences can arise from JS double intermediates. No-resize colored grid independently isolates patch/channel order.',
            'negative_control_qwen_merge_order':{'unequalBytePercent':float(np.mean(wrong_order_error!=0)*100),
                                                  'meanAbsoluteByteError':float(np.mean(wrong_order_error)),
                                                  'maxByteError':int(np.max(wrong_order_error))},
            'cases':cases}
    (ROOT/'validate-preprocess.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    main()
