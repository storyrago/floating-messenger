# ADR-005. 엔진은 핀 고정된 instagram.com/direct 탭이다 (offscreen·iframe 임베드 미채택)

- 상태: 채택
- 날짜: 2026-09-07

## 맥락
위젯은 인스타 탭 밖에서 열리므로 인스타 세션·WebSocket을 유지하는 "엔진"이 어딘가에 있어야 한다. 후보: (a) 실제 인스타 탭을 핀 고정으로 유지 (b) 확장의 offscreen 문서나 패널 안에 instagram.com을 iframe으로 임베드 (c) background에서 프로토콜을 직접 구현.

## 결정
(a)를 채택한다. background가 `https://www.instagram.com/direct/*` 탭을 찾고, 없으면 `/direct/inbox/`를 핀 고정·비활성 탭으로 연다. 탭 id는 `storage.session`에 저장하고, 탭이 닫히면 패널이 열려 있을 때만 재생성한다. 이미 열린 instagram.com 탭이 있으면 그것을 쓴다.

## 근거
- 실제 탭은 인스타가 기대하는 환경 그대로다: 1st-party 쿠키, 정상 WebSocket, 헤더·지문 모두 웹 클라이언트와 동일.
- iframe 임베드는 `X-Frame-Options`/`frame-ancestors`를 헤더 수정으로 우회해야 하고, 확장 페이지 안 서드파티 컨텍스트에서 쿠키·파티셔닝 동작이 불안정하며, 인스타 스크립트가 프레임 여부를 감지할 수 있다.
- offscreen 문서도 같은 임베드 문제를 안는다.
- (c)는 ADR-003에서 보류한 프로토콜 구현을 전제로 한다.

## 결과
- 장점: 가장 단순하고 인스타 변경에 강하다. 사용자가 이미 인스타를 열어 두는 습관이 있으면 추가 비용이 없다.
- 단점: 핀 탭 하나가 항상 보인다. 인스타 페이지 메모리를 계속 쓴다. 탭이 닫히면 위젯이 멈추므로 상태 표시와 자동 복구가 필수다(FR-02, FR-11).

## 검토한 대안
- offscreen/iframe 임베드: 헤더 우회·쿠키 문제로 취약. 기각.
- background에서 프로토콜 직접 구현: ADR-003 v2 조건 충족 시 재검토.
