# floating-messenger — Claude Code 작업 지침

인스타그램 DM과 카카오톡을 어떤 사이트에서든 우하단 플로팅 버블로 열어 읽고 답장하는 Chrome 확장프로그램(MV3). 텍스트 전용, 개인 사용.
- 레포명 `floating-messenger` · 코드 내부 식별자 접두사(코드네임) `buoy` · 브랜드명 미정 (ADR-007)
- 인스타: 브라우저 안의 instagram.com 웹 세션과 WebSocket을 그대로 빌려 쓴다(로그인 UI 없음).
- 카카오: 브라우저 밖의 카카오톡 PC 앱을 로컬 네이티브 메시징 호스트(Python)가 제어한다. **PoC 관문(docs/04 §B)을 통과해야 통합(M5)에 들어간다.**

## 문서 지도 (4개 + ADR)

| 알고 싶은 것 | 문서 |
|---|---|
| 무엇을 만드는지, FR/NFR, 제약, 인스타·카카오 차이 | `docs/01-requirements.md` |
| 구조, Provider 인터페이스, 데이터 모델·병합 규칙, 확장 내부 규약, 호스트 프로토콜, 외부 API(인스타·카톡), 상태 머신, 정책, 보안, UI | `docs/02-architecture.md` |
| 로드맵(인스타 트랙·카카오 트랙·통합), 추적표, 코드 규칙, 테스트 전략, 리스크, 미결 | `docs/03-development-plan.md` |
| 마일스톤 체크리스트(§A), 카카오 PoC 실험·판정·결과표(§B), 통합 체크(§C), 성능(§D), 보안(§E) | `docs/04-verification.md` |
| 왜 이렇게 결정했는지 (확장 선택, 버블+iframe, 실시간 방식, 인증, 엔진 탭, 카카오 호스트+타당성, 이름·범위, 카카오 수신 경로) | `docs/adr/ADR-001~008` |
| 검토·테스트된 코드 | `poc/` (아래), `reference/` |

## 현재 상태

| 단계 | 상태 |
|---|---|
| 인스타 I-M0 (엔드포인트 검증) | 시작 전 |
| 카카오 K-P0 자동 검증 (프레이밍·프로토콜·호스트 왕복·확장 측 링크·병합) | **완료, 테스트 통과** (pytest 20, node 15) |
| 카카오 K-P1 실기 실험 (E0~E5, Windows) | 사용자가 수행. 결과는 `docs/04` §B3 |
| I-M1~I-M4, M5~M7 | 시작 전 |

## 기술 스택

- 확장: Chrome MV3, 최소 Chrome 116, Vanilla JS(ES2022) + JSDoc, 번들러·프레임워크 없음. 공용 순수 로직은 UMD(`globalThis.X` + `module.exports`)로 써서 `node --test`로 검증.
- 카카오 호스트: Python 3.10+, 표준 라이브러리 + `pywin32` + `pywinrt`(Windows 전용). pytest. `print()` 금지(stdout은 프레임 전용).
- 나머지 검증은 `docs/04` 수동 체크리스트와 실험 스크립트.

## 디렉터리

```
manifest.json, background.js, hook.js, ig-bridge.js, widget.js, panel.*, help.html   확장 (I-M1부터 생성)
lib/normalize.js        인스타 응답 정규화 (순수)
lib/providers.js        프로바이더 네임스페이스·병합·게이팅   ← poc/extension-provider 에서 M5에 승격
lib/native-port.js      네이티브 호스트 링크                 ← 〃
host/                   카카오 호스트                        ← poc/kakao-host 에서 M5에 승격
tests/                  node·pytest 테스트 + fixtures
icons/                  확장 아이콘 16·48·128 (ADR-009)
package.json .editorconfig  개발 편의(의존성 0) — ADR-009
poc/kakao-host/         호스트 PoC: buoy_kakao_host/(framing·protocol·host·adapters), experiments/, install/, tests/
poc/extension-provider/ 확장 측 공용 로직 PoC + tests
poc/extension-native-echo/  E3·E4용 실험 확장
docs/  reference/
```

## 절대 지킬 것

인스타
1. 로그인을 구현하지 않는다. 인스타 요청은 `ig-bridge.js`에서만. MQTT/LightSpeed 페이로드를 해석하지 않는다. (ADR-003, 004)
2. 엔드포인트·헤더 상수는 `ig-bridge.js` 상단 한 곳. 바꾸기 전에 DevTools로 확인하고 `docs/02` §9.1 갱신.
3. 호스트 페이지(`widget.js`)에서 `innerHTML`·`insertAdjacentHTML`·`setAttribute('style')` 금지. 패널은 `textContent`만.
4. 권한은 `storage`, `nativeMessaging`, instagram host뿐. `tabs` 금지. 새 권한은 ADR 먼저.
5. 메시지 내용은 `chrome.storage.session`에만. 텍스트 전용. 한글 IME(`isComposing`/`keyCode 229`) 처리.

카카오
6. **PoC 관문 전에 M5 코드를 쓰지 않는다.** `docs/04` §B3 결과표가 비어 있으면 실기 실험을 먼저 요청한다.
7. 호스트는 네트워크를 쓰지 않고, 자격 증명을 다루지 않고, **stdout에 프레임 외 바이트를 쓰지 않는다.** 로그는 stderr/파일, 본문·사용자 ID 금지.
8. 프로토콜 정본은 `protocol.py` = `docs/02` §8. 둘 중 하나만 바꾸지 않는다. 바꾸면 `PROTOCOL_VERSION`을 올린다.
9. 카톡 PC와 닿는 값(컨트롤 클래스, 알림 레이아웃)은 실험 스크립트가 출력한 실제 값으로만 정한다. `win_send.CHAT_EDIT_CLASS`, `parse_kakao_toast` 두 곳에만 둔다.
10. 패널은 프로바이더 분기 대신 `caps`(send/seen/history/rooms)로 게이팅한다. 스레드·항목 id는 항상 `provider:id`.
11. 자동 응답·예약·대량 발송을 만들지 않는다. 전송은 사용자 입력 1건당 1회.

## 작업 방식

- `docs/03` §4 로드맵을 따른다. 인스타 트랙(I-M0→I-M4)과 카카오 트랙(K-P1)은 병행 가능, M5는 둘 다 끝난 뒤.
- 작업 끝마다 자동 테스트(`pytest`, `node --test`)와 `docs/04` 해당 섹션을 수행하고 결과를 커밋 본문에 남긴다.
- 설계와 다르게 구현해야 하면 코드보다 문서(`docs/02` 또는 새 ADR)를 먼저 고친다.
- 모르는 값은 추측하지 말고 `docs/03` §10 또는 `docs/04` §B3에 적고 사용자에게 확인을 요청한다.
- 로그 접두사: 확장 `[buoy]`, 성능 `[buoy][perf]`, 호스트 로거 `buoy.*`.

## 자주 쓰는 명령

```bash
npm run verify        # 완료 정의의 자동 검사 전부 (아래 3줄 = test + test:host + check). macOS·Linux 전용
node --test 'poc/extension-provider/tests/*.test.js'                                   # 확장 측 순수 로직
cd poc/kakao-host && python -m pytest -q tests && python experiments/e3_echo_check.py   # 호스트 + 로컬 왕복
for f in $(git ls-files '*.js'); do node --check "$f" || exit 1; done                     # 문법
python -m compileall -q poc/kakao-host
cd poc/kakao-host && pip install -r requirements-windows.txt && python experiments/e0_env_check.py   # Windows 실기 (docs/04 §B1)
```

브라우저 로드: `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드". 호스트 등록: `poc/kakao-host/install/register.ps1 -ExtensionId <ID> -Adapter mock|windows`.
패키징(확장): `mkdir -p dist && zip -r "dist/floating-messenger-$(node -p "require('./manifest.json').version").zip" . -x 'docs/*' 'tests/*' 'poc/*' 'reference/*' 'dist/*' 'node_modules/*' '.git/*' 'CLAUDE.md' 'README.md' 'package.json' '.editorconfig' '.gitignore'`

## 완료 정의 (Definition of Done)

- 해당 단계의 완료 기준(`docs/03` §4) 만족
- `pytest`·`node --test`·`node --check`·`compileall` 통과, manifest JSON 유효
- `docs/04` 해당 섹션 통과 (위젯은 google.com, github.com, youtube.com, naver.com)
- 새 권한·엔드포인트·메시지 타입·storage 키·프로토콜 필드를 추가했으면 `docs/02` 갱신
- 서비스워커·엔진 탭·위젯 탭·패널·호스트 로그에 잡히지 않은 예외 없음

## 하지 않을 것

웹스토어 배포, 다중 계정, 사진/영상/음성/스티커 전송, 스토리·게시물, 인스타 모바일 비공개 API, 카카오 LOCO 프로토콜, 제3자 "카톡 웹버전", 자동 응답 봇, 대량·예약 발송.
