# Buoy Native Echo (E3)

호스트(`poc/kakao-host`)와 Chrome 사이의 네이티브 메시징 왕복을 검증하는 실험용 확장.

1. `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → 이 폴더. **ID(32자)** 복사.
2. `poc/kakao-host`에서 `.\install\register.ps1 -ExtensionId <ID> -Adapter mock`
3. 확장 아이콘 클릭 → 배지 `OK`. 서비스 워커 콘솔에 HELLO_ACK/PONG/ROOMS/SEND_RESULT/ITEM 로그.
4. `-Adapter windows`로 다시 등록 → 카톡 채팅창 하나 열고 클릭 → 그 방에 `buoy e3 test`가 올라가면 E3 통과.
   연결을 유지하므로 폰에서 메시지를 보내면 콘솔에 `ITEM`이 찍힌다 (= E4 수신 확인).

배지: `OK` 성공 / `NOROOM` 방 없음 / `SENDX` 전송 실패 / `ERR` 연결 실패(→ `%LOCALAPPDATA%\Buoy\kakao-host.log`).
