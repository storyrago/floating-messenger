# 아키텍처 설계 — floating-messenger

| 항목 | 내용 |
|---|---|
| 문서 버전 | 0.3 (통합본 — 프로바이더 모델을 중심으로 인스타·카카오를 한 구조로 서술) |
| 작성일 | 2026-09-07 |
| 상태 | 초안. §9.1 인스타 외부 값은 M0, §9.2 카카오 외부 값은 PoC E1a/E2로 확정 |
| 참조 구현 | `poc/extension-provider/lib/providers.js`, `lib/native-port.js`, `poc/kakao-host/` (모두 테스트 포함), `reference/` |

**2026-09-07 범위 축소(ADR-011):** 카카오 호스트 프로토콜(§8)과 카카오톡 PC 접점(§9.2)은 무효다. **구조 변경(ADR-010):** 확장이 아니라 Electron 앱이다. 엔진은 핀 고정 탭이 아니라 앱 안 웹뷰이고, 패널 포트는 IPC로 바뀌었다.

## 1. 개요

메신저마다 "빌려 쓰는 것"이 다르다. 인스타는 브라우저 안의 웹 세션과 WebSocket을, 카카오는 브라우저 밖의 PC 앱을 빌린다. 그래서 background 안에 **프로바이더** 객체를 하나씩 두고, 그 뒤가 무엇이든(엔진 탭이든 로컬 호스트든) 같은 모양의 이벤트를 내게 한다. 패널은 프로바이더 차이를 `capabilities`로만 안다.

```
┌─ 엔진 탭: https://www.instagram.com/direct/inbox/ (핀 고정·비활성) ─────────────┐
│  hook.js (MAIN)  WebSocket 프레임 → 신호   ig-bridge.js (ISOLATED)  디바운스 → inbox   │
│                                            fetch(같은 오리진) · lib/normalize.js       │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ runtime.sendMessage / tabs.sendMessage
┌─ background.js (서비스워커) ───▼───────────────────────────────────────────────────┐
│  InstagramProvider ──┐                                                               │
│  KakaoProvider ──────┤ Provider 인터페이스(§4) → lib/providers.js 병합·unread·상태 요약  │
│   (lib/native-port) ─┘ storage.session(§7.7) · 패널 포트 브로드캐스트 · 배지 · 툴바      │
└──────────┬──────────────────────────────────────────────────┬──────────────────────┘
           │ connectNative('com.buoy.kakao')                    │ Port "panel"    ▲ tabs.sendMessage TOGGLE
┌──────────▼──────────────────┐                     ┌──────────▼─────────┐  ┌────┴──────────────────┐
│ 호스트 (Python, stdio JSON)  │                     │ panel.html/css/js   │  │ widget.js (모든 사이트) │
│ host.py ─ adapters/windows  │                     │ 통합 목록·필터·대화·  │◀─│ closed Shadow DOM 버블  │
│  toast_source (알림 수신)     │                     │ 컴포저·상태·배너      │──▶│ 배지(unread) · iframe   │
│  win_send (입력창 제어)       │                     │ (iframe / 독립 창)   │  │ lazy 로드 · 토글 · Esc  │
└──────────┬──────────────────┘                     └────────────────────┘  └───────────────────────┘
           ▼ 카카오톡 PC 앱 (Windows)
```

## 2. 원칙

- 인스타 네트워크 호출은 **ig-bridge.js에서만**. 같은 오리진이라 쿠키가 자동으로 붙고 쿠키를 읽거나 위조하지 않는다.
- hook.js는 **페이로드를 해석하지 않는다.** 프레임 도착만 알린다.
- 호스트는 **네트워크를 쓰지 않고, 자격 증명을 다루지 않고, stdout에 프레임만 쓴다.**
- 상태의 원본은 `chrome.storage.session`. 서비스워커·패널 메모리는 캐시다.
- 스레드·항목 id는 항상 `provider:rawId`. 패널은 원본 id를 만지지 않는다.
- panel.html은 iframe(위젯)과 팝업 창(독립 실행) 어디서든 동일하게 동작한다.

## 3. 컴포넌트와 책임

### 3.1 확장

| 파일 | 실행 위치 | 책임 | 하지 않는 것 |
|---|---|---|---|
| `manifest.json` | — | 권한·콘텐츠 스크립트·리소스·`key` 선언 | `tabs` 권한 |
| `hook.js` | instagram.com, MAIN world, `document_start` | `window.WebSocket`을 Proxy로 감싸 실시간 소켓의 `message`마다 신호 | 페이로드 파싱, chrome API |
| `ig-bridge.js` | instagram.com, ISOLATED world, `document_start` | 신호 수신→디바운스→inbox 조회, background 요청(REFRESH/THREAD/SEND/SEEN/PING) 처리, 상태 보고 | UI, storage |
| `lib/normalize.js` | ig-bridge와 같은 world + 테스트 | 인스타 원본 JSON → §5 모델 | 네트워크, DOM |
| `lib/providers.js` | background + panel + 테스트 | id 네임스페이스, capabilities, 인스타 inbox 태깅, 카카오 ITEM 적용, 병합·정렬·unread·상태 요약 | I/O |
| `lib/native-port.js` | background + 테스트 | 호스트 링크: 핸드셰이크, 요청 상관·타임아웃, 끊김→백오프 재연결, 이벤트 라우팅 | 프로토콜 해석 이상의 로직 |
| `background.js` | 서비스워커 | 프로바이더 2개 구동, 엔진 탭 확보·복구, storage.session, 패널 포트·브로드캐스트, 툴바·배지 | 인스타 fetch, UI |
| `widget.js` | 모든 http/https 최상위 프레임(instagram.com 제외) | 버블·배지·패널 컨테이너, iframe lazy 로드, 토글/Esc, TOGGLE 응답 | innerHTML, 네트워크 |
| `panel.html/css/js` | 확장 페이지(iframe 또는 팝업) | 통합 목록·필터·대화·컴포저·상태·배너, 포트 재연결, 낙관적 전송 | 네트워크, storage 직접 접근 |

### 3.2 호스트 (`host/`, PoC 위치 `poc/kakao-host/buoy_kakao_host/`)

| 파일 | 책임 |
|---|---|
| `framing.py` | 네이티브 메시징 프레이밍(32비트 길이 + UTF-8 JSON), 1MB 제한, Windows 바이너리 stdio |
| `protocol.py` | 요청 검증, 응답·이벤트 빌더, 메시지 id 해시 — **프로토콜 정본** |
| `host.py` | stdin 읽기 루프, 요청 디스패치, stdout 락 직렬화, 워커 풀(SEND·LIST_ROOMS), EOF 종료, 로그(stderr·파일) |
| `adapters/base.py` | 어댑터 인터페이스 `start(emit)`, `stop()`, `list_rooms()`, `send(room_id, text)` |
| `adapters/mock.py` | 카톡 없이 왕복 검증. 방 2개, 선택적 가짜 수신, 전송 시 답장 흉내 |
| `adapters/windows/win_send.py` | 카톡 창 열거(프로세스 기준), 입력창(`RICHEDIT50W`) `WM_SETTEXT` + Enter |
| `adapters/windows/toast_source.py` | `UserNotificationListener` 400ms 폴링, 카톡 토스트 → (방, 발신자, 본문) |
| `adapters/windows/__init__.py` | 위 둘을 조합. 부품이 없어도 살아서 `degraded` 보고 |

### 3.3 실행 컨텍스트

| | origin | DOM | `chrome.runtime` | `chrome.storage` | 인스타 쿠키 자동 첨부 |
|---|---|---|---|---|---|
| hook.js (MAIN) | instagram.com | 페이지 공유 | ✕ | ✕ | — |
| ig-bridge.js (ISOLATED) | instagram.com | 페이지 공유 | ○ | (사용 안 함) | ○ |
| background.js | chrome-extension:// | ✕ | ○ | ○ | (사용 금지) |
| widget.js (ISOLATED) | 호스트 사이트 | 페이지 공유 | ○ | session 읽기(접근 레벨 필요) | — |
| panel.js | chrome-extension:// | 자기 문서 | ○ | (사용 안 함) | — |
| 호스트 | 로컬 프로세스 | — | — | — | — |

## 4. Provider 인터페이스 (background.js 내부)

```ts
interface Provider {
  id: 'instagram' | 'kakao';
  caps: Capabilities;                    // { send, seen, history, rooms }
  status: Status;  detail: string | null;
  start(): void;  stop(): void;
  refresh(): Promise<void>;              // instagram: inbox 재조회 / kakao: LIST_ROOMS
  loadThread(rawId): Promise<Thread>;    // caps.history=false 면 캐시 반환
  send(rawId, text): Promise<SendResult>;
  seen(rawId, itemId): Promise<void>;    // caps.seen=false 면 no-op
  onEvent: (ev: ProviderEvent) => void;  // background가 주입
}
type ProviderEvent =
  | { type: 'INBOX',  provider: 'instagram', inbox: Inbox, perf?: { wsAt: number } }
  | { type: 'ITEM',   provider: 'kakao',     item: KakaoItem }
  | { type: 'STATUS', provider, status: Status, detail?: string, caps?: Capabilities };
```

- `InstagramProvider`: 엔진 탭 확보(`ensureEngineTab`), 엔진 중계(`askEngine`, 1.5초 간격 3회 재시도), 엔진 메시지를 ProviderEvent로 변환. `caps`는 고정 `{send:true, seen:true, history:true, rooms:true}`.
- `KakaoProvider`: `createNativeLink({ connect: () => chrome.runtime.connectNative('com.buoy.kakao'), getLastError, onEvent, onState })`. HELLO_ACK의 `capabilities`→`caps`, 호스트 `STATUS`→상태(`connected`→connected, `degraded`→degraded, `error`/`stopped`→disconnected), 링크 상태(`disconnected` + 사유)→disconnected.
- background는 두 프로바이더의 이벤트를 받아 `storage.session`을 갱신하고, `lib/providers.js`로 통합 목록·unread를 계산해 패널에 브로드캐스트한다(§7.4).

## 5. 데이터 모델

```ts
type Status = 'connecting'|'connected'|'degraded'|'disconnected'|'logged_out'|'rate_limited'|'error';
// 인스타 사용: connecting/connected/disconnected/logged_out/rate_limited/error
// 카카오 사용: connecting/connected/degraded/disconnected/error
interface Capabilities { send: boolean; seen: boolean; history: boolean; rooms: boolean }

interface User { id: string; username: string; name: string; avatar?: string }

interface Item {
  id: string;              // 인스타 item_id / 카카오 해시 / 낙관적 'tmp_…'
  provider: 'instagram'|'kakao';
  userId: string;          // 인스타 pk / 카카오 발신자 이름
  fromMe: boolean;
  type: string;            // 인스타 item_type / 카카오 'text'
  text: string;            // text면 본문, 아니면 플레이스홀더
  ts: number;              // epoch ms
  clientContext?: string;  // 인스타 전송 중복 제거
  source?: string;         // 카카오 'toast'|'window'|'mock'
  // panel 로컬: pending?, failed?, error?
}

interface Thread {
  id: string;              // 'instagram:<thread_id>' | 'kakao:<방이름>'
  rawId: string;
  provider: 'instagram'|'kakao';
  title: string;           // 인스타 thread_title || username 나열 / 카카오 방 이름
  users: User[];           // 나를 제외. 카카오는 관찰된 발신자 누적
  isGroup: boolean;        // 카카오는 발신자 2명 이상이면 true
  items: Item[];           // 오래된 순. 인스타 inbox 10개·thread 30개 / 카카오 로컬 최대 200개
  last: Item | null;
  unread: boolean;
  lastActivity: number;    // epoch ms
}

interface Inbox { threads: Thread[]; viewer: { id: string; username?: string }; fetchedAt: number }  // 인스타 원본(정규화 후, 네임스페이스 전)
interface SendResult { clientContext?: string; itemId: string | null; ts: number }
interface KakaoItem { id; roomId; roomName; sender; text; ts; fromMe: false; source; raw?: string[] }  // 호스트 ITEM.item (§8)
```

### 병합 규칙 (정본: `lib/providers.js`, 테스트 `poc/extension-provider/tests/providers.test.js`)
1. **인스타** `INBOX` 도착: `tagInstagramInbox`로 `provider`·네임스페이스 id 부여 → 스레드 메타(title, users, unread, last, lastActivity)는 최신값으로 덮고, 항목은 id로 upsert. 서버에서 온 `fromMe` 항목이 도착하면 `pending` 임시 항목 중 `clientContext`가 같거나 (텍스트 동일 && |ts 차| < 15초)인 것을 제거한다. `SEND_RESULT` 성공 시 임시 항목을 서버 `itemId`로 재키잉.
2. **카카오** `ITEM` 도착: `applyKakaoItem` — 방이 없으면 만들고, 같은 id는 무시, ts 정렬, 200개 초과분 버림, 열려 있는 방(`isOpen`)이 아니면 `unread=true`, 발신자를 users에 누적(2명 이상이면 `isGroup`). 낙관적 항목은 `SEND_RESULT ok`면 `pending=false`(id 유지), 실패면 `failed=true`. 서버 항목으로 교체하지 않는다(내 메시지가 알림에 안 오므로).
3. **통합 목록** `mergeThreads`: `lastActivity` 내림차순. `countUnread` → `{ total, byProvider }`. `filterThreads(threads, 'all'|'instagram'|'kakao')`.
4. **헤더 요약** `overallStatus`: 켜진 프로바이더가 모두 `connected`면 connected, 일부면 degraded, 없으면 disconnected. 프로바이더별 점은 각자 상태.

## 6. 데이터 흐름 (시퀀스)

### 6.1 시작
1. 서비스워커 시작 → `storage.session.setAccessLevel({accessLevel:'TRUSTED_AND_UNTRUSTED_CONTEXTS'})`(widget.js가 `unread`를 읽기 위해 매 시작마다) → `storage.local.providers` 읽기.
2. 인스타: `ensureEngineTab()` — `storage.session.engineTabId`가 유효하면 재사용 → `tabs.query({url:'https://www.instagram.com/*'})`에서 `/direct/` 우선 → 없으면 `tabs.create({url: DIRECT_URL, pinned:true, active:false})`. 생성 중 중복 호출은 같은 Promise 공유. 엔진 탭 로드 → hook.js가 WebSocket을 감쌈 → ig-bridge.js가 `ENGINE_READY{loggedIn}` 전송, 1.5초 뒤 첫 inbox 조회.
3. 카카오(켜져 있으면): `KakaoProvider.start()` → `connectNative` → `HELLO` → `HELLO_ACK`(caps) → `LIST_ROOMS`로 열린 방 목록 → `STATUS`.
4. 패널 포트가 열리면 `STATE`(§7.4) 1회 전송.

### 6.2 인스타 수신
1. 상대 전송 → 인스타 서버 → 엔진 탭 WebSocket `message`.
2. hook.js → `window.postMessage({__buoy:true, type:'IG_WS_FRAME', t: performance.now()}, location.origin)`.
3. ig-bridge.js → `scheduleRefresh(300)` (디바운스, 최소 간격 500ms, 쿨다운 반영) → `fetchInbox()` → `normalizeInbox()` → `runtime.sendMessage({from:'engine', type:'INBOX', inbox, perf})`.
4. background → `INBOX` 이벤트 → `storage.session['inbox:instagram']` 저장 → 통합 목록·unread 재계산 → 패널에 `THREADS`, `action.setBadgeText`.
5. panel.js 병합·렌더. widget.js는 `storage.onChanged`로 배지.
6. 성능 로그: 2단계 `t`와 렌더 완료 시각 차이를 `[buoy][perf] ig recv→render Nms`.

### 6.3 카카오 수신
1. 상대 전송 → 카톡 PC 토스트 → 호스트 `toast_source` 폴링(400ms)이 새 알림 id 감지 → `parse_kakao_toast` → `ITEM` 프레임.
2. native-port → `onEvent(ITEM)` → `KakaoProvider` → background `ITEM` 이벤트 → `applyKakaoItem` → `storage.session['threads:kakao']` 저장(코얼레싱 200ms) → 패널에 `ITEM`(증분) + `THREADS`(500ms 코얼레싱) → 배지.
3. 성능 로그: `ITEM.item.ts`(호스트 감지 시각)와 렌더 시각 차이 `[buoy][perf] kakao item→render Nms`.

### 6.4 전송 (공통 → 프로바이더)
1. panel.js: Enter → 낙관적 Item(`tmp_…`, `pending:true`) 렌더 → `request({type:'SEND', threadId, text})`.
2. background → `parseId(threadId)` → 해당 프로바이더 `send(rawId, text)`.
   - 인스타: `askEngine({type:'SEND'})` → ig-bridge `sendText()` → `item_id`·`timestamp`·`client_context` → 500ms 뒤 inbox 재조회.
   - 카카오: `link.send(roomId, text)` → 호스트 `SEND` → 어댑터 `send_text` → `SEND_RESULT`.
3. background → 패널 `SEND_RESULT{reqId, threadId, ok, result|error}` → §5 규칙으로 확정/실패.

### 6.5 스레드 열기·읽음
1. panel.js: 캐시 즉시 렌더 → `caps.history`면 `request({type:'THREAD', threadId})` → 인스타 `fetchThread()` 30개 → 병합.
2. 스레드가 unread였고 `caps.seen`이면 `post({type:'SEEN', threadId, itemId})`, 로컬 unread 해제. 카카오는 로컬 해제만.

### 6.6 조치가 필요한 상태
- 인스타 `logged_out`: ig-bridge fetch가 판정 → `STATUS` → 배너 [인스타그램 열기] → `OPEN_INSTAGRAM` → `tabs.update(engineTabId,{active:true})` + `windows.update(...,{focused:true})`. 로그인 후 폴백 폴링 성공 시 자동 `connected`.
- 카카오 `disconnected`(호스트 미설치·죽음): native-port가 `chrome.runtime.lastError.message`를 사유로 보고 → 배너 [설치 안내](`OPEN_HELP{provider:'kakao'}` → 확장 내 `help.html#kakao`) → 백오프 재연결.
- 카카오 `degraded`(수신 또는 전송 부품 없음, 알림 권한 거부, 방해 금지): 호스트 `STATUS.detail`을 툴팁·배너 보조 문구로.

### 6.7 재시작·복구
- 서비스워커 종료 후 메시지가 오면 다시 뜨고 `storage.session`에서 상태를 읽는다. 패널 포트는 끊기므로 panel.js가 800ms 후 재연결하고 `STATE`를 다시 받는다. 호스트 포트도 닫혀 호스트가 EOF로 종료되므로 재연결(호스트 재시작 ~300ms).
- 엔진 탭 `onRemoved` → `engineTabId` 삭제, `disconnected`, 패널이 열려 있으면 1초 후 `ensureEngineTab()`.
- 확장 리로드 → 기존 콘텐츠 스크립트는 `chrome.runtime` 호출 시 "Extension context invalidated". 모든 호출을 try/catch로 감싸고 조용히 멈춘다.
- 카톡 PC 종료 → 호스트는 살아 있고 전송 실패·알림 없음 → `degraded`. 다시 켜면 다음 성공 시 `connected`.

## 7. 확장 내부 메시지 규약

모든 메시지는 JSON 직렬화 가능한 평범한 객체. 타입 문자열은 각 파일 상단 상수.

### 7.1 hook.js → ig-bridge.js (`window.postMessage`, targetOrigin = `location.origin`)
```js
{ __buoy: true, type: 'IG_WS_FRAME', t: performance.now() }
```
수신 측은 `event.source === window && event.data?.__buoy === true`만 처리.

### 7.2 ig-bridge.js → background (`chrome.runtime.sendMessage`, 응답 없음)
```js
{ from: 'engine', type: 'ENGINE_READY', loggedIn: boolean, url: string }
{ from: 'engine', type: 'INBOX',  inbox: Inbox, perf?: { wsAt: number, sentAt: number } }
{ from: 'engine', type: 'STATUS', status: Status, detail?: string }
```

### 7.3 background → ig-bridge.js (`chrome.tabs.sendMessage(engineTabId, msg)` → Promise<응답>)
| 요청 | 응답 (성공) |
|---|---|
| `{ to:'engine', type:'REFRESH' }` | `{ ok:true, inbox: Inbox }` |
| `{ to:'engine', type:'THREAD', threadId }` | `{ ok:true, thread: Thread }` |
| `{ to:'engine', type:'SEND', threadId, text }` | `{ ok:true, result: SendResult }` |
| `{ to:'engine', type:'SEEN', threadId, itemId }` | `{ ok:true }` |
| `{ to:'engine', type:'PING' }` | `{ ok:true, loggedIn }` |

실패: `{ ok:false, error: 'logged_out'|'rate_limited'|'http_<status>'|'send_failed'|'unknown_type'|'engine_unavailable' }`. 리스너는 `return true`로 비동기 응답 선언. `threadId`는 원본 id(네임스페이스 제거는 background가).

### 7.4 panel.js ↔ background (`chrome.runtime.connect({ name: 'panel' })`)
panel → background
```js
{ type: 'REFRESH', provider?: 'instagram'|'kakao' }        // 없으면 전체
{ type: 'THREAD', threadId, reqId }                        // threadId = 네임스페이스 id
{ type: 'SEND', threadId, text, reqId }
{ type: 'SEEN', threadId, itemId }                         // caps.seen=false 면 background가 무시
{ type: 'OPEN_INSTAGRAM' }
{ type: 'OPEN_HELP', provider }
{ type: 'SET_OPEN_THREAD', threadId | null }               // 열린 대화 (카카오 unread 판정용)
```
background → panel
```js
{ type: 'STATE', providers: { [id]: { status, detail, caps, enabled } }, threads: ThreadSummary[], unread: { total, byProvider } }  // 연결 직후 1회
{ type: 'THREADS', threads: ThreadSummary[], unread }      // 통합 목록 갱신 (500ms 코얼레싱). ThreadSummary = items 최근 10개
{ type: 'ITEM', threadId, item }                           // 카카오 증분 항목 (열린 대화 즉시 갱신)
{ type: 'STATUS', provider, status, detail?, caps? }
{ type: 'THREAD', reqId, thread }                          // 인스타 서버 30개 / 카카오 캐시 200개
{ type: 'SEND_RESULT', reqId, threadId, ok, result?, error? }
{ type: 'ERROR', reqId, error }
```
`reqId`는 패널이 증가시키는 정수. 패널은 15초 타임아웃. 패널 병합: `THREADS`는 메타 덮어쓰기 + 항목 id 합집합, `ITEM`은 단건 upsert, `THREAD`는 항목 합집합(§5 규칙).

### 7.5 background → widget.js (`chrome.tabs.sendMessage(activeTabId, msg)`)
```js
{ to: 'widget', type: 'TOGGLE' }   →   { ok: true }
```
`ok:true`가 아니면(콘텐츠 스크립트 없음, instagram.com, chrome://) `panel.html?standalone=1`을 `windows.create({type:'popup', width:400, height:640})`.

### 7.6 panel(iframe) → widget.js (부모 창)
```js
parent.postMessage({ __buoy: true, type: 'CLOSE' }, '*')
```
widget.js는 `event.origin === new URL(chrome.runtime.getURL('')).origin`일 때만 처리.

### 7.7 저장소 키
`chrome.storage.session` (브라우저 종료 시 삭제)

| 키 | 타입 | 쓰는 곳 | 읽는 곳 |
|---|---|---|---|
| `engineTabId` | number | background | background |
| `inbox:instagram` | Inbox | background | background(STATE 계산) |
| `threads:kakao` | Thread[] (최대 방 50개, 방당 200항목) | background | background |
| `provider:<id>:status` / `provider:<id>:detail` / `provider:<id>:caps` | Status / string / Capabilities | background | background |
| `unread` | number | background | widget.js(`onChanged`), background |
| `unreadByProvider` | `{instagram, kakao}` | background | background |

`chrome.storage.local` (설정만, 메시지 내용 금지): `providers: {instagram:true, kakao:true}`, `bubblePos`, `theme`.

## 8. 확장 ↔ 카카오 호스트 프로토콜 (정본: `host/…/protocol.py`)

전송 규격: Chrome Native Messaging — 메시지 = 32비트 길이(네이티브 바이트 순서) + UTF-8 JSON 객체. 호스트→확장 1MB 이하. 호스트 이름 `com.buoy.kakao`.

확장 → 호스트

| 메시지 | 필드 | 응답 |
|---|---|---|
| `HELLO` | `protocol:1, client, version` | `HELLO_ACK` |
| `PING` | `reqId` | `PONG {reqId, ts}` |
| `LIST_ROOMS` | `reqId` | `ROOMS {reqId, rooms:[{id,name,kind}]}` |
| `SEND` | `reqId, roomId, text` (비어있지 않은 문자열, 5000자 이하) | `SEND_RESULT {reqId, roomId, ok, error?, ts}` |
| `SHUTDOWN` | — | (호스트 종료) |

호스트 → 확장

| 메시지 | 필드 |
|---|---|
| `HELLO_ACK` | `protocol, host, version, adapter:'mock'|'windows', capabilities:{send,rooms,history,seen}` — 시작 직후 1회 + HELLO마다 |
| `ITEM` | `item:{id, roomId, roomName, sender, text, ts(ms), fromMe:false, source:'toast'|'window'|'mock', raw?:string[]}` |
| `STATUS` | `status:'connected'|'degraded'|'error'|'stopped', detail?, source?` |
| `ERROR` | `error, reqId?` |
| `LOG` | `level, msg` (디버그) |

규칙
- `reqId`는 확장이 증가시키는 정수. 응답은 같은 `reqId`. 확장 타임아웃 15초(PING은 3초).
- 호스트는 어떤 입력에도 죽지 않는다. 잘못된 요청은 `ERROR`, 어댑터 예외는 `SEND_RESULT ok:false` 또는 `STATUS error`.
- stdin EOF(포트 닫힘) → 어댑터 정지 → `STATUS stopped` → 종료 코드 0.
- 프로토콜 변경 시 `protocol` 번호를 올린다. 확장은 불일치 시 `degraded`로 표시한다.
- 오류 코드(`SEND_RESULT.error`): `room_window_not_open`, `edit_not_found`, `send_unavailable`, `room_not_found`, 그 외 `예외이름: 메시지`.

호스트 수명주기: `connectNative`가 프로세스를 띄운다. 포트가 열려 있는 동안 살아 있고, 서비스워커 종료로 포트가 닫히면 EOF로 종료된다. 다음 활성화 때 재연결(~300ms). 호스트 크래시 → `onDisconnect` + `lastError` → 백오프 재연결.

## 9. 외부 인터페이스

### 9.1 인스타그램 웹 (M0에서 검증 후 "검증 상태" 갱신)

모든 요청은 ig-bridge.js에서 `fetch(location.origin + path, { credentials:'include', headers })`. 아래는 웹 클라이언트가 써 온 형태로 알려진 값이며, **"미확인"이면 코드에 쓰기 전에 DevTools에서 확인한다.**

공통 헤더: `x-ig-app-id: 936619743392459`(**확정 2026-09-07** — 이 값으로 inbox 200. 게이트웨이 소켓의 `x-dgw-appid`와도 일치), `x-csrftoken: <cookie csrftoken>`, `x-csrftoken: <cookie csrftoken>`, `x-requested-with: XMLHttpRequest`, `x-instagram-ajax: 1`(선택), `x-asbd-id`(요구되면).

| 용도 | 메서드 · 경로 (알려진 형태) | 요청 본문 | 응답에서 쓰는 필드 | 검증 상태 |
|---|---|---|---|---|
| 목록 | `GET /api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=20&thread_message_limit=10` | — | `inbox.threads[]`, `viewer.pk`, `viewer.username` | **확인 2026-09-07** — 200 `application/json`. 세션 쿠키 + `x-ig-app-id: 936619743392459` + `x-requested-with` 만으로 성공. 헤더 없이 보내면 400 |
| 대화 | `GET /api/v1/direct_v2/threads/{thread_id}/?limit=30` | — | `thread.items[]`, `thread.viewer_id`, `thread.oldest_cursor`, `thread.has_older` | 미확인 |
| 텍스트 전송 | `POST /api/v1/direct_v2/threads/broadcast/text/` | form: `action=send_item`, `client_context`, `mutation_token`, `offline_threading_id`, `thread_ids=["<id>"]`, `text`, `is_shh_mode=0`, `send_attribution=direct_thread` | `status`, `payload.item_id`, `payload.timestamp`, `payload.client_context` | 미확인 — MQTT 전용이면 C5 |
| 읽음 | `POST /api/v1/direct_v2/threads/{thread_id}/items/{item_id}/seen/` | form: `thread_id`, `item_id`, `action=mark_seen`, `client_context` | `status` | 미확인 |
| 실시간 | `wss://edge-chat.instagram.com/chat?sid=&cid=` (MQTT) + `wss://gateway.instagram.com/ws/{rpsignaling,lightspeed,realtime,streamcontroller}?x-dgw-*` | — | hook.js가 존재만 감지 | **확인 2026-09-07** — 소켓 5개, 모두 문서 스크립트가 여는 것으로 관찰(C4 회피). DM이 오는 소켓은 확인 중 |

`client_context`: 19자리 숫자 문자열, `String(Date.now()) + 6자리 난수`.

원본 → 내부 매핑 (`lib/normalize.js`)

| 원본 | 내부 | 비고 |
|---|---|---|
| `thread.thread_id` / `thread_title` / `is_group` | `Thread.rawId` / `title` / `isGroup` | title 비면 username 나열 |
| `thread.users[].pk / username / full_name / profile_pic_url` | `User.id / username / name / avatar` | pk 문자열화 |
| `thread.items[].item_id / user_id / item_type / text / timestamp / client_context` | `Item.id / userId / type / text / ts / clientContext` | timestamp µs → ms |
| `thread.read_state` | `Thread.unread` | `1`=안읽음(추정). 없으면 `last_seen_at[viewer].item_id !== last_permanent_item.item_id && last_permanent_item.user_id !== viewer` |
| `thread.last_activity_at` | `Thread.lastActivity` | µs → ms |
| `viewer.pk` / `thread.viewer_id` | `Inbox.viewer.id` / `fromMe` 판정 | |

응답 오류 판정(`igFetch`) — **순서가 중요하다.** 429가 `text/html`로 오는 것을 2026-09-07에 확인했으므로,
"JSON 아님" 검사를 먼저 하면 요청 제한을 로그아웃으로 오인한다.
1) 429 → `rate_limited` 2) 401/403 또는 로그인 페이지 리다이렉트 → `logged_out`
3) JSON 아님 → `logged_out` 4) 그 외 !ok → `http_<status>`.

**웹앱과 우리의 경로가 다르다(2026-09-07 관찰).** 현재 instagram.com 웹앱은 DM 읽기를 `graphql`
요청으로, 전송을 웹소켓으로 한다. 개발자 도구 본문 검색에서 보낸 문자열이 어떤 HTTP 요청에도
잡히지 않았다. 그래도 위 `/api/v1/direct_v2/` 경로는 살아 있어서 우리가 직접 부르면 동작한다.
즉 읽기는 이 표대로 가고, **전송만 별도 검증이 필요하다**(§A1.5).

### 9.2 카카오톡 PC (Windows, PoC E1a·E2로 검증 후 갱신)

| 접점 | 방식 | 값 (알려진 형태) | 검증 상태 |
|---|---|---|---|
| 카톡 창 찾기 | `EnumWindows` + 프로세스 실행파일 `kakaotalk.exe` | 채팅방 창 제목 = 방 이름 | 미확인 (E2가 창 목록·class 출력) |
| 입력창 | `EnumChildWindows` class | `RICHEDIT50W` (`win_send.CHAT_EDIT_CLASS`) | 미확인 (E2) |
| 전송 | `WM_SETTEXT` + `WM_KEYDOWN/KEYUP VK_RETURN` (창이 앞에 없어도) | — | 미확인 (E2) |
| 수신 | `UserNotificationListener.get_notifications_async(TOAST)` 400ms 폴링, 앱 이름에 "카카오톡"/"kakaotalk" | 텍스트 줄 → `parse_kakao_toast`: `[제목, 본문]`(1:1), `[제목, "발신자: 본문"]`(그룹), `[방, 발신자, 본문…]` | 미확인 (E1a가 raw 출력) |
| 알림 권한 | `request_access_async()` → `ALLOWED` | 거부 시 `degraded: notification access not allowed` | 미확인 (E0/E1a) |
| 방 목록 | 입력창이 있는 카톡 창 + 알림으로 관찰된 방 | `ROOMS` | 미확인 (E2) |

전제: 카톡 PC 알림 켜짐 + 메시지 내용 표시, Windows 알림 허용, 방해 금지 꺼짐. 카톡 창이 포커스 상태면 알림이 안 뜰 수 있다(E1a에서 확인).

## 10. 상태 머신

```
                 ENGINE_READY(loggedIn) / INBOX 성공                 HELLO_ACK + STATUS connected
 connecting ────────────────────────────▶ connected      connecting ───────────────────────▶ connected
     │ ENGINE_READY(false) / fetch→logged_out  │ ▲ 다음 조회 성공        │ HELLO_ACK 5s 없음 / onDisconnect     │ ▲ 다음 성공
     ▼                                         ▼ │                       ▼                                      ▼ │
 logged_out ◀────────────────────  rate_limited (429 쿨다운)       disconnected(사유) ◀─────────── degraded(부품 없음·권한·방해금지)
     ▲                                         │ 기타 예외                │ 백오프 재연결
 disconnected ◀── 엔진 탭 제거 / 3회 실패        ▼                        └──▶ connecting
     └── ensureEngineTab + ENGINE_READY ──▶ connecting            error(detail)
                 [인스타 프로바이더]                                       [카카오 프로바이더]
```

패널 문구: connecting "연결 중…", connected "연결됨", degraded "일부 기능 제한 — {detail}", disconnected "인스타그램 탭 연결 끊김" / "카카오 호스트에 연결할 수 없어요" (배너), logged_out "인스타그램 로그인 필요" (배너), rate_limited "요청 제한 — 잠시 후 자동 재시도", error "오류: {detail}".

## 11. 재조회·백오프·타임아웃 정책

| 항목 | 값 | 위치 |
|---|---|---|
| WS 신호 디바운스 / 재조회 최소 간격 | 300ms / 500ms | ig-bridge |
| 동시 조회 | 1개. 진행 중 신호가 오면 완료 후 200ms 뒤 1회 추가 | ig-bridge |
| 폴백 폴링 | 15초 (`FALLBACK_POLL_MS`, 0이면 끔) | ig-bridge |
| 429 쿨다운 | 30초, 연속 시 2배(최대 5분), 성공 시 초기화 | ig-bridge |
| 전송 후 재조회 | 500ms 뒤 | ig-bridge |
| background→엔진 재시도 | 1.5초 간격 3회, 실패 시 `disconnected` | background |
| 호스트 HELLO_ACK 타임아웃 | 5초 | native-port |
| 호스트 요청 타임아웃 | 15초 (PING 3초) | native-port |
| 호스트 재연결 백오프 | 1·2·4·8·16·30초, 성공 시 초기화 | native-port |
| 호스트 토스트 폴링 | 400ms | toast_source |
| 패널 요청 타임아웃 / 포트 재연결 | 15초 / 끊김 800ms 후 | panel |
| 패널 `THREADS` 코얼레싱 / storage 쓰기 코얼레싱 | 500ms / 200ms | background |
| 엔진 탭 재생성 | 제거 1초 후(패널 열려 있을 때만) | background |

## 12. 보안·프라이버시

- **쿠키:** `sessionid`는 HttpOnly라 읽을 수 없고 읽을 필요도 없다. 읽는 값은 `csrftoken`(헤더), `ds_user_id`(로그인 여부)뿐.
- **네트워크 경계:** 인스타 요청은 엔진 탭에서만. background는 인스타에 fetch하지 않는다. 호스트는 네트워크 자체를 쓰지 않는다 — 카카오 대화는 PC 안에서만 움직인다.
- **호스트 페이지 격리:** widget.js는 closed Shadow DOM, `adoptedStyleSheets`, `createElement`만. 패널은 교차 출처 iframe. 부모↔iframe 메시지는 `__buoy` 플래그 + origin 검증.
- **렌더링:** 패널의 모든 사용자 텍스트(호스트 `ITEM.text` 포함)는 `textContent`. 링크 자동 변환 없음(v0.1).
- **저장:** 메시지·스레드는 `storage.session`만. 호스트는 저장하지 않는다. 카카오 `raw` 필드는 E1a 확정 후 제거한다.
- **권한:** `storage`, `nativeMessaging`, instagram host, 콘텐츠 스크립트 `http(s)://*/*`. "모든 웹사이트 데이터" 경고는 플로팅 버블의 비용(ADR-002). 호스트 매니페스트 `allowed_origins`로 이 확장만 호스트에 접근한다.
- **로그:** 본문·사용자 ID 금지. 스레드 id는 뒤 4자리만. 호스트 `--verbose`에서도 길이만.

## 13. 수명주기와 저장소

- MV3 서비스워커는 유휴 30초 후 종료된다. 열린 포트(패널·호스트)와 메시지 수신이 수명을 연장하지만 이에 의존하지 않는다. 필요한 상태는 전부 `storage.session`에 있고 메모리 상태(패널 Set, 프로바이더 객체)는 재연결로 복구된다.
- `storage.session`은 기본적으로 콘텐츠 스크립트에서 못 읽는다. background 시작마다 `setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS)`를 호출해야 widget.js가 `unread`를 읽는다.
- 위젯 iframe은 처음 열 때 로드되고 닫아도 언로드하지 않는다(재열기 ≤ 100ms). 탭이 닫히면 함께 사라진다.
- 엔진 탭이 instagram.com 밖으로 이동하면 `tabs.get().url`이 권한 밖이라 `undefined` → `getEngineTabId()`가 null → 다음 `ensureEngineTab()`이 새 탭을 만든다.
- 호스트 프로세스는 포트와 수명을 같이한다(§8).

## 14. UI 설계 원칙과 토큰

- 성격: 조용하고 빠른 메신저. 장식 없음. 눈에 띄는 요소는 버블과 내 말풍선의 보라 하나. 프로바이더 표시는 작은 라벨(`IG`/`KT`) 또는 점.
- 색: paper `#FFFFFF`, ink `#1C1B22`, mist `#F2F1F6`, muted `#6E6C7A`, accent `#5B4FE6`, ok `#2BB673`, warn `#E8A33D`, bad `#E5484D`, 프로바이더 점 instagram `#5B4FE6` / kakao `#B8860B`(브랜드 색과 무관한 황토색). 다크: paper `#17161C`, mist `#24232B`, ink `#ECECF1`.
- 글꼴: `Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`. 15(본문)/13(보조)/11.5(메타)px. 이름 600, 본문 400. 대문자 라벨·아이콘 남발 금지.
- 레이아웃: 버블 52px `right:20px; bottom:20px`. 패널 380 × `min(620px, 100vh − 110px)`, `right:20px; bottom:84px`, radius 16, 그림자 `0 12px 40px rgba(0,0,0,.28)`. 상단 바 52px: 뒤로(대화일 때) · 제목+상태 점 · 새로고침 · 닫기. 목록 위 필터 칩 한 줄.
- 모션: 사용자 동작 응답만(열림/닫힘 120ms, 새로고침 회전). `prefers-reduced-motion`이면 제거.
- 문구: 사용자 관점 평문. 오류는 원인과 해결을 말한다. "인스타그램 탭이 닫혔어요. 다시 여는 중…", "로그인이 풀렸어요. 인스타그램 탭에서 로그인하면 자동으로 이어져요.", "카카오 호스트가 응답하지 않아요. PC 카카오톡과 호스트 설치를 확인하세요.", "PC 카카오톡에서 이 방을 열어 두세요."

## 15. 호스트 설치·등록 (Windows)

- 파일: `%LOCALAPPDATA%\Buoy\kakao-host\host.bat`(OEM 코드페이지로 저장, `PYTHONPATH` 설정 후 `python -m buoy_kakao_host --adapter windows`), `com.buoy.kakao.json`(UTF-8, `path`·`allowed_origins`).
- 레지스트리: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.buoy.kakao` = 매니페스트 경로. Edge/Whale은 각자 경로(`install/register.ps1 -Browser`).
- 확장 ID 고정: `manifest.json`에 `key`(M5). 바뀌면 `register.ps1 -ExtensionId` 재실행.
- 로그: `%LOCALAPPDATA%\Buoy\kakao-host.log`.
- Python 없는 PC: M6에서 PyInstaller 단일 exe로 대체.

## 16. 확장 지점

- **사이드패널 모드(M7):** `side_panel.default_path = panel.html`, `sidePanel.setPanelBehavior({openPanelOnActionClick:true})`. panel.js 변경 없음.
- **인스타 v2 실시간 파싱:** hook.js에서 MQTT PUBLISH 토픽/페이로드 해석 → 재조회 없이 항목 생성. 참고 mautrix-meta(messagix). 재검토 조건: v1 측정에서 `recv→render` p50 미달이고 병목이 재조회 왕복일 때(ADR-003).
- **카카오 수신 경로 B(창 UIA 읽기):** E1b에서 텍스트가 노출되면 `window_source.py`(열린 방 1초 폴링·diff)를 toast와 병행(ADR-008).
- **카카오 방 열기 자동화(M6):** 메인 창 검색 조작. 실패 시 안내 유지.
- **카카오 macOS 어댑터:** 전송은 Accessibility API(AXUIElement)로 텍스트 필드 설정 + Return, 수신은 알림 DB(`~/Library/Group Containers/group.com.apple.usernoted/db2/db`) 폴링 또는 AX로 채팅창 읽기. 호스트 등록은 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.buoy.kakao.json`. 구조·프로토콜은 그대로, `adapters/macos/`만 추가.
- **더 불러오기(인스타):** `thread.oldest_cursor`로 위 스크롤 시 이전 메시지.
- **알림:** `notifications` 권한 + 패널이 하나도 열려 있지 않을 때만(ADR 후).

## 부록 A. reference/ · poc/

- `reference/manifest.json`: 인스타 콘텐츠 스크립트·리소스 선언 초안. M1에서 루트로 복사하고 `nativeMessaging`·`key`는 M5에서 추가.
- `reference/hook.js`: §7.1 신호를 내는 MAIN world 훅. 소켓 호스트 정규식(`/edge-chat|mqtt/i`)은 M0 결과로 확정.
- `poc/extension-provider/lib/`: §5 병합 규칙과 §8 링크의 참조 구현(테스트 15개). M5에서 `lib/`로 승격.
- `poc/kakao-host/`: §3.2, §8, §9.2의 참조 구현(테스트 20개, 실험 스크립트, 설치 스크립트). M5에서 `host/`로 승격.
- `poc/extension-native-echo/`: §8 왕복을 Chrome에서 검증하는 실험 확장(docs/04 §B E3·E4).
