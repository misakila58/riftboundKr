// 최소 preload — 앱 버전과 리플레이 파일 보관함만 렌더러에 안전하게 노출한다.
// (sandbox:true 이므로 파일 접근은 전부 메인 프로세스 IPC를 경유한다.)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  version: process.versions.electron,
  // 리플레이(.rbr) 보관함 — 문서 폴더의 RiftboundSim/Replays
  replay: {
    dir:      ()                => ipcRenderer.invoke('replay:dir'),
    list:     ()                => ipcRenderer.invoke('replay:list'),
    save:     (name, bytes)     => ipcRenderer.invoke('replay:save', name, bytes),
    read:     (name)            => ipcRenderer.invoke('replay:read', name),
    del:      (name)            => ipcRenderer.invoke('replay:delete', name),
    openDir:  ()                => ipcRenderer.invoke('replay:openDir'),
    exportAs: (name, suggested) => ipcRenderer.invoke('replay:exportAs', name, suggested),
  },
});
