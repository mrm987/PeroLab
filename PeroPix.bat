@echo off
title PeroPix

echo Starting PeroPix...
echo.

:: 백엔드 시작
start /B python backend.py

:: 서버 시작 대기
timeout /t 2 /nobreak >nul

:: 브라우저 열기 (앱 모드)
start "" "http://127.0.0.1:8765"

echo PeroPix is running at http://127.0.0.1:8765
echo Press Ctrl+C or close this window to stop.
echo.

:: 백엔드 프로세스 유지
python backend.py
