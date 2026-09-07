"""호스트를 실제 서브프로세스로 띄워 mock 어댑터와 왕복한다 (E3의 자동화 버전)."""
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Empty, Queue

from buoy_kakao_host.framing import read_message, write_message

ROOT = Path(__file__).resolve().parents[1]


class HostProc:
    def __init__(self, *extra_args):
        env = {**os.environ, "PYTHONPATH": str(ROOT)}
        self.p = subprocess.Popen(
            [sys.executable, "-m", "buoy_kakao_host", "--adapter", "mock", "--log", "", *extra_args],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=str(ROOT),
        )
        self.q: Queue = Queue()
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        while True:
            try:
                msg = read_message(self.p.stdout)
            except Exception as e:  # noqa: BLE001
                self.q.put({"type": "__reader_error__", "error": str(e)})
                return
            if msg is None:
                self.q.put(None)
                return
            self.q.put(msg)

    def send(self, obj):
        write_message(self.p.stdin, obj)

    def wait_for(self, type_, timeout=5.0, **match):
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise AssertionError(f"timeout waiting for {type_} {match}")
            try:
                msg = self.q.get(timeout=remaining)
            except Empty:
                continue
            if msg is None:
                raise AssertionError(f"host closed stdout while waiting for {type_}")
            if msg.get("type") == type_ and all(msg.get(k) == v for k, v in match.items()):
                return msg

    def close(self):
        try:
            self.p.stdin.close()
        except Exception:
            pass
        return self.p.wait(timeout=5)


def test_handshake_ping_rooms_send_and_shutdown():
    h = HostProc()
    try:
        ack = h.wait_for("HELLO_ACK")
        assert ack["adapter"] == "mock" and ack["capabilities"]["send"] is True
        h.wait_for("STATUS", status="connected")

        h.send({"type": "HELLO", "protocol": 1, "client": "test"})
        h.wait_for("HELLO_ACK")

        h.send({"type": "PING", "reqId": 7})
        assert h.wait_for("PONG", reqId=7)["ts"] > 0

        h.send({"type": "LIST_ROOMS", "reqId": 8})
        rooms = h.wait_for("ROOMS", reqId=8)["rooms"]
        assert rooms and all({"id", "name", "kind"} <= set(r) for r in rooms)

        h.send({"type": "SEND", "reqId": 9, "roomId": rooms[0]["id"], "text": "안녕"})
        res = h.wait_for("SEND_RESULT", reqId=9)
        assert res["ok"] is True and res["roomId"] == rooms[0]["id"]
        it = h.wait_for("ITEM", timeout=3)["item"]
        assert it["roomId"] == rooms[0]["id"] and "안녕" in it["text"] and it["fromMe"] is False
        assert {"id", "roomId", "roomName", "sender", "text", "ts", "fromMe", "source"} <= set(it)

        h.send({"type": "SEND", "reqId": 10, "roomId": "없는방", "text": "x"})
        assert h.wait_for("SEND_RESULT", reqId=10)["ok"] is False

        h.send({"type": "BOGUS", "reqId": 11})
        assert "unknown request type" in h.wait_for("ERROR", reqId=11)["error"]
    finally:
        code = h.close()
    assert code == 0
    h.wait_for("STATUS", status="stopped", timeout=2)


def test_mock_ticker_emits_items():
    h = HostProc("--mock-interval", "0.2")
    try:
        h.wait_for("HELLO_ACK")
        first = h.wait_for("ITEM", timeout=3)["item"]
        second = h.wait_for("ITEM", timeout=3)["item"]
        assert first["id"] != second["id"]
    finally:
        assert h.close() == 0


def test_stdout_contains_only_frames():
    """stdout에 프레임 외 바이트가 섞이면 Chrome이 연결을 끊는다. 로그가 stderr로만 가는지 확인."""
    h = HostProc("--verbose")
    try:
        h.wait_for("HELLO_ACK")
        h.send({"type": "PING", "reqId": 1})
        h.wait_for("PONG", reqId=1)
    finally:
        h.close()
    err = h.p.stderr.read().decode("utf-8", "replace")
    assert "host start" in err  # 로그는 stderr
