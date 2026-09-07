"""Mock 어댑터. 카카오톡 없이 호스트·확장 왕복(E3)을 검증하는 데 쓴다.

- 방 2개를 가진다.
- interval > 0 이면 그 간격(초)으로 가짜 수신 메시지를 낸다.
- send() 하면 SEND_RESULT ok 뒤 0.3초 후 상대가 답한 것처럼 ITEM을 낸다.
"""
from __future__ import annotations

import itertools
import threading
from typing import List

from .. import protocol as P
from .base import Adapter, Emit

ROOMS = [
    {"id": "Buoy 테스트방", "name": "Buoy 테스트방", "kind": "group"},
    {"id": "친구 A", "name": "친구 A", "kind": "dm"},
]


class MockAdapter(Adapter):
    name = "mock"
    capabilities = {"send": True, "rooms": True, "history": False, "seen": False}

    def __init__(self, interval: float = 0.0):
        self.interval = float(interval or 0.0)
        self._stop = threading.Event()
        self._seq = itertools.count(1)
        self._thread: threading.Thread | None = None
        self._emit: Emit = lambda _m: None

    def start(self, emit: Emit) -> None:
        self._emit = emit
        emit(P.status("connected", source="mock"))
        if self.interval > 0:
            self._thread = threading.Thread(target=self._ticker, name="buoy-mock-ticker", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def list_rooms(self) -> List[dict]:
        return list(ROOMS)

    def send(self, room_id: str, text: str) -> dict:
        if room_id not in {r["id"] for r in ROOMS}:
            return {"ok": False, "error": "room_not_found"}
        # 상대 답장 흉내 (fromMe=False)
        def reply() -> None:
            if not self._stop.wait(0.3):
                self._emit(P.item(room_id, room_id, "mock 상대", f"(mock) 받았어요: {text}", source="mock"))
        threading.Thread(target=reply, name="buoy-mock-reply", daemon=True).start()
        return {"ok": True}

    def _ticker(self) -> None:
        while not self._stop.wait(self.interval):
            n = next(self._seq)
            room = ROOMS[n % len(ROOMS)]
            self._emit(P.item(room["id"], room["name"], "mock 상대", f"가짜 메시지 #{n}", source="mock"))
