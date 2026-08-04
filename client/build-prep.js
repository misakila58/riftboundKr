// 빌드 준비 — npm run dist 시 predist 훅으로 자동 실행된다.
// 1) package.json 패치 버전 +1  2) web/js/buildinfo.js에 버전·빌드 일시 기록
// 3) 카드 이미지 로컬 캐시 확보 (없는 것만 받음 — 실패해도 CDN 폴백이 있으므로 빌드는 계속)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

// 카드 이미지: 앱에 포함해 오프라인·즉시 로딩이 되게 한다. 네트워크가 없으면 건너뛰고 CDN을 쓴다.
const fetcher = path.join(__dirname, '..', 'tools', 'fetch-card-images.js');
if (fs.existsSync(fetcher)) {
  const r = spawnSync(process.execPath, [fetcher, '--quiet'], { stdio: 'inherit' });
  if (r.status !== 0) console.warn('⚠ 카드 이미지 준비 실패 — 이번 빌드는 Riot CDN에서 이미지를 불러옵니다');
}
