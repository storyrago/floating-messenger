"""어댑터 인터페이스. 호스트는 이 인터페이스만 안다."""
from __future__ import annotations

from typing import Callable, Dict, List

Emit = Callable[[dict], None]


class Adapter:
    name = "base"
    capabilities: Dict[str, bool] = {"send": False, "rooms": False, "history": False, "seen": False}

    def start(self, emit: Emit) -> None:
        """이벤트(ITEM/STATUS/LOG)를 emit으로 내보내기 시작한다. 즉시 반환해야 한다(스레드 사용)."""
        self._emit = emit

    def stop(self) -> None:
        pass

    def list_rooms(self) -> List[dict]:
        """[{'id': str, 'name': str, 'kind': 'dm'|'group'|'unknown'}]"""
        return []

    def send(self, room_id: str, text: str) -> dict:
        """{'ok': bool, 'error'?: str}. 예외를 던져도 호스트가 SEND_RESULT(ok=false)로 바꾼다."""
        raise NotImplementedError(f"{self.name} adapter cannot send")
