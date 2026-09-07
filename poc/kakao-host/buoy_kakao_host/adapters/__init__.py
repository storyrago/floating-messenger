"""어댑터 레지스트리. 이름으로 어댑터 인스턴스를 만든다."""
from __future__ import annotations

from .base import Adapter


def get_adapter(name: str, **kwargs) -> Adapter:
    if name == "mock":
        from .mock import MockAdapter
        return MockAdapter(**kwargs)
    if name == "windows":
        from .windows import WindowsKakaoAdapter
        return WindowsKakaoAdapter(**kwargs)
    raise ValueError(f"unknown adapter: {name}")
