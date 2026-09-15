/* One geometry for screen, thumbnails and vector PDF export. Signed deltas
   preserve the direction when an endpoint crosses the other endpoint. */
(function(root){
  'use strict';
  function geometry(a,width,height){
    const start=[a.nx*width,a.ny*height],end=[(a.nx+a.nw)*width,(a.ny+a.nh)*height];
    const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);
    const scale=width/(a.pageWidth||width),stroke=Math.max(.5,a.lineWidth||2)*scale;
    const head=Math.min(length*.45,Math.max(8*scale,stroke*4.5));
    const ux=length?dx/length:1,uy=length?dy/length:0,half=head*.43;
    const base=[end[0]-ux*head,end[1]-uy*head];
    return {start,end,base,head:[end,[base[0]-uy*half,base[1]+ux*half],[base[0]+uy*half,base[1]-ux*half]],stroke,length};
  }
  function endpoint(a,end,x,y){
    if(end==='start'){const ex=a.nx+a.nw,ey=a.ny+a.nh;a.nx=x;a.ny=y;a.nw=ex-x;a.nh=ey-y;}
    else{a.nw=x-a.nx;a.nh=y-a.ny;}
  }
  function svg(a,w,h){
    const ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'g'),p=geometry(a,w,h);
    g.setAttribute('class','anno');g.dataset.uid=a.id;
    const line=`M${p.start} L${p.base}`;
    for(const hit of [true,false]){
      const path=document.createElementNS(ns,'path');path.setAttribute('d',hit?`M${p.start} L${p.end}`:line);
      path.setAttribute('fill','none');path.setAttribute('stroke',hit?'transparent':a.stroke);path.setAttribute('stroke-width',hit?Math.max(14,p.stroke):p.stroke);
      path.setAttribute('stroke-linecap','round');
      if(hit){path.setAttribute('vector-effect','non-scaling-stroke');path.style.pointerEvents='stroke';}
      else if(a.dash==='dashed')path.setAttribute('stroke-dasharray',`${p.stroke*3} ${p.stroke*2}`);
      g.append(path);
    }
    const head=document.createElementNS(ns,'path');head.setAttribute('d',`M${p.head.join(' L')} Z`);head.setAttribute('fill',a.stroke);g.append(head);
    return g;
  }
  function bake(page,a,viewport){
    const P=PDFLib,p=geometry(a,viewport.width,viewport.height),rgb=hex=>P.rgb(...hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255));
    const point=v=>viewport.convertToPdfPoint(...v),start=point(p.start),end=point(p.base),head=p.head.map(point),color=rgb(a.stroke);
    page.drawLine({start:{x:start[0],y:start[1]},end:{x:end[0],y:end[1]},thickness:p.stroke,color,opacity:1,dashArray:a.dash==='dashed'?[p.stroke*3,p.stroke*2]:undefined});
    page.pushOperators(P.pushGraphicsState(),P.setFillingColor(color),P.moveTo(...head[0]),P.lineTo(...head[1]),P.lineTo(...head[2]),P.closePath(),P.fill(),P.popGraphicsState());
  }
  root.PDFArrow={geometry,endpoint,svg,bake};
  if(typeof module!=='undefined')module.exports={geometry,endpoint};
})(globalThis);
