# 개발 계획 — floating-messenger

| 항목 | 내용 |
|---|---|
| 문서 버전 | 0.3 (통합본 — 인스타 트랙·카카오 트랙·통합 단계를 한 로드맵으로) |
| 작성일 | 2026-09-07 |
| 현재 단계 | **인스타 I-M0 시작 전 · 카카오 K-P0(자동 검증) 완료 · K-P1(실기 실험) 대기** |

## 1. 개발 방향 (원칙)

1. **검증 → 구현 순서.** 외부와 닿는 값(인스타 엔드포인트·응답 필드, 카톡 컨트롤 클래스·알림 레이아웃)은 DevTools·실험 스크립트로 확인한 뒤 코드에 넣는다. 추측으로 채우지 않는다.
2. **빌려 쓰기 > 다시 만들기.** 인증·세션·실시간은 원래 클라이언트(인스타 웹 페이지, 카톡 PC 앱) 것을 그대로 쓴다. 우리가 만드는 것은 가벼운 화면과 중계뿐이다.
3. **프로바이더 경계.** 메신저별 차이는 프로바이더 안과 `capabilities`에만 있다. 패널·위젯에 "인스타라서/카톡이라서" 분기를 두지 않는다.
4. **얇은 계층, 한 방향 흐름.** 엔진/호스트 → 프로바이더 → background → 패널. 원본 응답 형태는 정규화 계층(`lib/normalize.js`, 호스트 어댑터) 밖으로 새지 않는다.
5. **체감 속도가 목표.** 서버 전달 속도는 못 바꾼다. 도착→표시, 입력→표시 구간만 줄이고 매 단계에서 수치를 잰다.
6. **작게 자주 확인.** 단계마다 로드해서 실제로 쓴다. 자동 테스트가 있는 부분은 매 변경마다 돌린다.

## 2. 기술 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 플랫폼 | Chrome MV3, Chrome 116+ | `world:"MAIN"` 콘텐츠 스크립트, `storage.session` 접근 레벨, `nativeMessaging` |
| 확장 언어 | Vanilla JS(ES2022) + JSDoc | 번들 없이 바로 로드, 디버깅 단순. TS는 M4 후 ADR |
| 공용 로직 | UMD 패턴(`globalThis.X` + `module.exports`) | 확장에서 `<script>`/`importScripts`, 테스트에서 `require` |
| UI | 프레임워크 없음, 직접 DOM | 화면 2개. 의존성 0 |
| 스타일 | panel.css 1개 + widget은 `adoptedStyleSheets` | CSP·Trusted Types 호환 |
| 호스트 언어 | Python 3.10+, `pywin32` + `pywinrt` | 창 제어·알림 API 접근이 쉬움. 나중에 PyInstaller exe |
| 호스트 구조 | 호스트 본체 + 어댑터(mock/windows) | 카톡 없이 왕복 검증, OS 추가 시 어댑터만 |
| 테스트 | `node --test`(확장 순수 로직), `pytest`(호스트), 수동 체크리스트(docs/04) | 브라우저·OS 의존 부분은 실기 |
| 상태 저장 | `chrome.storage.session` | SW 재시작 대응, 브라우저 종료 시 소멸 |

## 3. 리포 구조

`CLAUDE.md` "디렉터리" 절과 동일. 신규 파일은 그 구조 밖에 만들지 않는다. `poc/`는 M5에서 `lib/`·`host/`·`tests/`로 승격하고 비운다.

## 4. 로드맵

두 트랙은 독립이라 병행할 수 있다. 통합(M5)은 두 트랙이 모두 끝난 뒤.

```
인스타 트랙   I-M0 검증 ─ I-M1 엔진 ─ I-M2 위젯·패널 ─ I-M3 전송·읽음 ─ I-M4 안정화 ─┐
                                                                                    ├─ M5 카카오 통합 ─ M6 완성도 ─ M7 편의 ─ v2
카카오 트랙   K-P0 자동 검증(완료) ─ K-P1 실기 실험 E0~E5 ─ 판정 ──────────────────────┘
```

각 단계는 **작업 → 완료 기준 → 검증** 순서. 완료 기준을 다 만족해야 다음으로 넘어간다.

### I-M0. 인스타 조사·검증 (0.5일) — 코드 없음
작업
1. Chrome에서 instagram.com/direct 열고 DevTools > Network.
2. **WS:** 필터 WS. 실시간 소켓 URL·initiator 확인. Worker면 C4 → 폴백 폴링 중심으로 계획 수정.
3. **inbox:** 로드·새로고침 시 `direct_v2/inbox` 요청의 경로·쿼리·헤더(`x-ig-app-id`, `x-asbd-id`) 기록. 응답 JSON을 `tests/fixtures/inbox.json`으로(이름·본문·URL은 가짜 값).
4. **thread:** 스레드 클릭 시 요청 → `tests/fixtures/thread.json`.
5. **send:** 텍스트 하나 전송하고 요청 확인. HTTP POST면 경로·본문 기록. WS로만 나가면 C5 → 전송 대안 ADR.
6. **seen:** 스레드 열 때 seen 요청 확인.
7. `docs/02` §9.1 "검증 상태"를 갱신하고 `docs/01`을 0.4로.

완료 기준: §9.1에 "미확인"이 없다(확인됨 또는 대안 결정). fixtures 2개, 민감정보 없음. 검증: docs/04 §A1.

### I-M1. 엔진 + 콘솔 (1일)
작업
- `reference/manifest.json`, `reference/hook.js`를 루트로 복사. 정규식 반영.
- `lib/normalize.js` + `tests/normalize.test.js`(fixtures 기반: µs→ms, unread 판정, 플레이스홀더).
- `ig-bridge.js`: `API`/`HEADERS` 상수, `igFetch`(오류 판정), `fetchInbox`, `scheduleRefresh`(디바운스·최소 간격·쿨다운), 폴백 폴링, `ENGINE_READY`/`INBOX`/`STATUS`, `REFRESH`/`PING` 처리.
- `background.js`: `setAccessLevel`, `InstagramProvider`(`ensureEngineTab`, `onRemoved` 복구, `askEngine`), `storage.session` 저장, `unread`, 배지, 툴바 클릭 시 임시 `panel.html?standalone=1` 팝업(빈 페이지여도 됨). 처음부터 §4 Provider 인터페이스 모양으로 쓴다(카카오는 M5).
- 성능 로그 `[buoy][perf] ig recv→inbox Nms`.

완료 기준: 확장 로드 후 핀 탭이 자동 생성되고, 다른 기기에서 보낸 메시지가 SW 콘솔에 1초 내 `INBOX`로 찍히며 `unread`가 바뀐다. 핀 탭을 닫으면 3초 내 재생성(팝업 열린 상태). `node --test` 통과. 검증: docs/04 §A2, §A3.

### I-M2. 위젯 + 패널 읽기 전용 (1~2일)
**순서 변경(2026-09-07, 사용자 결정):** I-M2를 I-M0·I-M1보다 먼저 진행한다. 위젯·패널은 인스타 엔드포인트를
전혀 참조하지 않으므로 I-M0 결과에 의존하지 않는다. 대신 `background.js`는 이 단계에서 포트·배지·툴바만
구현하고 데이터는 내장 mock을 쓴다(`MOCK` 상수). I-M1에서 `InstagramProvider`가 그 자리를 대체한다.
`manifest.json`의 인스타 콘텐츠 스크립트 3줄(hook.js, lib/normalize.js, ig-bridge.js)도 I-M1에서 추가한다.
파일이 없으면 확장이 로드되지 않기 때문이다. 컴포저는 I-M3 범위 그대로 두었다.

작업
- `widget.js`: 호스트 div → closed Shadow DOM, `adoptedStyleSheets`, 버블·배지·컨테이너, iframe lazy 로드, 토글·Esc, `TOGGLE` 응답, `CLOSE` 수신(origin 검증), `storage.onChanged` 배지.
- `panel.html/css/js`: 포트 연결·재연결, `STATE/THREADS/STATUS` 처리, 목록(필터 칩은 켜진 프로바이더가 1개면 숨김)·대화 렌더(병합 규칙), 상태 점·배너·[인스타그램 열기], 뒤로/새로고침/닫기, standalone 모드(`window.close`). `lib/providers.js`를 패널에서도 로드해 `mergeThreads`·`filterThreads`를 그대로 쓴다.
- `background.js`: 포트 관리, `STATE`·`THREADS` 송신(500ms 코얼레싱), `THREAD` 중계, `OPEN_INSTAGRAM`, 툴바 → `TOGGLE` → 실패 시 팝업.
- 성능 로그 `[buoy][perf] ig recv→render Nms`.

완료 기준: 4개 기준 사이트에서 버블·배지·패널, 콘솔 오류 0. 수신 시 열린 패널이 갱신되고 `recv→render` p50 ≤ 800ms(10회). 로그아웃 배너·버튼 동작. 검증: docs/04 §A4, §A5, §D.

### I-M3. 전송 + 읽음 (1일)
작업: `ig-bridge.js` `sendText`·`markSeen`·`SEND`/`SEEN` 처리·전송 후 재조회(M0에서 C5면 대안). `panel.js` 컴포저(Enter/Shift+Enter/IME), 낙관적 항목, `SEND_RESULT` 재키잉, 실패·재시도, 열 때 `SEEN`. `background.js` 중계.
완료 기준: Enter 후 50ms 내 말풍선, 1.5초 내 확정, 한글 조합 중 Enter 무시. 오프라인 전송 → 실패+재시도 → 온라인 후 성공. 안읽음 스레드 열면 배지 감소, 인스타 웹에서도 읽음. 검증: docs/04 §A6.

### I-M4. 안정화 (1일)
작업: SW 강제 종료 후 패널 재연결, 확장 리로드 후 고아 스크립트 예외 제거, 429 재현→쿨다운, Trusted Types·엄격 CSP·한국 사이트 재확인, 메모리 ≤ 5MB, 접근성(Tab·포커스·aria·reduced-motion), 문서 최신화, `README.md` 사용법.
완료 기준: docs/04 §A 전 섹션 통과. 버전 `0.1.0` 태그, `dist/` zip.

### K-P0. 카카오 PoC 자동 검증 — 완료
`poc/kakao-host`(pytest 20), `poc/extension-provider`(node 15), 로컬 왕복 `e3_echo_check.py` GO. 상세는 docs/04 §B0.

### K-P1. 카카오 PoC 실기 실험 (0.5~1일, Windows)
`docs/04` §B1 순서로 E0→E1a(→E1b)→E2→E3→E4(→E5)를 수행하고 §B3 결과표를 채운다.
완료 기준: E1(a 또는 b)·E2·E3·E4 판정 기록, ADR-008 상태 확정, `docs/02` §9.2 "검증 상태" 갱신, `parse_kakao_toast`·`CHAT_EDIT_CLASS`와 테스트 갱신. 판정 트리(docs/04 §B2)에 따라 M5 범위(전체 / 읽기 전용 / 보류)를 결정한다.

### M5. 카카오 프로바이더 통합 (2일, I-M4 + K-P1 GO 후)
작업
- 승격: `poc/extension-provider/lib/*` → `lib/`, `poc/kakao-host` → `host/`, 테스트 → `tests/`. `poc/` 비움.
- `manifest.json`: `nativeMessaging` 권한, `key`(ID 고정).
- `background.js`: `KakaoProvider`(native-port), `storage.session` 키 확장(`threads:kakao`, `provider:kakao:*`), `ITEM` 증분 브로드캐스트, `OPEN_HELP`, `SET_OPEN_THREAD`, `providers` 설정 반영.
- `panel.js`: 필터 칩·프로바이더 표시·`caps` 게이팅 문구(읽기 전용/기록 없음)·카카오 확정 규칙·`room_window_not_open` 안내·[설치 안내]. `help.html#kakao`.
- 호스트: E1a 결과로 `parse_kakao_toast` 확정, `raw` 제거, 방 목록 캐시, 본문 로그 없음 재확인.
- 로그 접두사 통일 `[buoy]`.

완료 기준: 인스타·카톡 스레드가 한 목록에 최근순으로 섞여 보이고 필터가 동작. 카톡 수신 p50 ≤ 1.5s, 전송 5/5, 호스트 강제 종료 후 30초 내 복구, 카톡 PC 재시작 후 복구. docs/04 §C 통과, §A 회귀 없음. 버전 `0.2.0`.

### M6. 카카오 완성도 (1~2일, 선택)
방 열기 자동화(닫힌 방 전송), 동명 방 보조 키, PyInstaller 단일 exe + 등록 통합, 수신 경로 B(창 읽기) 병행, macOS 어댑터 검토.

### M7. 편의 기능 (각 0.5일, 선택)
드래그·위치 기억 → 다크모드 → 사이드패널 모드 → OS 알림(ADR 후). 각각 별도 브랜치·검증.

### v2. 인스타 실시간 프로토콜 파싱 (별도 결정)
착수 조건: 측정에서 `recv→render` p50 미달이고 병목이 재조회 왕복임이 확인될 때. ADR-003 재검토. 참고 mautrix-meta(messagix).

## 5. 요구사항 추적표

| FR | 구현 위치 | 단계 | 검증 |
|---|---|---|---|
| FR-01 버블 | widget.js | I-M2 | §A4 |
| FR-02 통합 목록·필터 | panel.js, lib/providers.js | I-M2, M5 | §A5, §C |
| FR-03 대화 | panel.js | I-M2, M5 | §A5, §C |
| FR-04 컴포저·낙관적 전송 | panel.js | I-M3, M5 | §A6, §C |
| FR-05 상태·안내 | background, panel.js | I-M2, M5 | §A5, §C |
| FR-06 툴바 | background(`action.onClicked`), widget(`TOGGLE`) | I-M1, I-M2 | §A4 |
| FR-07 플레이스홀더 | lib/normalize.js | I-M1 | 단위 테스트 |
| FR-08 프로바이더 설정 | background, storage.local | M5 | §C |
| FR-09 편의 | — | M7 | — |
| FR-10 인스타 세션 | ig-bridge(`ds_user_id`, `logged_out`), panel 배너, background(`OPEN_INSTAGRAM`) | I-M1, I-M2 | §A2, §A5 |
| FR-11 엔진 탭 | background(`ensureEngineTab`, `onRemoved`) | I-M1 | §A2 |
| FR-12 인스타 실시간 | hook.js, ig-bridge(`scheduleRefresh`), background | I-M1, I-M2 | §A3, §D |
| FR-13 인스타 전송·확정 | ig-bridge(`sendText`), panel | I-M3 | §A6 |
| FR-14 읽음 | ig-bridge(`markSeen`), panel | I-M3 | §A6 |
| FR-15 호스트 연결 | lib/native-port.js, background(KakaoProvider) | M5 | §B E3, §C |
| FR-16 카카오 수신 | host(toast_source), lib/providers.js(`applyKakaoItem`), panel | K-P1, M5 | §B E1a/E4, §C |
| FR-17 카카오 전송·확정 | host(win_send), panel | K-P1, M5 | §B E2/E4, §C |
| FR-18 설치 도우미 | host/install | M6 | §C |
| NFR-01 성능 | perf 로그 | 전 단계 | §D |
| NFR-02 신뢰성 | background, panel 재연결, native-port | I-M4, M5 | §A7, §C |
| NFR-03/11 보안·호스트 무해성 | 전 파일 | 전 단계 | §E |

## 6. 코드 규칙

확장(JS)
- 파일 상단: 한 줄 책임 설명 + 메시지 타입 상수. 콘텐츠 스크립트는 IIFE(전역 오염 방지), 공용 로직은 UMD.
- `async/await` + try/catch. `chrome.*` 프로미스 호출은 실패를 항상 처리. 콘텐츠 스크립트의 `chrome.runtime.*`는 "Extension context invalidated" 대비 try/catch.
- `onMessage` 리스너는 비동기면 `return true`.
- 정규화·병합 함수는 `?.`와 기본값으로 방어. 필드가 없어도 예외 없이 빈 값.
- widget.js: `innerHTML`·`insertAdjacentHTML`·`setAttribute('style')` 금지. panel.js: 사용자 텍스트는 `textContent`, DOM 생성 헬퍼 `h(tag, attrs, ...children)` 하나.
- 시간은 epoch ms. 표시는 `Intl.DateTimeFormat('ko-KR', …)`. 상수는 `_MS` 접미사.
- 로그 `console.debug('[buoy]', …)`, 성능 `[buoy][perf]`. 본문·사용자 ID 금지.

호스트(Python)
- stdout에 `print()` 금지. 로그는 `logging`(stderr + 파일). 본문·사용자 ID 금지(길이만).
- 어댑터는 `Adapter` 인터페이스만 구현. OS 라이브러리 import는 어댑터 안에서 지연 import(없어도 호스트가 뜨게).
- 카톡과 닿는 상수는 `win_send.CHAT_EDIT_CLASS`, `toast_source.parse_kakao_toast` 두 곳.
- 프로토콜 변경은 `protocol.py`와 docs/02 §8을 같이, `PROTOCOL_VERSION` 증가.

공통
- 커밋: Conventional Commits(`feat:`, `fix:`, `docs:`, `test:`, `chore:`). 본문에 수행한 docs/04 항목 번호.
- 브랜치: `main` 안정, 단계별 `i-m1-engine`, `k-p1-poc`, `m5-kakao` 식으로.

## 7. 테스트 전략

| 종류 | 대상 | 도구 | 시점 |
|---|---|---|---|
| 단위 | `lib/normalize.js`, `lib/providers.js`, `lib/native-port.js` | `node --test` + fixtures | 매 변경 |
| 단위·통합 | 호스트 프레이밍·프로토콜·서브프로세스 왕복(mock)·토스트 파싱 | `pytest` | 매 변경 |
| 실기 | 카톡 PC 수신·전송, Chrome 왕복 | docs/04 §B 실험 스크립트 | K-P1, M5, 카톡 PC 업데이트 후 |
| 수동 기능 | 전 기능 | docs/04 §A, §C | 매 단계 |
| 성능 | ig recv→render, kakao item→render, Enter→확정 | `[buoy][perf]` 10회 표본 | I-M2, I-M3, I-M4, M5 |
| 호환 | 4개 기준 사이트 + 임의 3개 | 육안 + 콘솔 | I-M2, I-M4, M5 |
| 복구 | SW·엔진 탭·호스트·카톡 PC 종료, 리로드, 로그아웃 | docs/04 §A7, §C | I-M4, M5 |

## 8. 릴리즈·패키징

- 개인 사용. 웹스토어 배포 없음.
- 확장: `manifest.json` `version` 올리고 `CLAUDE.md` 패키징 명령으로 `dist/floating-messenger-<version>.zip`, git 태그 `v<version>`.
- 호스트: M5까지는 `register.ps1`(Python 필요), M6에서 PyInstaller exe + 등록 통합.
- 다른 PC 설치: zip 풀어 "압축해제된 확장 프로그램 로드" → `register.ps1 -ExtensionId <ID> -Adapter windows`.

## 9. 리스크와 대응

| 리스크 | 가능성 | 영향 | 대응 |
|---|---|---|---|
| 인스타 엔드포인트·필드 변경 | 높음 | 인스타 중단 | 정규화 계층, `API` 상수 1곳, fixtures 갱신, `error` 표시 |
| WS가 Worker에서 열림(C4) | 중 | 인스타 실시간 불가 | 폴백 폴링, 주기 5~10초 옵션 |
| 인스타 전송이 MQTT 전용(C5) | 중 | 인스타 전송 불가 | 엔진 탭 입력창 조작 대안(ADR), 또는 v2 앞당김 |
| 429·일시 차단 | 중 | 갱신 지연 | 최소 간격·쿨다운·폴링 주기 조정, NFR-01 준수 |
| 계정 제재(인스타·카카오) | 낮음~중 | 계정 제한 | 원래 클라이언트만 사용, 부계정·테스트 계정, 자동화 기능 없음 |
| 호스트 사이트 CSP/TT 충돌 | 중 | 특정 사이트 오류 | innerHTML 금지, adoptedStyleSheets, iframe |
| SW 수명·상태 유실 | 중 | 패널 멈춤 | storage.session 원본, 포트·호스트 재연결 |
| 인스타 세션 만료 | 확실(주기적) | 로그인 필요 | 감지·배너·자동 복구 |
| 확장 리로드 후 고아 스크립트 | 확실(개발 중) | 콘솔 예외 | try/catch, 조용히 종료 |
| 카카오 알림 리스너가 데스크탑 Python에서 동작하지 않음 | 중 | 카카오 수신 불가 | E1b(UIA) 대안, `wintoastlistener`, 보류 판정 |
| 카톡 PC 업데이트로 컨트롤·알림 형식 변경(C12) | 중 | 카카오 중단 | 상수 2곳, 실험 스크립트 재실행, `degraded` 표시 |
| 호스트 설치 실패(Python·레지스트리) | 중 | 카카오 미동작 | `register.ps1` 검증 출력, 로그 파일, M6 exe |
| 확장 ID 변경으로 `allowed_origins` 불일치 | 낮음 | 호스트 연결 실패 | `manifest.key`, `register.ps1` 재실행 |

## 10. 미결 사항

인스타 (I-M0에서 답한다)
- [ ] 실시간 소켓 URL과 initiator(문서/Worker)
- [ ] inbox·thread 요청의 정확한 쿼리스트링과 필수 헤더(`x-asbd-id` 필요 여부)
- [ ] 텍스트 전송이 HTTP POST인지, 본문 파라미터 목록
- [ ] seen 요청 형태
- [ ] `read_state` 의미(1=안읽음 가정), `items[].timestamp` 단위(µs 가정)
- [ ] 엔진 탭이 `/direct/inbox/`가 아닌 인스타 페이지일 때도 실시간 소켓이 열리는지

카카오 (K-P1, docs/04 §B3로 답한다)
- [ ] 카톡 토스트 raw 레이아웃(1:1/그룹), 카톡 창 포커스 시 알림 여부
- [ ] 입력창 클래스, 채팅창 class 이름, 창이 최소화 상태에서도 전송되는지
- [ ] 알림 접근 권한이 데스크탑 Python에 허용되는지
- [ ] 호스트가 10분 유휴 후에도 살아 있는지(또는 재연결 시간)
