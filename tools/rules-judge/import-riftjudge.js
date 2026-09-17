// tools/data/riftjudge.jsonl(수집 원본: id/question/answer/status/deprecated/tags/rule_refs/created_at …)
// → data/riftjudge.jsonl(판정 팩용 축약 형식: id/q/a/status/deprecated/date/rules). 404(missing) 항목은 뺀다.
// 사용: node tools/fetch-riftjudge.js <maxId>  →  node tools/rules-judge/import-riftjudge.js  →  node tools/rules-judge/build-project-pack.js
const fs=require('fs'), path=require('path');
const SRC=path.join(__dirname,'..','data','riftjudge.jsonl'), DST=path.join(__dirname,'data','riftjudge.jsonl');
const out=[]; let missing=0, verified=0, deprecated=0, latest='';
for(const l of fs.readFileSync(SRC,'utf8').split('\n')){
  if(!l.trim()) continue;
  let q; try{ q=JSON.parse(l); }catch(e){ continue; }
  if(q.missing || !q.question) { missing++; continue; }
  const date=String(q.created_at||'').slice(0,10);
  const rules=Array.isArray(q.rule_refs) ? q.rule_refs.map(r=>typeof r==='string'?r:(r&&(r.rule||r.ref||r.id))||'').filter(Boolean) : [];
  const rec={ id:q.id, q:q.question, a:q.answer||'', status:q.status||'', deprecated:q.deprecated?1:0, date, rules };
  if(rec.status==='verified') verified++; if(rec.deprecated) deprecated++; if(date>latest) latest=date;
  out.push(JSON.stringify(rec));
}
fs.writeFileSync(DST, out.join('\n')+'\n');
console.log(`변환 ${out.length}건 (verified ${verified} · deprecated ${deprecated} · 404 제외 ${missing} · 최근 ${latest}) → ${DST}`);
