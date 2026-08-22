// Riftcodex API에서 Origins: Proving Grounds(OGS, 증명의 전장) 24장을 내려받아 저장한다.
// 사용: node tools/fetch-ogs.js
// 출력: data/ogs_p1.json (원본), data/ogs_base.json (기본 24장)
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

(async () => {
  const r = await fetch('https://api.riftcodex.com/cards?set_id=ogs&limit=50&page=1');
  const d = await r.json();
  fs.writeFileSync(path.join(DATA, 'ogs_p1.json'), JSON.stringify(d));
  const seen = new Set();
  const all = (d.items || []).filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const base = all.filter(c =>
    !(c.metadata && (c.metadata.alternate_art || c.metadata.overnumbered || c.metadata.signature_alternate)) &&
    c.collector_number <= 24);
  fs.writeFileSync(path.join(DATA, 'ogs_base.json'), JSON.stringify(base));
  console.log(`fetched ${all.length} unique, base set ${base.length}`);
  console.log('다음: node tools/build-cards.js 로 한글 카드 DB를 생성하세요.');
})();
