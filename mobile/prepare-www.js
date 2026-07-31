// client/web → mobile/www 복사 (APK에 번들되는 웹앱)
// 서버 없이 실행되므로 그대로 복사만 하면 된다. (봇/핫시트/튜토리얼/P2P는 전부 클라이언트 로직)
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'client', 'web');
const DST = path.join(__dirname, 'www');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

fs.rmSync(DST, { recursive: true, force: true });
copyDir(SRC, DST);
console.log('www 준비 완료: ' + DST);
