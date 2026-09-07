// background.js — 서비스워커. 이 단계(I-M2)는 패널 포트·배지·툴바만 담당한다.
// 데이터는 아래 MOCK이 낸다. I-M1에서 InstagramProvider가, M5에서 KakaoProvider가
// 그 자리를 대체한다(docs/02 §4). 포트·브로드캐스트·배지 코드는 그대로 쓴다.
// docs/02 §6.1, §7.4, §7.5, §7.7
'use strict';

const THREADS_COALESCE_MS = 500; // docs/02 §11

/** @type {Set<chrome.runtime.Port>} */
const panels = new Set();
const openThreadByPort = new Map();

// ponytail: I-M2 동안만 쓰는 고정 데이터. I-M0·I-M1이 끝나면 InstagramProvider의
// INBOX 이벤트가 이 자리를 대체한다. 실제 계정 데이터가 아니다.
const MOCK = (() => {
  const now = Date.now();
  const min = 60 * 1000;
  const providers = {
    instagram: { status: 'connected', detail: null, caps: { send: true, seen: true, history: true, rooms: true }, enabled: true },
    kakao: { status: 'degraded', detail: '채팅창이 열린 방에만 보낼 수 있어요', caps: { send: true, seen: false, history: false, rooms: true }, enabled: true },
  };
  const threads = [
    {
      id: 'instagram:t1', rawId: 't1', provider: 'instagram', title: '김서연',
      users: [{ id: '2001', username: 'seoyeon', name: '김서연' }], isGroup: false, unread: true,
      lastActivity: now - 2 * min,
      items: [
        { id: 'i1', provider: 'instagram', userId: '1', fromMe: true, type: 'text', text: '내일 발표 자료 다 됐어?', ts: now - 90 * min },
        { id: 'i2', provider: 'instagram', userId: '2001', fromMe: false, type: 'text', text: '거의. 마지막 장만 남았어', ts: now - 88 * min },
        { id: 'i3', provider: 'instagram', userId: '2001', fromMe: false, type: 'media', text: '[사진]', ts: now - 3 * min },
        { id: 'i4', provider: 'instagram', userId: '2001', fromMe: false, type: 'text', text: '이렇게 정리했는데 어때', ts: now - 2 * min },
      ],
    },
    {
      id: 'kakao:스터디', rawId: '스터디', provider: 'kakao', title: '스터디',
      users: [{ id: '박지호', username: '박지호', name: '박지호' }, { id: '이레', username: '이레', name: '이레' }],
      isGroup: true, unread: true, lastActivity: now - 26 * min,
      items: [
        { id: 'k1', provider: 'kakao', userId: '박지호', fromMe: false, type: 'text', text: '오늘 8시 그대로죠?', ts: now - 28 * min, source: 'toast' },
        { id: 'k2', provider: 'kakao', userId: '이레', fromMe: false, type: 'text', text: '네 링크 곧 올릴게요', ts: now - 26 * min, source: 'toast' },
      ],
    },
    {
      id: 'instagram:t2', rawId: 't2', provider: 'instagram', title: '동아리 총무',
      users: [{ id: '2002', username: 'club', name: '동아리 총무' }], isGroup: false, unread: false,
      lastActivity: now - 5 * 60 * min,
      items: [
        { id: 'i5', provider: 'instagram', userId: '2002', fromMe: false, type: 'text', text: '회비 입금 확인했습니다', ts: now - 5 * 60 * min },
        { id: 'i6', provider: 'instagram', userId: '1', fromMe: true, type: 'text', text: '감사합니다', ts: now - 5 * 60 * min + 30000 },
      ],
    },
  ];
  for (const t of threads) t.last = t.items[t.items.length - 1];
  return { providers, threads };
})();

function snapshot() {
  const threads = [...MOCK.threads].sort((a, b) => b.lastActivity - a.lastActivity);
  const byProvider = {};
  let total = 0;
  for (const t of threads) {
    if (!t.unread) continue;
    total += 1;
    byProvider[t.provider] = (byProvider[t.provider] || 0) + 1;
  }
  return { providers: MOCK.providers, threads, unread: { total, byProvider } };
}

// ── 배지 ──
async function paintBadge(total) {
  try {
    await chrome.action.setBadgeText({ text: total > 99 ? '99+' : total > 0 ? String(total) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#E5484D' });
    await chrome.storage.session.set({ unread: total }); // widget.js가 읽는다
  } catch (e) {
    console.debug('[buoy] badge failed', e && e.message);
  }
}

// ── 패널 포트 ──
let broadcastTimer = null;

function broadcastThreads() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const s = snapshot();
    for (const p of panels) {
      try { p.postMessage({ type: 'THREADS', threads: s.threads, unread: s.unread }); } catch { panels.delete(p); }
    }
    paintBadge(s.unread.total);
  }, THREADS_COALESCE_MS);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  panels.add(port);
  const s = snapshot();
  try { port.postMessage({ type: 'STATE', providers: s.providers, threads: s.threads, unread: s.unread }); } catch { /* 이미 닫힘 */ }
  paintBadge(s.unread.total);

  port.onMessage.addListener((msg) => onPanelMessage(port, msg));
  port.onDisconnect.addListener(() => { panels.delete(port); openThreadByPort.delete(port); });
});

function onPanelMessage(port, msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'REFRESH':
      broadcastThreads();
      break;
    case 'THREAD': {
      const t = MOCK.threads.find((x) => x.id === msg.threadId);
      // caps.history가 있는 프로바이더는 서버에서 더 가져온다. mock은 캐시를 그대로 돌려준다.
      try { port.postMessage({ type: 'THREAD', reqId: msg.reqId, thread: t }); } catch { /* 닫힘 */ }
      break;
    }
    case 'SET_OPEN_THREAD':
      openThreadByPort.set(port, msg.threadId || null);
      break;
    case 'SEEN': {
      const t = MOCK.threads.find((x) => x.id === msg.threadId);
      if (t && t.unread) { t.unread = false; broadcastThreads(); }
      break;
    }
    case 'OPEN_INSTAGRAM':
      // 엔진 탭은 I-M1에서 만든다. 지금은 인스타를 새 탭으로 연다.
      chrome.tabs.create({ url: 'https://www.instagram.com/direct/inbox/' }).catch(() => {});
      break;
    case 'OPEN_HELP':
      console.debug('[buoy] help page is M6 work:', msg.provider);
      break;
    default:
      console.debug('[buoy] unknown panel message', msg.type);
  }
}

// ── 툴바 아이콘: 활성 탭 위젯 토글, 실패하면 팝업 창 (FR-06, docs/02 §7.5) ──
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const res = tab && tab.id != null ? await chrome.tabs.sendMessage(tab.id, { to: 'widget', type: 'TOGGLE' }) : null;
    if (res && res.ok) return;
  } catch { /* 콘텐츠 스크립트 없음 */ }
  chrome.windows.create({ url: chrome.runtime.getURL('panel.html?standalone=1'), type: 'popup', width: 400, height: 640 }).catch(() => {});
});

// ── 시작 ──
async function start() {
  try {
    // widget.js(콘텐츠 스크립트)가 unread를 읽으려면 매 시작마다 필요하다. docs/02 §13
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  } catch (e) {
    console.debug('[buoy] setAccessLevel failed', e && e.message);
  }
  paintBadge(snapshot().unread.total);
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
start();
