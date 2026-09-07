"""Chrome Native Messaging 프레이밍.

규격: 메시지마다 [32비트 길이(네이티브 바이트 순서)] + [UTF-8 JSON].
- 호스트 → Chrome 한 메시지 최대 1 MB
- Chrome → 호스트 최대 4 GB (실제로는 작게 유지)
참고: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
"""
from __future__ import annotations

import json
import struct
import sys
from typing import Any, BinaryIO, Optional

HEADER = struct.Struct("=I")  # '=' : 네이티브 바이트 순서, 표준 크기(4바이트), 패딩 없음
MAX_OUTBOUND = 1024 * 1024    # 호스트 → Chrome 1 MB 제한


class FramingError(Exception):
    pass


def read_message(stream: BinaryIO) -> Optional[dict]:
    """한 메시지를 읽어 dict로 돌려준다. 스트림이 닫혔으면 None."""
    header = _read_exact(stream, HEADER.size)
    if header is None:
        return None
    (length,) = HEADER.unpack(header)
    if length == 0:
        return {}
    body = _read_exact(stream, length)
    if body is None:
        raise FramingError("stream closed mid-message")
    try:
        obj = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise FramingError(f"invalid JSON payload: {e}") from e
    if not isinstance(obj, dict):
        raise FramingError("payload must be a JSON object")
    return obj


def encode_message(obj: Any) -> bytes:
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_OUTBOUND:
        raise FramingError(f"message too large: {len(body)} bytes (max {MAX_OUTBOUND})")
    return HEADER.pack(len(body)) + body


def write_message(stream: BinaryIO, obj: Any) -> None:
    stream.write(encode_message(obj))
    stream.flush()


def binary_stdio() -> tuple[BinaryIO, BinaryIO]:
    """Windows에서 stdin/stdout을 바이너리 모드로 전환한다 (개행 변환 방지)."""
    if sys.platform == "win32":  # pragma: no cover - Windows 전용
        import msvcrt
        import os

        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    return sys.stdin.buffer, sys.stdout.buffer


def _read_exact(stream: BinaryIO, n: int) -> Optional[bytes]:
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)
