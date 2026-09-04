// docs/패치노트.txt → client/web/js/patchnotes.js
// fetch로 읽으면 file:// 로 실행되는 데스크톱 앱에서 막히므로, 스크립트 상수로 심는다.
// 빌드 때 자동 실행된다 (client/build-prep.js · server/build-dist.js).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'docs', '패치노트.txt');
const DST = process.argv[2] || path.join(__dirname, '..', 'client', 'web', 'js', 'patchnotes.js');

if (!fs.existsSync(SRC)) {
  console.warn('⚠ 패치노트.txt 없음 — 건너뜀');
  process.exit(0);
}
const txt = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST,
  '// 생성물: tools/build-patchnotes.js가 docs/패치노트.txt에서 만든다 (직접 수정 금지)\n' +
  'const PATCHNOTES = ' + JSON.stringify(txt) + ';\n');
console.log(`patchnotes: ${txt.split('\n').length}줄 → ${path.relative(process.cwd(), DST)}`);
