// 서버 배포 패키지 빌드: server/dist/ 에 서버 실행에 필요한 파일만 모은다.
// (웹/게임 UI는 별도의 Electron 클라이언트로 배포되므로 포함하지 않음)
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRV = __dirname;
const DIST = path.join(SRV, 'dist');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// 기존 exe 보존 (--exe 없을 때 재사용)
const exePath = path.join(DIST, 'riftbound-server.exe');
const exeBak = path.join(SRV, '.server.exe.bak');
if (fs.existsSync(exePath)) fs.copyFileSync(exePath, exeBak);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1) 서버 번들 (ws 포함 단일 파일)
console.log('서버 번들 생성 중...');
execSync(`npx --yes esbuild "${path.join(SRV, 'server.js')}" --bundle --platform=node --outfile="${path.join(DIST, 'riftbound-server.js')}"`, { stdio: 'inherit' });

// 2) 카드 검증 데이터
fs.copyFileSync(path.join(SRV, 'cards.json'), path.join(DIST, 'cards.json'));

// 3) 실행 도우미 (bat/가이드)
copyDir(path.join(SRV, 'dist-assets'), DIST);

// 3.5) 모바일/브라우저용 웹앱 (exe 옆 web/ 에 넣어 서버가 제공)
const webSrc = path.join(SRV, '..', 'client', 'web');
if (fs.existsSync(path.join(webSrc, 'index.html'))) {
  copyDir(webSrc, path.join(DIST, 'web'));
  console.log('웹앱 포함(web/): 모바일은 서버 주소를 브라우저로 열어 접속');
}

// 4) 독립 실행 파일
if (process.argv.includes('--exe')) {
  console.log('독립 실행 파일(.exe) 빌드 중...');
  execSync(`npx --yes pkg "${path.join(DIST, 'riftbound-server.js')}" --targets node18-win-x64 --output "${exePath}"`, { stdio: 'inherit' });
} else if (fs.existsSync(exeBak)) {
  fs.copyFileSync(exeBak, exePath);
  console.log('기존 riftbound-server.exe 재사용 (재빌드: node build-dist.js --exe)');
}
if (fs.existsSync(exeBak)) fs.rmSync(exeBak);

console.log('완료: ' + DIST);
console.log('이 폴더(server/dist)를 서버용 컴퓨터에 복사한 뒤 start-server.bat 을 실행하세요.');
