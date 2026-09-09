// 배치별 수정 기록(tools/data/riftjudge-audit/changelog-*.json)을 합쳐 변경 목록을 만든다.
// 출력: changelog.json(병합) · changelog.md(카드별 before→after) · changelog.html(아티팩트용 본문)
const fs=require('fs'), path=require('path');
const DIR=path.join(__dirname,'data/riftjudge-audit');
const files=fs.readdirSync(DIR).filter(f=>/^changelog-\d+\.json$/.test(f)).sort((a,b)=>+a.match(/\d+/)[0]-+b.match(/\d+/)[0]);
const THEME={1:'주문 격발 시점 · 플레이 카드 수 · 볼리베어 판정 · 오라 합산',2:'플레이 시점 대상 지정(전용 op) · 적법 대상 · 굴절',3:'결전 정리 · 공격/방어 지정 · 유닛 피해 종류 · 불사조',4:'덱·폐기장·효과 플레이 경로 통일 · 녹턴 · 시간 왜곡',5:'개별 카드 #5~#80',6:'개별 카드 #83~#206',7:'개별 카드 #207~#315'};
const all=[]; const byBatch={};
for(const f of files){ const b=+f.match(/\d+/)[0]; const arr=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8')); arr.forEach(e=>{ e.batch=b; all.push(e); }); byBatch[b]=arr; }
const count=d=>all.filter(e=>e.decision===d).length;
fs.writeFileSync(path.join(DIR,'changelog.json'), JSON.stringify(all,null,1));
const TAG={fixed:'수정',partial:'부분 수정',skipped:'보류','already-fixed':'이미 해결'};
const batches=Object.keys(byBatch).map(Number).sort((a,b)=>a-b);
const cardsOf=arr=>{ const m={}; arr.forEach(e=>{ (m[e.n]=m[e.n]||[]).push(e); }); return Object.entries(m).sort((a,b)=>+a[0]-+b[0]); };
// ── Markdown ──
const m=[];
m.push(`# 룰 대조 수정 내역 (2026-09-09) — RiftJudge 판정 ${all.length}건 처리`);
m.push(`수정 ${count('fixed')} · 부분 수정 ${count('partial')} · 이미 해결됨 ${count('already-fixed')} · 보류(룰북 미뒷받침) ${count('skipped')}\n`);
for(const b of batches){
  const arr=byBatch[b];
  m.push(`## ${b}차 — ${THEME[b]||''} (${arr.length}건)`);
  for(const [n,es] of cardsOf(arr)){
    m.push(`### #${n} ${es[0].ko}`);
    for(const e of es){
      m.push(`- **${TAG[e.decision]||e.decision}** — 기존: ${e.before || '-'}\n  → 변경: ${e.after || '-'}${e.rule?`\n  _근거: ${e.rule}_`:''}${e.reason_if_skipped?`\n  _보류 사유: ${e.reason_if_skipped}_`:''}`);
    }
  }
  m.push('');
}
fs.writeFileSync(path.join(DIR,'changelog.md'), m.join('\n'));
// ── HTML (보고서와 같은 토큰·서체) ──
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const h=[];
h.push(`<title>룰 대조 수정 내역</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#f3f5f7;--fg:#16202a;--mut:#5c6b7a;--line:#d3dae1;--panel:#ffffff;--inset:#eef2f5;--acc:#1f5f8b;--acc-bg:#e3eef7;--ok:#1d7a46;--part:#b26f00;--skip:#5c6b7a;--done:#7a6a8f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f151b;--fg:#e6ecf1;--mut:#97a6b4;--line:#2a3641;--panel:#16202a;--inset:#1c2732;--acc:#7fb3de;--acc-bg:#1b2f40;--ok:#6fcf97;--part:#f0b24d;--skip:#97a6b4;--done:#b7a6d1}}
:root[data-theme="dark"]{--bg:#0f151b;--fg:#e6ecf1;--mut:#97a6b4;--line:#2a3641;--panel:#16202a;--inset:#1c2732;--acc:#7fb3de;--acc-bg:#1b2f40;--ok:#6fcf97;--part:#f0b24d;--skip:#97a6b4;--done:#b7a6d1}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font:15px/1.65 "IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;margin:0;padding:32px 20px 80px}
main{max-width:1020px;margin:0 auto}
header h1{font-size:26px;font-weight:700;margin:0;letter-spacing:-.01em;text-wrap:balance} header p{color:var(--mut);margin:6px 0 0;max-width:70ch}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));border:1px solid var(--line);background:var(--panel);margin:22px 0 26px}
.stats div{padding:12px 16px;border-right:1px solid var(--line)} .stats div:last-child{border-right:0}
.stats b{display:block;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2} .stats span{font-size:12px;color:var(--mut);letter-spacing:.04em;text-transform:uppercase}
.stats .ok b{color:var(--ok)} .stats .part b{color:var(--part)} .stats .done b{color:var(--done)} .stats .skip b{color:var(--skip)}
nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px} nav a{font-size:13px;color:var(--acc);text-decoration:none;border:1px solid var(--line);padding:4px 10px;border-radius:2px;background:var(--panel)} nav a:hover{background:var(--acc-bg)}
h2{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:34px 0 8px;font-weight:600;border-bottom:1px solid var(--line);padding-bottom:6px}
.card{display:grid;grid-template-columns:150px minmax(0,1fr);gap:0 18px;padding:12px 0;border-bottom:1px solid var(--line)}
.card .nm{font-weight:600} .card .nm small{display:block;color:var(--mut);font-family:"IBM Plex Mono",monospace;font-weight:400;font-size:12px}
.e{margin:0 0 8px} .e:last-child{margin:0}
.tag{font-size:11.5px;padding:1px 7px;border:1px solid currentColor;border-radius:2px;letter-spacing:.03em;margin-right:6px}
.t-fixed{color:var(--ok)} .t-partial{color:var(--part)} .t-skipped{color:var(--skip)} .t-already-fixed{color:var(--done)}
.ba{display:grid;grid-template-columns:44px minmax(0,1fr);gap:2px 8px;margin-top:4px;font-size:14px} .ba dt{color:var(--mut);font-size:12.5px;padding-top:2px} .ba dd{margin:0;max-width:80ch}
.rule{font-size:12.5px;color:var(--mut);margin-top:4px;font-family:"IBM Plex Mono",monospace;word-break:break-word}
@media (max-width:640px){.card{grid-template-columns:1fr}}
</style>`);
h.push(`<main><header><h1>룰 대조 수정 내역 — 2026-09-09</h1><p>RiftJudge 판정 대조에서 나온 불일치 후보를 룰북(종합 규칙) 원문과 다시 대조해, 룰북이 뒷받침하는 항목만 고쳤습니다. 각 항목에 기존 동작 → 바뀐 동작과 근거 조항을 적었습니다.</p></header>
<div class="stats"><div><b>${all.length}</b><span>처리 항목</span></div><div class="ok"><b>${count('fixed')}</b><span>수정</span></div><div class="part"><b>${count('partial')}</b><span>부분 수정</span></div><div class="done"><b>${count('already-fixed')}</b><span>이미 해결됨</span></div><div class="skip"><b>${count('skipped')}</b><span>보류</span></div></div>
<nav>${batches.map(b=>`<a href="#b${b}">${b}차 · ${esc(THEME[b])} (${byBatch[b].length})</a>`).join('')}</nav>`);
for(const b of batches){
  h.push(`<h2 id="b${b}">${b}차 — ${esc(THEME[b])} · ${byBatch[b].length}건</h2>`);
  for(const [n,es] of cardsOf(byBatch[b])){
    h.push(`<section class="card"><div class="nm">${esc(es[0].ko)}<small>#${n}</small></div><div>`+es.map(e=>`<div class="e"><span class="tag t-${esc(e.decision)}">${TAG[e.decision]||esc(e.decision)}</span><dl class="ba"><dt>기존</dt><dd>${esc(e.before||'-')}</dd><dt>변경</dt><dd>${esc(e.after||'-')}</dd></dl>${e.rule?`<div class="rule">근거 · ${esc(e.rule)}</div>`:''}${e.reason_if_skipped?`<div class="rule">보류 사유 · ${esc(e.reason_if_skipped)}</div>`:''}</div>`).join('')+`</div></section>`);
  }
}
h.push(`</main>`);
fs.writeFileSync(path.join(DIR,'changelog.html'), h.join('\n'));
console.log(`${all.length}건 → 수정 ${count('fixed')} / 부분 ${count('partial')} / 이미 ${count('already-fixed')} / 보류 ${count('skipped')} → changelog.md / changelog.html`);
