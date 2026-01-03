@echo off
title PeroPix

echo Starting PeroPix...
echo.

:: 필수 패키지 설치 확인
python -c "import piexif" 2>nul
if errorlevel 1 (
    echo Installing required packages...
    pip install piexif -q
)

:: 브라우저 먼저 준비 (서버 시작 후 열림)
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765"

echo PeroPix is running at http://127.0.0.1:8765
echo Press Ctrl+C or close this window to stop.
echo.

:: 백엔드 실행 (포그라운드 - 창 닫으면 종료됨)
python backend.py

:: 오류 발생 시 메시지 표시
if errorlevel 1 (
    echo.
    echo [ERROR] PeroPix failed to start. See error above.
    pause
)
