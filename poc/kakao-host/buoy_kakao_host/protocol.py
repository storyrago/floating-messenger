"""확장 ↔ 카카오 호스트 프로토콜 (docs/02-architecture.md §8와 1:1로 맞춘다).

요청(확장 → 호스트): HELLO, PING, LIST_ROOMS, SEND, SHUTDOWN
응답/이벤트(호스트 → 확장): HELLO_ACK, PONG, ROOMS, SEND_RESULT, ITEM, STATUS, ERROR, LOG
"""
from __future__ import annotations

import hashlib
import time
from typing import Any, Optional

PROTOCOL_VERSION = 1
HOST_NAME = "buoy-kakao-host"
HOST_VERSION = "0.1.0"

REQUEST_TYPES = {"HELLO", "PING", "LIST_ROOMS", "SEND", "SHUTDOWN"}
EVENT_TYPES = {"HELLO_ACK", "PONG", "ROOMS", "SEND_RESULT", "ITEM", "STATUS", "ERROR", "LOG"}
STATUS_VALUES = {"connected", "degraded", "error", "stopped"}

MAX_TEXT_LEN = 5000  # 카카오톡 PC 입력 한도보다 작게 유지


def now_ms() -> int:
    return int(time.time() * 1000)


def validate_request(msg: Any) -> Optional[str]:
    """요청이 규약에 맞으면 None, 아니면 오류 문자열."""
    if not isinstance(msg, dict):
        return "request must be an object"
    t = msg.get("type")
    if t not in REQUEST_TYPES:
        return f"unknown request type: {t!r}"
    req_id = msg.get("reqId")
    if req_id is not None and not isinstance(req_id, int):
        return "reqId must be an integer"
    if t == "SEND":
        room_id = msg.get("roomId")
        text = msg.get("text")
        if not isinstance(room_id, str) or not room_id:
            return "SEND.roomId must be a non-empty string"
        if not isinstance(text, str) or not text.strip():
            return "SEND.text must be a non-empty string"
        if len(text) > MAX_TEXT_LEN:
            return f"SEND.text too long (max {MAX_TEXT_LEN})"
    return None


# ── 빌더 ──────────────────────────────────────────────────────────────────────

def hello_ack(adapter_name: str, capabilities: dict) -> dict:
    return {
        "type": "HELLO_ACK",
        "protocol": PROTOCOL_VERSION,
        "host": HOST_NAME,
        "version": HOST_VERSION,
        "adapter": adapter_name,
        "capabilities": {
            "send": bool(capabilities.get("send", False)),
            "rooms": bool(capabilities.get("rooms", False)),
            "history": bool(capabilities.get("history", False)),
            "seen": bool(capabilities.get("seen", False)),
        },
    }


def pong(req_id: Optional[int]) -> dict:
    return {"type": "PONG", "reqId": req_id, "ts": now_ms()}


def rooms(req_id: Optional[int], room_list: list) -> dict:
    return {
        "type": "ROOMS",
        "reqId": req_id,
        "rooms": [
            {"id": str(r.get("id")), "name": str(r.get("name", r.get("id"))), "kind": r.get("kind", "unknown")}
            for r in room_list
        ],
    }


def send_result(req_id: Optional[int], room_id: str, ok: bool, error: Optional[str] = None) -> dict:
    out = {"type": "SEND_RESULT", "reqId": req_id, "roomId": room_id, "ok": bool(ok), "ts": now_ms()}
    if error:
        out["error"] = error
    return out


def item(room_id: str, room_name: str, sender: str, text: str, ts: Optional[int] = None,
         source: str = "unknown", from_me: bool = False, raw: Optional[list] = None) -> dict:
    ts = now_ms() if ts is None else int(ts)
    out = {
        "type": "ITEM",
        "item": {
            "id": make_item_id(room_id, sender, text, ts),
            "roomId": room_id,
            "roomName": room_name,
            "sender": sender,
            "text": text,
            "ts": ts,
            "fromMe": bool(from_me),
            "source": source,
        },
    }
    if raw is not None:
        out["item"]["raw"] = raw
    return out


def status(value: str, detail: Optional[str] = None, source: Optional[str] = None) -> dict:
    if value not in STATUS_VALUES:
        raise ValueError(f"bad status: {value}")
    out = {"type": "STATUS", "status": value}
    if detail:
        out["detail"] = detail
    if source:
        out["source"] = source
    return out


def error(message: str, req_id: Optional[int] = None) -> dict:
    out = {"type": "ERROR", "error": message}
    if req_id is not None:
        out["reqId"] = req_id
    return out


def log(level: str, msg: str) -> dict:
    return {"type": "LOG", "level": level, "msg": msg}


def make_item_id(room_id: str, sender: str, text: str, ts_ms: int) -> str:
    """같은 메시지가 알림·창 등 여러 소스에서 잡혀도 같은 id가 되도록 1초 단위로 묶어 해시."""
    key = f"{room_id}\x1f{sender}\x1f{text}\x1f{ts_ms // 1000}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
