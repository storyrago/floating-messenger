"""카카오톡 PC(Windows) 수신 경로 A — Windows 알림(토스트) 리스너. (E1a에서 실기 검증)

원리
- Windows 10/11의 UserNotificationListener 로 현재 떠 있는 토스트 알림을 읽는다.
- 카카오톡 PC가 Windows 알림 시스템으로 알림을 내면, 제목/본문 텍스트에서 방·발신자·본문을 뽑는다.
- 이벤트 콜백은 데스크탑 앱에서 안 올 수 있어 400ms 폴링으로 새 알림 id를 찾는다.

전제 (E0에서 확인)
- 카카오톡 PC 설정 > 알림: 알림 켜기 + 메시지 내용(미리보기) 표시
- Windows 설정 > 알림: 카카오톡 알림 허용. Python 프로세스의 알림 접근 허용 (처음 실행 시 물어보거나 설정에서 켠다)

pywinrt 패키지 이름
- 새 방식: pip install winrt-runtime winrt-Windows.Foundation winrt-Windows.Foundation.Collections
           winrt-Windows.UI.Notifications winrt-Windows.UI.Notifications.Management winrt-Windows.ApplicationModel
  → import winrt.windows.ui.notifications.management
- 예전 방식(단일 패키지, deprecated): pip install winsdk → import winsdk.windows.ui.notifications.management
둘 다 시도한다.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Callable, Iterable, List, Optional, Tuple

log = logging.getLogger("buoy.toast")

KAKAO_APP_NAMES = ("카카오톡", "kakaotalk")


def _import_winrt():
    try:
        from winrt.windows.ui.notifications.management import (  # type: ignore
            UserNotificationListener, UserNotificationListenerAccessStatus)
        from winrt.windows.ui.notifications import KnownNotificationBindings, NotificationKinds  # type: ignore
        return UserNotificationListener, UserNotificationListenerAccessStatus, KnownNotificationBindings, NotificationKinds
    except ImportError:
        from winsdk.windows.ui.notifications.management import (  # type: ignore
            UserNotificationListener, UserNotificationListenerAccessStatus)
        from winsdk.windows.ui.notifications import KnownNotificationBindings, NotificationKinds  # type: ignore
        return UserNotificationListener, UserNotificationListenerAccessStatus, KnownNotificationBindings, NotificationKinds


def _static(cls, prop: str, getter: str):
    """pywinrt 버전에 따라 정적 속성이 property 또는 get_xxx() 로 노출된다. 둘 다 시도."""
    if hasattr(cls, getter):
        return getattr(cls, getter)()
    return getattr(cls, prop)


def parse_kakao_toast(lines: List[str]) -> Tuple[str, str, str]:
    """토스트 텍스트 줄들 → (방 이름, 발신자, 본문).

    카카오톡 알림 레이아웃은 E1a 결과로 확정한다. 지금은 가장 흔한 형태를 가정:
    - [제목, 본문]              1:1 → 제목=발신자=방
    - [제목, "발신자: 본문"]    그룹 → 제목=방
    - [방, 발신자, 본문...]
    """
    lines = [l.strip() for l in lines if l and l.strip()]
    if not lines:
        return "", "", ""
    if len(lines) == 1:
        return "", "", lines[0]
    if len(lines) == 2:
        title, body = lines
        if ": " in body:
            sender, text = body.split(": ", 1)
            if 0 < len(sender) <= 20 and "://" not in sender:  # 카톡 이름은 20자 이하, URL은 제외
                return title, sender, text
        return title, title, body
    return lines[0], lines[1], " ".join(lines[2:])


class ToastSource:
    """카카오톡 토스트를 폴링해 on_item(room, sender, text, ts_ms, raw_lines) 로 넘긴다."""

    def __init__(self, on_item: Callable[[str, str, str, int, List[str]], None],
                 on_status: Optional[Callable[[str, str], None]] = None,
                 poll_ms: int = 400, app_names: Iterable[str] = KAKAO_APP_NAMES):
        self.on_item = on_item
        self.on_status = on_status or (lambda _s, _d: None)
        self.poll_ms = poll_ms
        self.app_names = tuple(a.lower() for a in app_names)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._thread_main, name="buoy-toast", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    # ── 내부 ──
    def _thread_main(self) -> None:
        try:
            asyncio.run(self._run())
        except Exception as e:
            log.exception("toast source died")
            self.on_status("error", f"toast source died: {type(e).__name__}: {e}")

    async def _run(self) -> None:
        try:
            Listener, AccessStatus, Bindings, Kinds = _import_winrt()
        except ImportError as e:
            self.on_status("degraded", f"winrt not installed: {e}")
            return

        listener = _static(Listener, "current", "get_current")
        access = await listener.request_access_async()
        if access != AccessStatus.ALLOWED:
            self.on_status("degraded", f"notification access not allowed: {access}")
            return

        toast_generic = _static(Bindings, "toast_generic", "get_toast_generic")
        seen: set = set()
        first = True
        self.on_status("connected", "toast listener polling")
        while not self._stop.is_set():
            try:
                notifs = await listener.get_notifications_async(Kinds.TOAST)
            except Exception as e:
                log.warning("get_notifications failed: %s", e)
                await asyncio.sleep(1.0)
                continue
            current_ids = set()
            for n in notifs:
                nid = n.id
                current_ids.add(nid)
                if nid in seen:
                    continue
                seen.add(nid)
                if first:  # 시작 전에 떠 있던 알림은 무시
                    continue
                app = _app_name(n)
                if app and not any(k in app.lower() for k in self.app_names):
                    continue
                lines = _text_lines(n, toast_generic)
                room, sender, text = parse_kakao_toast(lines)
                if not text:
                    continue
                self.on_item(room, sender, text, int(time.time() * 1000), lines)
            seen &= current_ids or set()
            first = False
            await asyncio.sleep(self.poll_ms / 1000)


def _app_name(n) -> str:
    try:
        return n.app_info.display_info.display_name or ""
    except Exception:
        return ""


def _text_lines(n, toast_generic) -> List[str]:
    try:
        binding = n.notification.visual.get_binding(toast_generic)
        if binding is None:
            return []
        return [t.text for t in binding.get_text_elements()]
    except Exception as e:
        log.debug("text extraction failed: %s", e)
        return []
