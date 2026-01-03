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

echo PeroPix is running at http://127.0.0.1:8765
echo Press Ctrl+C or close this window to stop.
echo.

:: 백엔드 실행 (서버 준비 완료 시 자동으로 브라우저 열림)
python backend.py

:: 오류 발생 시 메시지 표시
if errorlevel 1 (
    echo.
    echo [ERROR] PeroPix failed to start. See error above.
    pause
)
