# Buoy 카카오톡 네이티브 메시징 호스트 (PoC)

Chrome 확장 ↔ (Native Messaging) ↔ 이 호스트(Python) ↔ 카카오톡 PC(Windows).
확장은 `chrome.runtime.connectNative('com.buoy.kakao')`로 연결하고, 프로토콜은 `buoy_kakao_host/protocol.py` (= docs/02 §8).

## 구성

```
buoy_kakao_host/
  framing.py            네이티브 메시징 프레이밍 (4바이트 길이 + UTF-8 JSON)
  protocol.py           요청/이벤트 규약, 검증, 빌더
  host.py               본체: stdin 읽기 → 처리 → stdout 쓰기(직렬화), 워커 풀
  adapters/mock.py      카톡 없이 왕복 검증용
  adapters/windows/     win_send.py(전송: RICHEDIT50W + Enter) / toast_source.py(수신: 알림 리스너)
experiments/            E0~E3 실기 실험 스크립트 (docs/04-verification.md §B)
install/                host.bat·매니페스트 템플릿, register.ps1 / unregister.ps1
tests/                  pytest — 프레이밍, 규약, 서브프로세스 왕복(mock), 토스트 파싱
```

## 어디서나 되는 것 (검증 완료)

```bash
pip install -r requirements-dev.txt
python -m pytest -q tests            # 20 tests
python experiments/e3_echo_check.py  # 호스트 왕복 (mock) → 판정: GO
```

## Windows에서 하는 것 (실기 실험, docs/04 §B1 순서대로)

```powershell
pip install -r requirements-windows.txt
python experiments/e0_env_check.py                       # 환경
python experiments/e1a_toast_listener.py                 # 수신 A: 폰으로 메시지 보내 보기
python experiments/e1b_uia_dump.py "방 이름"              # 수신 B 탐색 (선택)
python experiments/e2_send.py "방 이름" "buoy e2 테스트"   # 전송
python experiments/e3_echo_check.py --adapter windows    # 호스트+windows 어댑터 로컬 왕복
.\install\register.ps1 -ExtensionId <ID> -Adapter mock   # Chrome 왕복 (poc/extension-native-echo)
.\install\register.ps1 -ExtensionId <ID> -Adapter windows
```

로그: `%LOCALAPPDATA%\Buoy\kakao-host.log`. stdout에는 프레임만 쓴다 — `print()`를 절대 넣지 말 것.

## pywinrt 설치가 안 될 때 (대안)

1. `pip install winsdk` (구 단일 패키지) — `toast_source.py`가 자동으로 폴백한다.
2. 그래도 안 되면 `pip install wintoastlistener` 후 `toast_source.py`의 `_run`을 그 라이브러리 콜백으로 바꾼다 (E1a 결과표에 기록).

## 주의

- 카카오톡 PC 창을 자동 제어하는 방식은 카카오 약관과 충돌할 수 있다. 개인 사용, 테스트 계정 권장.
- 채팅방 창이 열려 있어야 전송된다 (PoC 제약). 방 열기 자동화는 E2-b.
- 방 id = 방 이름. 같은 이름의 방이 둘이면 구분 못 한다 (PoC 제약, docs/01 §8).
