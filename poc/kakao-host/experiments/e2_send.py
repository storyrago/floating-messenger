"""E2. 전송 — 열려 있는 채팅방 창에 텍스트 보내기.

실행: python experiments/e2_send.py "방 이름" "보낼 문장"
절차: 그 방의 채팅창을 PC 카톡에서 열어 둔다(앞에 있을 필요는 없음). 실행한다.
기대: 1초 안에 방에 메시지가 올라가고 폰에서도 보인다. 한글·이모지 포함 문장으로도 한 번 더.
판정: 3회 연속 성공이면 GO. 'room_window_not_open'이면 창 제목이 방 이름과 정확히 같은지 아래 목록에서 확인.
      'edit_not_found'이면 입력창 클래스가 RICHEDIT50W가 아닌 것 → 아래 목록의 class 값을 win_send.CHAT_EDIT_CLASS에 반영.
"""
import sys
import time

sys.path.insert(0, ".")
import win32gui  # type: ignore  # noqa: E402

from buoy_kakao_host.adapters.windows.win_send import CHAT_EDIT_CLASS, find_child, kakao_windows, send_text  # noqa: E402

print("=== 카카오톡 창 목록 ===")
for hwnd, title, cls in kakao_windows():
    edit = find_child(hwnd, CHAT_EDIT_CLASS)
    kids = []
    try:
        win32gui.EnumChildWindows(hwnd, lambda h, _: kids.append(win32gui.GetClassName(h)) or True, None)
    except Exception:  # noqa: BLE001
        pass
    print(f"  {title!r:30} class={cls!r} 입력창={'있음' if edit else '없음'} 자식클래스={sorted(set(kids))[:8]}")

if len(sys.argv) < 3:
    print("\n사용법: python experiments/e2_send.py \"방 이름\" \"보낼 문장\"")
    raise SystemExit(2)

room, text = sys.argv[1], sys.argv[2]
t0 = time.perf_counter()
result = send_text(room, text)
print(f"\nsend_text → {result}  ({(time.perf_counter() - t0) * 1000:.0f} ms)")
