#!/usr/bin/env python3
"""
PeroPix - PyWebView Desktop App
NAI + Local Diffusers Image Generator
"""
import sys
import os
import threading
import time
import socket
import traceback

# 경로 설정 (PyInstaller 빌드 대응)
if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(APP_DIR)

# 전역 에러 저장
backend_error = None


def is_port_in_use(port: int) -> bool:
    """포트 사용 중인지 확인"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def wait_for_server(port: int, timeout: int = 30) -> bool:
    """서버가 준비될 때까지 대기"""
    start = time.time()
    while time.time() - start < timeout:
        # 백엔드 에러 체크
        if backend_error:
            return False
        if is_port_in_use(port):
            return True
        time.sleep(0.1)
    return False


def start_backend():
    """FastAPI 백엔드 시작 (별도 스레드)"""
    global backend_error
    try:
        import uvicorn
        from backend import app

        uvicorn.run(
            app,
            host="127.0.0.1",
            port=8765,
            log_level="info",
            access_log=False
        )
    except Exception as e:
        backend_error = str(e)
        print(f"Backend error: {e}")
        traceback.print_exc()


def main():
    global backend_error

    # 이미 서버가 실행 중인지 확인
    server_already_running = is_port_in_use(8765)

    if not server_already_running:
        print("Starting backend server...")

        # 백엔드 서버 시작 (daemon 스레드)
        server_thread = threading.Thread(target=start_backend, daemon=True)
        server_thread.start()

        # 서버 준비 대기
        if not wait_for_server(8765, timeout=30):
            error_msg = backend_error or "Server failed to start (timeout)"
            print(f"Error: {error_msg}")

            # 에러 메시지 표시
            try:
                import webview
                webview.create_window(
                    "PeroPix - Error",
                    html=f"""
                    <html>
                    <body style="font-family: sans-serif; padding: 40px; background: #1a1a2e; color: #fff;">
                        <h1>⚠️ Backend Server Failed</h1>
                        <p style="color: #ff6b6b;">{error_msg}</p>
                        <p>Please check:</p>
                        <ul>
                            <li>Python dependencies are installed</li>
                            <li>Port 8765 is not in use</li>
                            <li>backend.py exists in the app folder</li>
                        </ul>
                        <button onclick="window.close()" style="padding: 10px 20px; cursor: pointer;">Close</button>
                    </body>
                    </html>
                    """,
                    width=500,
                    height=350
                )
                webview.start()
            except:
                pass
            sys.exit(1)

        print("Backend server ready!")
    else:
        print("Backend server already running")

    # PyWebView 창 생성
    import webview

    window = webview.create_window(
        title="PeroPix",
        url="http://127.0.0.1:8765",
        width=1400,
        height=900,
        min_size=(800, 600),
        resizable=True,
        frameless=False,
        easy_drag=False,
        text_select=True,
    )

    # WebView 시작
    webview.start(debug=False)


if __name__ == "__main__":
    main()
