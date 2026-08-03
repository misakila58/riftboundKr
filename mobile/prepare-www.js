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

// 안드로이드 매니페스트: 앱을 가로(landscape) 전용으로 고정 — 실행 시 자동으로 가로 전환.
// android/는 생성물(gitignore)이라 npx cap add android로 재생성될 때마다 여기서 다시 적용한다.
const manifest = path.join(__dirname, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifest)) {
  let xml = fs.readFileSync(manifest, 'utf8');
  if (!xml.includes('android:screenOrientation')) {
    xml = xml.replace(/<activity(\s)/, '<activity android:screenOrientation="sensorLandscape"$1');
    fs.writeFileSync(manifest, xml);
    console.log('AndroidManifest: 가로(sensorLandscape) 고정 적용');
  } else {
    console.log('AndroidManifest: 가로 고정 이미 적용됨');
  }
}

// MainActivity: 몰입 모드(상태바·내비게이션바 숨김, 스와이프 시 일시 표시) — 생성물이라 매번 덮어쓴다.
const mainActivity = path.join(__dirname, 'android', 'app', 'src', 'main', 'java', 'com', 'fan', 'riftboundsim', 'MainActivity.java');
if (fs.existsSync(mainActivity)) {
  fs.writeFileSync(mainActivity, `package com.fan.riftboundsim;

import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      // 몰입 모드: 상태바+내비바 숨김, 가장자리 스와이프 시 잠깐 표시
      getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
  }
}
`);
  console.log('MainActivity: 몰입 모드(풀스크린) 적용');
}
