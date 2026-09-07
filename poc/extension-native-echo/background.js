// E3 확장: 아이콘 클릭 → 호스트 연결 → HELLO/PING/LIST_ROOMS/SEND → 결과를 배지와 콘솔에.
// 서비스워커 콘솔: chrome://extensions → 이 확장의 "서비스 워커" 링크.
importScripts('lib/native-port.js');

const HOST = 'com.buoy.kakao';
const SEND_TEXT = 'buoy e3 test';
let link = null;

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
}

async function runCheck() {
  badge('…', '#888888');
  if (link) { link.stop(); link = null; }
  const t0 = performance.now();
  const stamp = () => `+${(performance.now() - t0).toFixed(0)}ms`;

  link = BuoyNativeLink.createNativeLink({
    connect: () => chrome.runtime.connectNative(HOST),
    getLastError: () => (chrome.runtime.lastError ? chrome.runtime.lastError.message : null),
    maxAttempts: 1,
    onState: (s) => console.log('[e3][state]', stamp(), s),
    onEvent: (m) => console.log('[e3][event]', stamp(), m),
  });
  link.start();

  // HELLO_ACK 대기 (최대 5초)
  const connected = await waitFor(() => link.status === 'connected' || link.status === 'stopped', 5500);
  if (!connected || link.status !== 'connected') {
    console.error('[e3] 연결 실패. 등록(register.ps1), 확장 ID, host.bat 경로, 로그 파일을 확인하세요.');
    return badge('ERR', '#E5484D');
  }
  console.log('[e3] adapter =', link.adapter, 'caps =', link.caps);

  try {
    const pong = await link.ping();
    console.log('[e3] PONG', stamp(), pong);
    const rooms = (await link.listRooms()).rooms;
    console.log('[e3] ROOMS', stamp(), rooms);
    if (!rooms.length) { console.warn('[e3] 방이 없어 SEND 생략 (windows: 채팅창을 열어 두세요)'); return badge('NOROOM', '#E8A33D'); }
    const t1 = performance.now();
    const res = await link.send(rooms[0].id, SEND_TEXT);
    console.log('[e3] SEND_RESULT', `${(performance.now() - t1).toFixed(0)}ms`, res);
    badge(res.ok ? 'OK' : 'SENDX', res.ok ? '#2BB673' : '#E5484D');
  } catch (e) {
    console.error('[e3] 실패:', e.message);
    badge('ERR', '#E5484D');
  }
  // 연결은 유지해 ITEM 이벤트(폰에서 보낸 메시지)가 콘솔에 찍히는지 본다. 다시 클릭하면 재검사.
}

function waitFor(pred, ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const id = setInterval(() => {
      if (pred()) { clearInterval(id); resolve(true); }
      else if (Date.now() - started > ms) { clearInterval(id); resolve(false); }
    }, 50);
  });
}

chrome.action.onClicked.addListener(() => { runCheck(); });
