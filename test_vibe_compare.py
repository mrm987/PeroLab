#!/usr/bin/env python3
"""
NAI 웹의 바이브 인코딩과 페로픽스의 인코딩을 비교하는 스크립트

사용법:
1. NAI 웹에서 .naiv4vibe 파일 내보내기
2. 페로픽스에서 같은 이미지로 바이브 인코딩 (vibe_cache에 저장됨)
3. 이 스크립트 실행

python test_vibe_compare.py test_data/xxx.naiv4vibe vibe_cache/xxx.png
"""

import sys
import json
import base64
import hashlib
from pathlib import Path

def analyze_nai_vibe(filepath):
    """NAI .naiv4vibe 파일 분석"""
    with open(filepath, 'r') as f:
        data = json.load(f)

    print("=== NAI Vibe 파일 분석 ===")
    print(f"Model: {data['importInfo']['model']}")
    print(f"Info Extracted: {data['importInfo']['information_extracted']}")
    print(f"Strength: {data['importInfo']['strength']}")

    # 원본 이미지 정보
    img_b64 = data['image']
    img_bytes = base64.b64decode(img_b64)
    print(f"\n원본 이미지:")
    print(f"  Base64 length: {len(img_b64)}")
    print(f"  Decoded bytes: {len(img_bytes)}")
    print(f"  SHA256: {hashlib.sha256(img_bytes).hexdigest()}")

    # PNG 헤더에서 color type 확인
    import struct
    pos = 8
    while pos < len(img_bytes):
        length = struct.unpack('>I', img_bytes[pos:pos+4])[0]
        chunk_type = img_bytes[pos+4:pos+8].decode('ascii', errors='ignore')
        if chunk_type == 'IHDR':
            ihdr_data = img_bytes[pos+8:pos+8+length]
            color_type = ihdr_data[9]
            color_types = {0: 'Grayscale', 2: 'RGB', 3: 'Indexed', 4: 'Grayscale+Alpha', 6: 'RGBA'}
            print(f"  Color type: {color_type} ({color_types.get(color_type, 'Unknown')})")
            break
        pos += 4 + 4 + length + 4

    # 인코딩 데이터
    print(f"\n인코딩 데이터:")
    for model_key, encodings in data['encodings'].items():
        print(f"  Model: {model_key}")
        for hash_key, enc_data in encodings.items():
            encoding = enc_data['encoding']
            decoded = base64.b64decode(encoding)
            print(f"    Hash: {hash_key[:16]}...")
            print(f"    Encoding base64 length: {len(encoding)}")
            print(f"    Decoded bytes: {len(decoded)}")
            print(f"    SHA256: {hashlib.sha256(decoded).hexdigest()}")

    return data

def analyze_peropix_vibe(filepath):
    """페로픽스 vibe_cache PNG 파일 분석"""
    from PIL import Image

    print("\n=== 페로픽스 Vibe Cache 분석 ===")

    img = Image.open(filepath)
    metadata = img.info

    print(f"Model: {metadata.get('model', 'N/A')}")
    print(f"Info Extracted: {metadata.get('info_extracted', 'N/A')}")
    print(f"Strength: {metadata.get('strength', 'N/A')}")

    vibe_data = metadata.get('vibe_data', '')
    if vibe_data:
        decoded = base64.b64decode(vibe_data)
        print(f"\nVibe Data:")
        print(f"  Base64 length: {len(vibe_data)}")
        print(f"  Decoded bytes: {len(decoded)}")
        print(f"  SHA256: {hashlib.sha256(decoded).hexdigest()}")
    else:
        print("  vibe_data가 없습니다!")

    return metadata

def compare_encodings(nai_data, peropix_metadata):
    """인코딩 데이터 비교"""
    print("\n=== 비교 결과 ===")

    peropix_vibe = peropix_metadata.get('vibe_data', '')
    if not peropix_vibe:
        print("페로픽스 vibe_data가 없어서 비교 불가")
        return

    peropix_decoded = base64.b64decode(peropix_vibe)
    peropix_hash = hashlib.sha256(peropix_decoded).hexdigest()

    # NAI의 모든 인코딩과 비교
    found_match = False
    for model_key, encodings in nai_data['encodings'].items():
        for hash_key, enc_data in encodings.items():
            nai_decoded = base64.b64decode(enc_data['encoding'])
            nai_hash = hashlib.sha256(nai_decoded).hexdigest()

            if peropix_hash == nai_hash:
                print(f"✓ 일치! ({hash_key[:16]}...)")
                found_match = True
            else:
                print(f"✗ 불일치 ({hash_key[:16]}...)")
                print(f"  NAI: {len(nai_decoded)} bytes, {nai_hash[:32]}...")
                print(f"  PP:  {len(peropix_decoded)} bytes, {peropix_hash[:32]}...")

    if not found_match:
        print("\n어떤 NAI 인코딩과도 일치하지 않습니다!")
        print("가능한 원인:")
        print("1. 원본 이미지가 다름 (RGBA→RGB 변환 등)")
        print("2. information_extracted 값이 다름")
        print("3. 모델이 다름")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    nai_file = sys.argv[1]
    peropix_file = sys.argv[2] if len(sys.argv) > 2 else None

    nai_data = analyze_nai_vibe(nai_file)

    if peropix_file:
        try:
            pp_meta = analyze_peropix_vibe(peropix_file)
            compare_encodings(nai_data, pp_meta)
        except Exception as e:
            print(f"\n페로픽스 파일 분석 오류: {e}")
