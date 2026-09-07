// panel.js — 통합 목록·대화·상태 화면. 앱 창 하나 안에서 목록과 대화를 오간다(ADR-010).
// 네트워크에 직접 닿지 않는다. preload가 열어 준 window.buoy 로만 메인 프로세스와 이야기한다.
// 메시지 모양은 확장 시절의 포트 규약을 그대로 쓴다. docs/01 FR-02·03·05 · docs/02 §7.4, §14
//
// 컴포저(전송)는 다음 단계다. 지금은 읽기 전용이다.
(() => {
  'use strict';

  const REQ_TIMEOUT_MS = 15000;  // docs/02 §11
  const GAP_MS = 30 * 60 * 1000; // 30분 이상이면 구분선 (FR-03)

  const el = {
    back: document.getElementById('back'),
    title: document.getElementById('title'),
    dots: document.getElementById('dots'),
    refresh: document.getElementById('refresh'),
    banners: document.getElementById('banners'),
    chips: document.getElementById('chips'),
    list: document.getElementById('list'),
    convo: document.getElementById('convo'),
  };

  /** @type {{providers: Object, threads: Array, unread: {total:number, byProvider:Object}}} */
  const state = { providers: {}, threads: [], unread: { total: 0, byProvider: {} } };
  let filter = 'all';
  let openThreadId = null;
  let reqId = 0;
  const pending = new Map();

  const LABEL = { instagram: { short: 'IG', name: '인스타' }, kakao: { short: 'KT', name: '카톡' } };
  const STATUS_TEXT = {
    connecting: '연결 중…',
    connected: '연결됨',
    degraded: '일부 기능 제한',
    disconnected: '연결 끊김',
    logged_out: '로그인 필요',
    rate_limited: '요청 제한 — 잠시 후 자동 재시도',
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

  // ── 시간 표시 ──
  const hm = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const md = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' });
  const full = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  function when(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? hm.format(d) : md.format(d);
  }

  // ── 메인 프로세스 연결 (preload-ui.js가 노출) ──
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

  /** THREADS는 메타를 덮어쓰고 항목은 id 합집합으로 병합한다. docs/02 §7.4 */
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
  function renderAll() { renderChrome(); renderList(); if (openThreadId) renderConvo(); }

  function enabledProviders() {
    return Object.entries(state.providers).filter(([, p]) => p.enabled !== false).map(([id]) => id);
  }

  function renderChrome() {
    const ids = enabledProviders();

    clear(el.dots);
    for (const id of ids) {
      const p = state.providers[id];
      const label = (LABEL[id] ? LABEL[id].name : id) + ' — ' + (STATUS_TEXT[p.status] || p.status || '');
      el.dots.appendChild(h('span', { class: 'dot ' + (p.status || ''), title: p.detail ? label + ': ' + p.detail : label }));
    }

    clear(el.banners);
    for (const id of ids) {
      const p = state.providers[id];
      if (p.status === 'logged_out') {
        el.banners.appendChild(banner('로그인이 풀렸어요. 인스타그램 탭에서 로그인하면 자동으로 이어져요.', '인스타그램 열기', () => post({ type: 'OPEN_INSTAGRAM' })));
      } else if (p.status === 'disconnected') {
        el.banners.appendChild(id === 'kakao'
          ? banner('카카오 호스트가 응답하지 않아요. PC 카카오톡과 호스트 설치를 확인하세요.', '설치 안내', () => post({ type: 'OPEN_HELP', provider: 'kakao' }))
          : banner('인스타그램 탭이 닫혔어요. 다시 여는 중…'));
      } else if (p.status === 'degraded' && p.detail) {
        el.banners.appendChild(banner(name(id) + ' 일부 기능이 제한돼요 — ' + p.detail));
      }
    }

    el.chips.hidden = ids.length < 2;
    if (!el.chips.hidden) {
      clear(el.chips);
      const opts = [['all', '전체', state.unread.total], ...ids.map((id) => [id, LABEL[id] ? LABEL[id].name : id, (state.unread.byProvider || {})[id] || 0])];
      for (const [key, text, n] of opts) {
        const chip = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === key), onclick: () => { filter = key; renderList(); renderChrome(); } }, document.createTextNode(text));
        if (n > 0) chip.appendChild(h('span', { class: 'n', text: String(n) }));
        el.chips.appendChild(chip);
      }
    }
  }

  function name(providerId) { return LABEL[providerId] ? LABEL[providerId].name : providerId; }

  function banner(text, action, onclick) {
    const node = h('div', { class: 'banner' }, h('p', { text }));
    if (action) node.appendChild(h('button', { type: 'button', text: action, onclick }));
    return node;
  }

  function visibleThreads() {
    return filter === 'all' ? state.threads : state.threads.filter((t) => t.provider === filter);
  }

  function renderList() {
    clear(el.list);
    const threads = visibleThreads();
    if (!threads.length) {
      el.list.appendChild(h('p', { class: 'empty', text: '대화가 없어요' }));
      return;
    }
    for (const t of threads) el.list.appendChild(row(t));
  }

  function row(t) {
    const tag = LABEL[t.provider] ? LABEL[t.provider].short : t.provider;
    const node = h('button', {
      class: 'row' + (t.unread ? ' unread' : ''),
      type: 'button',
      onclick: () => openThread(t.id),
    },
      h('span', { class: 'tag ' + t.provider, text: tag }),
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
      renderChrome();
    }
    renderConvo();
    el.list.hidden = true;
    el.convo.hidden = false;
    el.back.hidden = false;
    el.chips.hidden = true;
    el.convo.focus();
    if (t && ((state.providers[t.provider] || {}).caps || {}).history) {
      request({ type: 'THREAD', threadId: id }).catch(() => { /* 캐시만 보여준다 */ });
    }
  }

  function backToList() {
    openThreadId = null;
    post({ type: 'SET_OPEN_THREAD', threadId: null });
    el.convo.hidden = true;
    el.list.hidden = false;
    el.back.hidden = true;
    renderChrome();
    renderList();
    el.list.focus();
  }

  function renderConvo() {
    const t = state.threads.find((x) => x.id === openThreadId);
    if (!t) return backToList();
    el.title.textContent = t.title || '대화';

    const atBottom = el.convo.scrollHeight - el.convo.scrollTop - el.convo.clientHeight < 40;
    clear(el.convo);

    const caps = (state.providers[t.provider] || {}).caps || {};
    if (caps.history === false) {
      el.convo.appendChild(h('p', { class: 'sep', text: '호스트가 켜진 뒤 받은 메시지만 보여요' }));
    }

    // prevTs=0으로 시작해 첫 항목에도 구분선이 붙는다. docs/01 FR-03은 "항목 간 30분"만
    // 말하지만, 맨 위에 날짜가 없으면 오래된 대화를 열었을 때 언제 이야기인지 알 수 없다.
    let prevTs = 0;
    for (const item of t.items || []) {
      if (item.ts - prevTs > GAP_MS) el.convo.appendChild(h('p', { class: 'sep', text: full.format(new Date(item.ts)) }));
      prevTs = item.ts;
      const msg = h('div', { class: 'msg' + (item.fromMe ? ' me' : '') });
      if (t.isGroup && !item.fromMe) {
        const u = (t.users || []).find((x) => x.id === item.userId);
        msg.appendChild(h('p', { class: 'sender', text: (u && u.username) || item.userId || '' }));
      }
      msg.appendChild(h('p', { class: 'text', text: item.text || '' }));
      el.convo.appendChild(msg);
    }

    if (atBottom) el.convo.scrollTop = el.convo.scrollHeight;
  }

  // ── 상단 바 동작 ──
  el.back.addEventListener('click', backToList);

  el.refresh.addEventListener('click', () => {
    el.refresh.classList.remove('spin');
    void el.refresh.offsetWidth;
    el.refresh.classList.add('spin');
    post({ type: 'REFRESH' });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openThreadId) backToList();
  });

  // 패널 제목은 목록일 때 고정
  const setListTitle = () => { if (!openThreadId) el.title.textContent = '메시지'; };
  const observer = new MutationObserver(setListTitle);
  observer.observe(el.list, { childList: true });

  connect();
  renderAll();

  // 앱 밖(브라우저 미리보기)에서 열렸을 때만 열어 두는 개발용 진입점. 앱에서는 만들어지지 않는다.
  if (!globalThis.buoy) globalThis.__buoyDev = { onMessage };
})();
