"""E1a. 수신 경로 A — Windows 알림 리스너로 카카오톡 메시지 받기.

실행: python experiments/e1a_toast_listener.py
절차: 실행 후 폰으로 자신의 PC 카톡에 메시지를 3개 보낸다 (1:1 방 1개, 그룹방 1개 포함).
기대: 각 메시지가 1초 안에 아래처럼 찍힌다.
      [toast] room='…' sender='…' text='…' raw=['…', '…']
판정: 3개 모두 찍히고 raw 레이아웃이 일정하면 GO. raw를 docs/04 §B3 결과표에 그대로 옮긴다.
      아무것도 안 찍히면: (1) E0 수동 확인 항목 (2) 카톡 창이 앞에 떠 있으면 알림이 안 뜰 수 있음 → 최소화하고 재시도
      (3) 그래도 안 되면 E1b로.
"""
import sys
import time

sys.path.insert(0, ".")
from buoy_kakao_host.adapters.windows.toast_source import ToastSource  # noqa: E402

t0 = time.time()


def on_item(room, sender, text, ts_ms, raw):
    print(f"[toast] +{time.time() - t0:6.1f}s room={room!r} sender={sender!r} text={text!r} raw={raw!r}", flush=True)


def on_status(status, detail):
    print(f"[status] {status}: {detail}", flush=True)


src = ToastSource(on_item=on_item, on_status=on_status, poll_ms=300)
src.start()
print("알림 대기 중… 폰에서 메시지를 보내보세요. 종료: Ctrl+C", flush=True)
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    src.stop()
