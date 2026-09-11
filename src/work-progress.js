/* Measured progress only: elapsed time is real; remaining time is an estimate. */
(() => {
  function createTracker(now=()=>performance.now()) {
    let start=now(),phaseStart=start,lastChange=start,value=0,updates=0,canceled=false,phase='전체 작업',rateKnown=true,deadline=null,plan=null;
    return {
      phase(name,known=true){phase=name;phaseStart=lastChange=now();value=0;updates=0;rateKnown=known;deadline=null;plan=null;},
      estimate(ms){deadline=Number.isFinite(ms)&&ms>0?now()+ms:null;},
      plan(from,to,ms){if(Number.isFinite(ms)&&ms>0)plan={from,to,ms,at:now()};},
      update(percent){if(canceled||!Number.isFinite(percent))return;const next=Math.max(value,Math.min(99,Math.max(0,percent)));if(next>value){value=next;lastChange=now();updates++;}},
      cancel(){value=this.snapshot().percent;canceled=true;},
      snapshot(){const time=now(),elapsed=Math.max(0,time-start),phaseElapsed=Math.max(0,time-phaseStart);
        const measurable=rateKnown&&updates>=2&&value>=3&&phaseElapsed>=2000;
        const remaining=measurable?Math.max(1000,phaseElapsed*(100-value)/value):null;
        const projected=plan&&!canceled?plan.from+(plan.to-plan.from)*Math.min(.95,Math.max(0,(time-plan.at)/plan.ms)):value;
        return {phase,percent:Math.floor(Math.min(99,Math.max(value,projected))),estimated:projected>value,indeterminate:!rateKnown&&!plan&&value===0,elapsed,remaining:deadline!==null?(deadline>time?deadline-time:null):time-lastChange>15000?null:remaining,canceled};}
    };
  }
  const duration=ms=>{const seconds=Math.max(0,Math.ceil(ms/1000));return Math.floor(seconds/60)+'분 '+String(seconds%60).padStart(2,'0')+'초';};
  let tracker=null,timer=null;
  function render(){if(!tracker)return;const s=tracker.snapshot(),root=document.getElementById('busyMetrics');if(!root)return;
    document.getElementById('busyPercent').textContent=s.canceled?'취소 중':s.phase+(s.indeterminate?' · 진행 중':' '+(s.estimated?'약 ':'')+s.percent+'%');
    document.getElementById('busyElapsed').textContent=duration(s.elapsed)+' 경과';
    document.getElementById('busyRemaining').textContent=s.canceled?'작업을 안전하게 정리하고 있습니다.':s.remaining===null?'남은 시간 계산 중':'이 단계 약 '+duration(s.remaining)+' 남음 · 예상';
    const bar=document.getElementById('busyProgress');if(s.indeterminate)bar.removeAttribute('value');else bar.value=s.percent;bar.setAttribute('aria-label',s.phase+' 진행률');
  }
  // Only timings are stored; no page text, filenames or images are persisted.
  let timings={};try{const saved=JSON.parse(globalThis.localStorage.getItem('pdf-ocr-timings-v1'));if(saved&&typeof saved==='object'&&Object.keys(saved).length<=32)timings=saved;}catch{}
  globalThis.PDFWorkProgress={createTracker,duration,
    start(){if(tracker)return;tracker=createTracker();render();timer=setInterval(render,1000);},
    stop(){clearInterval(timer);timer=null;tracker=null;},
    phase(name,known=true){tracker?.phase(name,known);render();},
    update(percent){tracker?.update(percent);render();},
    estimate(ms){tracker?.estimate(ms);render();},
    plan(from,to,ms){tracker?.plan(from,to,ms);render();},
    previous(key){const n=timings[key];return Number.isFinite(n)&&n>=500&&n<=600000?n:null;},
    sample(key,ms){if(!Number.isFinite(ms)||ms<500||ms>600000)return;const old=this.previous(key);timings[key]=old?old*.5+ms*.5:ms;if(Object.keys(timings).length>32)delete timings[Object.keys(timings)[0]];try{globalThis.localStorage?.setItem('pdf-ocr-timings-v1',JSON.stringify(timings));}catch{}},
    cancel(){tracker?.cancel();render();}
  };
})();
