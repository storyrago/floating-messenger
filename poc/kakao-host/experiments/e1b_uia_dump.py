"""E1b. 수신 경로 B 탐색 — 채팅방 창의 UI Automation 트리에 메시지 텍스트가 노출되는지 확인.

실행: pip install pywinauto  →  python experiments/e1b_uia_dump.py "방 이름"
기대: 트리에 최근 메시지 본문이 텍스트로 보이면 UIA 기반 수신 소스를 만들 수 있다 (window_source).
      본문이 안 보이고 컨트롤만 나오면 이 경로는 폐기하고 E1a(알림)로만 간다.
"""
import sys

from pywinauto import Desktop  # type: ignore

room = sys.argv[1] if len(sys.argv) > 1 else None
if not room:
    print("사용법: python experiments/e1b_uia_dump.py \"방 이름\"  (채팅방 창을 먼저 열어 두세요)")
    raise SystemExit(2)

win = Desktop(backend="uia").window(title=room)
print("=== 컨트롤 트리 (depth 6) ===")
win.print_control_identifiers(depth=6)
print("\n=== 텍스트가 있는 컨트롤 ===")
for ctrl in win.descendants():
    try:
        txt = ctrl.window_text()
    except Exception:  # noqa: BLE001
        continue
    if txt and txt.strip():
        print(f"{ctrl.friendly_class_name():>16} | {txt[:100]!r}")
