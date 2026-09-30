// 한글 카드명·텍스트 덮어쓰기 적용 — data/ko-overrides.json → client/web/js/cards.js (제자리 패치, 여러 번 실행해도 같다)
//   + data/ko-aliases.json → client/web/js/cardnames-alias.js (옛 이름으로 적은 덱 목록도 가져올 수 있게)
// 사용: node tools/apply-ko-overrides.js   (build-cards.js가 끝에서 자동 호출한다)
// 배경: cards.js는 원본(data/ogn_*.json + tr_out_batch*.json)보다 최신(에라타 텍스트·이미지 주소)이라 재생성으로는 관리하지 않는다.
//       카드명 표기는 롤딱닷컴(lolttak.com, mtg-kr.com 카드 DB) 기준 (2026-09-30).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OV = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ko-overrides.json'), 'utf8'));
const AL = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ko-aliases.json'), 'utf8'));
const file = path.join(ROOT, 'client', 'web', 'js', 'cards.js');
const src = fs.readFileSync(file, 'utf8');
const m = src.match(/^(.*?const CARDS=)(\[.*?\]);(.*)$/s);
if (!m) throw new Error('cards.js 형식을 알 수 없습니다');
const cards = JSON.parse(m[2]);
let nameN = 0, textN = 0, fixN = 0;
for (const c of cards) {
  const nk = OV.names[c.n]; if (nk && c.ko !== nk) { c.ko = nk; nameN++; }
  const tk = OV.texts[c.n]; if (tk && c.tko !== tk) { c.tko = tk; textN++; }
  for (const [a, b] of OV.fixes || []) if (c.tko && c.tko.includes(a)) { c.tko = c.tko.split(a).join(b); fixN++; }
}
fs.writeFileSync(file, m[1] + JSON.stringify(cards) + ';' + m[3]);
const alias = {}; for (const [n, arr] of Object.entries(AL.aliases)) alias[n] = arr;
fs.writeFileSync(path.join(ROOT, 'client', 'web', 'js', 'cardnames-alias.js'),
  '// 옛 한글 카드명 (2026-09-30 롤딱닷컴 표기로 바꾸기 전) — 덱 목록(레시피) 가져오기에서 옛 이름도 받아 준다. tools/apply-ko-overrides.js가 생성\n' +
  'const CARD_KO_ALIASES=' + JSON.stringify(alias) + ';\n');
console.log(`ko-overrides 적용: 이름 ${nameN}건 · 텍스트 ${textN}건 · 치환 ${fixN}건 · 별칭 ${Object.keys(alias).length}장 → cards.js, cardnames-alias.js`);
