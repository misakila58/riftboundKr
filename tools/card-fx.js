// 카드 하나의 원문·번역·FX(파서 결과)·개별 스크립트 유무를 출력한다. 사용: node tools/card-fx.js <n> [<n>...]
const fs=require('fs'), path=require('path'), vm=require('vm');
const JS=path.join(__dirname,'../client/web/js');
const r=f=>fs.readFileSync(path.join(JS,f),'utf8');
const ctx={console}; vm.createContext(ctx);
vm.runInContext([r('cards.js'),r('loc.js'),r('effects.js'),r('cardscripts.js'),'compileAllCards();'].join('\n;\n'),ctx);
const {CARDS, FX, SCRIPTS} = vm.runInContext('({CARDS, FX, SCRIPTS:(typeof SCRIPTS!=="undefined"?SCRIPTS:null)})', ctx);
for(const a of process.argv.slice(2)){
  const n=+a; const c=CARDS.find(x=>x.n===n); if(!c){ console.log('#'+n+' 없음'); continue; }
  console.log(`\n══ #${c.n} ${c.ko} (${c.name}) — ${c.type}${c.super?' '+c.super:''} e=${c.e} p=${c.p} m=${c.m} dom=${JSON.stringify(c.dom)} tags=${JSON.stringify(c.tags)}`);
  console.log('원문:', c.text); if(c.textKo||c.koText) console.log('번역:', c.textKo||c.koText);
  console.log('FX:', JSON.stringify(FX[n],(k,v)=>typeof v==='function'?'[fn]':v));
  console.log('SCRIPTS['+n+']:', SCRIPTS && SCRIPTS[n] ? '있음' : '없음');
}
