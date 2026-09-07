"""카카오톡 PC(Windows) 창 제어 — 방 목록과 텍스트 전송. (E2에서 실기 검증)

원리
- 카카오톡 프로세스(kakaotalk.exe)의 보이는 최상위 창을 열거한다. 채팅방 창의 제목 = 방 이름.
- 채팅방 창 안의 입력창은 RichEdit 컨트롤(클래스 RICHEDIT50W)이다.
- 입력창에 WM_SETTEXT로 글을 넣고 Enter 키 메시지를 보내면 전송된다. (창이 앞에 없어도 동작)

제약
- 채팅방 창이 열려 있어야 한다. 닫혀 있으면 room_window_not_open 을 돌려준다. (방 열기 자동화는 E2-b)
- 클래스 이름은 카카오톡 버전에 따라 바뀔 수 있다. E2 스크립트가 실제 값을 출력하므로 그 값으로 상수를 맞춘다.
"""
from __future__ import annotations

import os
from typing import List, Optional, Tuple

import win32api  # type: ignore  # pywin32
import win32con  # type: ignore
import win32gui  # type: ignore
import win32process  # type: ignore

KAKAO_EXE = "kakaotalk.exe"
CHAT_EDIT_CLASS = "RICHEDIT50W"
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _exe_name(pid: int) -> str:
    """pid의 실행파일 이름(소문자). 못 읽으면 ''."""
    for access in (win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, PROCESS_QUERY_LIMITED_INFORMATION):
        try:
            h = win32api.OpenProcess(access, False, pid)
        except Exception:
            continue
        try:
            return os.path.basename(win32process.GetModuleFileNameEx(h, 0)).lower()
        except Exception:
            continue
        finally:
            win32api.CloseHandle(h)
    try:  # 선택 의존성: psutil이 있으면 마지막으로 시도
        import psutil  # type: ignore
        return psutil.Process(pid).name().lower()
    except Exception:
        return ""


def kakao_windows() -> List[Tuple[int, str, str]]:
    """카카오톡 프로세스의 보이는 최상위 창 [(hwnd, title, class_name)]."""
    found: List[Tuple[int, str, str]] = []
    pid_cache: dict = {}

    def cb(hwnd: int, _extra) -> bool:
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd)
        if not title:
            return True
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        if pid not in pid_cache:
            pid_cache[pid] = _exe_name(pid)
        if pid_cache[pid] == KAKAO_EXE:
            found.append((hwnd, title, win32gui.GetClassName(hwnd)))
        return True

    win32gui.EnumWindows(cb, None)
    return found


def find_child(hwnd: int, class_name: str) -> Optional[int]:
    """hwnd 아래에서 class_name 컨트롤을 찾는다 (첫 번째)."""
    hits: List[int] = []

    def cb(h: int, _extra) -> bool:
        if win32gui.GetClassName(h) == class_name:
            hits.append(h)
        return True

    try:
        win32gui.EnumChildWindows(hwnd, cb, None)
    except Exception:  # 자식이 없으면 pywin32가 예외를 던지는 경우가 있다
        pass
    return hits[0] if hits else None


def chat_rooms() -> List[dict]:
    """열려 있는 채팅방 창 목록. 입력창(RICHEDIT50W)이 있는 창만 채팅방으로 본다."""
    rooms = []
    for hwnd, title, _cls in kakao_windows():
        if find_child(hwnd, CHAT_EDIT_CLASS) is not None:
            rooms.append({"id": title, "name": title, "kind": "unknown", "hwnd": hwnd})
    return rooms


def send_text(room_name: str, text: str) -> dict:
    """방 이름이 제목인 채팅방 창을 찾아 텍스트를 전송한다."""
    for hwnd, title, _cls in kakao_windows():
        if title != room_name:
            continue
        edit = find_child(hwnd, CHAT_EDIT_CLASS)
        if edit is None:
            return {"ok": False, "error": "edit_not_found"}
        win32gui.SendMessage(edit, win32con.WM_SETTEXT, 0, text)
        win32api.PostMessage(edit, win32con.WM_KEYDOWN, win32con.VK_RETURN, 0)
        win32api.PostMessage(edit, win32con.WM_KEYUP, win32con.VK_RETURN, 0)
        return {"ok": True, "hwnd": hwnd}
    return {"ok": False, "error": "room_window_not_open"}
