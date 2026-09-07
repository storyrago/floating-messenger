// lib/native-port.js — 확장 ↔ 네이티브 호스트 연결 관리 (docs/02 §8, §11).
// chrome.runtime.connectNative 를 직접 부르지 않고 주입받아(connect) 테스트 가능하게 한다.
// 확장: importScripts('lib/native-port.js') → globalThis.BuoyNativeLink
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BuoyNativeLink = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
  const RESPONSE_TYPES = new Set(['PONG', 'ROOMS', 'SEND_RESULT', 'ERROR']);
  const EVENT_TYPES = new Set(['ITEM', 'STATUS', 'LOG', 'HELLO_ACK']);

  /**
   * @param {object} opts
   * @param {() => Port} opts.connect          예: () => chrome.runtime.connectNative('com.buoy.kakao')
   * @param {(msg) => void} [opts.onEvent]     ITEM / STATUS / LOG
   * @param {(state) => void} [opts.onState]   { status, caps, adapter, error, attempt }
   * @param {() => string|null} [opts.getLastError]  예: () => chrome.runtime.lastError?.message ?? null
   * @param {number[]} [opts.backoffMs]
   * @param {number} [opts.helloTimeoutMs]     기본 5000
   * @param {number} [opts.requestTimeoutMs]   기본 15000
   * @param {number} [opts.maxAttempts]        기본 Infinity (0/undefined = 무한)
   */
  function createNativeLink(opts) {
    const connect = opts.connect;
    const onEvent = opts.onEvent || (() => {});
    const onState = opts.onState || (() => {});
    const getLastError = opts.getLastError || (() => null);
    const backoff = opts.backoffMs || DEFAULT_BACKOFF_MS;
    const helloTimeoutMs = opts.helloTimeoutMs || 5000;
    const requestTimeoutMs = opts.requestTimeoutMs || 15000;
    const maxAttempts = opts.maxAttempts || Infinity;
    const clientInfo = opts.client || { client: 'buoy-extension', version: '0.2.0' };

    let port = null;
    let status = 'idle';          // idle | connecting | connected | disconnected | stopped
    let caps = null;
    let adapter = null;
    let attempt = 0;              // 연속 실패 횟수 (HELLO_ACK 받으면 0)
    let reconnectTimer = null;
    let helloTimer = null;
    let reqSeq = 0;
    const pending = new Map();    // reqId → { resolve, reject, timer }
    let stopped = false;

    function setState(next, extra) {
      status = next;
      onState({ status, caps, adapter, attempt, ...(extra || {}) });
    }

    function start() {
      stopped = false;
      open();
    }

    function open() {
      if (stopped || port) return;
      setState('connecting');
      let p;
      try {
        p = connect();
      } catch (e) {
        return failed('connect threw: ' + (e && e.message ? e.message : e));
      }
      port = p;
      p.onMessage.addListener(handleMessage);
      p.onDisconnect.addListener(() => handleDisconnect(p));
      post({ type: 'HELLO', protocol: 1, ...clientInfo });
      helloTimer = setTimeout(() => {
        if (status === 'connecting') {
          try { p.disconnect(); } catch (_) { /* noop */ }
          handleDisconnect(p, 'HELLO_ACK timeout');
        }
      }, helloTimeoutMs);
    }

    function post(msg) {
      if (!port) return false;
      try { port.postMessage(msg); return true; } catch (e) { return false; }
    }

    function handleMessage(msg) {
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'HELLO_ACK') {
        clearTimeout(helloTimer); helloTimer = null;
        caps = msg.capabilities || {};
        adapter = msg.adapter || null;
        attempt = 0;
        setState('connected', { protocol: msg.protocol, version: msg.version });
        onEvent(msg);
        return;
      }
      if (RESPONSE_TYPES.has(msg.type) && typeof msg.reqId === 'number' && pending.has(msg.reqId)) {
        const p = pending.get(msg.reqId);
        pending.delete(msg.reqId);
        clearTimeout(p.timer);
        if (msg.type === 'ERROR') p.reject(new Error(msg.error || 'host error'));
        else p.resolve(msg);
        return;
      }
      if (EVENT_TYPES.has(msg.type) || msg.type === 'ERROR') onEvent(msg);
    }

    function handleDisconnect(p, reasonOverride) {
      if (p !== port) return; // 이미 교체된 옛 포트
      port = null;
      clearTimeout(helloTimer); helloTimer = null;
      const reason = reasonOverride || getLastError() || 'disconnected';
      for (const [, pr] of pending) { clearTimeout(pr.timer); pr.reject(new Error('disconnected: ' + reason)); }
      pending.clear();
      failed(reason);
    }

    function failed(reason) {
      caps = null; adapter = null;
      if (stopped) { setState('stopped', { error: reason }); return; }
      attempt += 1;
      if (attempt > maxAttempts) { setState('stopped', { error: reason, gaveUp: true }); return; }
      const delay = backoff[Math.min(attempt - 1, backoff.length - 1)];
      setState('disconnected', { error: reason, retryInMs: delay });
      reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, delay);
    }

    function stop() {
      stopped = true;
      clearTimeout(reconnectTimer); reconnectTimer = null;
      clearTimeout(helloTimer); helloTimer = null;
      const p = port; port = null;
      if (p) { try { p.postMessage({ type: 'SHUTDOWN' }); } catch (_) { /* noop */ } try { p.disconnect(); } catch (_) { /* noop */ } }
      for (const [, pr] of pending) { clearTimeout(pr.timer); pr.reject(new Error('stopped')); }
      pending.clear();
      setState('stopped');
    }

    function request(msg, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (status !== 'connected' || !port) return reject(new Error('not connected (' + status + ')'));
        const reqId = ++reqSeq;
        const timer = setTimeout(() => {
          if (pending.delete(reqId)) reject(new Error('timeout: ' + msg.type));
        }, timeoutMs || requestTimeoutMs);
        pending.set(reqId, { resolve, reject, timer });
        if (!post({ ...msg, reqId })) {
          clearTimeout(timer); pending.delete(reqId);
          reject(new Error('post failed'));
        }
      });
    }

    return {
      start, stop, request,
      ping: () => request({ type: 'PING' }, 3000),
      listRooms: () => request({ type: 'LIST_ROOMS' }),
      send: (roomId, text) => request({ type: 'SEND', roomId, text }),
      get status() { return status; },
      get caps() { return caps; },
      get adapter() { return adapter; },
      get attempt() { return attempt; },
      get pendingCount() { return pending.size; },
    };
  }

  return { createNativeLink, DEFAULT_BACKOFF_MS };
});
