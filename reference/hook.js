// hook.js — instagram.com 페이지의 MAIN world에서 document_start에 실행된다.
//
// 페이지가 여는 실시간 WebSocket(MQTT)을 가로채되, 페이로드는 해석하지 않는다.
// "프레임이 도착했다"는 사실만 ISOLATED world(ig-bridge.js)에 알려서
// inbox 재조회 트리거로 쓴다. 이렇게 하면 프로토콜 분석 없이도 거의 실시간이 된다.
(() => {
  const Orig = window.WebSocket;
  if (!Orig || Orig.__buoyHooked) return;

  const logged = new Set();

  window.WebSocket = new Proxy(Orig, {
    construct(target, args) {
      const ws = new target(...args);
      const url = String(args[0] ?? '');

      // 실시간 소켓 호스트가 바뀌었으면 DevTools > Network > WS 탭에서 확인하고 아래 정규식만 수정
      if (/edge-chat|mqtt/i.test(url)) {
        if (!logged.has(url)) {
          logged.add(url);
          console.debug('[buoy] realtime socket hooked:', url);
        }
        ws.addEventListener('message', () => {
          window.postMessage({ __buoy: true, type: 'IG_WS_FRAME', t: performance.now() }, location.origin);
        });
      }
      return ws;
    },
  });

  Object.defineProperty(Orig, '__buoyHooked', { value: true });
})();
