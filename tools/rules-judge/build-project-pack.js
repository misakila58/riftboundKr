// claude.ai 프로젝트 / ChatGPT 프로젝트(GPTs)용 팩 생성 — 스크립트 없이 '파일 업로드 + 지침 붙여넣기'만으로 쓰는 버전.
// 출력: project-pack/  (0-설치방법.md, 1-지침.md, 룰북.txt, 카드.md, 판정-일반.md, 판정-카드별-XX.md …)  총 20개 이하
// 사용: node build-project-pack.js
const fs=require('fs'), path=require('path');
const D=path.join(__dirname,'data'), OUT=path.join(__dirname,'project-pack');
fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const cards=JSON.parse(fs.readFileSync(path.join(D,'cards.json'),'utf8'));
const kws=JSON.parse(fs.readFileSync(path.join(D,'keywords.json'),'utf8'));
const qa=fs.readFileSync(path.join(D,'riftjudge.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l))
  .filter(q=>q.status==='verified' && !q.deprecated);
const PUNCT=new RegExp('[' + String.fromCharCode(8217) + '\'`"!?.,:;*]', 'g');
const norm=s=>String(s||'').toLowerCase().replace(PUNCT,'').replace(/\s+/g,' ').trim();
const icon=s=>String(s||'').replace(/:rb_energy_(\d+):/g,'[에너지 $1]').replace(/:rb_rune_rainbow:/g,'[힘 1·아무 속성]').replace(/:rb_rune_(\w+):/g,'[힘 1·$1]').replace(/:rb_might:/g,'⚔').replace(/:rb_exhaust:/g,'[탈진]');
const CAP=40;   // 카드당 최대 수록 건수 (질문에 카드명이 든 것·최신 우선)

// ── 설치 안내·지침 (pack-src/ 원본 복사) ──
for(const f of fs.readdirSync(path.join(__dirname,'pack-src'))) fs.copyFileSync(path.join(__dirname,'pack-src',f), path.join(OUT,f));

// ── 룰북 ──
fs.copyFileSync(path.join(D,'rules.txt'), path.join(OUT,'룰북-Core-Rules-2025-12-01.txt'));

// ── 카드 ──
const cm=[];
cm.push('# 리프트바운드 카드 목록 — Origins(OGN 298장) + Proving Grounds(OGS 24장)');
cm.push('형식: `#번호 한글명 (영문명)` · 종류 · 비용(에너지/힘) · 위력 · 속성 · 태그 → 카드 원문(영어). 아이콘: ⚔=위력, [탈진]=탈진 비용.');
cm.push('\n## 키워드 한↔영\n');
cm.push('| 한글 | 영문 | 뜻 |\n|---|---|---|');
kws.forEach(k=>cm.push(`| ${k.ko} | ${k.en} | ${k.desc||''} |`));
cm.push('\n## 카드\n');
for(const c of cards){
  cm.push(`### #${c.n} ${c.ko} (${c.name})`);
  cm.push(`${c.type}${c.super?' · '+c.super:''} · 에너지 ${c.energy??'-'} / 힘 ${c.power??'-'} · 위력 ${c.might??'-'} · ${c.domain.join('/')||'무속성'}${c.tags.length?' · '+c.tags.join(', '):''}`);
  cm.push('> '+icon(c.text).replace(/\n/g,' '));
  cm.push('');
}
fs.writeFileSync(path.join(OUT,'카드.md'), cm.join('\n'));

// ── Q&A: 카드별 매칭 ──
const byCard=new Map(); const used=new Set();
for(const c of cards){
  const nm=norm(c.name); if(!nm || nm.length<4 || /[^a-z0-9 -]/.test(nm)) continue;
  const re=new RegExp('(^|[^a-z0-9])'+nm+'([^a-z0-9]|$)');
  const list=qa.filter(q=>re.test(norm(q.q))||re.test(norm(q.a)))
    .sort((a,b)=>{ const qa_=re.test(norm(a.q))?1:0, qb=re.test(norm(b.q))?1:0; if(qa_!==qb) return qb-qa_; return b.date.localeCompare(a.date); })
    .slice(0,CAP);
  if(list.length){ byCard.set(c.n, list); list.forEach(q=>used.add(q.id)); }
}
// 카드에 안 걸린 일반 규칙 Q&A (키워드·절차 등) — 최신순, 상한
const general=qa.filter(q=>!used.has(q.id)).sort((a,b)=>b.date.localeCompare(a.date));
const fmt=q=>`### Q. ${q.q.trim()}\n(RiftJudge #${q.id} · ${q.date} · verified${q.rules&&q.rules.length?' · 관련 조항: '+q.rules.join(', '):''})\n\n${q.a.trim()}\n`;

// 카드별 파일: 크기 기준으로 나눠 담는다 (파일당 약 450KB)
const LIMIT=1000*1024; let part=[], size=0, idx=1, files=[];
const flush=()=>{ if(!part.length) return; const first=part[0].n, last=part[part.length-1].n;
  const name=`판정-카드별-${String(idx).padStart(2,'0')}-#${first}~#${last}.md`;
  const body=[`# RiftJudge 판정 — 카드별 (#${first}~#${last})`, '카드마다 커뮤니티 검증(verified) 판정을 최신순으로 최대 '+CAP+'건 수록. 답변은 영어 원문. 판정 번호로 https://app.riftjudge.com/questions/<번호> 에서 원문을 볼 수 있다.', ''];
  for(const {n,ko,name:en,list} of part){ body.push(`## #${n} ${ko} (${en}) — ${list.length}건\n`); list.forEach(q=>body.push(fmt(q))); }
  fs.writeFileSync(path.join(OUT,name), body.join('\n')); files.push({name, cards:part.length, qa:part.reduce((s,x)=>s+x.list.length,0)}); part=[]; size=0; idx++; };
for(const c of cards){ const list=byCard.get(c.n); if(!list) continue; const entry={n:c.n,ko:c.ko,name:c.name,list}; const sz=list.reduce((s,q)=>s+q.q.length+q.a.length+80,0); if(size+sz>LIMIT && part.length) flush(); part.push(entry); size+=sz; }
flush();
// 일반 Q&A 파일(들)
let gpart=[], gsize=0, gidx=1;
const gflush=()=>{ if(!gpart.length) return; const name=`판정-일반규칙-${String(gidx).padStart(2,'0')}.md`; fs.writeFileSync(path.join(OUT,name), ['# RiftJudge 판정 — 일반 규칙 (특정 카드에 묶이지 않은 질문)','키워드·절차·타이밍 등. 최신순. 답변은 영어 원문.',''].concat(gpart.map(fmt)).join('\n')); files.push({name, qa:gpart.length}); gpart=[]; gsize=0; gidx++; };
for(const q of general){ const sz=q.q.length+q.a.length+80; if(gsize+sz>LIMIT && gpart.length) gflush(); gpart.push(q); gsize+=sz; }
gflush();
console.log('카드 파일 수', files.filter(f=>f.cards).length, '일반 파일 수', files.filter(f=>!f.cards).length, '수록 Q&A', files.reduce((s,f)=>s+f.qa,0), '/ 검증본', qa.length, '/ 일반', general.length);
files.forEach(f=>console.log('  ', f.name, (fs.statSync(path.join(OUT,f.name)).size/1024).toFixed(0)+'KB', f.cards?('카드 '+f.cards+'장 · '):'', 'Q&A '+f.qa));
