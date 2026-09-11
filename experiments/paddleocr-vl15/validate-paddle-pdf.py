r"""Read-only independent validation of the real PDF Studio OCR download.

Creates a JSON report and Poppler PNG previews; never edits or creates a PDF.
Requires pypdf, pdfplumber, Pillow, NumPy, and Poppler's pdftoppm.
Example (run from the repository root):
  python experiments/paddleocr-vl15/validate-paddle-pdf.py \
    --result result.pdf --original original.pdf --flow browser-flow.json \
    --output validation.json --before previous-validation.json
Use --poppler or PDFTOPPM if pdftoppm is not on PATH. Fixture fonts can be
provided with --font/--bold-font or PADDLE_FIXTURE_FONT/PADDLE_FIXTURE_BOLD_FONT.
Substring metrics are explicitly skipped if those original fonts are absent
or differ from the truth manifest. Text, line bounds, and PDF/render checks
still work without fixture fonts. This validator inspects one-page fixtures.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import shutil
import statistics
import subprocess
import unicodedata

import numpy as np
from PIL import Image,ImageFont
import pdfplumber
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT=Path(__file__).resolve().parent

def font_default(filename,env_name):
    if os.environ.get(env_name):
        return Path(os.environ[env_name])
    windows=os.environ.get('WINDIR')
    return Path(windows)/'Fonts'/filename if windows else None


def fixture_font(path,expected_hash):
    if path is None or not path.is_file():
        return {'available':False,'reason':'original fixture font is unavailable','file':str(path) if path else None}
    actual_hash=sha(path)
    if not expected_hash or actual_hash!=expected_hash:
        return {'available':False,'reason':'font hash does not match the fixture manifest','file':str(path),
                'sha256':actual_hash,'expected_sha256':expected_hash}
    return {'available':True,'file':str(path),'sha256':actual_hash}

def normalized(text):
    return ' '.join(unicodedata.normalize('NFC',text).replace('\ufeff','').replace('\u200b','').split())

def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()

def sha(path):
    return sha_bytes(path.read_bytes())

def distance(a,b):
    previous=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        current=[i]
        for j,cb in enumerate(b,1):
            current.append(min(current[-1]+1,previous[j]+1,previous[j-1]+(ca!=cb)))
        previous=current
    return previous[-1]

def area(box):
    return max(0,box[2]-box[0])*max(0,box[3]-box[1])

def overlap(a,b):
    intersection=area([max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])])
    union=area(a)+area(b)-intersection
    return intersection/union if union else 0.0

def center(box):
    return [(box[0]+box[2])/2,(box[1]+box[3])/2]

def stats(values):
    return {'mean':statistics.mean(values),'median':statistics.median(values),'min':min(values),'max':max(values)} if values else None

def image_resources(page):
    output=[]
    def walk(resources,ancestors):
        xobjects=resources.get('/XObject',{})
        if hasattr(xobjects,'get_object'):
            xobjects=xobjects.get_object()
        for name,reference in xobjects.items():
            obj=reference.get_object()
            key=(getattr(reference,'idnum',None),getattr(reference,'generation',None))
            if key in ancestors:
                continue
            if obj.get('/Subtype')=='/Image':
                output.append({'name':str(name),'width':int(obj['/Width']),'height':int(obj['/Height']),
                               'filter':str(obj.get('/Filter')),'colorspace':str(obj.get('/ColorSpace')),
                               'bits_per_component':int(obj.get('/BitsPerComponent',0)),
                               'encoded_sha256':sha_bytes(obj._data),
                               'decoded_stream_sha256':sha_bytes(obj.get_data()),
                               'encoded_bytes':len(obj._data)})
            elif obj.get('/Subtype')=='/Form' and obj.get('/Resources'):
                walk(obj['/Resources'],ancestors|{key})
    walk(page.get('/Resources',{}),set())
    return output

def pdf_details(path):
    reader=PdfReader(path)
    pages=[]
    for page in reader.pages:
        operations=ContentStream(page.get_contents(),reader).operations
        text_modes=[];text_shows=[];mode=0;stack=[]
        for args,operator in operations:
            if operator==b'q':
                stack.append(mode)
            elif operator==b'Q' and stack:
                mode=stack.pop()
            elif operator==b'Tr':
                mode=int(args[0]);text_modes.append(mode)
            elif operator in (b'Tj',b'TJ',b"'",b'"'):
                text_shows.append(mode)
        pages.append({'width_pt':float(page.mediabox.width),'height_pt':float(page.mediabox.height),
                      'mediabox':list(map(float,page.mediabox)),'cropbox':list(map(float,page.cropbox)),
                      'rotation':int(page.get('/Rotate',0)),'text':page.extract_text(),
                      'text_rendering_modes':text_modes,'text_show_operation_modes':text_shows,
                      'images':image_resources(page),
                      'content_operation_count':len(operations)})
    return {'file':str(path),'bytes':path.stat().st_size,'sha256':sha(path),'page_count':len(reader.pages),
            'encrypted':reader.is_encrypted,'pages':pages}

def render(path,prefix,poppler):
    completed=subprocess.run([str(poppler),'-f','1','-singlefile','-png','-scale-to','1800',str(path),str(prefix)],
                             capture_output=True,text=True,check=True,timeout=120)
    return {'png':str(prefix.with_suffix('.png')),'stderr':completed.stderr.strip()}

def image_signature(images):
    # PDF object references and resource names can change when reserializing.
    return sorted((v['width'],v['height'],v['filter'],v['colorspace'],v['bits_per_component'],v['encoded_sha256'],v['decoded_stream_sha256']) for v in images)

def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--result','--pdf',dest='pdf',type=Path,required=True,help='Actual PDF Studio result PDF')
    parser.add_argument('--original',type=Path,required=True,help='Same document/options before OCR acceptance')
    parser.add_argument('--flow','--ocr-flow',dest='ocr_flow',type=Path,required=True,help='Actual app flow JSON with runs/events')
    parser.add_argument('--output',type=Path,required=True,help='Report JSON; render PNG names derive from this path')
    parser.add_argument('--before',type=Path,help='Prior validation JSON for substring error comparison')
    parser.add_argument('--truth',type=Path,default=ROOT/'fixtures/truth.json')
    parser.add_argument('--document',default='01-mixed-paragraph',help='Document id in the truth manifest')
    parser.add_argument('--poppler',default=os.environ.get('PDFTOPPM') or shutil.which('pdftoppm'),help='Path to pdftoppm executable; defaults to PDFTOPPM or PATH')
    parser.add_argument('--font',type=Path,default=font_default('malgun.ttf','PADDLE_FIXTURE_FONT'))
    parser.add_argument('--bold-font',type=Path,default=font_default('malgunbd.ttf','PADDLE_FIXTURE_BOLD_FONT'))
    args=parser.parse_args()
    for path in [args.pdf,args.original,args.ocr_flow,args.truth]+([args.before] if args.before else []):
        if not path.is_file():
            parser.error('Input file does not exist: '+str(path))
    if not args.poppler:
        parser.error('pdftoppm not found. Set --poppler, PDFTOPPM, or add Poppler to PATH.')
    inputs=[args.pdf,args.original,args.ocr_flow,args.truth]+([args.before] if args.before else [])
    if args.output.resolve() in [path.resolve() for path in inputs]:
        parser.error('--output must differ from every input path, including --before.')
    manifest=json.loads(args.truth.read_text(encoding='utf8'))
    truth=next((doc for doc in manifest['documents'] if doc['id']==args.document),None)
    if truth is None:
        parser.error('Document is not in the truth manifest: '+args.document)
    fixture=args.truth.parent/truth['image']
    if sha(fixture)!=truth['sha256']:
        parser.error('Fixture image hash does not match the truth manifest.')
    fonts={False:fixture_font(args.font,manifest['generator'].get('font_sha256')),
           True:fixture_font(args.bold_font,manifest['generator'].get('bold_font_sha256'))}
    flow=json.loads(args.ocr_flow.read_text(encoding='utf8'))
    # Match against the actual PDF Studio session that created this PDF, rather
    # than a prior standalone engine experiment on the same fixture.
    ocr=next((r for r in reversed(flow['runs']) if r.get('source')=='paddle-vl15' and r.get('words')),None)
    if ocr is None:
        parser.error('No completed Paddle Spotting result was found in the app flow.')
    result=pdf_details(args.pdf)
    original=pdf_details(args.original)
    if result['page_count']!=1 or original['page_count']!=1:
        parser.error('This fixture validator requires exactly one result and one original page.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    result['render']=render(args.pdf,args.output.with_name(args.output.stem+'-result-render'),args.poppler)
    with pdfplumber.open(args.pdf) as pdf:
        plumber_pages=[];plumber_line_chars=[]
        for page in pdf.pages:
            lines=page.extract_text_lines(layout=False,strip=True,return_chars=True)
            plumber_line_chars.append(lines)
            char_outside=[i for i,c in enumerate(page.chars) if c['x0']<-.5 or c['top']<-.5 or c['x1']>page.width+.5 or c['bottom']>page.height+.5]
            plumber_pages.append({'width_pt':page.width,'height_pt':page.height,'text':page.extract_text() or '',
                                  'character_count':len(page.chars),'out_of_page_character_indices':char_outside,
                                  'lines':[{'text':line['text'],'box_pt':[line['x0'],line['top'],line['x1'],line['bottom']],
                                            'characters':len(line['chars'])} for line in lines],
                                  'images':[{'box_pt':[img['x0'],img['top'],img['x1'],img['bottom']],
                                             'source_size':img['srcsize']} for img in page.images]})
    expected=normalized(truth['expected_text']);recognized=normalized(ocr['text'])
    extractors={}
    for name,text in [('pypdf','\n'.join(p['text'] for p in result['pages'])),
                      ('pdfplumber','\n'.join(p['text'] for p in plumber_pages))]:
        actual=normalized(text)
        extractors[name]={'text':text,'normalized_length':len(actual),'matches_saved_ocr_text':actual==recognized,
                          'character_edits_vs_saved_ocr':distance(recognized,actual),
                          'character_edits_vs_truth':distance(expected,actual),'cer_vs_truth':distance(expected,actual)/len(expected),
                          'key_fields':[{'name':field['name'],'expected':field['text'],'found':field['text'] in actual} for field in truth['key_fields']]}
    page=plumber_pages[0]
    predicted=ocr['words']
    extracted_boxes=[[b[0]/page['width_pt'],b[1]/page['height_pt'],b[2]/page['width_pt'],b[3]/page['height_pt']] for b in (line['box_pt'] for line in page['lines'])]
    pairs=[];used_expected=set();used_actual=set()
    for score,ei,ai in sorted(((overlap(word['box'],box),ei,ai) for ei,word in enumerate(predicted) for ai,box in enumerate(extracted_boxes)),reverse=True):
        if score<.3 or ei in used_expected or ai in used_actual:
            continue
        used_expected.add(ei);used_actual.add(ai)
        ec,ac=center(predicted[ei]['box']),center(extracted_boxes[ai])
        dx=(ac[0]-ec[0])*page['width_pt'];dy=(ac[1]-ec[1])*page['height_pt']
        pairs.append({'ocr_line_index':ei,'pdf_line_index':ai,'ocr_text':predicted[ei]['text'],'pdf_text':page['lines'][ai]['text'],
                      'text_equal':normalized(predicted[ei]['text'])==normalized(page['lines'][ai]['text']),
                      'ocr_box_normalized':predicted[ei]['box'],'pdf_box_normalized':extracted_boxes[ai],
                      'iou':score,'center_offset_pt':[dx,dy],'center_error_pt':math.hypot(dx,dy)})
    pairs.sort(key=lambda p:p['ocr_line_index'])
    # A line can be correctly placed while substring search rectangles drift.
    # Compare known synthetic-font advances against real PDF character boxes.
    # This is a substring advance comparison, not a claimed exact black-ink box.
    field_selection=[]
    for field in truth['key_fields']:
        target=field['text']
        cell=next(c for block in truth['blocks'] for line in block['lines'] for c in line['cells'] if target in c['text'])
        font_info=fonts[cell['bold']]
        if not font_info['available']:
            field_selection.append({'field':field['name'],'text':target,'measured':False,'reason':font_info['reason']})
            continue
        font=ImageFont.truetype(font_info['file'],cell['font_size_px'])
        at=cell['text'].index(target)
        expected_x=[cell['bbox_xyxy_px'][0]+font.getlength(cell['text'][:at]),
                    cell['bbox_xyxy_px'][0]+font.getlength(cell['text'][:at+len(target)])]
        matching=[line for line in plumber_line_chars[0] if target in ''.join(c['text'] for c in line['chars'])]
        if len(matching)!=1:
            field_selection.append({'field':field['name'],'text':target,'measured':False,'reason':'not a unique PDF substring'})
            continue
        chars=matching[0]['chars']
        if any(len(c['text'])!=1 for c in chars):
            field_selection.append({'field':field['name'],'text':target,'measured':False,'reason':'multi-character glyph requires expanded index mapping'})
            continue
        raw=''.join(c['text'] for c in chars);start=raw.index(target);selected=chars[start:start+len(target)]
        actual_x=[min(c['x0'] for c in selected)/page['width_pt']*truth['width'],
                  max(c['x1'] for c in selected)/page['width_pt']*truth['width']]
        field_selection.append({'field':field['name'],'text':target,'measured':True,'reference_x_px':expected_x,
                                'pdf_selection_x_px':actual_x,'edge_error_px':[p-t for p,t in zip(actual_x,expected_x)]})
    baseline=None
    if args.original.is_file():
        original['render']=render(args.original,args.output.with_name(args.output.stem+'-original-render'),args.poppler)
        a=np.asarray(Image.open(original['render']['png']).convert('RGB'),dtype=np.int16)
        b=np.asarray(Image.open(result['render']['png']).convert('RGB'),dtype=np.int16)
        same_shape=a.shape==b.shape
        difference=np.abs(a-b) if same_shape else None
        baseline={'original':original,'same_page_count':original['page_count']==result['page_count'],
                  'same_page_geometry':[(p['mediabox'],p['cropbox'],p['rotation']) for p in original['pages']]==[(p['mediabox'],p['cropbox'],p['rotation']) for p in result['pages']],
                  'same_image_resources':len(original['pages'])==len(result['pages']) and all(image_signature(p['images'])==image_signature(q['images']) for p,q in zip(original['pages'],result['pages'])),
                  'render_same_dimensions':same_shape,'render_exact_pixel_match':bool(same_shape and not difference.any()),
                  'render_different_channel_count':int(np.count_nonzero(difference)) if same_shape else None,
                  'render_max_channel_difference':int(difference.max()) if same_shape else None,
                  'render_mean_absolute_channel_difference':float(difference.mean()) if same_shape else None}
    report={'scope':'Read-only inspection of the actual PDF Studio OCR download; one synthetic page.',
            'inputs':{'truth':str(args.truth),'truth_sha256':sha(args.truth),'document':truth['id'],
                      'fixture':str(fixture),'fixture_sha256':sha(fixture),'poppler':str(args.poppler)},
            'actual_app_flow':{'file':str(args.ocr_flow),'sha256':sha(args.ocr_flow),'model':ocr['model'],
                               'elapsed_ms':ocr['elapsedMs'],'generated_tokens':ocr['generatedTokens'],
                               'preprocess':ocr['preprocess'],'events':flow['events']},
            'result':result,'pdfplumber':plumber_pages,'text_checks':extractors,
            'all_page1_text_show_operations_invisible':bool(result['pages'][0]['text_show_operation_modes']) and all(v==3 for v in result['pages'][0]['text_show_operation_modes']),
            'coordinate_checks':{'reference':'Saved Spotting line boxes; PDF text bounds reflect font metrics, not detected ink.',
                                 'expected_lines':len(predicted),'extracted_lines':len(page['lines']),'matched_lines':len(pairs),
                                 'unmatched_ocr_lines':sorted(set(range(len(predicted)))-used_expected),
                                 'unmatched_pdf_lines':sorted(set(range(len(page['lines'])))-used_actual),
                                 'iou':stats([p['iou'] for p in pairs]),'center_error_pt':stats([p['center_error_pt'] for p in pairs]),
                                 'per_line':pairs},
            'field_selection_alignment':{'reference':f'Known fixture font getlength(prefix) advances. PDF coordinates mapped to original {truth["width"]}px width. Glyph side bearings are not measured.',
                                          'fonts':{'regular':fonts[False],'bold':fonts[True]},
                                          'finding':'Measured substring edge offsets; whole-line alignment alone does not certify individual search-highlight accuracy.',
                                          'absolute_edge_error_px':stats([abs(error) for field in field_selection if field['measured'] for error in field['edge_error_px']]),
                                          'fields':field_selection},
            'baseline_comparison':baseline,
            'limitations':['The source fixture was selected by the recorded test procedure; the app flow did not include its file hash.',
                           'Full visual preservation can only be established against the pre-OCR PDF, not the source PNG alone.',
                           'Per-line bounds do not certify per-character search-highlight alignment, especially mixed-width Korean/English.',
                           'This is one synthetic page, not a representative multilingual or production PDF benchmark.']}
    if args.before:
        before=json.loads(args.before.read_text(encoding='utf8'))
        old_fields={f['field']:f for f in before['field_selection_alignment']['fields'] if f['measured']}
        comparisons=[]
        for current in field_selection:
            old=old_fields.get(current['field'])
            if not old or not current['measured'] or old['text']!=current['text']:
                continue
            if any(abs(a-b)>1e-6 for a,b in zip(old['reference_x_px'],current['reference_x_px'])):
                continue
            comparisons.append({'field':current['field'],'text':current['text'],
                                'before_edge_error_px':old['edge_error_px'],'after_edge_error_px':current['edge_error_px'],
                                'absolute_error_reduction_px':[abs(b)-abs(a) for b,a in zip(old['edge_error_px'],current['edge_error_px'])]})
        before_abs=[abs(value) for entry in comparisons for value in entry['before_edge_error_px']]
        after_abs=[abs(value) for entry in comparisons for value in entry['after_edge_error_px']]
        before_mean=statistics.mean(before_abs) if before_abs else None
        after_mean=statistics.mean(after_abs) if after_abs else None
        report['before_after_selection_comparison']={
            'before_report':str(args.before),'before_report_sha256':sha(args.before),
            'note':'Observed end-to-end PDFs from separate recognition runs. Box movement may contribute; this does not isolate the writer.',
            'matched_fields':len(comparisons),'fields':comparisons,
            'before_absolute_edge_error_px':stats(before_abs),'after_absolute_edge_error_px':stats(after_abs),
            'mean_absolute_error_reduction_percent':100*(1-after_mean/before_mean) if before_mean else None,
            'before_ocr_pdf_sha256':before['result']['sha256'],'after_ocr_pdf_sha256':result['sha256']}
    output=args.output
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'report':str(output),'pages':result['page_count'],'invisible_text':report['all_page1_text_show_operations_invisible'],
                      'text_checks':extractors,'coordinate_checks':{k:v for k,v in report['coordinate_checks'].items() if k!='per_line'},
                      'baseline_summary':{k:v for k,v in baseline.items() if k!='original'} if baseline else None,
                      'field_selection_alignment':report['field_selection_alignment'],
                      'before_after_selection_comparison':report.get('before_after_selection_comparison'),
                      'render':result['render']},ensure_ascii=True,indent=2))

if __name__=='__main__':
    main()
