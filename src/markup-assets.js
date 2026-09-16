/* Offline builds embed these bytes; web builds fetch only the chosen font. */
const PDFMarkupAssets=(()=>{
 const pending=new Map();
 async function get(id){
  const embedded=document.getElementById(id);
  if(embedded)return b64bytes(embedded.textContent.trim());
  if(pending.has(id))return pending.get(id);
  const job=(async()=>{
   const asset=globalThis.PDFMarkupManifest?.[id];
   if(!asset)throw Error('글꼴 데이터가 없습니다. 최신 HTML 파일을 다시 열어 주세요.');
   const url=new URL(asset.url,location.href);
   if(url.origin!==location.origin||!/^https?:$/.test(url.protocol)||!url.pathname.startsWith('/markup/'))throw Error('글꼴 주소가 올바르지 않습니다.');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
   try{
    const response=await fetch(url.href,{signal:controller.signal,credentials:'omit',redirect:'error'});
    if(!response.ok)throw Error('글꼴을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==asset.bytes)throw Error('글꼴 파일이 손상되었습니다. 다시 시도해 주세요.');
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    if([...digest].map(b=>b.toString(16).padStart(2,'0')).join('')!==asset.sha256)throw Error('글꼴 파일 검증에 실패했습니다. 다시 시도해 주세요.');
    return bytes;
   }catch(e){if(e.name==='AbortError')throw Error('글꼴 준비 시간이 초과됐습니다. 다시 시도해 주세요.');throw e;}
   finally{clearTimeout(timer);}
  })();
  pending.set(id,job);try{return await job;}finally{pending.delete(id);}
 }
 return {get};
})();
