# 검증 — floating-messenger

| 항목 | 내용 |
|---|---|
| 문서 버전 | 0.3 (통합본 — 마일스톤 체크리스트, 카카오 PoC 실험·판정·결과표, 성능·보안 점검을 한 문서로) |
| 작성일 | 2026-09-07 |
| 구성 | §A 인스타 트랙 체크리스트(I-M0~I-M4) · §B 카카오 PoC(K-P0/K-P1) · §C 통합(M5) · §D 성능 측정 · §E 보안 점검 |

결과(통과/실패, 측정값)는 커밋 메시지 본문에 남긴다. 기준 사이트: google.com(검색 결과), github.com(리포), youtube.com(영상), naver.com(메인).

---

## §A 인스타 트랙

### §A1 I-M0 조사 결과

코드를 쓰지 않는 단계다. DevTools로 `docs/02` §9.1의 "미확인" 5줄과 `docs/03` §10 인스타 미결 6개를 답한다.
**테스트·부계정 권장**(docs/01 C2). 답이 안 나온 칸은 비워 두고 §A1.8에 적는다. 추측해서 채우지 않는다.

준비
- [ ] 부계정으로 instagram.com 로그인, 폰 등 다른 기기에서 그 계정에 메시지를 보낼 수 있는 상태
- [ ] `https://www.instagram.com/direct/inbox/` 열기 → DevTools(F12) → Network → **Preserve log 켜기**

#### §A1.1 실시간 소켓 (C4, FR-12)
- [ ] Network 필터 **WS** → 페이지 새로고침 → 소켓 URL 기록. `docs/02` §9.1은 `wss://edge-chat.instagram.com/chat` 형태를 예상한다
- [ ] 그 요청의 **Initiator** 열 기록. 문서 스크립트인가, Worker 스크립트인가
- [ ] Sources → **Threads**(또는 `chrome://inspect/#workers`)에 워커가 있는지, 있다면 소켓이 그쪽에서 열렸는지
- [ ] 소켓을 선택 → Messages 탭 → 다른 기기에서 메시지 전송 → 프레임이 늘어나는지 확인(내용은 볼 필요 없다)
- [ ] instagram.com 홈(`/`)에서도 같은 소켓이 열리는지 (`docs/03` §10 마지막 항목, FR-11 엔진 탭 URL 선택에 영향)
- [ ] **판정:** 문서에서 열림 → `hook.js` 그대로 진행, `reference/hook.js`의 `/edge-chat|mqtt/i` 정규식을 실제 URL에 맞춘다. Worker에서 열림 → **C4 발동**, 폴백 폴링(15초) 중심으로 `docs/03` I-M1 수정하고 ADR 작성

#### §A1.2 inbox 요청
- [ ] Network 필터 **Fetch/XHR** → 새로고침 → `direct_v2/inbox` 요청 선택
- [ ] Headers 탭에서 경로·쿼리스트링 전체 기록(`persistentBadging`, `folder`, `limit`, `thread_message_limit`)
- [ ] 요청 헤더에서 `x-ig-app-id` **실제 값**, `x-asbd-id` 유무, `x-csrftoken`, `x-requested-with`, `x-instagram-ajax` 기록
- [ ] Response → 우클릭 Copy response → `tests/fixtures/inbox.json` 저장
- [ ] **저장 전 치환:** 사람 이름·username·본문·프로필 이미지 URL·pk를 가짜 값으로. 스레드 2~3개면 충분하다

#### §A1.3 thread 요청
- [ ] 스레드 하나 클릭 → `direct_v2/threads/<id>/` 요청의 경로·쿼리(`limit`) 기록
- [ ] Response → `tests/fixtures/thread.json` 저장(같은 방식으로 치환). 사진·좋아요 등 **텍스트가 아닌 항목이 섞인 스레드**를 고르면 FR-07 플레이스홀더 테스트에 그대로 쓸 수 있다

#### §A1.4 응답 필드 확인 (`lib/normalize.js` 매핑, `docs/02` §9.1 표)
- [ ] `items[].timestamp` 자릿수 → 마이크로초 가정이 맞는지 (16자리면 µs, 13자리면 ms)
- [ ] `thread.last_activity_at` 단위도 같은지
- [ ] `thread.read_state` 값과 의미(안읽음 스레드와 읽은 스레드를 비교해 관찰). 구분되지 않으면 `last_seen_at` 폴백을 쓴다
- [ ] `viewer.pk` 위치, `thread.viewer_id` 유무(`fromMe` 판정 근거)
- [ ] `thread_title`이 비는 경우가 있는지(비면 username 나열로 대체)

#### §A1.5 텍스트 전송 (C5 — 가장 큰 갈림길)
- [ ] Fetch/XHR 필터를 켠 채 대화창에서 텍스트 한 줄 전송
- [ ] POST가 잡히면: 경로와 **Payload 파라미터 전부** 기록(`action`, `client_context`, `mutation_token`, `offline_threading_id`, `thread_ids`, `text`, `send_attribution` 등), 응답에서 `payload.item_id`·`timestamp`·`client_context` 확인
- [ ] `client_context` 실제 형식 기록(19자리 숫자 가정)
- [ ] **POST가 없고 WS 프레임만 늘어나면 C5 발동.** `docs/03` §9 대응대로 엔진 탭 입력창 조작 대안 ADR을 쓰거나 v2(프로토콜 파싱)를 앞당긴다. I-M3 설계가 통째로 바뀌므로 여기서 멈추고 결정한다

#### §A1.6 읽음 처리 (FR-14)
- [ ] 안읽음 스레드를 열고 `seen` 요청이 잡히는지 → 경로·본문 파라미터 기록
- [ ] 없으면 FR-14를 보류로 내리고 `docs/01` FR-14 우선순위를 조정한다

#### §A1.7 요청 빈도 관찰 (NFR-01 기준선)
- [ ] 대화 중 인스타 웹 자신이 `inbox`를 얼마나 자주 부르는지 관찰. 우리 재조회 상한(초 2회, 분 평균 10회)이 웹 클라이언트보다 잦지 않은지 비교 근거로 남긴다

#### §A1.8 정리
- [ ] `docs/02` §9.1 표의 "검증 상태"를 확인됨/대안 결정으로 갱신, **"미확인" 0개**
- [ ] `docs/03` §10 인스타 미결 6개에 답 기록, C4·C5 발동 여부 명시
- [ ] `tests/fixtures/inbox.json`·`thread.json` 2개 존재, **민감정보 없음**(이름·본문·URL·pk 전부 가짜)
- [ ] `reference/hook.js` 소켓 정규식을 실제 URL에 맞춰 수정
- [ ] `docs/01`을 0.4로 올리고 커밋. 커밋 본문에 C4·C5 판정 기록

### §A2 설치·인증·엔진 탭 (I-M1)
- [ ] 새 Chrome 프로필에서 확장 로드 → 핀 고정·비활성 인스타 탭이 자동 생성됨
- [ ] 인스타 탭에서 로그인(2FA 포함) → 확장 안에서 아무 입력 없이 SW 콘솔에 `ENGINE_READY loggedIn:true`
- [ ] 이미 instagram.com 탭이 있으면 새 탭을 만들지 않고 그 탭을 씀
- [ ] 엔진 탭을 닫음 → (팝업/패널 열린 상태) 3초 내 재생성, `disconnected` → `connected`
- [ ] 엔진 탭을 닫음 → (패널 없음) 재생성하지 않고 다음 패널 열기 때 생성
- [ ] 인스타에서 로그아웃 → 30초 내 `logged_out`; 다시 로그인 → 30초 내 `connected`, 조작 없음

### §A3 인스타 실시간 수신 (I-M1)
- [ ] 엔진 탭 콘솔에 `[buoy] realtime socket hooked: wss://…` 1회
- [ ] 다른 기기에서 텍스트 전송 → SW 콘솔 `INBOX` 1초 내, `storage.session.unread` 증가
- [ ] 상대가 타이핑만 해도 재조회가 초당 2회를 넘지 않음(엔진 탭 Network)
- [ ] 10분 방치 시 inbox 요청 평균 ≤ 10회/분
- [ ] `FALLBACK_POLL_MS`로 15초마다 재조회(hook 비활성화 상태에서 확인)
- [ ] 빠른 재조회 반복으로 429 유도 → `rate_limited`, 30초 뒤 자동 복귀
- [ ] `node --test` 통과

### §A4 플로팅 버블 (I-M2) — 기준 사이트 4곳 각각

**중간 결과 2026-09-07 (macOS Chrome, MOCK 데이터):** 기준 사이트 4곳(naver.com, google.com,
github.com, youtube.com) 모두 버블·패널 정상 표시, 레이아웃 변화 없음. google.com에서 정상이므로
Trusted Types 강제 사이트에서의 Shadow DOM·`adoptedStyleSheets` 격리가 실제로 동작한다.
naver.com에서 배지(2)가 패널 안읽음 수와 일치 → `storage.session` 접근 레벨(`setAccessLevel`)
경로 확인됨.

아직 기록하지 않은 것: 각 사이트 콘솔 오류 0건 확인, Esc·닫기 버튼, 페이지 안 iframe에 버블 없음,
툴바 아이콘 토글과 팝업 폴백, 미개봉 탭 메모리 ≤ 5MB, 서비스워커 재시작(§A7).

- [ ] 우하단 버블 표시, 레이아웃 변화 없음, 콘솔 오류 0(Trusted Types 경고 포함)
- [ ] 배지가 `unread`와 일치, 0이면 숨김
- [ ] 클릭 → 패널 열림(최초 ≤ 500ms, 이후 ≤ 100ms), 다시 클릭 → 닫힘
- [ ] 호스트 페이지 포커스 상태에서 Esc → 닫힘; 패널 안 닫기 버튼 → 닫힘
- [ ] 페이지 안 iframe(유튜브 임베드 등)에는 버블 없음; instagram.com에는 버블 없음
- [ ] 툴바 아이콘 → 활성 탭 위젯 토글; `chrome://extensions`에서 클릭 → 400×640 팝업 패널
- [ ] 패널을 열지 않은 탭의 메모리 증가 ≤ 5MB(Chrome 작업 관리자)

### §A5 패널 — 목록·대화·상태 (I-M2)
- [ ] 최근 활동순, 이름·미리보기·시간·안읽음 강조. 미리보기 접두 `나: `/`username: `
- [ ] 스레드 클릭 → 캐시 즉시 → 서버 30개 병합, 내 메시지 오른쪽
- [ ] 그룹 발신자 표시, 30분 간격 구분선
- [ ] 대화 화면에서 새 메시지 수신 시 하단이면 자동 스크롤, 위로 올려둔 상태면 위치 유지
- [ ] 비텍스트 항목 플레이스홀더(`[사진]` 등)
- [ ] 뒤로·Esc → 목록; 새로고침 → 회전 후 갱신
- [ ] 상태 점·문구 표시(connecting/connected/disconnected/logged_out/rate_limited/error)
- [ ] `logged_out` 배너 [인스타그램 열기] → 엔진 탭이 앞으로
- [ ] 빈 목록 문구(테스트 계정)
- [ ] Tab으로 모든 버튼 이동, 포커스 링, aria-label; `prefers-reduced-motion`이면 애니메이션 없음

### §A6 인스타 전송·읽음 (I-M3)
- [ ] Enter → 50ms 내 "전송 중…" → 1.5초 내 확정
- [ ] Shift+Enter 줄바꿈, 공백만이면 전송 안 됨, 한글 조합 중 Enter로 전송되지 않음
- [ ] 보낸 메시지가 인스타 웹·모바일에 표시; 재조회 후 말풍선 중복 없음
- [ ] 오프라인 전송 → "전송 실패"+재시도 → 온라인 후 재시도 성공
- [ ] 안읽음 스레드 열기 → 배지 감소, 인스타 웹에서도 읽음
- [ ] SW·엔진 탭 콘솔에 메시지 본문 없음

### §A7 복구·안정성 (I-M4)
- [ ] 패널 연 상태로 30초 방치(SW 종료) → 수신 시 정상 갱신
- [ ] `chrome://serviceworker-internals`에서 SW 강제 종료 → 패널 1초 내 재연결, 상태 유지
- [ ] 확장 리로드 → 기존 탭 콘솔에 잡히지 않은 예외 없음, 새로고침 후 정상
- [ ] 엔진 탭을 다른 사이트로 이동 → 다음 패널 열기 때 새 엔진 탭
- [ ] 브라우저 재시작 → 핀 탭 재생성, 세션 유지 시 자동 `connected`
- [ ] 여러 탭에서 패널 동시 열기 → 각각 갱신
- [ ] 15초 무응답 요청 타임아웃(엔진 탭 일시 정지로 재현)

---

## §B 카카오 PoC

환경: Windows 10/11 + 카카오톡 PC(로그인) + Python 3.10+ + Chrome 116+. **테스트 계정 권장.** 스크립트는 `poc/kakao-host/experiments/`, 설치는 `poc/kakao-host/install/`, Chrome 왕복은 `poc/extension-native-echo/`.

### §B0 자동 검증 (완료)

| 항목 | 위치 | 결과 |
|---|---|---|
| 네이티브 메시징 프레이밍(4바이트 길이 + UTF-8 JSON, 1MB 제한, 한글·이모지, 다중 메시지, 잘린 본문) | `tests/test_framing.py` | 통과 |
| 프로토콜 검증·빌더, 메시지 id 안정성(같은 초 = 같은 id) | `tests/test_protocol.py` | 통과 |
| 호스트 서브프로세스 왕복: HELLO_ACK→PING→LIST_ROOMS→SEND→SEND_RESULT→ITEM, 없는 방 실패, 잘못된 요청 ERROR, EOF 종료 코드 0 + `STATUS stopped`, stdout에 프레임만 | `tests/test_host_mock.py` | 통과 |
| pywin32/winrt 없는 환경에서 windows 어댑터가 호스트를 죽이지 않고 `degraded` 보고, PING 응답 | 수동(Linux) | 통과 |
| 토스트 텍스트 파싱 휴리스틱(1:1/그룹/URL 본문/빈 줄) | `tests/test_toast_parse.py` | 통과 — 레이아웃은 E1a로 확정 |
| 확장 측: 네임스페이스, capabilities 기본값, 인스타 inbox 태깅, 카카오 ITEM 적용(중복·unread·그룹·정렬·상한), 통합 정렬·unread·필터, 상태 요약 | `poc/extension-provider/tests/providers.test.js` | 통과 |
| 확장 측 링크: 핸드셰이크, 요청 상관(순서 바뀜), ERROR 거부, 타임아웃, 미연결 거부, 끊김→pending 거부→백오프 재연결→재핸드셰이크, stop 취소, HELLO_ACK 타임아웃, maxAttempts, 이벤트 라우팅 | `tests/native-port.test.js` | 통과 |

재실행: `cd poc/kakao-host && python -m pytest -q tests && python experiments/e3_echo_check.py` / `node --test 'poc/extension-provider/tests/*.test.js'`

남은 불확실성은 **카카오톡 PC 앱과 Windows OS에 닿는 부분(E1, E2)과 실제 Chrome 등록(E3)** 뿐이다.

### §B1 실기 실험

가설: **H1** 알림 리스너로 방·발신자·본문을 1초 안에 읽는다(E1a) · **H2** 채팅창 UIA 트리에 본문이 노출된다(E1b) · **H3** 열린 채팅창에 WM_SETTEXT+Enter로 한글·이모지를 1초 안에 보낸다(E2) · **H4** Chrome↔호스트 왕복이 안정적이고 PONG ≤ 50ms(E3) · **H5** 폰↔패널 양방향 1.5초 이내(E4).

#### E0. 환경 점검 (10분)
- `pip install -r requirements-windows.txt` → `python experiments/e0_env_check.py`
- 수동: 카톡 PC 설정 > 알림 > 알림 켜기·메시지 내용 표시. Windows 설정 > 알림 > 카카오톡 허용, 집중 모드 끄기.
- 기록: Windows 버전, 카카오톡 PC 버전, 창 목록의 class 이름.
- 관문: 모두 OK.

#### E1a. 수신 A — 알림 리스너 (20분)
- `python experiments/e1a_toast_listener.py`
- 폰으로 (1) 1:1 방에 2개 (2) 그룹방에 1개, 한글·이모지·URL 포함. 카톡 PC 창은 최소화.
- 기대: 각 메시지가 1초 안에 `[toast] room=… sender=… text=… raw=[…]`.
- 기록: `raw` 줄 구조(1:1/그룹), 지연, 카톡 창이 앞에 있을 때도 찍히는지.
- 관문: 3건 모두 + raw 레이아웃 일정 → **H1 GO**. `parse_kakao_toast`와 테스트를 그 레이아웃에 맞춘다.
- 실패 시: 권한 거부 → Windows 설정에서 허용 후 재시도 → `pip install winsdk`(구 패키지, 자동 폴백) → `pip install wintoastlistener` 대안 → E1b.

#### E1b. 수신 B 탐색 — UIA 텍스트 노출 (15분, E1a 실패 시 또는 병행)
- `pip install pywinauto` → `python experiments/e1b_uia_dump.py "방 이름"` (채팅창 열어 두기)
- 기대: "텍스트가 있는 컨트롤" 목록에 최근 메시지 본문.
- 관문: 본문이 보이면 **H2 GO** → M6에서 `window_source.py`. 안 보이면 B 폐기.

#### E2. 전송 (15분)
- 채팅창을 하나 열어 둔 뒤 `python experiments/e2_send.py "방 이름" "buoy e2 테스트 😀 한글"`
- 기대: `send_text → {'ok': True}`, 1초 안에 폰에서 보임. 3회.
- 기록: 창 목록의 class·입력창 유무, 지연 ms, 창이 최소화/뒤에 있을 때도 되는지.
- 관문: 3/3 → **H3 GO**.
- 실패 시: `edit_not_found` → 출력된 자식 클래스에서 입력창을 찾아 `CHAT_EDIT_CLASS` 수정 후 재시도. `room_window_not_open` → 창 제목과 방 이름 대조.

#### E3. Chrome ↔ 호스트 왕복 (20분)
- 로컬 사전 점검: `python experiments/e3_echo_check.py` → 판정 GO.
- Chrome: `poc/extension-native-echo` 로드 → ID(32자) 복사 → `.\install\register.ps1 -ExtensionId <ID> -Adapter mock` → 아이콘 클릭 → 배지 `OK`.
- 유휴: 10분 방치 후 다시 클릭 → 여전히 `OK`.
- 기록: 서비스 워커 콘솔 `[e3][state]` 타임스탬프로 연결·PONG 지연.
- 관문: 배지 OK + PONG ≤ 50ms → **H4 GO**.
- 실패 시: `ERR` → `%LOCALAPPDATA%\Buoy\kakao-host.log`, 레지스트리 키, 매니페스트 `allowed_origins`의 ID, host.bat 경로 확인.

#### E4. 끝에서 끝까지 (20분, E1·E2·E3 후)
- `.\install\register.ps1 -ExtensionId <ID> -Adapter windows` → 채팅창 하나 열기 → 아이콘 클릭 → 배지 `OK`, 그 방에 `buoy e3 test` 게시.
- 폰에서 메시지 전송 → 서비스 워커 콘솔에 `[e3][event] ITEM`. 시각 차이 기록. 5회.
- 관문: 수신 p50 ≤ 1.5s, 전송 5/5 → **H5 GO**.

#### E5. 안정성 (30분, 선택)
- 카톡 PC 종료 → 재시작: 호스트 STATUS 변화와 복구.
- 호스트 프로세스 강제 종료: 확장 백오프 재연결(`[e3][state] disconnected → connecting → connected`).
- 방해 금지 모드: E1a가 멈추는지 → `degraded` 표시 필요성.

### §B2 판정 트리

```
E0 OK? ─아니오→ 환경 해결 후 재시도
  └예→ E1a GO?
        ├예→ E2 GO?
        │     ├예→ E3 GO? ─예→ E4 GO? ─예→ ✅ M5 전체 범위 착수
        │     │                          └아니오→ 지연 원인 분석(폴링·디바운스) 후 재시도
        │     └아니오→ E2 원인 수정 1회 재시도 → 실패 → ⚠️ 읽기 전용(send=false)으로 M5 축소 착수
        └아니오→ E1b GO?
                 ├예→ window_source 설계 추가 후 E2로
                 └아니오→ ❌ 카카오 보류 (ADR-008 "기각", v2에서 OCR 등 재검토)
```

### §B3 결과 기록표

| 실험 | 일시 | 환경(Win/카톡 PC 버전) | 결과 | 측정값 | 메모(raw 레이아웃, class 이름, 오류) |
|---|---|---|---|---|---|
| E0 | | | | | |
| E1a | | | | 지연: | raw 1:1: / raw 그룹: |
| E1b | | | | | |
| E2 | | | | ms: | class: |
| E3 | | | | PONG ms: | |
| E4 | | | | 수신 p50: / 전송: | |
| E5 | | | | | |

기록 후: `docs/02` §9.2 "검증 상태" 갱신 → `parse_kakao_toast`·`CHAT_EDIT_CLASS`·테스트 갱신 → ADR-008 상태 확정 → `docs/03` M5 범위 결정.

---

## §C 통합 (M5)

자동
- [ ] `python -m pytest -q host/tests` 통과 (승격 전 `poc/kakao-host/tests`)
- [ ] `node --test 'tests/*.test.js'` 통과 (승격 전 `poc/extension-provider/tests`)
- [ ] `python host/experiments/e3_echo_check.py` GO

기능
- [ ] 목록에 인스타·카톡 스레드가 최근순으로 섞여 보이고 행마다 프로바이더 표시
- [ ] 필터 칩 전체/인스타/카톡 동작, 칩 배지 = 프로바이더별 unread, 버블 배지 = 합계
- [ ] `caps.send=false` 프로바이더는 컴포저 대신 읽기 전용 안내; `caps.history=false`면 안내 한 줄; `caps.seen=false`면 seen 요청 없음
- [ ] 카톡 방 열기 → unread 해제(로컬), 열려 있는 방에 새 메시지 → unread 안 됨(`SET_OPEN_THREAD`)
- [ ] 카톡 전송 → 50ms 내 말풍선 → SEND_RESULT로 확정(id 유지) / 실패 표시
- [ ] 채팅창 닫힌 방으로 전송 → "PC 카카오톡에서 이 방을 열어 두세요"
- [ ] `providers.kakao=false` → 호스트 미연결, 칩 숨김, 인스타 정상

복구·상태
- [ ] 호스트 미설치 → 카카오 배너 [설치 안내], 인스타 정상
- [ ] 호스트 강제 종료 → 30초 내 자동 재연결(콘솔 backoff 로그)
- [ ] 카톡 PC 종료 → `degraded`; 재시작 → `connected`
- [ ] 방해 금지 모드 → `degraded` + detail
- [ ] SW 강제 종료 → 호스트 재시작 포함 재연결, 카톡 스레드 목록 유지(`storage.session`)
- [ ] 호스트 로그(`%LOCALAPPDATA%\Buoy\kakao-host.log`)에 메시지 본문 없음
- [ ] §A 전 섹션 회귀 없음

---

## §D 성능 측정 절차 (I-M2, I-M3, I-M4, M5)

준비: 엔진 탭·카톡 PC는 백그라운드. 다른 기기(폰)에서 같은 스레드로 텍스트를 보낸다. 10회 반복.

인스타 수신 (`ig recv→render`)
1. 엔진 탭 콘솔 필터 `[buoy][perf]`.
2. hook.js 신호의 `t`와 패널 렌더 완료 시각 차이를 로그로 확인.
3. p50·p95 기록. 목표 p50 ≤ 800ms, p95 ≤ 1.5s.

카카오 수신 (`kakao item→render`, 폰→패널)
1. 호스트 `ITEM.item.ts`(감지 시각)와 패널 렌더 시각 차이 → p50 ≤ 300ms.
2. 폰 전송 시각(폰 화면 시계)과 패널 표시 시각 차이 → p50 ≤ 1.5s.

비교 기준
1. 인스타 웹 탭을 **비활성**으로 두고 폰에서 전송, 5초 후 탭 전환해 반영 여부 확인. 또는 두 창을 나란히 두고 화면 녹화로 5회 비교(웹 화면 vs 패널).
2. 카톡: PC 토스트가 뜨는 시각 vs 패널 표시 시각(토스트가 먼저인 게 정상, 차이 ≤ 500ms).
3. 결과(위젯이 먼저/같음/나중)를 기록.

전송
1. 패널 Enter 시각과 `SEND_RESULT` 수신 시각 차이 → `[buoy][perf] send→ack Nms`, p95 ≤ 1.5s (양쪽).

요청 빈도
1. 엔진 탭 Network에서 `direct_v2/inbox` 요청 수를 10분 세어 평균/분(≤ 10), 활발한 대화 중 초당 최대(≤ 2).
2. 호스트 로그에서 PING 빈도(패널 열림 시 30초 1회).

---

## §E 보안·프라이버시 점검 (I-M2~I-M4, M5)

- [ ] background.js에 instagram.com fetch 없음(코드 검색)
- [ ] widget.js에 `innerHTML`·`insertAdjacentHTML`·`setAttribute('style'` 없음(코드 검색)
- [ ] panel.js에서 사용자 텍스트가 `textContent`로만 들어감(`innerHTML` 0건)
- [ ] `manifest.json` permissions가 `["storage", "nativeMessaging"]`뿐
- [ ] `storage.local`에 메시지 데이터 없음
- [ ] 호스트 페이지 콘솔에서 위젯 호스트 요소의 `shadowRoot === null`(closed)
- [ ] 확장 로그에 본문·사용자 ID 없음
- [ ] 호스트 코드에 네트워크 호출(`socket`, `urllib`, `requests`, `http`) 없음(코드 검색)
- [ ] 호스트 로그에 본문 없음(`--verbose`에서도 길이만), `raw` 필드 제거됨(M5)
- [ ] 호스트 매니페스트 `allowed_origins`에 이 확장 ID 하나만
