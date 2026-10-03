#!/usr/bin/env node
// ══════════ 운영자용 비밀번호 재설정 ══════════
// 비밀번호는 원문이 아니라 해시로만 저장되므로 '알려 주기'는 불가능하다 — 새 비밀번호로 바꿔 주는 것만 가능.
// 서버 컴퓨터에서 실행한다 (서버가 같은 컴퓨터에서 돌고 있어야 함):
//   node reset-password.js <아이디> [포트]        예) cd /opt/riftbound && node reset-password.js abcd
// 새 비밀번호는 화면에 표시하지 않고 두 번 입력받는다. 바꾸면 그 계정의 기존 로그인은 모두 끊긴다(등급 기록·저장 덱은 그대로).
// 서버는 이 컴퓨터에서 직접 보낸 요청 + data/admin-secret.txt의 비밀값이 맞을 때만 받는다.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), readline = require('readline');

const id = process.argv[2];
const port = +(process.argv[3] || process.env.PORT || 8321);
if (!id) { console.log('사용법: node reset-password.js <아이디> [포트]'); process.exit(1); }

let secret = '';
try { secret = fs.readFileSync(path.join(__dirname, 'data', 'admin-secret.txt'), 'utf8').trim(); }
catch (e) { console.error('data/admin-secret.txt를 읽지 못했습니다 — 서버를 한 번 실행한 뒤, 서버 폴더에서 실행하세요.'); process.exit(1); }

// 입력을 화면에 찍지 않는 프롬프트
function askHidden(q) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}

(async () => {
  console.log(`계정 「${id}」의 비밀번호를 새로 정합니다 (8~128자).`);
  const a = await askHidden('새 비밀번호: ');
  const b = await askHidden('한 번 더: ');
  if (a !== b) { console.error('두 입력이 다릅니다. 바꾸지 않았습니다.'); process.exit(1); }
  const body = JSON.stringify({ id, pw: a });
  const req = http.request({ host: '127.0.0.1', port, path: '/api/admin/reset-password', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-admin-secret': secret } }, r => {
    let s = ''; r.on('data', d => s += d); r.on('end', () => {
      let j = {}; try { j = JSON.parse(s); } catch (e) {}
      if (r.statusCode === 200) console.log(`✅ 「${id}」 비밀번호를 바꿨습니다. 기존 로그인 ${j.sessions || 0}개를 끊었습니다. 새 비밀번호를 본인에게만 안전한 방법(개인 메시지 등)으로 전달하세요.`);
      else { console.error(`❌ 실패 (${r.statusCode}): ${j.error || s}`); process.exit(1); }
    });
  });
  req.on('error', e => { console.error('서버에 연결하지 못했습니다:', e.message); process.exit(1); });
  req.end(body);
})();
