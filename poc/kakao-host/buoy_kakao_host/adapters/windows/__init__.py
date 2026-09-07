"""Windows 카카오톡 어댑터 = 토스트 수신(toast_source) + 창 제어 전송(win_send).

각 부품이 없거나 실패해도 호스트는 살아 있고, STATUS(degraded)로 무엇이 빠졌는지 알린다.
"""
from __future__ import annotations

import logging
from typing import List

from ... import protocol as P
from ..base import Adapter, Emit

log = logging.getLogger("buoy.windows")


class WindowsKakaoAdapter(Adapter):
    name = "windows"

    def __init__(self, poll_ms: int = 400):
        self.poll_ms = poll_ms
        self._emit: Emit = lambda _m: None
        self._toast = None
        self._send_mod = None
        self._room_cache: dict = {}  # roomName → 마지막 ITEM 시각 (읽기 전용 정보)
        self.capabilities = {"send": False, "rooms": False, "history": False, "seen": False}
        try:
            from . import win_send  # pywin32 필요
            self._send_mod = win_send
            self.capabilities.update({"send": True, "rooms": True})
        except Exception as e:  # ImportError 포함
            log.warning("win_send unavailable: %s", e)
            self._send_error = f"{type(e).__name__}: {e}"

    def start(self, emit: Emit) -> None:
        self._emit = emit
        if self._send_mod is None:
            emit(P.status("degraded", f"send unavailable: {getattr(self, '_send_error', 'pywin32 missing')}", source="win_send"))
        try:
            from .toast_source import ToastSource
            self._toast = ToastSource(on_item=self._on_toast_item, on_status=self._on_source_status, poll_ms=self.poll_ms)
            self._toast.start()
        except Exception as e:
            log.exception("toast source failed to start")
            emit(P.status("degraded", f"receive unavailable: {type(e).__name__}: {e}", source="toast"))
        if self._send_mod is not None:
            emit(P.status("connected", "windows adapter ready", source="windows"))

    def stop(self) -> None:
        if self._toast is not None:
            self._toast.stop()

    def list_rooms(self) -> List[dict]:
        rooms = []
        if self._send_mod is not None:
            for r in self._send_mod.chat_rooms():
                rooms.append({"id": r["id"], "name": r["name"], "kind": r.get("kind", "unknown")})
        # 알림으로만 본 방도 목록에 포함 (창이 닫혀 있어도 읽기는 되므로)
        known = {r["id"] for r in rooms}
        for name in self._room_cache:
            if name and name not in known:
                rooms.append({"id": name, "name": name, "kind": "unknown"})
        return rooms

    def send(self, room_id: str, text: str) -> dict:
        if self._send_mod is None:
            return {"ok": False, "error": "send_unavailable"}
        result = self._send_mod.send_text(room_id, text)
        return {"ok": bool(result.get("ok")), "error": result.get("error")}

    # ── 소스 콜백 ──
    def _on_toast_item(self, room: str, sender: str, text: str, ts_ms: int, raw: List[str]) -> None:
        room_id = room or sender or "(알 수 없음)"
        self._room_cache[room_id] = ts_ms
        self._emit(P.item(room_id, room_id, sender or room_id, text, ts=ts_ms, source="toast", raw=raw))

    def _on_source_status(self, status: str, detail: str) -> None:
        self._emit(P.status(status, detail, source="toast"))
