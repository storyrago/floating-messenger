# floating-messenger — Claude Code 작업 지침

인스타그램 DM을 데스크탑 앱에서 읽고 답장한다. 텍스트 전용. 본인과 친구가 쓴다.
- 레포명 `floating-messenger` · 코드 내부 접두사 `buoy` · 브랜드명 미정 (ADR-007)
- 형태: **Electron 앱** (ADR-010). 확장이 아니다.
- 범위: **인스타그램 하나** (ADR-011). 카카오는 걷어냈다.
- 인증: 앱 안 웹뷰의 instagram.com 세션을 그대로 쓴다. 로그인 화면을 만들지 않는다 (ADR-004).

## 문서 지도

| 알고 싶은 것 | 문서 |
|---|---|
| 왜 이 형태인지 (Electron 전환, 범위 축소, 인증, 실시간 방식) | `docs/adr/ADR-010`, `ADR-011`, `ADR-004`, `ADR-003` |
| FR/NFR, 제약 | `docs/01-requirements.md` (카카오 부분 무효) |
| 데이터 모델, 인스타 외부 API, 상태 머신, 정책, UI 토큰 | `docs/02-architecture.md` (§8·§9.2 무효) |
| 로드맵·리스크 | `docs/03-development-plan.md` (카카오 트랙 무효, Electron 기준으로 재작성 필요) |
| 검증 절차 | `docs/04-verification.md` (§B·§C 무효) |

**주의:** 네 문서는 Chrome 확장을 전제로 쓰였다. ADR-010과 011이 그 위에 있다. 충돌하면 ADR이 이긴다.

## 현재 상태

| 항목 | 상태 |
|---|---|
| Electron 앱 뼈대 (창·엔진 웹뷰·IPC) | 동작 |
| 패널 UI (목록·대화·상태·배너) | 동작. 데이터는 아직 MOCK |
| 인스타 inbox 엔드포인트 | **검증됨** — 200 `application/json` (docs/02 §9.1) |
| 인스타 전송 엔드포인트 | 미검증 (429로 중단) |
| 정규화 `lib/normalize.js` | 없음. 응답 필드 모양을 확인해야 쓴다 |

## 기술 스택

Electron + Vanilla JS(ES2022) + JSDoc. 번들러·프레임워크 없음. 런타임 의존성은 Electron 하나 (ADR-009, ADR-010).

## 디렉터리

```
app/main.js          메인 프로세스: 창, 엔진 웹뷰, IPC, 인스타 조회, 429 백오프
app/preload-ig.js    엔진 웹뷰 preload: WebSocket 훅 (페이지보다 먼저 실행)
app/preload-ui.js    UI 창 preload: contextBridge로 post/onMessage만 노출
app/renderer/panel.* 목록·대화 화면 (창 하나에서 오간다)
lib/                 순수 로직. normalize.js는 아직 없다
poc/extension-provider/  프로바이더 병합 로직 + 테스트 (lib/로 승격 예정)
icons/ docs/ reference/
```

## 절대 지킬 것

1. 로그인을 구현하지 않는다. 사용자가 엔진 웹뷰에서 직접 로그인한다.
2. 인스타 엔드포인트·헤더 상수는 `app/main.js` 상단 한 곳. 바꾸기 전에 실제로 확인하고 `docs/02` §9.1을 갱신한다.
3. **429를 가장 먼저 판정한다.** 429가 `text/html` 빈 본문으로 오기 때문에, JSON 여부를 먼저 보면 로그아웃으로 오인한다 (2026-09-07 확인).
4. 인스타에 요청을 연달아 날리지 않는다. 요청 제한에 걸리면 흰 화면만 남고 한참 안 풀린다. 재시도는 백오프로만.
5. 패널의 사용자 텍스트는 `textContent`만. HTML 문자열을 넣지 않는다.
6. UI 창은 `contextIsolation: true`. 엔진 웹뷰만 false이며, `ipcRenderer`를 preload 클로저 밖으로 내보내지 않는다.
7. 모르는 값은 추측하지 말고 사용자에게 확인을 요청한다.
8. 자동 응답·예약·대량 발송을 만들지 않는다. 전송은 사용자 입력 1건당 1회.

## 작업 방식

- 작업 끝마다 `npm run verify`를 돌리고 결과를 커밋 본문에 남긴다.
- 설계와 다르게 구현해야 하면 코드보다 ADR을 먼저 쓴다.
- 로그 접두사: `[buoy]`, 성능 `[buoy][perf]`. 본문·사용자 ID를 남기지 않는다.

## 자주 쓰는 명령

```bash
npm start           # 앱 실행
npm run verify      # 테스트 + 문법 검사
npm test            # 순수 로직 테스트만
```

## 하지 않을 것

모르는 사람에게 배포(ADR-011 메모 참고), 다중 계정, 사진·영상·음성 전송, 스토리·게시물,
인스타 모바일 비공개 API, 자동 응답 봇, 대량·예약 발송.
