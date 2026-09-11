#!/usr/bin/env node
// 리프트바운드 룰 판정 검색 도구 — RIFTBOUND_JUDGE.md 지침이 이 스크립트를 부른다.
//   node search.js "cull the weak"            Q&A·카드·룰북을 한 번에 검색 (단어 전부 포함, 대소문자 무시)
//   node search.js --qa "deflect counter"     Q&A만 (질문+답변 본문)  --n 10 으로 건수 조절, --all 이면 deprecated 포함
//   node search.js --id 10900                 Q&A 한 건 전문
//   node search.js --card 약자                 카드 검색 (한글/영문 이름·번호·본문)
//   node search.js --rule 352.8               룰 번호로 조항 출력 (하위 조항 포함)   --rule "illegal target" 은 본문 검색
const fs=require('fs'), path=require('path');
const D=path.join(__dirname,'data');
const args=process.argv.slice(2);
const opt=k=>{ const i=args.indexOf(k); return i>=0 ? (args[i+1]||'') : null; };
const has=k=>args.includes(k);
const N=+(opt('--n')||8);
const norm=s=>String(s||'').toLowerCase();
const terms=q=>norm(q).split(/\s+/).filter(Boolean);
const matchAll=(txt,ts)=>{ const t=norm(txt); return ts.every(x=>t.includes(x)); };
const clip=(s,n)=>{ s=String(s||'').replace(/\s+/g,' ').trim(); return s.length>n ? s.slice(0,n)+'…' : s; };

function loadQA(){ return fs.readFileSync(path.join(D,'riftjudge.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)); }
function loadCards(){ return JSON.parse(fs.readFileSync(path.join(D,'cards.json'),'utf8')); }
function loadRules(){ return fs.readFileSync(path.join(D,'rules.txt'),'utf8').split('\n'); }
function printQA(q, full){
  const tag = q.deprecated ? 'DEPRECATED(구 판정 — 최신 판정을 우선)' : q.status;
  console.log(`--- [#${q.id}] ${q.q}  (${q.date} · ${tag}${q.rules&&q.rules.length?' · rules: '+q.rules.join(', '):''})`);
  console.log(full ? q.a.trim() : clip(q.a, 420));
  console.log('');
}

// ── Q&A 한 건 ──
if(has('--id')){ const id=+opt('--id'); const q=loadQA().find(x=>x.id===id); if(!q) console.log('없음'); else printQA(q,true); process.exit(); }

// ── 룰 조항 ──
if(has('--rule')){
  const key=opt('--rule'); const lines=loadRules();
  if(/^\d/.test(key)){
    // 룰 번호: 해당 번호와 그 하위 조항(예: 352.8 → 352.8, 352.8.a, 352.8.a.1 …)이 붙은 줄부터, 다음 상위 번호 전까지
    const re=new RegExp('^\\s*'+key.replace(/\./g,'\\.')+'(\\.|\\b)');
    const idx=lines.findIndex(l=>re.test(l));
    if(idx<0){ console.log('해당 번호 없음 — 본문 검색을 시도하세요: node search.js --rule "키워드"'); process.exit(); }
    // 번호가 문단 왼쪽 여백에 따로 붙는 형식이라, 앞뒤 문맥을 넉넉히 보여 준다
    const from=Math.max(0, idx-3), to=Math.min(lines.length, idx+60);
    console.log(`── rules.txt ${from+1}~${to}행 (룰 ${key} 부근) ──`);
    lines.slice(from,to).forEach((l,i)=>console.log(String(from+i+1).padStart(5)+'  '+l));
  } else {
    const ts=terms(key); let hit=0;
    lines.forEach((l,i)=>{ if(matchAll(l,ts)){ hit++; if(hit<=N){ console.log(`── ${i+1}행 ──`); lines.slice(Math.max(0,i-2),i+6).forEach((x,j)=>console.log(String(Math.max(0,i-2)+j+1).padStart(5)+'  '+x)); console.log(''); } } });
    console.log(`총 ${hit}개 줄 일치 (상위 ${Math.min(hit,N)}개 표시)`);
  }
  process.exit();
}

// ── 카드 ──
function searchCards(q){
  const ts=terms(q); const cards=loadCards();
  const byNum = /^\d+$/.test(q) ? cards.filter(c=>c.n===+q) : [];
  const byName = cards.filter(c=>ts.every(t=>norm(c.ko).includes(t)||norm(c.name).includes(t)));
  const byText = cards.filter(c=>!byName.includes(c) && matchAll(c.text,ts));
  return [...byNum, ...byName, ...byText];
}
function printCard(c){
  console.log(`#${c.n} ${c.ko} (${c.name}) — ${c.type}${c.super?' '+c.super:''} · ${c.set} · 에너지 ${c.energy??'-'} 힘 ${c.power??'-'} 위력 ${c.might??'-'} · ${c.domain.join('/')||'무속성'}${c.tags.length?' · '+c.tags.join(', '):''}`);
  console.log('   '+c.text.replace(/:rb_energy_(\d+):/g,'[$1]').replace(/:rb_rune_rainbow:/g,'[힘·아무 속성]').replace(/:rb_rune_(\w+):/g,'[힘·$1]').replace(/:rb_might:/g,'⚔').replace(/:rb_exhaust:/g,'[탈진]'));
}
if(has('--card')){ const r=searchCards(opt('--card')); r.slice(0,N).forEach(printCard); console.log(`\n총 ${r.length}장`); process.exit(); }

// ── Q&A ──
function searchQA(q, all){
  const ts=terms(q);
  return loadQA().filter(x=>(all||!x.deprecated) && x.status==='verified' && (matchAll(x.q,ts)||matchAll(x.a,ts)))
    .sort((a,b)=>{ const qa=matchAll(a.q,ts)?1:0, qb=matchAll(b.q,ts)?1:0; if(qa!==qb) return qb-qa; return b.date.localeCompare(a.date); });
}
if(has('--qa')){ const r=searchQA(opt('--qa'), has('--all')); r.slice(0,N).forEach(q=>printQA(q,false)); console.log(`총 ${r.length}건 (질문에 포함된 것 우선·최신순, 상위 ${Math.min(r.length,N)}건). 전문: node search.js --id <번호>`); process.exit(); }

// ── 통합 ──
// 옵션 값(--n 20 의 20 등)은 검색어에서 뺀다
const VALOPTS=['--n','--qa','--card','--id','--rule'];
const free=[]; for(let i=0;i<args.length;i++){ if(VALOPTS.includes(args[i])){ i++; continue; } if(args[i].startsWith('--')) continue; free.push(args[i]); }
const q=free.join(' ');
if(!q){ console.log(fs.readFileSync(__filename,'utf8').split('\n').slice(1,7).join('\n')); process.exit(); }
console.log('══ 카드 ══'); const cs=searchCards(q); cs.slice(0,5).forEach(printCard); if(cs.length>5) console.log(`… 외 ${cs.length-5}장 (--card 로 더 보기)`); if(!cs.length) console.log('(없음)');
console.log('\n══ RiftJudge 판정 (verified, 최신순) ══'); const qs=searchQA(q,false); qs.slice(0,N).forEach(x=>printQA(x,false)); console.log(qs.length?`총 ${qs.length}건 — 전문은 --id`:'(없음)');
console.log('\n══ 룰북 ══'); const lines=loadRules(); const ts=terms(q); let hit=0; lines.forEach((l,i)=>{ if(matchAll(l,ts)){ hit++; if(hit<=5) console.log(String(i+1).padStart(5)+'  '+l.trim()); } }); console.log(hit?`총 ${hit}줄 — 문맥은 --rule "${q}" 또는 --rule <번호>`:'(없음)');
