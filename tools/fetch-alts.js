// ══════════ 대체 일러스트 수집 ══════════
// 같은 카드의 다른 그림(Alternate Art / Overnumbered / Signature)을 모아
// 기본 카드 번호에 붙여 둔다. 효과·텍스트는 기본 카드와 같으므로 번역은 재사용한다.
//
//   node tools/fetch-alts.js
//   → data/alts.json   { "39": ["https://...", ...], ... }   (키 = 기본 카드 n)
//
// 매칭 방식
//   · Alternate Art  — collector_number 가 기본 카드와 같다
//   · Overnumbered / Signature — 번호가 다르므로 이름에서 접미사를 떼어 맞춘다
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

// build-cards.js와 같은 규칙 (OGS는 300을 더해 OGN과 충돌하지 않게 한다)
const OFFSET = { ogn: 0, ogs: 300 };

const SUFFIX = /\s*\((Alternate Art|Overnumbered|Signature)\)\s*$/i;
const stripName = s => String(s || '').replace(SUFFIX, '').trim().toLowerCase();

async function fetchSet(set) {
  let all = [];
  for (let p = 1; p <= 12; p++) {
    const r = await fetch(`https://api.riftcodex.com/cards?set_id=${set}&limit=50&page=${p}`);
    if (!r.ok) throw new Error(`${set} page ${p}: HTTP ${r.status}`);
    const d = await r.json();
    all = all.concat(d.items || []);
    if (!d.items || !d.items.length) break;
  }
  const seen = new Set();
  return all.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

(async () => {
  const alts = {};          // n → [url, ...]
  let total = 0, orphan = [];

  for (const set of ['ogn', 'ogs']) {
    const all = await fetchSet(set);
    const off = OFFSET[set];
    const isExtra = c => c.metadata.alternate_art || c.metadata.overnumbered || c.metadata.signature;
    const base = all.filter(c => !isExtra(c));
    const byNum = new Map(base.map(c => [c.collector_number, c]));
    const byName = new Map(base.map(c => [stripName(c.name), c]));

    for (const c of all.filter(isExtra)) {
      // 번호가 같으면 그대로, 아니면 이름에서 접미사를 떼어 찾는다
      const b = byNum.get(c.collector_number) || byName.get(stripName(c.name));
      const url = c.media && c.media.image_url;
      if (!b || !url) { orphan.push(c.name); continue; }
      const n = b.collector_number + off;
      (alts[n] = alts[n] || []).push(url);
      total++;
    }
    console.log(`[${set.toUpperCase()}] 기본 ${base.length}장 · 대체판 ${all.length - base.length}장`);
  }

  // 같은 그림이 두 번 들어가지 않게
  for (const n of Object.keys(alts)) alts[n] = [...new Set(alts[n])];

  fs.writeFileSync(path.join(DATA, 'alts.json'), JSON.stringify(alts, null, 1));
  console.log(`\n대체 일러스트 ${total}장 → ${Object.keys(alts).length}종 카드에 연결`);
  if (orphan.length) console.log(`⚠ 기본 카드를 못 찾은 것 ${orphan.length}건: ${orphan.join(', ')}`);
  console.log('다음: node tools/build-cards.js 로 cards.js에 반영하세요.');
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
