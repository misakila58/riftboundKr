// Riftcodex API에서 Origins(OGN) 세트 카드 데이터를 내려받아 tools/data/ 에 저장한다.
// 사용: node tools/fetch-ogn.js
// 출력: data/ogn_p*.json (원본 페이지), data/ogn_base.json (기본 세트 298장)
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

(async () => {
  let all = [];
  for (let p = 1; p <= 8; p++) {
    const r = await fetch(`https://api.riftcodex.com/cards?set_id=ogn&limit=50&page=${p}`);
    const d = await r.json();
    fs.writeFileSync(path.join(DATA, `ogn_p${p}.json`), JSON.stringify(d));
    all = all.concat(d.items || []);
    if (!d.items || !d.items.length) break;
  }
  const seen = new Set();
  all = all.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const base = all.filter(c =>
    !c.metadata.alternate_art && !c.metadata.overnumbered && !c.metadata.signature &&
    c.collector_number <= 298);
  fs.writeFileSync(path.join(DATA, 'ogn_all.json'), JSON.stringify(all));
  fs.writeFileSync(path.join(DATA, 'ogn_base.json'), JSON.stringify(base));
  console.log(`fetched ${all.length} unique, base set ${base.length}`);
  console.log('다음: node tools/build-cards.js 로 한글 카드 DB를 생성하세요.');
})();
