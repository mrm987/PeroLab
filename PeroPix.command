#!/bin/bash
cd "$(dirname "$0")"

echo "Starting PeroPix..."
echo

# 필수 패키지 설치 확인
if ! python3 -c "import piexif" 2>/dev/null; then
    echo "Installing required packages..."
    pip3 install piexif -q
fi

echo "PeroPix is running at http://127.0.0.1:8765"
echo "Press Ctrl+C or close this window to stop."
echo

# 백엔드 실행 (서버 준비 완료 시 자동으로 브라우저 열림)
python3 backend.py
