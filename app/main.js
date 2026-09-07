// main.js — Electron 메인 프로세스. 창 하나(UI) + 숨은 엔진 웹뷰(instagram.com).
// 확장의 background.js가 하던 일을 그대로 한다. docs/02 §4, §7.4 · ADR-010
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

const IG_PARTITION = 'persist:instagram';   // 로그인 세션을 디스크에 유지 (ADR-010)
const IG_URL = 'https://www.instagram.com/direct/inbox/';
const WS_DEBOUNCE_MS = 300;                 // docs/02 §11

// 2026-09-07 검증된 인스타 엔드포인트. 세션 쿠키 + 이 헤더로 200 application/json. docs/02 §9.1
const IG_APP_ID = '936619743392459';
const INBOX_PATH = '/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=20&thread_message_limit=10';

let ui = null;      // UI 창
let engine = null;  // 인스타 엔진 웹뷰(숨김)
let uiReady = false;

// ── 임시 데이터 ───────────────────────────────────────────────────────────────
// ponytail: 아직 인스타 응답의 실제 필드 모양을 확인하지 않았다(fixtures 미확보).
// docs/03 §1 "추측으로 채우지 않는다"에 따라 정규화를 쓰기 전까지 화면은 이 값으로 돈다.
// `probeInbox()`가 실제 응답의 키 목록만 찍어 주고, 그걸로 lib/normalize.js를 쓴 뒤 걷어낸다.
const MOCK = (() => {
  const now = Date.now();
  const min = 60 * 1000;
  const providers = {
    instagram: { status: 'connecting', detail: null, caps: { send: true, seen: true, history: true, rooms: true }, enabled: true },
    kakao: { status: 'disconnected', detail: '호스트 연결은 다음 단계', caps: { send: false, seen: false, history: false, rooms: false }, enabled: true },
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

function toUI(msg) {
  if (ui && !ui.isDestroyed() && uiReady) ui.webContents.send('ui:msg', msg);
}

function setStatus(provider, status, detail) {
  const p = MOCK.providers[provider];
  if (!p) return;
  p.status = status;
  p.detail = detail || null;
  toUI({ type: 'STATUS', provider, status, detail: p.detail, caps: p.caps });
}

// ── 창 ───────────────────────────────────────────────────────────────────────
function createUI() {
  ui = new BrowserWindow({
    width: 400,
    height: 700,
    minWidth: 360,
    minHeight: 480,
    title: 'Floating Messenger',
    icon: path.join(__dirname, '..', 'icons', '128.png'),
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  ui.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  ui.on('closed', () => { ui = null; uiReady = false; });
}

function createEngine() {
  engine = new BrowserWindow({
    show: false,               // 로그인이 필요할 때만 보여 준다
    width: 1000,
    height: 800,
    title: 'Instagram (buoy engine)',
    webPreferences: {
      preload: path.join(__dirname, 'preload-ig.js'),
      partition: IG_PARTITION,
      // 페이지의 window.WebSocket을 감싸려면 격리를 꺼야 한다. preload-ig.js 상단 보안 메모 참고.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const wc = engine.webContents;

  // 메인 프레임 응답 감시. 429가 빈 본문으로 오기 때문에(2026-09-07 확인) 상태 코드를 보지 않으면
  // 흰 화면만 남는다. docs/02 §9.1 · docs/01 FR-05
  wc.session.webRequest.onHeadersReceived({ urls: ['https://*.instagram.com/*'] }, (d, cb) => {
    if (d.resourceType === 'mainFrame') onEngineResponse(d.statusCode, d.url);
    cb({});
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) {
      console.log('[buoy] engine load failed', code, desc);
      setStatus('instagram', 'disconnected', desc);
    }
  });
  wc.on('render-process-gone', (_e, d) => setStatus('instagram', 'error', d && d.reason));

  // 신원 문자열(User-Agent)은 Electron 기본값 그대로 둔다. 흰 화면의 원인이 429였음이
  // 확인됐으므로 UA를 손댈 근거가 없다. 제한이 풀린 뒤에도 페이지가 안 그려지면 그때 다시 본다.
  engine.loadURL(IG_URL);
  // 사용자가 로그인 창을 닫아도 앱은 살아 있어야 한다. 숨기기만 한다.
  engine.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); engine.hide(); }
  });
  // 인스타 밖 링크는 기본 브라우저로
  engine.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https:\/\/(www\.)?instagram\.com/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

// ── 인스타 조회 ───────────────────────────────────────────────────────────────
/** 엔진 웹뷰 안에서 같은 오리진 fetch. 쿠키는 크로미움이 붙인다. docs/02 §2 */
async function igFetch(pathname) {
  if (!engine || engine.isDestroyed()) throw new Error('engine_unavailable');
  const code = `(async () => {
    const r = await fetch(${JSON.stringify(pathname)}, {
      headers: { 'x-ig-app-id': ${JSON.stringify(IG_APP_ID)}, 'x-requested-with': 'XMLHttpRequest' },
      credentials: 'include',
    });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, type, body: r.ok && type.includes('json') ? await r.json() : null };
  })()`;
  return engine.webContents.executeJavaScript(code, true);
}

/**
 * 응답의 "모양"만 본다. 이름·본문은 절대 찍지 않는다.
 * 이 출력으로 lib/normalize.js를 쓰고 나면 이 함수는 지운다. docs/03 §1
 */
async function probeInbox() {
  try {
    const res = await igFetch(INBOX_PATH);
    // 429가 text/html로 오므로 상태 코드를 먼저 본다. docs/02 §9.1
    if (res.status === 429) return setStatus('instagram', 'rate_limited', '요청 제한');
    if (res.status === 401 || res.status === 403) return setStatus('instagram', 'logged_out');
    if (!res.body) return setStatus('instagram', 'error', `http_${res.status}`);

    const inbox = res.body.inbox || {};
    const t0 = (inbox.threads || [])[0] || {};
    const i0 = (t0.items || [])[0] || {};
    console.log('[buoy] inbox shape', {
      top: Object.keys(res.body),
      inbox: Object.keys(inbox),
      threadCount: (inbox.threads || []).length,
      thread: Object.keys(t0),
      item: Object.keys(i0),
      itemTypeSample: i0.item_type,
      timestampDigits: String(i0.timestamp || '').length,
      lastActivityDigits: String(t0.last_activity_at || '').length,
      readStateSample: t0.read_state,
      viewer: Object.keys(res.body.viewer || {}),
    });
    setStatus('instagram', 'connected');
  } catch (e) {
    setStatus('instagram', 'error', String(e && e.message));
  }
}

// ── 엔진 응답 판정과 백오프 ────────────────────────────────────────────────────
// docs/02 §11: 429 쿨다운 30초, 연속되면 2배씩 최대 5분, 성공하면 초기화.
const COOLDOWN_MIN_MS = 30_000;
const COOLDOWN_MAX_MS = 5 * 60_000;
let cooldownMs = COOLDOWN_MIN_MS;
let cooldownTimer = null;

function onEngineResponse(status, url) {
  if (status === 429) {
    setStatus('instagram', 'rate_limited', `요청 제한 — ${Math.round(cooldownMs / 1000)}초 뒤 다시 시도해요`);
    console.log('[buoy] engine 429, retry in %ds', Math.round(cooldownMs / 1000));
    clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => {
      if (engine && !engine.isDestroyed()) engine.webContents.loadURL(IG_URL);
    }, cooldownMs);
    cooldownMs = Math.min(cooldownMs * 2, COOLDOWN_MAX_MS);
    return;
  }
  // 2xx만 성공이다. 302는 로그인 페이지로 보내는 것이라 성공이 아니고,
  // 이걸 초기화로 치면 백오프가 30초에 붙박이가 된다(2026-09-07 검증에서 확인).
  if (status >= 200 && status < 300) cooldownMs = COOLDOWN_MIN_MS;
  if (status === 401 || status === 403) setStatus('instagram', 'logged_out');
  console.log('[buoy] engine response', status, url.split('?')[0]);
}

// ── 엔진 이벤트 ───────────────────────────────────────────────────────────────
let wsTimer = null;
const socketsSeen = new Set();

ipcMain.on('ig:socket-open', (_e, name) => {
  if (socketsSeen.has(name)) return;
  socketsSeen.add(name);
  console.log('[buoy] realtime socket hooked:', name);
});

ipcMain.on('ig:ws-frame', (_e, info) => {
  // 2 B 프레임은 연결 유지용 핑이라 신호가 아니다(2026-09-07 관찰). 걸러낸다.
  if (info.size <= 2) return;
  clearTimeout(wsTimer);
  wsTimer = setTimeout(() => {
    console.log('[buoy][perf] ws frame → refresh', info.socket, info.size + 'B');
    probeInbox();
  }, WS_DEBOUNCE_MS);
});

ipcMain.on('ig:ready', (_e, info) => {
  console.log('[buoy] engine ready loggedIn=%s', info.loggedIn);
  // 요청 제한 중에는 빈 페이지가 와서 쿠키가 없다. 그때의 loggedIn=false는 로그아웃이 아니라
  // 제한의 부산물이므로 상태를 덮지 않는다. 덮으면 "로그인 필요" 배너를 잘못 띄우게 된다.
  if (MOCK.providers.instagram.status === 'rate_limited') return;
  if (!info.loggedIn) { setStatus('instagram', 'logged_out'); return; }
  probeInbox();
});

// ── UI 이벤트 ────────────────────────────────────────────────────────────────
ipcMain.on('ui:ready', () => {
  uiReady = true;
  console.log('[buoy] ui ready');
  const s = snapshot();
  toUI({ type: 'STATE', providers: s.providers, threads: s.threads, unread: s.unread });
});

ipcMain.on('ui:post', (_e, msg) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'REFRESH': {
      probeInbox();
      const s = snapshot();
      toUI({ type: 'THREADS', threads: s.threads, unread: s.unread });
      break;
    }
    case 'THREAD': {
      const t = MOCK.threads.find((x) => x.id === msg.threadId);
      toUI({ type: 'THREAD', reqId: msg.reqId, thread: t });
      break;
    }
    case 'SEEN': {
      const t = MOCK.threads.find((x) => x.id === msg.threadId);
      if (t && t.unread) {
        t.unread = false;
        const s = snapshot();
        toUI({ type: 'THREADS', threads: s.threads, unread: s.unread });
      }
      break;
    }
    case 'OPEN_INSTAGRAM':
      if (engine && !engine.isDestroyed()) { engine.show(); engine.focus(); }
      break;
    case 'SET_OPEN_THREAD':
    case 'OPEN_HELP':
      break;
    default:
      console.log('[buoy] unknown ui message', msg.type);
  }
});

// ── 수명주기 ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createUI();
  createEngine();
  app.on('activate', () => { if (!ui) createUI(); });
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
