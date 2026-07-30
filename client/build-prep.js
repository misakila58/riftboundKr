// 빌드 준비 — npm run dist 시 predist 훅으로 자동 실행된다.
// 1) package.json 패치 버전 +1  2) web/js/buildinfo.js에 버전·빌드 일시 기록
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const v = pkg.version.split('.').map(Number);
v[2]++;
pkg.version = v.join('.');
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const built = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
fs.writeFileSync(path.join(__dirname, 'web', 'js', 'buildinfo.js'),
  `// 생성물: build-prep.js가 빌드 시 자동 갱신 (직접 수정 금지)\nconst BUILDINFO={version:"${pkg.version}",built:"${built}"};\n`);

console.log(`build-prep: v${pkg.version} (${built})`);
