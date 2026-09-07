# floating-messenger

인스타그램 DM과 카카오톡을 어떤 사이트에서든 우하단 플로팅 버블로 열어 읽고 답장하는 Chrome 확장프로그램(MV3). 텍스트 전용, 개인 사용. (코드네임 `buoy`, 브랜드명 미정)

## 문서 (4개 + ADR)

| 문서 | 내용 |
|---|---|
| `CLAUDE.md` | Claude Code 작업 지침 — 현재 상태, 규칙, 명령, 완료 정의 |
| `docs/01-requirements.md` | 요구사항 — 목표, 사용자 스토리, FR-01~18(공통·인스타·카카오), NFR, 제약, 메신저 차이표 |
| `docs/02-architecture.md` | 아키텍처 — 프로바이더 모델, 데이터 모델·병합, 확장 내부 규약, 호스트 프로토콜, 외부 API, 상태 머신, 정책, 보안, UI, 설치, 확장 지점 |
| `docs/03-development-plan.md` | 개발 계획 — 로드맵(I-M0~4 / K-P0~1 / M5~7 / v2), 추적표, 코드 규칙, 테스트, 리스크, 미결 |
| `docs/04-verification.md` | 검증 — 체크리스트(§A), 카카오 PoC 실험·판정·결과표(§B), 통합(§C), 성능(§D), 보안(§E) |
| `docs/adr/` | 결정 기록 001~008 |

## 코드 (PoC, 테스트 통과)

| 경로 | 내용 | 검증 |
|---|---|---|
| `poc/kakao-host/` | 카카오 네이티브 메시징 호스트(Python): 프레이밍·프로토콜·mock/windows 어댑터·실험 스크립트·설치 스크립트 | `pytest` 20 통과, 로컬 왕복 GO |
| `poc/extension-provider/` | 확장 측 공용 로직: 프로바이더 병합·네임스페이스·게이팅, 네이티브 링크(재연결·상관·타임아웃) | `node --test` 15 통과 |
| `poc/extension-native-echo/` | Chrome ↔ 호스트 왕복 검증 확장 (E3·E4) | Windows에서 수행 |
| `reference/` | 인스타 manifest·hook 초안 | 문법 검사 |

## 시작하기

1. `CLAUDE.md`를 읽는다.
2. `npm run verify`로 현재 검증 상태를 확인한다(설치 불필요, 의존성 0 — ADR-009). Windows에서는 `CLAUDE.md`의 개별 명령을 쓴다.
3. 카카오 실기 실험: `docs/04-verification.md` §B1 순서로 Windows에서 E0~E4를 수행하고 §B3 결과표를 채운다.
4. 인스타: `docs/03-development-plan.md` I-M0부터.
