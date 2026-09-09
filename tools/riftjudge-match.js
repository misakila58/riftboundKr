// tools/data/riftjudge.jsonl 에서 우리 카드(322장) 영문명이 언급된 검증(verified) Q&A를 카드별로 묶는다.
// 출력: tools/data/riftjudge-by-card.json  { "<n>": { name, ko, count, ids:[...] } }  + 요약 표
// 사용: node tools/riftjudge-match.js [--print <n>]  (--print n: 그 카드의 Q&A 전문 출력)
const fs=require('fs'), path=require('path'), vm=require('vm');
const JS=path.join(__dirname,'../client/web/js');
const ctx={console}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(JS,'cards.js'),'utf8'),ctx);
const CARDS=vm.runInContext('CARDS',ctx);
const rows=fs.readFileSync(path.join(__dirname,'data/riftjudge.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(q=>!q.missing);
const args=process.argv.slice(2); const arg=k=>{const i=args.indexOf(k); return i>=0?args[i+1]:null;};
const printN=arg('--print');
// 이름 정규화: 따옴표·문장부호 제거, 소문자, 공백 정리 (카드명에는 영문·숫자·공백·하이픈만 남는다)
const PUNCT=new RegExp('[' + String.fromCharCode(8217) + '\'`"!?.,:;*]', 'g');
const norm=s=>String(s||'').toLowerCase().replace(PUNCT,'').replace(/\s+/g,' ').trim();
const byCard={};
const verified=rows.filter(q=>q.status==='verified' && !q.deprecated).map(q=>({id:q.id, t:norm(q.question)+' \n '+norm(q.answer)}));
for(const c of CARDS){
  const nm=norm(c.name); if(!nm || nm.length<4) continue;
  if(/[^a-z0-9 -]/.test(nm)) { console.log('이름에 특수문자 — 건너뜀:', c.name); continue; }
  const re=new RegExp('(^|[^a-z0-9])'+nm+'([^a-z0-9]|$)');
  const ids=verified.filter(q=>re.test(q.t)).map(q=>q.id);
  if(ids.length) byCard[c.n]={name:c.name, ko:c.ko, type:c.type, count:ids.length, ids};
}
fs.writeFileSync(path.join(__dirname,'data/riftjudge-by-card.json'), JSON.stringify(byCard,null,1));
const list=Object.entries(byCard).sort((a,b)=>b[1].count-a[1].count);
console.log(`검증 Q&A ${verified.length}건 중 우리 카드 언급: ${list.length}장, 링크 ${list.reduce((s,[,v])=>s+v.count,0)}건`);
if(printN){
  const byId=Object.fromEntries(rows.map(q=>[q.id,q]));
  const e=byCard[printN]; if(!e){ console.log('해당 카드 언급 없음'); process.exit(); }
  console.log(`\n## #${printN} ${e.ko} (${e.name}) — ${e.count}건\n`);
  for(const id of e.ids){ const q=byId[id]; console.log(`--- [#${id}] ${q.question}\n${q.answer}\n`); }
} else {
  console.log(list.slice(0,40).map(([n,v])=>`#${n} ${v.ko} (${v.name}): ${v.count}`).join('\n'));
}
