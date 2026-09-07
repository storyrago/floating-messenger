# ADR-007. 범위는 멀티 메신저 플로팅 위젯, 레포명은 floating-messenger, 코드네임은 buoy, 브랜드명은 미정

- 상태: 채택
- 날짜: 2026-09-07

## 맥락
"IG DM Widget"은 인스타 전용 이름이라 카카오톡을 붙이는 순간 맞지 않는다. 메신저 상표(Instagram, KakaoTalk)를 제품명에 넣으면 상표 문제와 범위 오해가 생긴다. 브랜드 이름은 나중에 정하기로 했고, 지금 필요한 것은 의도가 드러나는 레포 이름과 코드 안에서 쓸 안정적인 식별자 접두사다.

## 결정
- **레포명 `floating-messenger`** — "어떤 사이트에서든 떠 있는 메신저"라는 의도가 그대로 읽히고, 특정 서비스 이름이 없어 메신저를 더 붙여도 안 바뀐다. 문서·패키지 zip·dist 이름에 쓴다.
- **코드네임 `buoy`** — 코드 내부 식별자 접두사. 호스트 이름 `com.buoy.kakao`, Python 패키지 `buoy_kakao_host`, 전역 `BuoyProviders`/`BuoyNativeLink`, 창 간 메시지 플래그 `__buoy`, 로그 접두사 `[buoy]`, 설치 폴더 `%LOCALAPPDATA%\Buoy`. 브랜드명이 정해져도 바꿀 필요가 없다(내부 이름).
- **브랜드명 미정** — 확장 표시 이름(`manifest.name`)은 브랜드 확정 전까지 "Floating Messenger"로 둔다.
- **범위** — 여러 메신저를 프로바이더로 붙이는 플로팅 위젯. 각 프로바이더는 docs/02 §4 인터페이스를 구현한다. v0.1 instagram, v0.2 +kakao.

## 근거
- 레포 이름은 브랜드가 아니라 "무엇을 하는 물건인지"만 말하면 된다. 후보 `messenger-overlay`(형태 강조), `unified-dm-widget`(통합 강조), `dm-bubble-extension`(가장 설명적이지만 김) 중 의도 전달이 가장 직접적인 것을 골랐다.
- 코드네임을 레포명과 분리해 두면 브랜드 결정이 코드에 영향을 주지 않는다.

## 결과
- 인스타 전용 파일 이름(`ig-bridge.js`, `hook.js`)은 프로바이더 내부 이름으로 유지한다.
- 브랜드가 정해지면 `manifest.name`, README 제목, 아이콘만 바꾼다.
