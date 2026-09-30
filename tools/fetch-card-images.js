// ══════════ 카드 이미지 로컬 캐시 받기 ══════════
// Riot CDN(Sanity)에서 카드 이미지를 webp로 받아 client/web/assets/cards/ 에 저장하고,
// 클라이언트가 참조할 목록(web/js/imgmap.js)을 만든다.
// 실행 중에는 CDN을 전혀 쓰지 않는다 (파일이 없을 때만 CDN 폴백 — 안전망).
//
// 두 가지를 받는다:
//   <키>.webp       보드/손패용 (기본 480w) — 작은 칸에 여러 장 그려도 가볍게
//   <키>.full.webp  확대·전설 미리보기용 (원본 해상도) — 크게 봐도 선명하게
//
//   node tools/fetch-card-images.js          이미 받은 건 건너뜀
//   node tools/fetch-card-images.js --force  전부 다시 받음
//   node tools/fetch-card-images.js --width 600
//   node tools/fetch-card-images.js --no-ko  한글판 이미지는 건너뜀
//
// 한글판(2026-09-30): 롤딱닷컴 카드 DB(mtg-kr.com/cardimage/rbtcg<코드>-ko.png)의 한글판 PNG를 받아 sharp로 webp 변환 →
//   assets/cards/ko/<코드>.webp · <코드>.full.webp. 영문 키→코드 매핑은 tools/data/ko-image-codes.json.
//   sharp는 tools/package.json 의존성(없으면 한글판만 건너뛰고 영문판으로 동작). 전장은 한글판이 세로로 눕혀 있어 가로로 돌린다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CARDS_JS = path.join(ROOT, 'client', 'web', 'js', 'cards.js');
const OUT_DIR = path.join(ROOT, 'client', 'web', 'assets', 'cards');
const MAP_JS = path.join(ROOT, 'client', 'web', 'js', 'imgmap.js');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const WIDTH = (() => { const i = args.indexOf('--width'); return i >= 0 ? +args[i + 1] : 480; })();
const CONCURRENCY = 8;
const QUIET = args.includes('--quiet');
const NO_KO = args.includes('--no-ko');
const KO_DIR = path.join(OUT_DIR, 'ko');
const KO_CODES = path.join(ROOT, 'tools', 'data', 'ko-image-codes.json');
const KO_URL = code => `https://mtg-kr.com/cardimage/rbtcg${code}-ko.png`;

// URL에서 안정적인 파일 키를 뽑는다 (Sanity 자산 해시 + 원본 크기)
function imgKey(url) {
  const m = String(url).match(/\/([0-9a-f]{20,}-\d+x\d+)\.(?:png|jpe?g|webp)/i);
  return m ? m[1] : null;
}

function loadCards() {
  const src = fs.readFileSync(CARDS_JS, 'utf8');
  return new Function(src + '\nreturn CARDS;')();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) throw new Error('too small (' + buf.length + 'B)');
  fs.writeFileSync(dest, buf);
  return buf.length;
}

(async () => {
  const cards = loadCards();
  // 토큰 카드 일러스트(loc.js TOKEN_IMG)도 함께 받는다 — 보드의 신병·정령 토큰이 쓴다
  let tokenUrls = [];
  try {
    const loc = fs.readFileSync(path.join(ROOT, 'client', 'web', 'js', 'loc.js'), 'utf8');
    const tm = new Function(loc + '\nreturn TOKEN_IMG;')();
    tokenUrls = Object.values(tm).flatMap(v => Object.values(v));
  } catch (e) { console.warn('토큰 이미지 목록을 읽지 못함:', e.message); }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 같은 이미지를 여러 카드가 공유할 수 있으므로 키 기준으로 중복 제거
  const jobs = new Map();
  let noKey = 0;
  for (const c of [...cards, { img: null, alts: tokenUrls }]) {
    // 기본 일러스트 + 같은 카드의 대체 일러스트(alts)를 모두 받는다 (+ 토큰 일러스트)
    for (const url of [c.img, ...(c.alts || [])]) {
      if (!url) continue;
      const key = imgKey(url);
      if (!key) { noKey++; continue; }
      if (!jobs.has(key)) jobs.set(key, url);
    }
  }
  console.log(`카드 ${cards.length}장 · 내려받을 이미지 ${jobs.size}종 (w=${WIDTH})${noKey ? ` · URL 형식 불일치 ${noKey}건` : ''}`);

  const entries = [...jobs.entries()];
  const failed = [];
  let skipped = 0, idx = 0, doneCount = 0;

  // 한 종류(작은 판/원본 판)를 확보한다
  async function ensure(url, dest, query) {
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 512) { skipped++; return true; }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { await download(url + (url.includes('?') ? '&' : '?') + query, dest); return true; }
      catch (e) {
        if (attempt === 3) { failed.push({ file: path.basename(dest), err: e.message }); return false; }
        await new Promise(r => setTimeout(r, 400 * attempt));
      }
    }
    return false;
  }

  async function worker() {
    while (idx < entries.length) {
      const [key, url] = entries[idx++];
      await ensure(url, path.join(OUT_DIR, key + '.webp'), `fm=webp&q=82&w=${WIDTH}`);
      // 원본 해상도(폭 지정 없음) — 확대해서 봐도 선명하도록
      await ensure(url, path.join(OUT_DIR, key + '.full.webp'), 'fm=webp&q=92');
      doneCount++;
      if (!QUIET && doneCount % 25 === 0) console.log(`  ${doneCount}/${entries.length} ...`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ── 한글판 ── 실패한 카드는 목록에서 빠져 영문판으로 표시된다
  const koMap = {};
  if (!NO_KO) {
    let sharp = null;
    try { sharp = require('sharp'); } catch (e) { console.warn('⚠ sharp 없음 — 한글판 카드 이미지를 건너뜁니다 (cd tools && npm install)'); }
    let codes = {};
    try { codes = JSON.parse(fs.readFileSync(KO_CODES, 'utf8')).codes || {}; } catch (e) { console.warn('⚠ 한글판 매핑 파일을 읽지 못함:', e.message); }
    if (sharp && Object.keys(codes).length) {
      fs.mkdirSync(KO_DIR, { recursive: true });
      const koJobs = new Map();   // 코드 → 영문 키들 (같은 한글 그림을 여러 키가 쓸 수 있다)
      for (const key of jobs.keys()) if (codes[key]) { if (!koJobs.has(codes[key])) koJobs.set(codes[key], []); koJobs.get(codes[key]).push(key); }
      const list = [...koJobs.entries()]; let ki = 0, koMade = 0; const koFailed = [];
      const isLandscape = key => { const m = key.match(/-(\d+)x(\d+)$/); return m && +m[1] > +m[2]; };
      async function koWorker() {
        while (ki < list.length) {
          const [code, keys] = list[ki++];
          const small = path.join(KO_DIR, code + '.webp'), full = path.join(KO_DIR, code + '.full.webp');
          const have = f => fs.existsSync(f) && fs.statSync(f).size > 512;
          if (!FORCE && have(small) && have(full)) { skipped += 2; keys.forEach(k => koMap[k] = code); continue; }
          let buf = null;
          for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
            try {
              const res = await fetch(KO_URL(code));
              if (!res.ok) throw new Error('HTTP ' + res.status);
              const b = Buffer.from(await res.arrayBuffer());
              if (b.length < 1024 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 아님');
              buf = b;
            } catch (e) { if (attempt === 3) koFailed.push(code + ' — ' + e.message); else await new Promise(r => setTimeout(r, 500 * attempt)); }
          }
          if (!buf) continue;
          try {
            const meta = await sharp(buf).metadata();
            const rotate = keys.some(isLandscape) && meta.height > meta.width ? 90 : 0;   // 전장: 한글판은 세로로 눕힌 그림
            await sharp(buf).rotate(rotate).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toFile(small);
            await sharp(buf).rotate(rotate).webp({ quality: 90 }).toFile(full);
            keys.forEach(k => koMap[k] = code); koMade++;
            if (!QUIET && koMade % 25 === 0) console.log(`  한글판 ${koMade}/${list.length} ...`);
          } catch (e) { koFailed.push(code + ' — 변환 실패 ' + e.message); }
        }
      }
      await Promise.all(Array.from({ length: 4 }, koWorker));   // 남의 서버라 동시 4개로 천천히
      console.log(`  한글판 ${Object.keys(koMap).length}/${[...jobs.keys()].filter(k => codes[k]).length}종 (새로 변환 ${koMade})${koFailed.length ? ' · 실패 ' + koFailed.length + ': ' + koFailed.slice(0, 5).join(', ') : ''}`);
    }
  }

  // 실제로 존재하는 파일만 목록에 넣는다 (일부 실패 시 그 카드만 CDN으로 넘어가게)
  const ok = f => { try { return fs.statSync(path.join(OUT_DIR, f)).size > 512; } catch (e) { return false; } };
  const have = [...jobs.keys()].filter(k => ok(k + '.webp')).sort();
  const haveFull = [...jobs.keys()].filter(k => ok(k + '.full.webp')).sort();
  fs.writeFileSync(MAP_JS,
    '// 생성물: tools/fetch-card-images.js 가 만든다 (직접 수정 금지)\n' +
    '// 앱에 포함된 로컬 이미지 목록. 실행 중에는 CDN을 쓰지 않으며, 여기 없는 것만 CDN으로 폴백한다.\n' +
    '//   files = 보드/손패용(작은 판) · full = 확대·미리보기용(원본 해상도) · ko = 영문 키 → 한글판 코드(ko/<코드>.webp·.full.webp)\n' +
    `const IMG_LOCAL={dir:'assets/cards/',w:${WIDTH},` +
    `files:{${have.map(k => JSON.stringify(k) + ':1').join(',')}},` +
    `full:{${haveFull.map(k => JSON.stringify(k) + ':1').join(',')}},` +
    `ko:{${Object.keys(koMap).sort().map(k => JSON.stringify(k) + ':' + JSON.stringify(koMap[k])).join(',')}}};\n`);
  console.log(`  작은 판 ${have.length}종 · 원본 판 ${haveFull.length}종`);

  // 합계는 카운터 대신 실제 디스크에서 잰다 (재시도·건너뜀이 섞여도 정확하게)
  let total = 0;
  for (const d of [OUT_DIR, KO_DIR]) { if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d)) { try { const st = fs.statSync(path.join(d, f)); if (st.isFile()) total += st.size; } catch (e) {} } }
  const mb = (total / 1048576).toFixed(1);
  console.log(`완료: 카드 ${entries.length}종 (이미 있어 건너뜀 ${skipped}개 파일) · 합계 ${mb}MB`);
  console.log(`  이미지: ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`  목록  : ${path.relative(ROOT, MAP_JS)}`);
  if (failed.length) {
    console.log(`⚠ 실패 ${failed.length}종 (해당 카드는 CDN에서 불러옵니다):`);
    failed.slice(0, 10).forEach(f => console.log(`   ${f.key} — ${f.err}`));
  }
})().catch(e => { console.error('이미지 받기 실패:', e.message); process.exit(1); });
