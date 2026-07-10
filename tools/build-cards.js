// 원본 카드 데이터(data/ogn_base.json)와 한글 번역(data/tr_out_batch*.json)을 합쳐
// 클라이언트/서버가 쓰는 카드 파일을 생성한다.
//   → client/web/js/cards.js  (게임용 전체 카드 DB)
//   → server/cards.json        (서버 덱 검증용: n/type/super 만)
// 사용: node tools/build-cards.js  (사전에 node tools/fetch-ogn.js 필요)
const fs = require('fs');
const path = require('path');
const DATA = path.join(__dirname, 'data');
const ROOT = path.join(__dirname, '..');

const base = JSON.parse(fs.readFileSync(path.join(DATA, 'ogn_base.json'), 'utf8'));
const ko = {};
for (let i = 1; i <= 6; i++) {
  const f = path.join(DATA, `tr_out_batch${i}.json`);
  if (fs.existsSync(f)) JSON.parse(fs.readFileSync(f, 'utf8')).forEach(e => ko[e.n] = e);
}

const db = base.map(c => ({
  n: c.collector_number,
  name: c.name,
  ko: (ko[c.collector_number] && ko[c.collector_number].name_ko) || c.name,
  type: c.classification.type,
  super: c.classification.supertype,
  rarity: c.classification.rarity,
  dom: c.classification.domain || [],
  e: c.attributes.energy, m: c.attributes.might, p: c.attributes.power,
  text: (c.text.plain || '').trim(),
  tko: (ko[c.collector_number] && ko[c.collector_number].text_ko) || '',
  tags: c.tags || [],
  img: c.media.image_url,
})).sort((a, b) => a.n - b.n);

fs.writeFileSync(path.join(ROOT, 'client', 'web', 'js', 'cards.js'),
  '// Riftbound OGN card DB (data via Riftcodex API, KR fan translation)\n' +
  'const CARDS=' + JSON.stringify(db) + ';\nconst CARD_BY_N={};CARDS.forEach(c=>CARD_BY_N[c.n]=c);\n');

fs.writeFileSync(path.join(ROOT, 'server', 'cards.json'),
  JSON.stringify(db.map(c => ({ n: c.n, type: c.type, super: c.super }))));

console.log(`생성 완료: client/web/js/cards.js (${db.length}장), server/cards.json`);
