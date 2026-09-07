// lib/providers.js — 멀티 메신저 공통 계층 (순수 함수, UI/네트워크 없음).
// 확장에서는 <script>/importScripts 로 로드하면 globalThis.BuoyProviders,
// 테스트에서는 require()로 쓴다. docs/02-architecture.md §4, §5 과 1:1.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuoyProviders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROVIDERS = Object.freeze({
    instagram: Object.freeze({ id: 'instagram', label: '인스타', short: 'IG', color: '#5B4FE6' }),
    kakao: Object.freeze({ id: 'kakao', label: '카톡', short: 'KT', color: '#B8860B' }),
  });
  const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

  const NO_CAPS = Object.freeze({ send: false, seen: false, history: false, rooms: false });
  const IG_CAPS = Object.freeze({ send: true, seen: true, history: true, rooms: true });

  // ── ID 네임스페이스 ──
  function nsId(provider, id) {
    if (!PROVIDERS[provider]) throw new Error('unknown provider: ' + provider);
    return provider + ':' + String(id);
  }
  function parseId(nsid) {
    const s = String(nsid);
    const i = s.indexOf(':');
    if (i < 0) return { provider: null, id: s };
    const provider = s.slice(0, i);
    return PROVIDERS[provider] ? { provider, id: s.slice(i + 1) } : { provider: null, id: s };
  }

  // ── 기능 게이팅 ──
  // instagram은 고정. kakao는 호스트 HELLO_ACK.capabilities 를 그대로 신뢰하되 없는 키는 false.
  function capsFor(provider, hostCaps) {
    if (provider === 'instagram') return { ...IG_CAPS };
    const c = hostCaps || {};
    return { send: !!c.send, seen: !!c.seen, history: !!c.history, rooms: !!c.rooms };
  }

  // ── 인스타 Inbox(docs/02 §6) → 공통 Thread ──
  function tagInstagramInbox(inbox) {
    if (!inbox || !Array.isArray(inbox.threads)) return [];
    return inbox.threads.map((t) => ({
      ...t,
      provider: 'instagram',
      id: nsId('instagram', t.id),
      rawId: t.id,
      items: (t.items || []).map((it) => ({ ...it, provider: 'instagram' })),
    }));
  }

  // ── 카카오 ITEM 이벤트(docs/02 §8) → Thread 갱신 ──
  // threadsById: Map<nsid, Thread>. 방이 없으면 만든다. 반환: 갱신된 Thread.
  function applyKakaoItem(threadsById, item, opts) {
    const o = opts || {};
    const id = nsId('kakao', item.roomId);
    const nowMs = typeof o.now === 'number' ? o.now : Date.now();
    let t = threadsById.get(id);
    if (!t) {
      t = {
        id,
        rawId: item.roomId,
        provider: 'kakao',
        title: item.roomName || item.roomId,
        users: [],
        isGroup: false,
        items: [],
        last: null,
        unread: false,
        lastActivity: 0,
      };
      threadsById.set(id, t);
    }
    if (t.items.some((x) => x.id === item.id)) return t; // 알림·창 소스 중복
    const it = {
      id: item.id,
      provider: 'kakao',
      userId: item.sender || '',
      fromMe: !!item.fromMe,
      type: 'text',
      text: item.text,
      ts: typeof item.ts === 'number' ? item.ts : nowMs,
      source: item.source,
    };
    t.items.push(it);
    t.items.sort((a, b) => a.ts - b.ts);
    if (t.items.length > (o.maxItems || 200)) t.items.splice(0, t.items.length - (o.maxItems || 200));
    t.last = t.items[t.items.length - 1];
    t.lastActivity = Math.max(t.lastActivity || 0, it.ts);
    if (!it.fromMe && !(o.isOpen && o.isOpen(id))) t.unread = true;
    if (item.sender && !t.users.some((u) => u.username === item.sender)) {
      t.users.push({ id: item.sender, username: item.sender, name: item.sender });
      if (t.users.length > 1) t.isGroup = true;
    }
    return t;
  }

  // 내가 카톡으로 보낸 뒤 낙관적 항목 (SEND_RESULT ok 시 확정). 카카오는 서버 item id가 없으므로 로컬 id 유지.
  function optimisticKakaoItem(text, nowMs) {
    return {
      id: 'tmp_' + nowMs + '_' + Math.random().toString(36).slice(2, 7),
      provider: 'kakao', userId: 'me', fromMe: true, type: 'text', text, ts: nowMs, pending: true,
    };
  }

  // ── 통합 목록 ──
  // providersState: { instagram?: { inbox }, kakao?: { threads: Map<nsid, Thread> } }
  function mergeThreads(providersState) {
    const out = [];
    const ig = providersState.instagram && providersState.instagram.inbox;
    if (ig) out.push(...tagInstagramInbox(ig));
    const kk = providersState.kakao && providersState.kakao.threads;
    if (kk) for (const t of kk.values()) out.push(t);
    out.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    return out;
  }

  function countUnread(threads) {
    const byProvider = { instagram: 0, kakao: 0 };
    let total = 0;
    for (const t of threads) {
      if (t.unread) { total += 1; byProvider[t.provider] = (byProvider[t.provider] || 0) + 1; }
    }
    return { total, byProvider };
  }

  function filterThreads(threads, provider) {
    if (!provider || provider === 'all') return threads;
    return threads.filter((t) => t.provider === provider);
  }

  // ── 상태 요약 (헤더 점 하나로 보여줄 때) ──
  // statuses: { instagram: Status, kakao: Status } → 'connected' | 'degraded' | 'disconnected'
  function overallStatus(statuses) {
    const vals = PROVIDER_IDS.map((p) => statuses[p]).filter(Boolean);
    if (!vals.length) return 'disconnected';
    const good = vals.filter((s) => s === 'connected').length;
    if (good === vals.length) return 'connected';
    return good > 0 ? 'degraded' : 'disconnected';
  }

  return {
    PROVIDERS, PROVIDER_IDS, NO_CAPS, IG_CAPS,
    nsId, parseId, capsFor,
    tagInstagramInbox, applyKakaoItem, optimisticKakaoItem,
    mergeThreads, countUnread, filterThreads, overallStatus,
  };
});
