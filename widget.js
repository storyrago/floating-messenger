// widget.js — 모든 http/https 최상위 프레임에 플로팅 버블과 패널 컨테이너를 놓는다.
// 패널 UI 자체는 그리지 않는다. 확장 페이지(panel.html)를 iframe으로 띄우고 위치만 잡는다.
// docs/01 FR-01 · docs/02 §3.1, §7.5, §7.6, §14 · ADR-002
//
// 규칙: HTML 문자열 주입과 인라인 style 속성을 쓰지 않는다(docs/04 §E는 코드 검색으로
// 확인한다). createElement와 adoptedStyleSheets만 쓴다. Trusted Types 강제 사이트에서도
// 동작해야 한다.
(() => {
  'use strict';

  const HOST_ID = 'buoy-widget-host';
  const OPEN_MS = 120; // docs/02 §14

  if (window.top !== window) return;                  // 최상위 프레임만 (FR-01)
  if (document.getElementById(HOST_ID)) return;       // 중복 주입 방지

  const EXT_ORIGIN = (() => {
    try { return new URL(chrome.runtime.getURL('')).origin; } catch { return null; }
  })();
  if (!EXT_ORIGIN) return; // 고아 콘텐츠 스크립트: 조용히 멈춘다

  const CSS = `
    :host { all: initial; }
    .bubble, .panel { position: fixed; z-index: 2147483647; }
    .bubble {
      right: 20px; bottom: 20px; width: 52px; height: 52px;
      display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 50%; padding: 0; cursor: pointer;
      background: #5B4FE6; color: #FFFFFF;
      box-shadow: 0 12px 40px rgba(0,0,0,.28);
      transition: transform ${OPEN_MS}ms ease;
    }
    .bubble:hover { transform: scale(1.04); }
    .bubble:focus-visible { outline: 2px solid #1C1B22; outline-offset: 3px; }
    .badge {
      position: absolute; top: -2px; right: -2px; min-width: 18px; height: 18px;
      box-sizing: border-box; padding: 0 5px; border-radius: 9px;
      background: #E5484D; color: #FFFFFF;
      font: 600 11.5px/18px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
      text-align: center;
    }
    .badge[hidden] { display: none; }
    .panel {
      right: 20px; bottom: 84px; width: 380px; height: min(620px, 100vh - 110px);
      border: 0; border-radius: 16px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,.28);
      opacity: 0; transform: translateY(6px);
      transition: opacity ${OPEN_MS}ms ease, transform ${OPEN_MS}ms ease;
    }
    .panel.open { opacity: 1; transform: none; }
    .panel[hidden] { display: none; }
    @media (prefers-reduced-motion: reduce) {
      .bubble, .panel { transition: none; }
      .bubble:hover { transform: none; }
    }
  `;

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'closed' }); // 호스트 스크립트가 읽을 수 없다
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = [sheet];

  const bubble = document.createElement('button');
  bubble.className = 'bubble';
  bubble.type = 'button';
  bubble.setAttribute('aria-label', '메신저 열기');
  bubble.setAttribute('aria-expanded', 'false');
  bubble.appendChild(speechMark());

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.hidden = true;
  badge.setAttribute('aria-label', '읽지 않은 대화');
  bubble.appendChild(badge);

  root.append(bubble);
  document.documentElement.appendChild(host);

  /** 버블 안 말풍선 표시. 아이콘과 같은 형태(icons/*.png, ADR-009). */
  function speechMark() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H10l-5 4v-4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z');
    svg.appendChild(p);
    return svg;
  }

  // ── 패널 (처음 열 때만 iframe 로드, 닫아도 언로드하지 않는다. docs/02 §13) ──
  let frame = null;
  let open = false;

  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.className = 'panel';
    frame.hidden = true;
    frame.setAttribute('title', '메신저 패널');
    frame.setAttribute('allowtransparency', 'true');
    try { frame.src = chrome.runtime.getURL('panel.html'); } catch { return null; }
    root.appendChild(frame);
    return frame;
  }

  function setOpen(next) {
    const f = ensureFrame();
    if (!f) return;
    open = next;
    bubble.setAttribute('aria-expanded', String(open));
    bubble.setAttribute('aria-label', open ? '메신저 닫기' : '메신저 열기');
    if (open) {
      f.hidden = false;
      requestAnimationFrame(() => f.classList.add('open'));
      try { f.contentWindow.focus(); } catch { /* 교차 출처: 무시 */ }
    } else {
      f.classList.remove('open');
      setTimeout(() => { if (!open) f.hidden = true; }, OPEN_MS);
    }
  }

  bubble.addEventListener('click', () => setOpen(!open));

  // 호스트 페이지에 포커스가 있을 때의 Esc. 패널 안 Esc는 panel.js가 CLOSE로 알린다.
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') setOpen(false);
  });

  // 패널(iframe) → 위젯: 닫기 요청. docs/02 §7.6
  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGIN) return;
    if (e.data && e.data.__buoy === true && e.data.type === 'CLOSE') setOpen(false);
  });

  // background → 위젯: 툴바 아이콘 토글. docs/02 §7.5
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg && msg.to === 'widget' && msg.type === 'TOGGLE') {
        setOpen(!open);
        respond({ ok: true });
      }
      return false;
    });
  } catch { /* 고아 스크립트 */ }

  // ── 배지 (storage.session.unread) ──
  function paintBadge(n) {
    const v = Number(n) || 0;
    badge.hidden = v <= 0;
    badge.textContent = v > 99 ? '99+' : String(v);
  }

  try {
    chrome.storage.session.get('unread').then((o) => paintBadge(o && o.unread)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.unread) paintBadge(changes.unread.newValue);
    });
  } catch { /* 접근 레벨 미설정·고아 스크립트: 배지 없이 동작 */ }
})();
