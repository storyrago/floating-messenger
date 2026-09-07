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
  // 프로바이더는 지금 instagram 하나다(ADR-011). 모르는 id는 아무 기능도 없는 것으로 본다.
  function capsFor(provider) {
    return provider === 'instagram' ? { ...IG_CAPS } : { ...NO_CAPS };
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

  // ── 통합 목록 ──
  // providersState: { instagram?: { inbox } }
  function mergeThreads(providersState) {
    const out = [];
    const ig = providersState.instagram && providersState.instagram.inbox;
    if (ig) out.push(...tagInstagramInbox(ig));
    out.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
    return out;
  }

  function countUnread(threads) {
    const byProvider = { instagram: 0 };
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
  // statuses: { instagram: Status } → 'connected' | 'degraded' | 'disconnected'
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
    tagInstagramInbox,
    mergeThreads, countUnread, filterThreads, overallStatus,
  };
});
