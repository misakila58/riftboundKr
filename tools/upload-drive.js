// ══════════ 빌드 결과를 구글 드라이브에 올리고 옛 버전을 정리한다 ══════════
//
//   node tools/upload-drive.js                 최신 버전 올리고 그 버전만 남긴다
//   node tools/upload-drive.js --keep 2        최근 2개 버전을 남긴다
//   node tools/upload-drive.js --dry-run       무엇을 올리고 지울지만 보여준다
//   node tools/upload-drive.js --remote "gdrive:다른폴더/"
//
// 올리는 것: 무설치판 exe + 같은 내용의 zip + 패치노트.
//   zip을 함께 두는 이유는 브라우저·메신저가 .exe 다운로드를 막는 경우가 있어서다.
// 지우는 것: 남길 개수를 넘는 옛 RiftboundSim-*.exe/.zip 만.
//   문서(빠른시작·사용가이드·패치노트)와 방금 올린 버전은 절대 건드리지 않는다.
//   rclone은 완전 삭제가 아니라 드라이브 휴지통으로 보낸다 (30일 안에 복구 가능).
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'client', 'dist');
const NOTES = path.join(ROOT, 'docs', '패치노트.txt');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(k);
const REMOTE = arg('--remote', 'gdrive:리프트바운드/');
const KEEP = Math.max(1, +arg('--keep', 1));
const DRY = has('--dry-run');

const say = (...a) => console.log(...a);
const die = m => { console.error('오류: ' + m); process.exit(1); };

// 버전 비교 (1.0.9 < 1.0.10)
const verKey = v => v.split('.').map(Number);
const verCmp = (a, b) => {
  const x = verKey(a), y = verKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
};

function rclone(args, { quiet } = {}) {
  const r = spawnSync('rclone', args, { encoding: 'utf8' });
  if (r.error) die('rclone을 찾을 수 없습니다 — 설치하고 gdrive 원격을 설정하세요');
  if (r.status !== 0 && !quiet) die('rclone 실패: ' + (r.stderr || '').trim());
  return (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
    .filter(l => !/NOTICE/.test(l));
}

// ---------- 무엇을 올릴지 ----------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'package.json'), 'utf8'));
const VER = pkg.version;
const exe = path.join(DIST, `RiftboundSim-${VER}-portable.exe`);
const zip = path.join(DIST, `RiftboundSim-${VER}-portable.zip`);

if (!fs.existsSync(exe)) die(`빌드 결과가 없습니다: ${path.basename(exe)}\n       먼저 client에서 npm run dist 를 실행하세요.`);

say(`업로드할 버전: v${VER}`);
say(`대상 폴더    : ${REMOTE}`);
say(`남길 버전 수 : ${KEEP}개` + (DRY ? '   (--dry-run: 실제로는 아무것도 하지 않습니다)' : ''));
say('');

// zip이 없거나 exe보다 오래됐으면 다시 만든다
const needZip = !fs.existsSync(zip) || fs.statSync(zip).mtimeMs < fs.statSync(exe).mtimeMs;
if (needZip) {
  if (DRY) say(`  [건너뜀] zip 생성: ${path.basename(zip)}`);
  else {
    say(`  zip 생성 중... (${path.basename(zip)})`);
    try {
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Compress-Archive -Path '${exe}' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`],
        { stdio: 'pipe' });
    } catch (e) { die('zip 생성 실패: ' + (e.stderr || e.message)); }
  }
}

// ---------- 올리기 ----------
const uploads = [exe, zip, ...(fs.existsSync(NOTES) ? [NOTES] : [])];
for (const f of uploads) {
  const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(0);
  if (DRY) { say(`  [건너뜀] 업로드: ${path.basename(f)} (${mb}MB)`); continue; }
  say(`  업로드: ${path.basename(f)} (${mb}MB)`);
  rclone(['copy', f, REMOTE, '--retries', '5', '--low-level-retries', '20']);
}
say('');

// ---------- 옛 버전 정리 ----------
// 원격에 있는 RiftboundSim-<버전>-portable.(exe|zip) 만 대상으로 삼는다.
const listed = rclone(['lsf', REMOTE]);
const byVer = new Map();
for (const name of listed) {
  const m = name.match(/^RiftboundSim-(\d+(?:\.\d+)*)-portable\.(exe|zip)$/);
  if (!m) continue;                       // 문서 등 다른 파일은 건드리지 않는다
  if (!byVer.has(m[1])) byVer.set(m[1], []);
  byVer.get(m[1]).push(name);
}
const versions = [...byVer.keys()].sort(verCmp).reverse();   // 최신 순
const keep = new Set(versions.slice(0, KEEP));
keep.add(VER);                                               // 방금 올린 것은 무조건 보존
const drop = versions.filter(v => !keep.has(v));

say(`원격 버전: ${versions.length ? versions.join(', ') : '(없음)'}`);
// 방금 올린 버전은 무조건 보존하므로, 실제로 남는 개수가 --keep보다 하나 많을 수 있다
const kept = [...keep].filter(v => byVer.has(v) || v === VER).sort(verCmp).reverse();
say(`남길 것  : ${kept.join(', ')} (${kept.length}개)`);

if (!drop.length) {
  say('지울 것  : 없음');
} else {
  say(`지울 것  : ${drop.join(', ')}`);
  for (const v of drop) {
    for (const name of byVer.get(v)) {
      if (DRY) { say(`  [건너뜀] 삭제: ${name}`); continue; }
      rclone(['deletefile', REMOTE + name]);
      say(`  삭제: ${name}`);
    }
  }
  say('  (완전 삭제가 아니라 드라이브 휴지통으로 갑니다 — 30일 안에 복구 가능)');
}

if (!DRY) {
  say('\n── 최종 목록 ──');
  rclone(['lsf', REMOTE]).forEach(n => say('  ' + n));
}
