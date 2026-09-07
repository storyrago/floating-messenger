import io
import struct

import pytest

from buoy_kakao_host.framing import FramingError, encode_message, read_message, write_message


def roundtrip(obj):
    buf = io.BytesIO()
    write_message(buf, obj)
    buf.seek(0)
    return read_message(buf)


def test_roundtrip_unicode():
    assert roundtrip({"type": "SEND", "text": "안녕하세요 👋"}) == {"type": "SEND", "text": "안녕하세요 👋"}


def test_header_is_native_uint32_length():
    data = encode_message({"a": 1})
    (length,) = struct.unpack("=I", data[:4])
    assert length == len(data) - 4
    assert data[4:] == b'{"a":1}'


def test_eof_returns_none():
    assert read_message(io.BytesIO(b"")) is None


def test_truncated_body_raises():
    data = encode_message({"a": 1})[:-2]
    with pytest.raises(FramingError):
        read_message(io.BytesIO(data))


def test_non_object_payload_raises():
    body = b"[1,2]"
    with pytest.raises(FramingError):
        read_message(io.BytesIO(struct.pack("=I", len(body)) + body))


def test_multiple_messages_in_stream():
    buf = io.BytesIO()
    write_message(buf, {"n": 1})
    write_message(buf, {"n": 2})
    buf.seek(0)
    assert read_message(buf) == {"n": 1}
    assert read_message(buf) == {"n": 2}
    assert read_message(buf) is None


def test_too_large_outbound_rejected():
    with pytest.raises(FramingError):
        encode_message({"x": "a" * (1024 * 1024)})
