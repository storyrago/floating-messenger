# poc/ — 카카오톡 확장 PoC

| 경로 | 무엇 | 어디서 검증 |
|---|---|---|
| `kakao-host/` | Python 네이티브 메시징 호스트: `buoy_kakao_host/`(프레이밍·프로토콜·호스트·mock/windows 어댑터), `experiments/`(E0~E3 스크립트), `install/`(host.bat·매니페스트 템플릿·register.ps1), `tests/` | 어디서나: `python -m pytest -q tests` (20 통과), `python experiments/e3_echo_check.py` (GO). Windows: E0~E4 |
| `extension-provider/` | 확장 측 공용 로직 `lib/providers.js`, `lib/native-port.js` + `tests/` | 어디서나: `node --test 'tests/*.test.js'` (15 통과) |
| `extension-native-echo/` | Chrome ↔ 호스트 왕복 검증 확장 (native-port.js 사용) | Windows + Chrome: docs/04 §B E3·E4 |

실험 순서와 판정 기준은 `docs/04-verification.md §B`. 결과는 그 문서 §B3 표에 기록한다.
