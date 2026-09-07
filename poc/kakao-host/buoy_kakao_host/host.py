"""호스트 본체.

동작
- stdin에서 프레임을 읽어 요청을 처리하고, stdout으로 응답·이벤트를 쓴다.
- stdout 쓰기는 락으로 직렬화한다 (어댑터 스레드와 메인 스레드가 동시에 쓸 수 있으므로).
- SEND / LIST_ROOMS 는 워커 스레드에서 실행해 PING 처리가 막히지 않게 한다.
- stdin이 닫히면(EOF) 어댑터를 멈추고 0으로 종료한다. Chrome이 포트를 끊으면 EOF가 온다.
- stdout에는 프레임 외에 아무것도 쓰지 않는다. 디버그 출력은 stderr 또는 로그 파일로.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import BinaryIO, Optional

from . import protocol as P
from .adapters import get_adapter
from .adapters.base import Adapter
from .framing import FramingError, binary_stdio, read_message, write_message

log = logging.getLogger("buoy.host")


class Host:
    def __init__(self, adapter: Adapter, inp: BinaryIO, out: BinaryIO):
        self.adapter = adapter
        self.inp = inp
        self.out = out
        self._out_lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="buoy-work")
        self._closed = False

    # ── 출력 ──
    def emit(self, msg: dict) -> None:
        with self._out_lock:
            if self._closed:
                return
            try:
                write_message(self.out, msg)
            except (BrokenPipeError, OSError, ValueError) as e:  # 파이프가 끊긴 뒤의 쓰기
                log.warning("emit failed (%s); marking closed", e)
                self._closed = True

    # ── 수명주기 ──
    def run(self) -> int:
        log.info("host start adapter=%s", self.adapter.name)
        self.emit(P.hello_ack(self.adapter.name, self.adapter.capabilities))
        try:
            self.adapter.start(self.emit)
        except Exception as e:  # 어댑터가 못 뜨면 알리고 계속 (PING은 되게)
            log.exception("adapter start failed")
            self.emit(P.status("error", f"adapter start failed: {type(e).__name__}: {e}"))

        try:
            while True:
                try:
                    msg = read_message(self.inp)
                except FramingError as e:
                    log.warning("bad frame: %s", e)
                    self.emit(P.error(f"bad frame: {e}"))
                    continue
                if msg is None:
                    log.info("stdin closed; shutting down")
                    break
                if not self.handle(msg):
                    break
        finally:
            self._shutdown()
        return 0

    def _shutdown(self) -> None:
        try:
            self.adapter.stop()
        except Exception:
            log.exception("adapter stop failed")
        self.emit(P.status("stopped"))
        self._pool.shutdown(wait=False, cancel_futures=True)
        with self._out_lock:
            self._closed = True

    # ── 요청 처리 ──
    def handle(self, msg: dict) -> bool:
        """False를 돌려주면 루프를 끝낸다."""
        err = P.validate_request(msg)
        req_id = msg.get("reqId") if isinstance(msg, dict) else None
        if err:
            log.warning("invalid request: %s", err)
            self.emit(P.error(err, req_id if isinstance(req_id, int) else None))
            return True

        t = msg["type"]
        if t == "HELLO":
            self.emit(P.hello_ack(self.adapter.name, self.adapter.capabilities))
        elif t == "PING":
            self.emit(P.pong(req_id))
        elif t == "LIST_ROOMS":
            self._pool.submit(self._do_list_rooms, req_id)
        elif t == "SEND":
            self._pool.submit(self._do_send, req_id, msg["roomId"], msg["text"])
        elif t == "SHUTDOWN":
            return False
        return True

    def _do_list_rooms(self, req_id: Optional[int]) -> None:
        try:
            self.emit(P.rooms(req_id, self.adapter.list_rooms()))
        except Exception as e:
            log.exception("list_rooms failed")
            self.emit(P.error(f"list_rooms failed: {type(e).__name__}: {e}", req_id))

    def _do_send(self, req_id: Optional[int], room_id: str, text: str) -> None:
        try:
            result = self.adapter.send(room_id, text) or {}
            self.emit(P.send_result(req_id, room_id, bool(result.get("ok")), result.get("error")))
        except Exception as e:
            log.exception("send failed")
            self.emit(P.send_result(req_id, room_id, False, f"{type(e).__name__}: {e}"))


# ── 진입점 ──

def default_log_path() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "Buoy" / "kakao-host.log"


def setup_logging(path: Optional[str], verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]  # stdout은 절대 쓰지 않는다
    if path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(p, encoding="utf-8"))
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="buoy_kakao_host", description="Buoy 카카오톡 네이티브 메시징 호스트")
    parser.add_argument("--adapter", default="mock", choices=["mock", "windows"], help="사용할 어댑터 (기본 mock)")
    parser.add_argument("--log", default=str(default_log_path()), help="로그 파일 경로 ('' 이면 파일 로그 끔)")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--mock-interval", type=float, default=0.0,
                        help="mock 어댑터가 가짜 수신 메시지를 내는 간격(초). 0이면 끔")
    # Chrome은 호스트를 실행할 때 origin 등 추가 인자를 붙일 수 있으므로 모르는 인자는 무시한다
    args, _unknown = parser.parse_known_args(argv)

    setup_logging(args.log or None, args.verbose)
    adapter_kwargs = {"interval": args.mock_interval} if args.adapter == "mock" else {}
    adapter = get_adapter(args.adapter, **adapter_kwargs)
    inp, out = binary_stdio()
    return Host(adapter, inp, out).run()
