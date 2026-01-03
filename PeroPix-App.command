#!/bin/bash
cd "$(dirname "$0")"

echo "Starting PeroPix..."

# 필수 패키지 설치 확인
if ! python3 -c "import piexif" 2>/dev/null; then
    echo "Installing required packages..."
    pip3 install piexif -q
fi

# 백엔드 시작 (백그라운드)
python3 backend.py &
BACKEND_PID=$!

# 서버 시작 대기
sleep 2

# Chrome 앱 모드로 열기 (없으면 일반 브라우저)
if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" --args --app=http://127.0.0.1:8765
elif [ -d "/Applications/Microsoft Edge.app" ]; then
    open -a "Microsoft Edge" --args --app=http://127.0.0.1:8765
else
    open "http://127.0.0.1:8765"
fi

echo
echo "PeroPix running. Press Enter to stop the server..."
read

# 백엔드 종료
kill $BACKEND_PID 2>/dev/null
