# ADR-002. 위젯은 모든 사이트 위 플로팅 버블 + 확장 페이지 iframe 패널로 만든다

- 상태: 채택
- 날짜: 2026-09-07

## 맥락
위젯 표면 후보는 세 가지였다: Chrome 사이드 패널, 별도 팝업 창, 모든 사이트에 주입하는 플로팅 버블. 사용자는 "진짜 위젯 느낌"의 플로팅 버블을 선택했다.
플로팅 버블은 임의의 사이트 DOM 안에 UI를 넣어야 하므로 사이트의 CSS·CSP·Trusted Types와 충돌할 수 있다.

## 결정
- `widget.js`를 모든 http/https 최상위 프레임에 주입한다(instagram.com 제외). 버블·배지·패널 컨테이너는 closed Shadow DOM 안에 만들고 스타일은 `adoptedStyleSheets`로 넣는다.
- 패널 UI 자체는 호스트 페이지 DOM에 그리지 않고 `chrome-extension://…/panel.html`을 iframe으로 띄운다. iframe은 처음 열 때만 로드한다.
- `panel.html`은 iframe과 팝업 창(`?standalone=1`)에서 같은 코드로 동작하게 만든다.

## 근거
- iframe 방식은 패널이 완전한 확장 페이지 컨텍스트에서 실행되어 포트 통신·CSP·키보드 이벤트가 호스트 사이트의 영향을 받지 않는다. 호스트 스크립트가 패널 내용을 읽을 수도 없다(교차 출처).
- Chrome은 `web_accessible_resources`에 선언된 확장 리소스의 프레임 로드를 호스트 페이지 CSP와 무관하게 허용한다.
- Shadow DOM + `adoptedStyleSheets` + `createElement`만 쓰면 Trusted Types 강제 사이트에서도 동작한다.
- 같은 panel.html을 사이드 패널·팝업 창에 재사용할 수 있어 표면을 나중에 바꾸기 쉽다.

## 결과
- 장점: 사이트에 무관하게 동일한 위젯. 패널 코드가 표면과 독립.
- 단점: 설치 시 "모든 웹사이트 데이터 읽기·변경" 권한 경고. 페이지마다 콘텐츠 스크립트가 실행되므로 미로드 상태의 비용을 최소화해야 한다(NFR-06). 사이트가 `document.documentElement`를 통째로 바꾸는 드문 경우 버블이 사라질 수 있다(M5에서 MutationObserver 재삽입 검토).

## 검토한 대안
- 사이드 패널: 권한 최소, 구현 단순. 브라우저 창 안에 붙어 "위젯" 느낌이 약함. M5 모드로 보류.
- 팝업 창 전용: 항상 위 고정 불가, 창 관리 부담. 툴바 클릭 폴백으로만 사용.
- 호스트 DOM에 패널을 직접 그리기(iframe 없음): 사이트 CSS·이벤트와 충돌 가능성, 호스트 스크립트가 내용 접근 가능. 기각.
