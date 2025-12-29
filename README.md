# PeroPix

NAI API + Local Diffusers 이미지 생성기

## 다운로드

[Releases](../../releases)에서 최신 버전 다운로드

## 설치

1. `PeroPix-Windows.zip` 다운로드
2. 압축 해제
3. `PeroPix.exe` 실행

## 사용법

### NAI 생성
1. Settings → NAI API Token 입력
2. NAI 탭에서 프롬프트 입력
3. Queue 버튼 클릭

### Local 생성 (GPU 필요)
1. Local 탭 클릭 → Install 버튼 (~3GB 추가 다운로드)
2. `models/checkpoints/`에 SDXL 모델 배치
3. 모델 선택 후 Generate

## 폴더 구조

```
PeroPix/
├── PeroPix.exe
├── backend.py
├── index.html
├── python_env/       # Python 환경 (포함)
├── prompts/          # 프롬프트 프리셋
├── models/
│   ├── checkpoints/  # SDXL 모델 (.safetensors)
│   ├── loras/        # LoRA 파일
│   └── upscale_models/
└── outputs/          # 생성된 이미지
```

## 기능

- **NAI API** - NovelAI v4 모델
- **Local 생성** - SDXL + LoRA
- **2-Pass Upscale** - 업스케일 모델
- **Multi-Slot** - 여러 프롬프트 큐
- **Character Prompts** - 캐릭터별 분리 프롬프트

## 시스템 요구사항

- Windows 10/11
- NVIDIA GPU (CUDA, Local 생성 시)
- 8GB+ VRAM 권장

## License

MIT
