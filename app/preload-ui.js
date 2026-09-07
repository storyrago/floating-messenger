// preload-ui.js — UI 창의 preload. 렌더러에 딱 두 개만 열어 준다.
// 확장에서 쓰던 chrome.runtime.connect 포트를 대체한다. 메시지 모양은 docs/02 §7.4 그대로.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buoy', {
  /** 렌더러 → 메인. { type, ... } */
  post: (msg) => ipcRenderer.send('ui:post', msg),
  /** 메인 → 렌더러. handler({ type, ... }) */
  onMessage: (handler) => {
    ipcRenderer.on('ui:msg', (_e, msg) => handler(msg));
    ipcRenderer.send('ui:ready');
  },
});
