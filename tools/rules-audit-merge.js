// 새 룰북(2026-07-16) 감사 결과(tools/data/rules-audit-2026/area-*.json)를 합쳐 작업 목록과 보고서를 만든다.
// 출력: rules-audit-2026/findings.json(병합·정렬), work-<A|B|C|D>.json(수정 대상: confirmed·likely, 절충 제외), report.md
const fs=require('fs'), path=require('path');
const DIR=path.join(__dirname,'data/rules-audit-2026');
const RANK={confirmed:0, likely:1, uncertain:2}, IMP={high:0, medium:1, low:2};
let all=[]; const meta=[];
for(const f of fs.readdirSync(DIR).filter(f=>/^area-[A-E]\.json$/.test(f))){
  const j=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));
  meta.push({area:j.area, lines:j.lines, reviewed:j.rules_reviewed||0, n:(j.findings||[]).length});
  (j.findings||[]).forEach(x=>all.push({...x, area:j.area}));
}
all.sort((a,b)=>(IMP[a.impact]??3)-(IMP[b.impact]??3) || (RANK[a.mismatch]??3)-(RANK[b.mismatch]??3) || String(a.rule).localeCompare(String(b.rule)));
all.forEach((x,i)=>x.no=i+1);
fs.writeFileSync(path.join(DIR,'findings.json'), JSON.stringify({meta, findings:all},null,1));
const work=all.filter(x=>x.category!=='known-compromise' && x.mismatch!=='uncertain');
for(const a of ['A','B','C','D','E']){ const w=work.filter(x=>x.area===a); fs.writeFileSync(path.join(DIR,'work-'+a+'.json'), JSON.stringify(w,null,1)); }
const cnt=(k,v)=>all.filter(x=>x[k]===v).length;
const m=[];
m.push(`# 새 룰북(2026-07-16) 대조 감사 — 발견 ${all.length}건`);
m.push(`영역: ${meta.map(x=>`${x.area}(${x.lines}행, 검토 ${x.reviewed}, 발견 ${x.n})`).join(' · ')}`);
m.push(`확인됨 ${cnt('mismatch','confirmed')} · 유력 ${cnt('mismatch','likely')} · 불확실 ${cnt('mismatch','uncertain')} / 영향 high ${cnt('impact','high')} · medium ${cnt('impact','medium')} · low ${cnt('impact','low')} / 알려진 절충 ${cnt('category','known-compromise')} / 구판 대비 변경 조항 ${all.filter(x=>x.changed_since_old).length}\n`);
for(const x of all){
  m.push(`## ${x.no}. [${x.area}] 룰 ${x.rule} — ${x.topic}  (${x.mismatch} · ${x.impact}${x.changed_since_old?' · 신판 변경':''}${x.category==='known-compromise'?' · 절충':''})`);
  m.push(`- 원문: ${x.rule_quote}`);
  m.push(`- 시뮬레이터: ${x.sim_behavior}`);
  m.push(`- 메모: ${x.note||''}`);
  m.push(`- 근거: ${(x.evidence||[]).join(', ')}\n`);
}
fs.writeFileSync(path.join(DIR,'report.md'), m.join('\n'));
console.log(`발견 ${all.length}건 (수정 대상 ${work.length}: A ${work.filter(x=>x.area==='A').length} · B ${work.filter(x=>x.area==='B').length} · C ${work.filter(x=>x.area==='C').length} · D ${work.filter(x=>x.area==='D').length} · E ${work.filter(x=>x.area==='E').length}) → report.md`);
