#!/usr/bin/env python3
"""
NAI 바이브 인코딩 비교 테스트

NAI .naiv4vibe 파일의 원본 이미지로 페로픽스 API를 호출하여
인코딩 결과가 NAI와 동일한지 확인합니다.

사용법:
  python test_vibe_api.py test_data/xxx.naiv4vibe [http://localhost:8000]
"""

import sys
import json
import base64
import hashlib
import requests

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    nai_file = sys.argv[1]
    api_base = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8000"

    # NAI 파일 로드
    print(f"Loading: {nai_file}")
    with open(nai_file, 'r') as f:
        nai_data = json.load(f)

    import_info = nai_data['importInfo']
    model = import_info['model']
    info_extracted = import_info['information_extracted']

    print(f"\n=== NAI 파일 정보 ===")
    print(f"Model: {model}")
    print(f"Info Extracted: {info_extracted}")

    # 원본 이미지
    image_b64 = nai_data['image']
    image_bytes = base64.b64decode(image_b64)
    image_hash = hashlib.sha256(image_bytes).hexdigest()

    print(f"\n원본 이미지:")
    print(f"  Base64 length: {len(image_b64)}")
    print(f"  Bytes: {len(image_bytes)}")
    print(f"  SHA256: {image_hash}")

    # NAI 인코딩 결과들
    print(f"\n=== NAI 인코딩 결과 ===")
    nai_encodings = {}
    for model_key, encodings in nai_data['encodings'].items():
        for hash_key, enc_data in encodings.items():
            enc_bytes = base64.b64decode(enc_data['encoding'])
            enc_hash = hashlib.sha256(enc_bytes).hexdigest()
            nai_encodings[enc_hash] = {
                'model': model_key,
                'hash_key': hash_key,
                'length': len(enc_bytes)
            }
            print(f"  {hash_key[:16]}... : {len(enc_bytes)} bytes, SHA256: {enc_hash[:32]}...")

    # 페로픽스 API 호출
    print(f"\n=== 페로픽스 API 테스트 ===")
    print(f"API: {api_base}/api/test-vibe-encode")

    try:
        response = requests.post(
            f"{api_base}/api/test-vibe-encode",
            json={
                "image": image_b64,
                "model": model,
                "info_extracted": info_extracted
            },
            timeout=120
        )

        result = response.json()

        if not result.get('success'):
            print(f"API 오류: {result.get('error')}")
            sys.exit(1)

        pp_hash = result['output_hash']
        pp_length = result['output_bytes']

        print(f"\n페로픽스 인코딩 결과:")
        print(f"  Bytes: {pp_length}")
        print(f"  SHA256: {pp_hash}")

        # 비교
        print(f"\n=== 비교 결과 ===")
        if pp_hash in nai_encodings:
            match = nai_encodings[pp_hash]
            print(f"✓ 일치! NAI hash key: {match['hash_key'][:16]}...")
            print(f"  → 같은 information_extracted 값으로 인코딩된 것으로 보임")
        else:
            print(f"✗ 불일치!")
            print(f"\n  NAI 인코딩들:")
            for enc_hash, info in nai_encodings.items():
                print(f"    {info['length']} bytes, {enc_hash[:32]}...")
            print(f"\n  페로픽스:")
            print(f"    {pp_length} bytes, {pp_hash[:32]}...")

            print(f"\n가능한 원인:")
            print(f"  1. information_extracted 값 차이 (NAI: {info_extracted})")
            print(f"  2. 이미지 전송 방식 차이")
            print(f"  3. API 파라미터 차이")

            # 추가 디버깅: 입력 이미지 검증
            print(f"\n입력 이미지 검증:")
            print(f"  API에 전달된 이미지 해시: {result.get('input_hash')}")
            print(f"  NAI 파일 원본 이미지 해시: {image_hash}")
            if result.get('input_hash') == image_hash:
                print(f"  → 입력 이미지는 동일함")
            else:
                print(f"  → ⚠️ 입력 이미지가 다름!")

    except requests.exceptions.ConnectionError:
        print(f"연결 실패: {api_base}")
        print("페로픽스 서버가 실행 중인지 확인하세요.")
        sys.exit(1)
    except Exception as e:
        print(f"오류: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
