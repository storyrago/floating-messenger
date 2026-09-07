// preload-ig.js — 인스타 엔진 웹뷰의 preload. 페이지 스크립트보다 먼저 실행된다.
//
// 확장의 hook.js가 하던 일과 같다. 페이지가 여는 실시간 WebSocket을 감싸서
// "프레임이 도착했다"는 사실만 메인 프로세스에 알린다. 페이로드는 해석하지 않는다.
// docs/02 §7.1 · ADR-003 · ADR-010
//
// 보안 메모: 이 웹뷰는 contextIsolation:false 로 뜬다. 그래야 페이지의 window.WebSocket을
// 감쌀 수 있다. 대신 ipcRenderer는 아래 클로저 밖으로 절대 내보내지 않는다. window에
// 아무것도 붙이지 않으므로 페이지 스크립트가 집을 수 있는 손잡이가 없다.
(() => {
  'use strict';
  const { ipcRenderer } = require('electron');

  // 2026-09-07 관찰: instagram.com/direct 는 소켓 5개를 연다.
  //   wss://edge-chat.instagram.com/chat            (MQTT)
  //   wss://gateway.instagram.com/ws/{rpsignaling,lightspeed,realtime,streamcontroller}
  // DM이 어느 소켓으로 오는지는 아직 확정 전이라 전부 감시하고, 어느 것이 울렸는지
  // 메인에 같이 보낸다. 확정되면 이 정규식을 좁힌다. docs/02 §9.1
  const WATCH = /edge-chat|gateway\.instagram\.com\/ws\//i;

  const Orig = window.WebSocket;
  if (!Orig || Orig.__buoyHooked) return;

  window.WebSocket = new Proxy(Orig, {
    construct(target, args) {
      const ws = new target(...args);
      const url = String(args[0] ?? '');
      if (WATCH.test(url)) {
        const name = url.replace(/^wss?:\/\//, '').split('?')[0]; // 쿼리에 세션 식별자가 있어 버린다
        ipcRenderer.send('ig:socket-open', name);
        ws.addEventListener('message', (e) => {
          const size = typeof e.data === 'string' ? e.data.length : (e.data && e.data.byteLength) || 0;
          ipcRenderer.send('ig:ws-frame', { socket: name, size, t: Date.now() });
        });
      }
      return ws;
    },
  });

  Object.defineProperty(Orig, '__buoyHooked', { value: true });

  window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.send('ig:ready', { loggedIn: /(^|;\s*)ds_user_id=/.test(document.cookie), url: location.href });
  });
})();
