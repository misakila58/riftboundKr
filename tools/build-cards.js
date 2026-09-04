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
// OGS(증명의 전장, Origins: Proving Grounds) 24장 — n은 300+수집번호(301~324)로 부여해 OGN과 충돌하지 않게 한다
const OGS_OFFSET = 300;
const ogsFile = path.join(DATA, 'ogs_base.json');
const ogs = fs.existsSync(ogsFile) ? JSON.parse(fs.readFileSync(ogsFile, 'utf8')) : [];
ogs.forEach(c => { c.collector_number += OGS_OFFSET; });
const ko = {};
for (let i = 1; i <= 6; i++) {
  const f = path.join(DATA, `tr_out_batch${i}.json`);
  if (fs.existsSync(f)) JSON.parse(fs.readFileSync(f, 'utf8')).forEach(e => ko[e.n] = e);
}
// 대체 일러스트 (같은 카드의 다른 그림) — tools/fetch-alts.js 가 생성
const altsFile = path.join(DATA, 'alts.json');
const ALTS = fs.existsSync(altsFile) ? JSON.parse(fs.readFileSync(altsFile, 'utf8')) : {};

const koOgs = path.join(DATA, 'tr_out_ogs.json');
if (fs.existsSync(koOgs)) JSON.parse(fs.readFileSync(koOgs, 'utf8')).forEach(e => ko[e.n] = e);

const db = base.concat(ogs).map(c => ({
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
  // 같은 효과의 다른 일러스트 (없으면 필드를 넣지 않아 파일이 커지지 않게)
  ...(ALTS[c.collector_number] ? { alts: ALTS[c.collector_number] } : {}),
})).sort((a, b) => a.n - b.n);

fs.writeFileSync(path.join(ROOT, 'client', 'web', 'js', 'cards.js'),
  '// Riftbound OGN card DB (data via Riftcodex API, KR fan translation)\n' +
  'const CARDS=' + JSON.stringify(db) + ';\nconst CARD_BY_N={};CARDS.forEach(c=>CARD_BY_N[c.n]=c);\n');

// 서버 검증용 — 시그니처 카드는 전설 태그 일치 검사가 필요해서 태그를 함께 싣는다
fs.writeFileSync(path.join(ROOT, 'server', 'cards.json'),
  JSON.stringify(db.map(c => {
    const e = { n: c.n, type: c.type, super: c.super };
    if (c.super === 'Signature' || c.type === 'Legend') e.tags = c.tags;
    return e;
  })));

const altCount = db.reduce((s, c) => s + (c.alts ? c.alts.length : 0), 0);
console.log(`생성 완료: client/web/js/cards.js (${db.length}장, 대체 일러스트 ${altCount}장), server/cards.json`);
