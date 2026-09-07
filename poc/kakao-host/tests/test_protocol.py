from buoy_kakao_host import protocol as P


def test_validate_ok():
    assert P.validate_request({"type": "PING", "reqId": 1}) is None
    assert P.validate_request({"type": "SEND", "reqId": 2, "roomId": "r", "text": "hi"}) is None


def test_validate_rejects():
    assert P.validate_request(None)
    assert P.validate_request({"type": "NOPE"})
    assert P.validate_request({"type": "PING", "reqId": "1"})
    assert P.validate_request({"type": "SEND", "roomId": "", "text": "x"})
    assert P.validate_request({"type": "SEND", "roomId": "r", "text": "   "})
    assert P.validate_request({"type": "SEND", "roomId": "r", "text": "a" * (P.MAX_TEXT_LEN + 1)})


def test_item_id_is_stable_within_a_second():
    a = P.item("room", "room", "철수", "hi", ts=1_700_000_000_123)["item"]["id"]
    b = P.item("room", "room", "철수", "hi", ts=1_700_000_000_900)["item"]["id"]
    c = P.item("room", "room", "철수", "hi", ts=1_700_000_001_100)["item"]["id"]
    assert a == b and a != c


def test_hello_ack_normalizes_caps():
    ack = P.hello_ack("mock", {"send": 1, "rooms": True})
    assert ack["capabilities"] == {"send": True, "rooms": True, "history": False, "seen": False}
    assert ack["protocol"] == P.PROTOCOL_VERSION


def test_status_rejects_unknown():
    import pytest
    with pytest.raises(ValueError):
        P.status("weird")
