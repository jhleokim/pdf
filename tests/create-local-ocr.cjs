const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const web=process.argv.includes('--web');
const html=fs.readFileSync(path.join(root,web?'index.html':'dist/PDF-Studio-Standalone-v5.0.html'),'utf8').replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src ${web?"'self' ":''}blob: data:">`);
const code=`(async()=>{let session;const out=document.querySelector('#localOCRReport'),checks=[];try{
 const c=document.createElement('canvas');c.width=1000;c.height=300;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1000,300);g.fillStyle='#000';g.font='42px "Malgun Gothic",Arial';g.fillText('계약서 CONTRACT 1234567890',40,100);g.fillText('금액 TOTAL 150,000',40,190);
 for(const name of ['Tesseract','Paddle']){
  out.textContent='Running · '+name;const api=name==='Paddle'?await PDFPaddleLoad():PDFOCR;
  session=await api.session('kor',null,p=>{out.textContent='Running · '+name+' · '+(p.detail||p.status)},'6');
  const result=await session.recognize(c);if(!result.text.replace(/\\s/g,'').includes('1234567890')||!result.text.includes('계약서')||!result.words.length)throw Error(name+': '+result.text);
  checks.push(name+' · '+result.text);await session.close();session=null;
 }
 out.textContent='PASS · Korean/English offline OCR\\n'+checks.join('\\n');
 }catch(e){out.textContent='FAIL · '+e.stack}finally{await session?.close()}})();`;
fs.mkdirSync(path.join(__dirname,'fixtures'),{recursive:true});
fs.writeFileSync(web?path.join(root,'.deploy/__qa-local-ocr.html'):path.join(__dirname,'fixtures/local-ocr.html'),html.replace('</body>','<pre id="localOCRReport" style="position:fixed;inset:0;z-index:99999;background:white;color:black;padding:30px">Running</pre><script>'+code+'</script></body>'));
