// 카드별 RiftJudge 판정 요약(digest)을 만든다 — 감사 에이전트 입력용.
// 입력: tools/data/riftjudge.jsonl, tools/data/riftjudge-by-card.json(riftjudge-match.js 산출)
// 출력: tools/data/riftjudge-digest/<n>.md  (카드 원문·FX + 판정 Q&A: 질문에 카드명이 있는 것 우선, 같은 답변 중복 제거, 최대 CAP건)
// 사용: node tools/riftjudge-digest.js [--cap 45]
const fs=require('fs'), path=require('path'), vm=require('vm');
const JS=path.join(__dirname,'../client/web/js');
const r=f=>fs.readFileSync(path.join(JS,f),'utf8');
const ctx={console}; vm.createContext(ctx);
vm.runInContext([r('cards.js'),r('loc.js'),r('effects.js'),r('cardscripts.js'),'compileAllCards();'].join('\n;\n'),ctx);
const {CARDS, FX, SCRIPTS} = vm.runInContext('({CARDS, FX, SCRIPTS:(typeof SCRIPTS!=="undefined"?SCRIPTS:null)})', ctx);
const args=process.argv.slice(2); const arg=k=>{const i=args.indexOf(k); return i>=0?args[i+1]:null;};
const CAP=+(arg('--cap')||45);
const rows=fs.readFileSync(path.join(__dirname,'data/riftjudge.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(q=>!q.missing);
const byId=Object.fromEntries(rows.map(q=>[q.id,q]));
const byCard=JSON.parse(fs.readFileSync(path.join(__dirname,'data/riftjudge-by-card.json'),'utf8'));
const PUNCT=new RegExp('[' + String.fromCharCode(8217) + '\'`"!?.,:;*]', 'g');
const norm=s=>String(s||'').toLowerCase().replace(PUNCT,'').replace(/\s+/g,' ').trim();
const OUT=path.join(__dirname,'data/riftjudge-digest'); fs.mkdirSync(OUT,{recursive:true});
const summary=[];
for(const [n,e] of Object.entries(byCard)){
  const c=CARDS.find(x=>x.n===+n); if(!c) continue;
  const nm=norm(c.name); const re=new RegExp('(^|[^a-z0-9])'+nm+'([^a-z0-9]|$)');
  let qs=e.ids.map(id=>byId[id]).filter(Boolean);
  // 질문에 카드명이 있는 것을 앞으로, 그 안에서는 최신순
  qs.sort((a,b)=>{ const qa=re.test(norm(a.question))?1:0, qb=re.test(norm(b.question))?1:0; if(qa!==qb) return qb-qa; return String(b.created_at).localeCompare(String(a.created_at)); });
  // 같은 답변(앞 160자 기준) 중복 제거
  const seen=new Set(); const uniq=[];
  for(const q of qs){ const k=norm(q.answer).slice(0,160); if(seen.has(k)) continue; seen.add(k); uniq.push(q); }
  const kept=uniq.slice(0,CAP);
  const inQ=qs.filter(q=>re.test(norm(q.question))).length;
  summary.push({n:+n, ko:c.ko, name:c.name, type:c.type, total:qs.length, inQ, uniq:uniq.length, kept:kept.length});
  const lines=[];
  lines.push(`# #${c.n} ${c.ko} (${c.name}) — ${c.type}${c.super?' '+c.super:''} e=${c.e} p=${c.p} m=${c.m} dom=${JSON.stringify(c.dom)} tags=${JSON.stringify(c.tags)}`);
  lines.push(`원문: ${c.text}`);
  lines.push(`FX: ${JSON.stringify(FX[c.n],(k,v)=>typeof v==='function'?'[fn]':v)}`);
  lines.push(`SCRIPTS[${c.n}]: ${SCRIPTS && SCRIPTS[c.n] ? '있음 (client/web/js/cardscripts.js 에서 SCRIPTS['+c.n+'] 검색)' : '없음'}`);
  lines.push(`\n판정 Q&A: 총 ${qs.length}건 (질문에 카드명 ${inQ}건) → 중복 제거 ${uniq.length}건 → 수록 ${kept.length}건\n`);
  for(const q of kept){
    lines.push(`--- [#${q.id}] ${q.question}  (${String(q.created_at).slice(0,10)}${q.rule_refs&&q.rule_refs.length?' · rules: '+q.rule_refs.join(', '):''})`);
    lines.push(String(q.answer).trim()); lines.push('');
  }
  fs.writeFileSync(path.join(OUT, n+'.md'), lines.join('\n'));
}
summary.sort((a,b)=>b.total-a.total);
fs.writeFileSync(path.join(__dirname,'data/riftjudge-digest/_summary.json'), JSON.stringify(summary,null,1));
const tot=summary.reduce((s,x)=>s+x.kept,0);
console.log(`카드 ${summary.length}장, 수록 Q&A ${tot}건 (원 ${summary.reduce((s,x)=>s+x.total,0)}건) → ${OUT}`);
console.log(summary.slice(0,12).map(x=>`#${x.n} ${x.ko}: 총${x.total} 질문언급${x.inQ} 고유${x.uniq} 수록${x.kept}`).join('\n'));
