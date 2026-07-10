// 최소 preload — 앱 버전 정도만 렌더러에 안전하게 노출한다.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  version: process.versions.electron,
});
