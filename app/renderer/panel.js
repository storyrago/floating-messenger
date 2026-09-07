// panel.js — 왼쪽 목록, 오른쪽 대화. 창 하나 안에서 두 칸을 동시에 보여 준다.
// 네트워크에 직접 닿지 않는다. preload가 열어 준 window.buoy 로만 메인 프로세스와 이야기한다.
// docs/01 FR-02·03·05 · docs/02 §7.4
//
// 컴포저(전송)는 다음 단계다. 지금은 자리만 두고 꺼 놓았다.
(() => {
  'use strict';

  const REQ_TIMEOUT_MS = 15000;  // docs/02 §11
  const GAP_MS = 30 * 60 * 1000; // 30분 이상 벌어지면 시간 구분선 (FR-03)

  const el = {
    dots: document.getElementById('dots'),
    refresh: document.getElementById('refresh'),
    banners: document.getElementById('banners'),
    list: document.getElementById('list'),
    chatHead: document.getElementById('chatHead'),
    chatAvatar: document.getElementById('chatAvatar'),
    chatName: document.getElementById('chatName'),
    chatSub: document.getElementById('chatSub'),
    convo: document.getElementById('convo'),
    blank: document.getElementById('blank'),
    composer: document.getElementById('composer'),
  };

  const state = { providers: {}, threads: [], unread: { total: 0, byProvider: {} } };
  let openThreadId = null;
  let reqId = 0;
  const pending = new Map();

  const STATUS_TEXT = {
    connecting: '연결 중',
    connected: '연결됨',
    degraded: '일부 기능 제한',
    disconnected: '연결 끊김',
    logged_out: '로그인 필요',
    rate_limited: '요청 제한',
    error: '오류',
  };

  // ── DOM 헬퍼 (사용자 텍스트는 언제나 textContent) ──
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k === 'hidden') node.hidden = !!v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c) node.appendChild(c);
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ── 시간 ──
  const hm = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  function isToday(d) {
    return dayKey(d) === dayKey(new Date());
  }

  /** 구분선 문구. 시각은 말 묶음마다 따로 붙으므로 여기서는 날짜만 말한다. */
  function dayLabel(ts) {
    const d = new Date(ts);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (isToday(d)) return '오늘';
    if (dayKey(d) === dayKey(yesterday)) return '어제';
    return dayFmt.format(d);
  }

  function when(ts) {
    const d = new Date(ts);
    return isToday(d) ? hm.format(d) : `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ── 프로필 사진 ──
  // 인스타는 profile_pic_url을 준다. 없으면 이름 첫 글자를 색 원에 담는다.
  // 색은 이름에서 만들어 같은 사람은 언제나 같은 색이 된다.
  function hue(name) {
    let n = 0;
    for (const ch of String(name)) n = (n * 31 + ch.codePointAt(0)) % 360;
    return n;
  }

  function paintAvatar(node, thread) {
    clear(node);
    const title = thread.title || '?';
    const url = (thread.users && thread.users[0] && thread.users[0].avatar) || null;
    if (url) {
      const img = h('img', { alt: '' });
      img.src = url;
      img.addEventListener('error', () => paintInitial(node, title)); // 사진이 막히면 글자로
      node.style.background = 'transparent';
      node.appendChild(img);
      return;
    }
    paintInitial(node, title);
  }

  function paintInitial(node, title) {
    clear(node);
    const t = hue(title);
    node.style.background = `linear-gradient(160deg, hsl(${t} 58% 48%), hsl(${(t + 38) % 360} 58% 38%))`;
    node.textContent = [...title][0] || '?';
  }

  function avatarFor(thread, big) {
    const node = h('div', { class: 'avatar' + (big ? ' lg' : ''), 'aria-hidden': 'true' });
    paintAvatar(node, thread);
    return node;
  }

  // ── 메인 프로세스 연결 ──
  function connect() {
    if (!globalThis.buoy) return; // 앱 밖(브라우저 미리보기)에서 열렸을 때
    globalThis.buoy.onMessage(onMessage);
  }

  function post(msg) {
    try { if (globalThis.buoy) globalThis.buoy.post(msg); } catch { /* 창이 닫히는 중 */ }
  }

  function request(msg) {
    const id = ++reqId;
    post({ ...msg, reqId: id });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, REQ_TIMEOUT_MS);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); pending.delete(id); resolve(v); }, reject });
    });
  }

  function onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'STATE':
        state.providers = msg.providers || {};
        mergeThreads(msg.threads);
        state.unread = msg.unread || state.unread;
        renderAll();
        break;
      case 'THREADS':
        mergeThreads(msg.threads);
        state.unread = msg.unread || state.unread;
        renderAll();
        break;
      case 'STATUS':
        if (state.providers[msg.provider]) {
          Object.assign(state.providers[msg.provider], {
            status: msg.status, detail: msg.detail, caps: msg.caps || state.providers[msg.provider].caps,
          });
        }
        renderChrome();
        break;
      case 'THREAD': {
        const p = pending.get(msg.reqId);
        mergeThreads([msg.thread]);
        if (p) p.resolve(msg.thread);
        renderList();
        if (openThreadId === (msg.thread && msg.thread.id)) renderConvo();
        break;
      }
      case 'ERROR': {
        const p = pending.get(msg.reqId);
        if (p) p.reject(new Error(msg.error || 'unknown'));
        break;
      }
      default:
        break;
    }
  }

  /** 메타는 덮어쓰고 항목은 id 합집합으로 병합한다. docs/02 §7.4 */
  function mergeThreads(incoming) {
    if (!Array.isArray(incoming)) return;
    const byId = new Map(state.threads.map((t) => [t.id, t]));
    for (const next of incoming) {
      if (!next || !next.id) continue;
      const prev = byId.get(next.id);
      if (!prev) { byId.set(next.id, { ...next, items: [...(next.items || [])] }); continue; }
      const items = new Map(prev.items.map((i) => [i.id, i]));
      for (const i of next.items || []) items.set(i.id, i);
      byId.set(next.id, { ...prev, ...next, items: [...items.values()].sort((a, b) => a.ts - b.ts) });
    }
    state.threads = [...byId.values()].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  }

  // ── 렌더 ──
  function renderAll() { renderChrome(); renderList(); renderConvo(); }

  function renderChrome() {
    const ids = Object.keys(state.providers).filter((id) => state.providers[id].enabled !== false);

    clear(el.dots);
    for (const id of ids) {
      const p = state.providers[id];
      const label = STATUS_TEXT[p.status] || p.status || '';
      el.dots.appendChild(h('span', { class: 'dot ' + (p.status || ''), title: p.detail ? `${label} — ${p.detail}` : label }));
    }

    clear(el.banners);
    for (const id of ids) {
      const p = state.providers[id];
      if (p.status === 'logged_out') {
        el.banners.appendChild(banner('로그인이 풀렸어요. 인스타그램 창에서 로그인하면 이어집니다.', '인스타그램 열기', () => post({ type: 'OPEN_INSTAGRAM' })));
      } else if (p.status === 'rate_limited') {
        el.banners.appendChild(banner(p.detail || '인스타그램이 요청을 잠시 막았어요. 자동으로 다시 시도합니다.'));
      } else if (p.status === 'disconnected') {
        el.banners.appendChild(banner('인스타그램에 연결하지 못했어요. 다시 시도하는 중입니다.'));
      } else if (p.status === 'degraded' && p.detail) {
        el.banners.appendChild(banner(p.detail));
      }
    }
  }

  function banner(text, action, onclick) {
    const node = h('div', { class: 'banner' }, h('p', { text }));
    if (action) node.appendChild(h('button', { type: 'button', text: action, onclick }));
    return node;
  }

  function renderList() {
    clear(el.list);
    if (!state.threads.length) {
      el.list.appendChild(h('p', { class: 'empty', text: '대화가 없어요' }));
      return;
    }
    for (const t of state.threads) el.list.appendChild(row(t));
  }

  function row(t) {
    const node = h('button', {
      class: 'row' + (t.unread ? ' unread' : ''),
      type: 'button',
      role: 'listitem',
      'aria-current': String(t.id === openThreadId),
      onclick: () => openThread(t.id),
    },
      avatarFor(t),
      h('span', { class: 'name', text: t.title || '(이름 없음)' }),
      h('span', { class: 'when', text: t.lastActivity ? when(t.lastActivity) : '' }),
      h('span', { class: 'preview', text: preview(t) }));
    node.setAttribute('aria-label', `${t.title || '대화'}${t.unread ? ', 읽지 않음' : ''}`);
    return node;
  }

  function preview(t) {
    const last = t.last || (t.items && t.items[t.items.length - 1]);
    if (!last) return '';
    if (last.fromMe) return '나: ' + last.text;
    if (t.isGroup) {
      const u = (t.users || []).find((x) => x.id === last.userId);
      return ((u && u.username) || last.userId || '') + ': ' + last.text;
    }
    return last.text || '';
  }

  // ── 대화 ──
  function openThread(id) {
    openThreadId = id;
    post({ type: 'SET_OPEN_THREAD', threadId: id });

    const t = state.threads.find((x) => x.id === id);
    if (t && t.unread) {
      t.unread = false;
      const last = t.items && t.items[t.items.length - 1];
      const caps = (state.providers[t.provider] || {}).caps || {};
      if (caps.seen && last) post({ type: 'SEEN', threadId: id, itemId: last.id });
    }

    renderList();
    renderConvo(true);
    el.convo.focus({ preventScroll: true });

    if (t && ((state.providers[t.provider] || {}).caps || {}).history) {
      request({ type: 'THREAD', threadId: id }).catch(() => { /* 캐시만 보여 준다 */ });
    }
  }

  function closeThread() {
    if (!openThreadId) return;
    openThreadId = null;
    post({ type: 'SET_OPEN_THREAD', threadId: null });
    renderList();
    renderConvo();
  }

  /**
   * @param {boolean} toBottom 무조건 맨 아래로 내린다. 다른 대화를 열 때 쓴다.
   *   이걸 안 주면 직전 대화에서 위로 올려 둔 스크롤 위치를 기준으로 판단해,
   *   새로 연 대화가 중간에서 시작한다.
   */
  function renderConvo(toBottom) {
    const t = state.threads.find((x) => x.id === openThreadId);
    if (!t) {
      el.chatHead.hidden = true;
      el.convo.hidden = true;
      el.composer.hidden = true;
      el.blank.hidden = false;
      return;
    }

    el.blank.hidden = true;
    el.chatHead.hidden = false;
    el.convo.hidden = false;
    el.composer.hidden = false;

    el.chatName.textContent = t.title || '대화';
    paintAvatar(el.chatAvatar, t);

    const caps = (state.providers[t.provider] || {}).caps || {};
    const names = (t.users || []).map((u) => u.username).filter(Boolean);
    el.chatSub.textContent = t.isGroup ? `${names.length + 1}명` : (names[0] ? '@' + names[0] : '');

    const atBottom = toBottom || el.convo.scrollHeight - el.convo.scrollTop - el.convo.clientHeight < 60;
    clear(el.convo);

    if (caps.history === false) {
      el.convo.appendChild(h('p', { class: 'sep', text: '앱을 켠 뒤 받은 메시지만 보여요' }));
    }

    // prevTs=0으로 시작해 첫 항목에도 구분선이 붙는다. 오래된 대화를 열었을 때
    // 맨 위에 날짜가 없으면 언제 이야기인지 알 수 없다.
    // 같은 사람이 연달아 말한 묶음마다 끝에 시각을 한 번 붙인다.
    // 모든 말풍선에 붙이면 시끄럽고, 대화 끝에만 붙이면 언제 이야기인지 알 수 없다.
    // 구분선은 날짜가 바뀔 때만 그린다. 같은 날 안에서 시간이 벌어진 것은 여백으로 보인다.
    // docs/01 FR-03은 "30분 이상이면 날짜·시간 구분선"이라 했지만, 말 묶음마다 시각이
    // 붙는 지금 구성에서는 같은 날 구분선이 "오늘"만 반복해 나와 정보가 되지 않는다.
    const items = t.items || [];
    let prevTs = 0;
    let prevDay = null;
    let lastSender = null;
    items.forEach((item, i) => {
      const day = dayKey(new Date(item.ts));
      const dayChanged = day !== prevDay;
      const bigGap = item.ts - prevTs > GAP_MS;
      if (dayChanged) {
        el.convo.appendChild(h('p', { class: 'sep', text: dayLabel(item.ts) }));
        lastSender = null;
      }
      prevDay = day;
      prevTs = item.ts;

      const sender = item.fromMe ? 'me' : item.userId;
      const msg = h('div', {
        class: 'msg' + (item.fromMe ? ' me' : '') + (bigGap && !dayChanged ? ' gap' : ''),
      });
      if (t.isGroup && !item.fromMe && sender !== lastSender) {
        const u = (t.users || []).find((x) => x.id === item.userId);
        msg.appendChild(h('p', { class: 'sender', text: (u && u.username) || item.userId || '' }));
      }
      msg.appendChild(h('p', { class: 'text', text: item.text || '' }));
      el.convo.appendChild(msg);

      const next = items[i + 1];
      const runEnds = !next || (next.fromMe ? 'me' : next.userId) !== sender || next.ts - item.ts > GAP_MS;
      if (runEnds) el.convo.appendChild(h('p', { class: 'stamp' + (item.fromMe ? ' me' : ''), text: hm.format(new Date(item.ts)) }));

      lastSender = sender;
    });

    if (atBottom) el.convo.scrollTop = el.convo.scrollHeight;
  }

  // ── 동작 ──
  el.refresh.addEventListener('click', () => {
    el.refresh.classList.remove('spin');
    void el.refresh.offsetWidth;
    el.refresh.classList.add('spin');
    post({ type: 'REFRESH' });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeThread();
  });

  connect();
  renderAll();

  // 앱 밖(브라우저 미리보기)에서 열렸을 때만 열어 두는 개발용 진입점. 앱에서는 만들어지지 않는다.
  if (!globalThis.buoy) globalThis.__buoyDev = { onMessage };
})();
