"""토스트 텍스트 파싱은 순수 함수라 어디서나 테스트한다. 레이아웃은 E1a 결과로 확정한다."""
from buoy_kakao_host.adapters.windows.toast_source import parse_kakao_toast


def test_two_lines_dm():
    assert parse_kakao_toast(["김철수", "저녁 뭐 먹을까"]) == ("김철수", "김철수", "저녁 뭐 먹을까")


def test_two_lines_group_with_sender_prefix():
    assert parse_kakao_toast(["가족방", "엄마: 밥 먹었니"]) == ("가족방", "엄마", "밥 먹었니")


def test_colon_in_body_but_long_prefix_is_not_sender():
    room, sender, text = parse_kakao_toast(["김철수", "https://example.com/a: b"])
    assert (room, sender) == ("김철수", "김철수") and text.startswith("https://")


def test_three_lines():
    assert parse_kakao_toast(["가족방", "엄마", "밥", "먹었니"]) == ("가족방", "엄마", "밥 먹었니")


def test_empty_and_single():
    assert parse_kakao_toast([]) == ("", "", "")
    assert parse_kakao_toast(["", "  "]) == ("", "", "")
    assert parse_kakao_toast(["안녕"]) == ("", "", "안녕")
