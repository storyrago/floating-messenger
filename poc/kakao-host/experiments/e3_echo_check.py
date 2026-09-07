"""E3(로컬). 호스트 왕복 자동 점검 — Chrome 없이 호스트를 서브프로세스로 띄워 PING/LIST_ROOMS/SEND를 확인한다.

실행: python experiments/e3_echo_check.py [--adapter mock|windows]
기대: HELLO_ACK → PONG → ROOMS → SEND_RESULT(ok) 순서로 출력. windows 어댑터면 첫 방으로 실제 전송된다(주의).
그다음 Chrome 쪽 E3는 poc/extension-native-echo 확장으로 한다 (README 참고).
"""
import os
import subprocess
import sys
import threading
import time
from queue import Empty, Queue

sys.path.insert(0, ".")
from buoy_kakao_host.framing import read_message, write_message  # noqa: E402

adapter = "mock"
if "--adapter" in sys.argv:
    adapter = sys.argv[sys.argv.index("--adapter") + 1]

p = subprocess.Popen([sys.executable, "-m", "buoy_kakao_host", "--adapter", adapter, "--log", ""],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, env={**os.environ, "PYTHONPATH": "."})
q: Queue = Queue()


def reader():
    while True:
        m = read_message(p.stdout)
        q.put(m)
        if m is None:
            return


threading.Thread(target=reader, daemon=True).start()


def wait_for(type_, timeout=5.0):
    """type_ 메시지가 올 때까지 기다린다. 사이에 온 STATUS/LOG 등은 그대로 출력."""
    deadline = time.time() + timeout
    while True:
        try:
            m = q.get(timeout=max(0.0, deadline - time.time()))
        except Empty:
            print(f"  !! {timeout}s 안에 {type_} 없음"); return None
        if m is None:
            print("  !! 호스트가 종료됨"); return None
        print("  ←", m)
        if m.get("type") == type_:
            return m


print("→ (호스트 시작)")
ok = wait_for("HELLO_ACK") is not None
write_message(p.stdin, {"type": "PING", "reqId": 1}); print("→ PING")
ok &= wait_for("PONG") is not None
write_message(p.stdin, {"type": "LIST_ROOMS", "reqId": 2}); print("→ LIST_ROOMS")
rooms_msg = wait_for("ROOMS")
rooms = rooms_msg["rooms"] if rooms_msg else []
if rooms:
    write_message(p.stdin, {"type": "SEND", "reqId": 3, "roomId": rooms[0]["id"], "text": "buoy e3 test"}); print("→ SEND")
    t0 = time.perf_counter()
    res = wait_for("SEND_RESULT")
    ok &= bool(res and res.get("ok"))
    print(f"  (SEND 왕복 {(time.perf_counter() - t0) * 1000:.0f} ms)")
    if adapter == "mock":
        ok &= wait_for("ITEM", timeout=3) is not None
else:
    print("  방이 없어 SEND 생략 (windows: 채팅창을 하나 열어 두세요)")
    ok = False
p.stdin.close()
print("종료 코드:", p.wait(5))
print("판정:", "GO" if ok else "NO-GO — 위 출력을 docs/04 §B3 결과표에 기록")
