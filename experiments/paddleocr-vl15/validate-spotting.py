"""Independent geometry audit of saved browser OCR; no model or browser execution.

Writes validate-spotting.json next to this file unless --output is supplied. Truth boxes are Pillow's
rendered text bounds; predicted OCR line boxes can include additional padding.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import re
import statistics
import unicodedata

ROOT=Path(__file__).resolve().parent
TRUTH=ROOT/'fixtures/truth.json'

def normalize(text):
    return ' '.join(unicodedata.normalize('NFC',text).replace('\ufeff','').replace('\u200b','').split())

def edit_distance(a,b):
    prev=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        current=[i]
        for j,cb in enumerate(b,1):
            current.append(min(current[-1]+1,prev[j]+1,prev[j-1]+(ca!=cb)))
        prev=current
    return prev[-1]

def area(box):
    return max(0,box[2]-box[0])*max(0,box[3]-box[1])

def intersection(a,b):
    return area([max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])])

def iou(a,b):
    common=intersection(a,b)
    return common/(area(a)+area(b)-common) if common else 0.0

def center(box):
    return [(box[0]+box[2])/2,(box[1]+box[3])/2]

def summary(values):
    return {'mean':statistics.mean(values),'median':statistics.median(values),'min':min(values),'max':max(values)} if values else None

def main():
    parser=argparse.ArgumentParser(description='Audit real saved Spotting output against the synthetic fixture geometry.')
    parser.add_argument('results',type=Path,help='JSON saved from the browser harness; must contain completed runs.')
    parser.add_argument('--output',type=Path,default=ROOT/'validate-spotting.json')
    args=parser.parse_args()
    source=json.loads(args.results.read_text(encoding='utf8'))
    manifest=json.loads(TRUTH.read_text(encoding='utf8'))
    candidates=[(i,r) for i,r in enumerate(source['runs']) if r.get('task')=='spotting' and r.get('status')=='complete']
    run_index,run=candidates[-1]
    document=next(d for d in manifest['documents'] if d['id']==run['id'])
    image_path=ROOT/'fixtures'/document['image']
    image_sha=hashlib.sha256(image_path.read_bytes()).hexdigest()
    assert image_sha==document['sha256']
    width,height=document['width'],document['height']
    truth=[]
    for block in document['blocks']:
        for line in block['lines']:
            cells=[c['bbox_xyxy_px'] for c in line['cells']]
            box=[min(c[0] for c in cells),min(c[1] for c in cells),max(c[2] for c in cells),max(c[3] for c in cells)]
            truth.append({'text':line['text'],'box':box,'block':block['id']})
    predicted=run['words']
    invalid=[]
    for index,word in enumerate(predicted):
        box=word['box'];poly=word['polygon']
        values=box+[v for point in poly for v in point]
        if len(box)!=4 or len(poly)!=4 or any(len(p)!=2 for p in poly) or not all(math.isfinite(v) and 0<=v<=1 for v in values) or area(box)<=0:
            invalid.append(index)
        envelope=[min(p[0] for p in poly),min(p[1] for p in poly),max(p[0] for p in poly),max(p[1] for p in poly)]
        assert max(abs(a-b) for a,b in zip(envelope,box))<1e-12

    # Recompute the actual run's raw LOC coordinates, independently of JS parser.
    matches=list(re.finditer(r'<\|LOC_(\d+)\|>',run['raw_text']))
    assert len(matches)==len(predicted)*8
    cursor=0
    for index in range(len(predicted)):
        group=matches[index*8:(index+1)*8]
        raw_text=run['raw_text'][cursor:group[0].start()].strip()
        assert raw_text==predicted[index]['text']
        values=[int(m.group(1))/1000 for m in group]
        poly=[values[i:i+2] for i in range(0,8,2)]
        assert poly==predicted[index]['polygon']
        cursor=group[-1].end()
    assert not run['raw_text'][cursor:].strip()

    pixel_boxes=[[b[0]*width,b[1]*height,b[2]*width,b[3]*height] for b in (p['box'] for p in predicted)]
    # Pair geometrically, without using OCR text equality. This avoids calling an
    # l/1 substitution a missing line and records all unmatched detections.
    all_pairs=sorted(((iou(t['box'],p),ti,pi) for ti,t in enumerate(truth) for pi,p in enumerate(pixel_boxes)),reverse=True)
    used_truth=set();used_prediction=set();pairs=[]
    for score,ti,pi in all_pairs:
        if score<0.5 or ti in used_truth or pi in used_prediction:
            continue
        used_truth.add(ti);used_prediction.add(pi)
        target=truth[ti];expected_box=target['box'];pred_box=pixel_boxes[pi]
        tc,pc=center(expected_box),center(pred_box)
        expected_text,actual_text=normalize(target['text']),normalize(predicted[pi]['text'])
        pairs.append({'truth_index':ti,'prediction_index':pi,'expected_text':expected_text,'actual_text':actual_text,
                      'exact_text_match':expected_text==actual_text,'character_edits':edit_distance(expected_text,actual_text),
                      'truth_box_px':expected_box,'predicted_box_px':pred_box,'iou':score,
                      'center_error_px':math.dist(tc,pc),'center_offset_xy_px':[pc[0]-tc[0],pc[1]-tc[1]],
                      'center_error_page_diagonal_percent':100*math.dist(tc,pc)/math.hypot(width,height),
                      'truth_box_coverage':intersection(expected_box,pred_box)/area(expected_box),
                      'predicted_height_over_truth':(pred_box[3]-pred_box[1])/(expected_box[3]-expected_box[1]),
                      'edge_delta_ltrb_px':[p-t for p,t in zip(pred_box,expected_box)]})
    pairs.sort(key=lambda p:p['truth_index'])
    order=[p['prediction_index'] for p in pairs]
    inversions=sum(order[i]>order[j] for i in range(len(order)) for j in range(i+1,len(order)))
    expected_page=normalize(document['expected_text']);actual_page=normalize(run['text'])
    distance=edit_distance(expected_page,actual_page)
    report={'source_results':str(args.results),'source_results_sha256':hashlib.sha256(args.results.read_bytes()).hexdigest(),
            'run_index':run_index,'document_id':run['id'],'image_sha256_matches_truth':True,'image_sha256':image_sha,
            'provenance_limit':'Saved run identifies the fixture by id; original browser input bytes were not hashed in that run.',
            'task':run['task'],'engine':run['engine'],'revision':run['revision'],'elapsed_ms':run['elapsed_ms'],
            'timing_scope':'Saved browser page-recognition elapsed_ms excludes previously completed engine initialization/model downloads.',
            'max_pixels':run['max_pixels'],'resized_dimensions':[run['preprocess']['resizedWidth'],run['preprocess']['resizedHeight']],
            'generated_tokens':run['generated_tokens'],'stop_reason':run['stop_reason'],
            'matching':'Descending IoU one-to-one matching; minimum IoU=0.5; no text correction or text-based pairing.',
            'coordinate_units':'Normalized xyxy projected to original fixture 1400x1800 pixels; IoU compares axis-aligned boxes.',
            'truth_box_scope':'Pillow textbbox used when drawing the synthetic line, not exact black-ink segmentation or a PDF text baseline.',
            'truth_lines':len(truth),'predicted_lines':len(predicted),'matched_lines':len(pairs),
            'missing_truth_indices':sorted(set(range(len(truth)))-used_truth),
            'unmatched_prediction_indices':sorted(set(range(len(predicted)))-used_prediction),
            'invalid_coordinate_indices':invalid,'raw_LOC_parser_agrees_with_saved_polygons':True,
            'exact_text_lines':sum(p['exact_text_match'] for p in pairs),'reading_order_inversions':inversions,
            'page_character_edits':distance,'reference_characters_after_whitespace_normalization':len(expected_page),
            'page_cer':distance/len(expected_page),'iou':summary([p['iou'] for p in pairs]),
            'center_error_px':summary([p['center_error_px'] for p in pairs]),
            'center_error_page_diagonal_percent':summary([p['center_error_page_diagonal_percent'] for p in pairs]),
            'truth_box_coverage':summary([p['truth_box_coverage'] for p in pairs]),
            'predicted_height_over_truth':summary([p['predicted_height_over_truth'] for p in pairs]),
            'per_line':pairs,
            'limitations':['One synthetic page only; not a representative OCR benchmark.',
                           'Line polygons are not per-character bounds or font metrics; searchable-PDF selection alignment needs an export test.',
                           'No performance comparison to other devices, browsers, cold starts or engines follows from this run.']}
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='per_line'},ensure_ascii=True,indent=2))

if __name__=='__main__':
    main()
