// 감사 결과(tools/data/riftjudge-audit/group-*.json)를 합쳐 보고서를 만든다.
// 출력: tools/data/riftjudge-audit/report.json (병합), report.md (목록), report.html (집계 → 공통 원인(클릭 필터) → 장부 행 + 원문 Q&A)
const fs=require('fs'), path=require('path');
const DIR=path.join(__dirname,'data/riftjudge-audit');
const rows=fs.readFileSync(path.join(__dirname,'data/riftjudge.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(q=>!q.missing);
const byId=Object.fromEntries(rows.map(q=>[q.id,q]));
const groups=fs.readdirSync(DIR).filter(f=>/^group-\d+\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8')));
const RANK={confirmed:0, likely:1, uncertain:2};
let findings=[]; let cards=0, reviewed=0, matched=0;
for(const g of groups){ cards+=g.cards_reviewed||0; reviewed+=g.rulings_reviewed||0; matched+=g.rulings_matched||0; for(const f of (g.findings||[])) findings.push({...f, group:g.group}); }
findings.sort((a,b)=>(RANK[a.mismatch]??3)-(RANK[b.mismatch]??3) || (a.category==='known-compromise')-(b.category==='known-compromise') || a.n-b.n);
findings.forEach((f,i)=>f.no=i+1);

// ── 공통 원인 묶음 (에이전트 요약을 종합한 수동 분류 — 근거 줄 번호로 매칭) ──
const CLUSTERS=[
 {k:'spellPlayTiming', t:"주문 '플레이할 때' 격발이 효과 실행 전에 발화", d:"resolveSpellEffects가 playOps 실행 전에 fireSpellPlayEvents를 호출. 공식은 주문 완전 해결 후(폐기·클린업 뒤). 레이븐블룸 학생·다리우스·빅토르·빙의·괴롭히는 밤·마법사냥꾼 간수 등 영향. 탈취 시 원 시전자 기준(execAs로 바꿔야 함)", re:/engine\.js:1316/},
 {k:'preTargetGap', t:"전용 op가 플레이 시점 대상 지정(PRE_TARGET_OPS)에서 빠짐", d:"bounceSpec(돌풍)·retreatOp(후퇴·질책)·grantKw(가르기·막기)·challenge(도전)·engarde·guillotine·possess(빙의)·dragonRage·extortion·mightSetToOther·gunsBlazing·dmgLastDiscardCost 등은 해결 시점에 대상을 골라, 응수로 대상이 사라지면 재지정 가능·굴절 소급·꿈꾸는 나무 미격발", re:/engine\.js:222[0-9]|engine\.js:2223/},
 {k:'legalTarget', t:"적법 대상 없어도 대상 주문 플레이 가능 / 굴절 거부 시 대상 없이 진행", d:"공허의 추적자(드로우만)·규율·혼미·단결된 의지·안면 분쇄·최후의 숨결·갈취 등을 대상 없이 낼 수 있음. 숨김 전용 hiddenSpellHasTarget을 손패 플레이로 일반화하면 해결", re:/engine\.js:224[0-9]|engine\.js:2266|engine\.js:1476/},
 {k:'phoenix', t:"불멸의 불사조 격발 조건", d:"피해 주문으로 죽인 유닛(cleanup 사망)은 _spellKilled를 못 세움·자기 유닛을 자기 주문으로 처치해도 미격발(u.ctrl!==G._casting)·폐기장에서 기지에만 배치·여러 장이어도 1장만", re:/engine\.js:1965|engine\.js:13(2[9]|3[0-6])/},
 {k:'unitDamageKind', t:"유닛이 주는 피해가 주문/능력 피해로 취급됨", d:"도전·용의 분노·최후의 숨결·신사의 결투·육식 덩굴 등 'they/it deal' 피해에 kind='spell'/'effect'를 써서 불굴의 정신이 막고 레이븐본 서적·공허의 관문 보너스가 붙음. 또 might()를 combatRole 없이 불러 맹공·보호막 누락", re:/engine\.js:706|cardscripts\.js:2(09|13|1[3-6])/},
 {k:'showdownCleanup', t:"결전 정리 — 무혈 결전 치유·종소리 피해 소실·동시 사망 존야 선택권", d:"resolveShowdown이 hasCombat과 무관하게 전 유닛 치유(1784), 전투 사망 [죽음의 종소리] 피해가 곧바로 치유에 지워짐, killUnitsTogether가 순서대로 처리해 존야 통제자의 구원 대상 선택권 없음, 포탄 세례 where:'combat'이 무혈 결전에도 적용", re:/engine\.js:17[7-8][0-9]|engine\.js:1882|engine\.js:2204/},
 {k:'attackTrigger', t:"공격/방어 트리거 판정이 결전의 공격자·방어자 지정을 안 봄", d:"fireAttackTriggers가 '적이 있으면 공격'으로 판정해 무혈 결전에 방어자로 합류한 유닛(바람 타기·천공의 검·야스오)의 [공격 시]가 발동하고 진짜 공격자의 [공격 시]는 누락. 방어 격발이 공격 격발보다 늦음", re:/engine\.js:2(4[0-9]|5[0-9])\b|engine\.js:1574|engine\.js:165[0-9]|engine\.js:166[0-9]/},
 {k:'mightyTiming', t:"볼리베어 '위력적 유닛 플레이' 판정 시점", d:"onPlay 격발(자기 버프 등)을 먼저 해결한 뒤 isMighty를 검사해 위험한 2인조·세트·숨김 티모가 잘못 격발. 검사를 격발 전으로", re:/engine\.js:118[6-9]/},
 {k:'playedCount', t:"'플레이한 카드 수'·[군단]·숨김 플레이가 카운터 여부와 무관하게 셈", d:"playedCards++가 플레이 시점이라 카운터된 주문도 녹서스 지망생 할인·다리우스 삼두정 조건에 들어가고, onPlayFromHidden이 적재 시점에 발화해 카운터된 숨김 주문도 잉걸불 수도승 +2. 태양 원반 [군단]이 자기 자신을 셈", re:/engine\.js:1160|engine\.js:1410|engine\.js:1229|engine\.js:1269|engine\.js:1228/},
 {k:'altPlayPath', t:"덱·폐기장·효과로 플레이하는 경로가 정식 플레이를 우회", d:"차원문 구출·미끼 바늘·유망한 미래·불사조·증원·선봉대 소집·스프라이트 부름 등이 makeUnit/placeUnit으로 직접 놓아 배치 위치 선택·[가속]·추가 비용·플레이 이벤트·[통찰]·등장 트리거가 누락. playCardFromHand(fromDeck…) 경로로 통일하면 해결", re:/cardscripts\.js:(3[4-6][0-9]|4[1-2][0-9]|57[0-6])|engine\.js:2447|engine\.js:2465/},
 {k:'kwAura', t:"오라가 주는 수치 키워드가 합산되지 않음", d:"effKw가 base[k]||true로 덮어써 타릭 [보호막]·패론 대위 2기 등이 공식보다 낮음", re:/engine\.js:220\b/},
 {k:'extraTurn', t:"시간 왜곡 추가 턴이 단일 플래그", d:"한 턴에 2장·유망한 미래로 양쪽 각 1장·탈취 재시전 시 1턴만 남음. 큐로 바꿔야 함. 카이사 폐기장 플레이 시 추방 대신 재활용", re:/engine\.js:2677|engine\.js:694\b/},
];
function clusterOf(f){ const ev=(f.evidence||[]).join(' '); for(const c of CLUSTERS) if(c.re.test(ev)) return c.k; return null; }
findings.forEach(f=>{ f.cluster = f.category==='known-compromise' ? 'knownCompromise' : clusterOf(f); });
const clusterCount=k=>findings.filter(f=>f.cluster===k).length;

fs.writeFileSync(path.join(DIR,'report.json'), JSON.stringify({groups:groups.length, cards, reviewed, matched, findings},null,1));
const cnt=k=>findings.filter(f=>f.mismatch===k).length;
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// 답변 마크다운의 **굵게**·줄바꿈만 가볍게 HTML로
const md=s=>esc(s).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>');
const KO={confirmed:'확인됨', likely:'유력', uncertain:'불확실'};
const CAT={rule:'규칙', 'card-text':'카드 효과', 'known-compromise':'알려진 절충', unclear:'불명확'};
// ── Markdown ──
const m=[];
m.push(`# RiftJudge 판정 대조 보고서 (Origins 카드)`);
m.push(`감사 그룹 ${groups.length}개 · 카드 ${cards}장 · 검토 판정 ${reviewed}건 · 일치 ${matched}건 · **불일치 후보 ${findings.length}건** (확인됨 ${cnt('confirmed')} · 유력 ${cnt('likely')} · 불확실 ${cnt('uncertain')})\n`);
m.push(`## 공통 원인별 묶음 (같은 곳을 고치면 함께 풀리는 항목)`);
for(const c of CLUSTERS) if(clusterCount(c.k)) m.push(`- **${c.t}** — ${clusterCount(c.k)}건 (항목: ${findings.filter(f=>f.cluster===c.k).map(f=>f.no).join(', ')})\n  ${c.d}`);
m.push(`- **알려진 절충(격발 즉시 해결 등)의 파생** — ${clusterCount('knownCompromise')}건`);
m.push(`- 그 외 개별 카드 문제 — ${findings.filter(f=>!f.cluster).length}건\n`);
for(const f of findings){
  m.push(`## ${f.no}. #${f.n} ${f.ko} (${f.name}) — ${KO[f.mismatch]||f.mismatch} · ${CAT[f.category]||f.category}`);
  m.push(`- **판정 질문**: ${f.ruling_question}`);
  m.push(`- **판정 요지(원문)**: ${f.ruling_excerpt}`);
  m.push(`- **시뮬레이터 현재 동작**: ${f.sim_behavior}`);
  if(f.note) m.push(`- **메모**: ${f.note}`);
  m.push(`- 근거: ${(f.evidence||[]).join(', ')} · 원문: ${(f.ruling_ids||[]).map(id=>`[#${id}](https://app.riftjudge.com/questions/${id})`).join(' ')}\n`);
}
fs.writeFileSync(path.join(DIR,'report.md'), m.join('\n'));

// ── HTML 본문 (아티팩트: 집계 → 공통 원인(클릭 필터) → 장부 행 + 원문 Q&A) ──
const h=[];
const CL_KO=Object.fromEntries(CLUSTERS.map(c=>[c.k,c.t]));
h.push(`<title>Origins 판정 대조</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#f3f5f7;--fg:#16202a;--mut:#5c6b7a;--line:#d3dae1;--panel:#ffffff;--inset:#eef2f5;--acc:#1f5f8b;--acc-bg:#e3eef7;--s0:#b4232c;--s1:#b26f00;--s2:#5c6b7a;--kc:#7a6a8f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f151b;--fg:#e6ecf1;--mut:#97a6b4;--line:#2a3641;--panel:#16202a;--inset:#1c2732;--acc:#7fb3de;--acc-bg:#1b2f40;--s0:#ff7a80;--s1:#f0b24d;--s2:#97a6b4;--kc:#b7a6d1}}
:root[data-theme="dark"]{--bg:#0f151b;--fg:#e6ecf1;--mut:#97a6b4;--line:#2a3641;--panel:#16202a;--inset:#1c2732;--acc:#7fb3de;--acc-bg:#1b2f40;--s0:#ff7a80;--s1:#f0b24d;--s2:#97a6b4;--kc:#b7a6d1}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:15px/1.65 "IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;margin:0;padding:32px 20px 80px}
main{max-width:1020px;margin:0 auto}
header h1{font-size:26px;font-weight:700;margin:0;letter-spacing:-.01em;text-wrap:balance}
header p{color:var(--mut);margin:6px 0 0;max-width:68ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));border:1px solid var(--line);background:var(--panel);margin:22px 0 26px}
.stats div{padding:12px 16px;border-right:1px solid var(--line)} .stats div:last-child{border-right:0}
.stats b{display:block;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2} .stats span{font-size:12px;color:var(--mut);letter-spacing:.04em;text-transform:uppercase}
.stats .s0 b{color:var(--s0)} .stats .s1 b{color:var(--s1)} .stats .s2 b{color:var(--s2)}
h2.sec{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:0 0 10px;font-weight:600}
.clusters{list-style:none;margin:0 0 30px;padding:0;border-top:1px solid var(--line)}
.clusters li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;padding:10px 0;border-bottom:1px solid var(--line);align-items:start}
.clusters li b{font-weight:600} .clusters li .d{grid-column:1/-1;font-size:13.5px;color:var(--mut);max-width:80ch}
.clusters button{font:inherit;font-size:12.5px;padding:3px 10px;border:1px solid var(--line);background:var(--panel);color:var(--acc);border-radius:2px;cursor:pointer;white-space:nowrap}
.clusters button:hover,.clusters button.on{background:var(--acc-bg);border-color:var(--acc)}
.bar{position:sticky;top:0;background:var(--bg);padding:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line);margin-bottom:6px;z-index:2}
.bar button{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);background:var(--panel);color:var(--fg);border-radius:2px;cursor:pointer}
.bar button.on{background:var(--acc);border-color:var(--acc);color:#fff} .bar .n{margin-left:auto;font-size:13px;color:var(--mut)}
.bar button:focus-visible,.clusters button:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.f{display:grid;grid-template-columns:6px 1fr;gap:0 16px;border-bottom:1px solid var(--line);padding:16px 0 14px}
.f .stripe{background:var(--s2);border-radius:1px} .f[data-m="confirmed"] .stripe{background:var(--s0)} .f[data-m="likely"] .stripe{background:var(--s1)} .f[data-c="known-compromise"] .stripe{background:var(--kc)}
.f h3{margin:0 0 8px;font-size:16.5px;font-weight:600;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.f h3 .no{font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--mut);min-width:3ch} .f h3 .en{color:var(--mut);font-weight:400;font-size:14px}
.tag{font-size:11.5px;padding:1px 7px;border:1px solid currentColor;border-radius:2px;letter-spacing:.03em} .t0{color:var(--s0)} .t1{color:var(--s1)} .t2{color:var(--s2)} .tk{color:var(--kc)} .tc{color:var(--mut);border-color:var(--line)}
dl{margin:0;display:grid;grid-template-columns:96px minmax(0,1fr);gap:5px 14px} dt{color:var(--mut);font-size:13px;padding-top:2px} dd{margin:0;max-width:78ch}
.ev{font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--mut);word-break:break-all}
details{margin-top:8px} summary{cursor:pointer;color:var(--acc);font-size:13.5px;list-style:none;display:inline-flex;gap:6px;align-items:center} summary::-webkit-details-marker{display:none}
summary::before{content:"▸";font-size:11px} details[open] summary::before{content:"▾"}
.q{background:var(--inset);border-left:2px solid var(--line);padding:10px 14px;margin:10px 0 0;font-size:14px}
.q .t{font-weight:600;margin-bottom:4px} .q .a{max-width:80ch} .q a{color:var(--acc);font-size:12.5px;font-family:"IBM Plex Mono",monospace;display:inline-block;margin-top:6px;text-decoration:none} .q a:hover{text-decoration:underline}
.hid{display:none}
@media (max-width:640px){dl{grid-template-columns:1fr} dt{padding-top:6px}}
</style>`);
h.push(`<main><header><h1>RiftJudge 판정 대조 — Origins 카드</h1>
<p>RiftJudge(app.riftjudge.com)의 검증된 Q&amp;A ${reviewed}건을 시뮬레이터 코드와 대조한 결과입니다. 시뮬레이터와 다르거나 다를 수 있는 항목만 실었고, 각 항목에 답변 전문(영어)과 링크를 붙였습니다. 수정 여부는 판단해 주세요.</p></header>
<div class="stats"><div><b>${cards}</b><span>카드</span></div><div><b>${reviewed}</b><span>검토 판정</span></div><div><b>${matched}</b><span>일치</span></div><div><b>${findings.length}</b><span>불일치 후보</span></div><div class="s0"><b>${cnt('confirmed')}</b><span>확인됨</span></div><div class="s1"><b>${cnt('likely')}</b><span>유력</span></div><div class="s2"><b>${cnt('uncertain')}</b><span>불확실</span></div></div>
<h2 class="sec">공통 원인 — 같은 코드 한 곳을 고치면 함께 풀리는 항목</h2><ul class="clusters">`+
  CLUSTERS.filter(c=>clusterCount(c.k)).map(c=>`<li><b>${esc(c.t)}</b><button data-cl="${c.k}">${clusterCount(c.k)}건 보기</button><div class="d">${esc(c.d)}</div></li>`).join('')+
  `<li><b>알려진 절충(격발 즉시 해결 등)의 파생</b><button data-cl="knownCompromise">${clusterCount('knownCompromise')}건 보기</button><div class="d">공식은 격발 능력이 체인에 올라 응수·순서 지정이 가능. 시뮬레이터는 즉시 해결하는 의도된 단순화이며, 아래 목록에서는 보라색 줄로 표시됩니다.</div></li>`+
  `<li><b>그 외 개별 카드 문제</b><button data-cl="none">${findings.filter(f=>!f.cluster).length}건 보기</button><div class="d">솔라리의 상징(작동 안 함) · 신성한 심판(선택 방식) · 녹턴(대체 플레이 미구현) · 예지의 가면 · 황제의 칙령 '두 번 죽음' · 용광로 자기 재활용 · 물결을 바꾸는 자 부분 교환 등</div></li></ul>
<div class="bar"><button class="on" data-k="all">전체</button><button data-k="confirmed">확인됨</button><button data-k="likely">유력</button><button data-k="uncertain">불확실</button><button data-k="kc">알려진 절충 제외</button><span class="n" id="cnt">${findings.length}건 표시</span></div>`);
for(const f of findings){
  const tc='t'+(RANK[f.mismatch]??2);
  h.push(`<section class="f" data-m="${esc(f.mismatch)}" data-c="${esc(f.category)}" data-cl="${esc(f.cluster||'none')}"><div class="stripe"></div><div>
<h3><span class="no">${String(f.no).padStart(3,'0')}</span><span>#${f.n} ${esc(f.ko)}</span><span class="en">${esc(f.name)}</span><span class="tag ${f.category==='known-compromise'?'tk':tc}">${KO[f.mismatch]||esc(f.mismatch)}</span><span class="tag tc">${CAT[f.category]||esc(f.category)}${f.cluster&&f.cluster!=='knownCompromise'?' · '+esc(CL_KO[f.cluster]||''):''}</span></h3>
<dl><dt>판정 질문</dt><dd>${esc(f.ruling_question)}</dd><dt>판정 요지</dt><dd>${md(f.ruling_excerpt)}</dd><dt>시뮬레이터</dt><dd>${esc(f.sim_behavior)}</dd>${f.note?`<dt>메모</dt><dd>${esc(f.note)}</dd>`:''}<dt>코드 근거</dt><dd class="ev">${esc((f.evidence||[]).join('  ·  '))}</dd></dl>
<details><summary>원문 Q&amp;A ${(f.ruling_ids||[]).length}건</summary>${(f.ruling_ids||[]).map(id=>{const q=byId[id]; if(!q) return `<div class="q">#${id} (수집본에 없음)</div>`; return `<div class="q"><div class="t">${esc(q.question)}</div><div class="a">${md(q.answer)}</div><a href="https://app.riftjudge.com/questions/${id}" target="_blank" rel="noopener">app.riftjudge.com/questions/${id} · ${esc(String(q.created_at).slice(0,10))}</a></div>`;}).join('')}</details></div></section>`);
}
h.push(`</main><script>
(function(){
  var sev='all', cl=null;
  var secs=[].slice.call(document.querySelectorAll('section.f'));
  function apply(){ var n=0; secs.forEach(function(s){ var ok = (sev==='all') || (sev==='kc' ? s.dataset.c!=='known-compromise' : s.dataset.m===sev); if(cl && s.dataset.cl!==cl) ok=false; s.classList.toggle('hid',!ok); if(ok) n++; }); document.getElementById('cnt').textContent=n+'건 표시'; }
  document.querySelectorAll('.bar button').forEach(function(b){ b.onclick=function(){ document.querySelectorAll('.bar button').forEach(function(x){x.classList.remove('on')}); b.classList.add('on'); sev=b.dataset.k; apply(); }; });
  document.querySelectorAll('.clusters button').forEach(function(b){ b.onclick=function(){ var same=b.classList.contains('on'); document.querySelectorAll('.clusters button').forEach(function(x){x.classList.remove('on')}); cl = same ? null : b.dataset.cl; if(!same) b.classList.add('on'); apply(); if(!same) document.querySelector('.bar').scrollIntoView({behavior:'smooth'}); }; });
})();
</script>`);
fs.writeFileSync(path.join(DIR,'report.html'), h.join('\n'));
console.log(`그룹 ${groups.length} · 카드 ${cards} · 검토 ${reviewed} · 일치 ${matched} · 불일치 후보 ${findings.length} (확인 ${cnt('confirmed')} / 유력 ${cnt('likely')} / 불확실 ${cnt('uncertain')})`);
