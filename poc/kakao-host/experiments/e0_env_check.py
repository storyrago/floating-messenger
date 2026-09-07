"""E0. 환경 점검 — Windows 버전, Python, 필요한 패키지, 카카오톡 프로세스.

실행: python experiments/e0_env_check.py
기대: 모든 항목 OK. 아니면 표시된 안내대로 설치/설정 후 다시 실행.
"""
import importlib
import platform
import sys


def check(label, ok, hint=""):
    print(f"[{'OK' if ok else 'X '}] {label}" + (f"  → {hint}" if (not ok and hint) else ""))
    return ok


print("Python", sys.version.split()[0], "/", platform.platform())
ok = True
def _win_ok() -> bool:
    if sys.platform != "win32":
        return False
    try:
        return int(platform.release().split(".")[0]) >= 10
    except ValueError:  # 서버 등 문자열 릴리즈는 통과시키고 수동 확인
        return True


ok &= check("Windows 10/11", _win_ok(), "이 PoC의 카카오 어댑터는 Windows 전용입니다")
ok &= check("Python >= 3.10", sys.version_info >= (3, 10), "python.org에서 3.11+ 설치")

for mod, pkg in [("win32gui", "pywin32"), ("win32process", "pywin32"), ("win32api", "pywin32")]:
    try:
        importlib.import_module(mod)
        ok &= check(f"{mod} ({pkg})", True)
    except ImportError:
        ok &= check(f"{mod} ({pkg})", False, f"pip install {pkg}")

winrt_ok = False
for mod in ("winrt.windows.ui.notifications.management", "winsdk.windows.ui.notifications.management"):
    try:
        importlib.import_module(mod)
        winrt_ok = True
        print(f"[OK] {mod}")
        break
    except ImportError:
        pass
ok &= check("winrt (알림 리스너)", winrt_ok, "pip install -r requirements-windows.txt  (실패하면 README의 대안 참고)")

if sys.platform == "win32":
    try:
        from buoy_kakao_host.adapters.windows.win_send import kakao_windows
        wins = kakao_windows()
        ok &= check(f"카카오톡 PC 실행 중 (창 {len(wins)}개)", len(wins) > 0, "카카오톡 PC를 실행하고 로그인하세요")
        for hwnd, title, cls in wins:
            print(f"     hwnd={hwnd} class={cls!r} title={title!r}")
    except Exception as e:  # noqa: BLE001
        ok &= check("카카오톡 창 열거", False, f"{type(e).__name__}: {e}")

print("\n수동 확인 (E0 체크리스트):")
print(" - 카카오톡 PC 설정 > 알림 > 알림 켜기 + 메시지 내용 표시(미리보기) 켜기")
print(" - Windows 설정 > 시스템 > 알림 > 카카오톡 알림 켜기, 집중 모드(방해 금지) 끄기")
print("\n결과:", "모두 OK" if ok else "실패 항목을 먼저 해결하세요")
