# PeroPix 개발 노트

## 프로젝트 구조
- `index.html` - 프론트엔드 (HTML + CSS + JavaScript 단일 파일)
- `backend.py` - FastAPI 백엔드

---

## NAI (NovelAI) API

### API 문서
- 공식 문서: https://docs.novelai.net/
- 비공식 API 문서: https://api.novelai.net/docs

### 주요 엔드포인트
- 이미지 생성: `POST https://image.novelai.net/ai/generate-image`
- 구독 정보: `GET https://api.novelai.net/user/subscription`

### 구독 Tier
```
0: Paper (Free)
1: Tablet
2: Scroll
3: Opus
```
- Opus 확인: `tier >= 3`

### Anlas 비용 계산

#### Opus 무료 조건 (공식)
- 1024×1024 픽셀 이하 (약 1MP)
- 28 steps 이하
- 단일 이미지 생성
- 다른 이미지를 base로 사용하지 않음 (img2img, inpaint 제외)

#### 기본 비용 공식
```
비용 = ceil(메가픽셀 × 20)
     = ceil(pixels / 1048576 × 20)
```
- Steps 보정: 28 초과시 `base_cost × (steps / 28)`

#### NAI 비용 공식 (역산)
```python
# 기본 비용: ceil(megapixels × 20)
base_cost = math.ceil(pixels / 1048576 * 20)

# Steps 보정 (28 초과시)
if steps > 28:
    base_cost = int(base_cost * (steps / 28))

# 검증 데이터 (Opus, 28 steps)
# 1152×1152 (1.27MP) → 26 Anlas ✓
# 1280×1280 (1.56MP) → 32 Anlas ✓
# 1920×1080 (1.98MP) → 40 Anlas ✓
# 1472×1472 (2.07MP) → 42 Anlas ✓
# 1536×1536 (2.25MP) → 45 Anlas ✓
```

#### Vibe Transfer (V4/V4.5)
- 인코딩: 2 Anlas/vibe (일회성, 캐시됨)
- Information Extracted 값 변경 시 재인코딩 필요
- 4개 초과 시: 추가 vibe당 +2 Anlas
- 최대 16개 사용 가능

#### Character Reference (V4.5 전용)
- +5 Anlas/이미지 (Opus/일반 동일)
- Vibe Transfer와 동시 사용 불가
- 최대 6개 이미지 사용 가능

#### 비용 표시 형식
```
// 일반: 총비용 (개별 × 슬롯 × 횟수)
"15 (5 × 3슬롯 × 1회)"

// Vibe: 인코딩 비용만 표시 (일회성)
"4 (바이브 2개)"
```

### subscription API 응답 구조
```json
{
  "tier": 3,
  "active": true,
  "trainingStepsLeft": {
    "fixedTrainingStepsLeft": 10000,  // 구독 Anlas
    "purchasedTrainingSteps": 5000     // 구매 Anlas
  }
}
```

---

## 해결한 문제들

### 1. JavaScript 변수 중복 선언 오류
**문제**: `images.forEach(img => {...})` 안에서 `const img = ...` 선언시 충돌
**해결**: 내부 변수명을 `imgEl` 등으로 변경

### 2. 이미지 드래그 동작
**문제**: `<img>`의 기본 드래그가 부모 드래그를 방해
**해결**: `imgEl.draggable = false` 설정 (preventDefault 대신)

### 3. CSS overflow와 외부 요소
**문제**: `overflow: hidden` 부모 안에서 `right: -8px` 요소가 잘림
**해결**: 부모를 `overflow: visible`로 변경, 내부 요소에 개별 overflow 설정

### 4. 드롭다운 클리핑
**문제**: `.collapsible-content`의 `overflow: hidden`이 드롭다운 잘림
**해결**: `#charactersContent:not(.collapsed)` 에만 `overflow: visible` 적용

### 5. 큐 진행률 동기화
**문제**: 빠르게 여러번 클릭시 진행률 표시 오류
**해결**:
- `totalImages`와 `currentIndex` 독립적으로 동기화
- 시드는 큐 추가 전에 즉시 갱신 (중복 방지)

### 6. 갤러리 폴더 이동 후 삭제 실패
**문제**: 슬롯에서 갤러리 등록 후 폴더 이동하면 삭제 불가
**해결**: 백엔드에서 폴더 미지정시 전체 폴더 검색

### 7. 슬롯 이미지/정보 동시 표시
**문제**: 이미지보다 하단 info bar가 먼저 표시됨
**해결**: `img.onload` 콜백에서 카드 삽입

---

## 주요 데이터 구조

### 슬롯 이미지 데이터 (card._imageData)
```javascript
{
  image: "base64...",           // 이미지 데이터
  image_path: "/path/to/file",  // 파일 경로
  filename: "image.png",
  metadata: { ... },
  galleryFilename: "saved.png", // 갤러리 저장시
  galleryFolder: "folder"       // 갤러리 폴더
}
```

### Vibe 데이터
```javascript
{
  image: "base64...",
  strength: 0.6,
  info_extracted: 1.0,
  name: "vibe_name"
}
```

### 갤러리 폴더 구조
```
gallery/
├── image1.png          (루트)
├── image2.png
├── 캐릭터A/
│   ├── char1.png
│   └── char2.png
└── 배경/
    └── bg1.png
```

---

## 프론트엔드 주요 변수

```javascript
currentProvider      // 'nai' | 'local'
currentMode          // 'slot' | 'gallery'
currentGalleryFolder // 현재 갤러리 폴더 ('' = 루트)
isOpusTier           // Opus 구독 여부
vibeList             // Vibe Transfer 목록
charRefData          // Character Reference 데이터
```

---

## 백엔드 주요 경로

```python
GALLERY_DIR = APP_DIR / "gallery"
OUTPUT_DIR  = APP_DIR / "outputs"
CONFIG_FILE = APP_DIR / "peropix_config.json"
```

---

## 디버깅 팁

### 콘솔 로그 확인
- `[Anlas] Subscription loaded: { tier, isOpusTier, anlas }`
- `[Queue] Adding job: slots=..., promptData=...`
- `[SSE] Image received: prompt_idx=..., filename=...`
- `[addImageToSlot] Card inserted for ...`

### 일반적인 문제
1. **슬롯 안보임**: JavaScript 오류 → 콘솔 확인
2. **API 실패**: 네트워크 탭에서 요청/응답 확인
3. **스타일 깨짐**: CSS overflow, z-index 확인
