"""
SDXL 이미지 생성

ComfyUI 방식의 샘플링으로 txt2img, img2img, inpaint 지원
"""

import math
import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any
import logging

logger = logging.getLogger('peropix')

from .model_sampling import ModelSamplingDiscrete, EPS
from .samplers import SAMPLERS, get_sampler
from .schedulers import get_sigmas, SCHEDULERS
from .model_loader import load_sdxl_model, get_model_cache
from .lora import LoRALoader


def pil_to_tensor(image: Image.Image) -> torch.Tensor:
    """PIL 이미지를 [0, 1] 범위 텐서로 변환"""
    image = image.convert("RGB")
    np_image = np.array(image).astype(np.float32) / 255.0
    tensor = torch.from_numpy(np_image).permute(2, 0, 1).unsqueeze(0)
    return tensor


def tensor_to_pil(tensor: torch.Tensor) -> Image.Image:
    """[0, 1] 범위 텐서를 PIL 이미지로 변환 (ComfyUI 방식)"""
    tensor = tensor.squeeze(0).permute(1, 2, 0)
    # ComfyUI 방식: 255 곱한 후 clip
    i = 255.0 * tensor.cpu().numpy()
    np_image = np.clip(i, 0, 255).astype(np.uint8)
    return Image.fromarray(np_image)


def encode_image(vae, image: torch.Tensor, device: str) -> torch.Tensor:
    """이미지를 latent로 인코딩 (ComfyUI 방식, 큰 해상도는 자동 타일링)"""
    # [0, 1] -> [-1, 1]
    image = image * 2.0 - 1.0

    vae_dtype = next(vae.parameters()).dtype
    image = image.to(device=device, dtype=vae_dtype)

    # 큰 해상도(한 변이 1024 초과)면 타일링 사용
    _, _, ih, iw = image.shape
    if ih > 1024 or iw > 1024:
        latent = _encode_image_tiled(vae, image, vae_dtype)
    else:
        with torch.no_grad():
            latent = vae.encode(image).float()

    # VAE 스케일 팩터 적용 (SDXL: 0.13025)
    latent = latent * 0.13025
    return latent


def _encode_image_tiled(vae, image: torch.Tensor, vae_dtype, tile_size=512, overlap=128) -> torch.Tensor:
    """
    타일링 VAE 인코딩

    Args:
        vae: VAE 모델
        image: [1, 3, H, W] 이미지 텐서 (범위: [-1, 1], vae_dtype)
        vae_dtype: VAE 연산 dtype
        tile_size: 타일 크기 (pixel 공간, default: 512)
        overlap: 오버랩 (pixel 공간, default: 128)
    """
    downscale = 8  # VAE downscale factor

    def encode_fn(s):
        with torch.no_grad():
            return vae.encode(s.to(vae_dtype)).float()

    # 3가지 타일 비율로 인코딩 후 평균
    result = (
        _tiled_scale_encode(image, encode_fn, tile_size // 2, tile_size * 2, overlap, downscale, out_channels=4) +
        _tiled_scale_encode(image, encode_fn, tile_size * 2, tile_size // 2, overlap, downscale, out_channels=4) +
        _tiled_scale_encode(image, encode_fn, tile_size, tile_size, overlap, downscale, out_channels=4)
    ) / 3.0

    return result


def _tiled_scale_encode(samples, function, tile_x, tile_y, overlap, downscale, out_channels=4):
    """
    타일링 인코딩 처리 (pixel → latent, 다운스케일)

    decode용 _tiled_scale과 동일 구조지만 스케일 방향이 반대입니다.
    """
    _, _, h, w = samples.shape
    out_h = h // downscale
    out_w = w // downscale
    output = torch.zeros(1, out_channels, out_h, out_w, device="cpu")
    out_div = torch.zeros_like(output)

    y_positions = list(range(0, max(1, h - overlap), max(1, tile_y - overlap))) if h > tile_y else [0]
    x_positions = list(range(0, max(1, w - overlap), max(1, tile_x - overlap))) if w > tile_x else [0]

    for y in y_positions:
        for x in x_positions:
            y1 = max(0, min(h - overlap, y))
            x1 = max(0, min(w - overlap, x))
            y2 = min(y1 + tile_y, h)
            x2 = min(x1 + tile_x, w)

            tile_in = samples[:, :, y1:y2, x1:x2]
            tile_out = function(tile_in).cpu()

            # Feathering mask (latent 공간 크기)
            mask = torch.ones_like(tile_out)
            feather_y = overlap // downscale
            feather_x = overlap // downscale

            if feather_y < mask.shape[2]:
                for t in range(feather_y):
                    a = (t + 1) / feather_y
                    mask[:, :, t, :] *= a
                    mask[:, :, mask.shape[2] - 1 - t, :] *= a

            if feather_x < mask.shape[3]:
                for t in range(feather_x):
                    a = (t + 1) / feather_x
                    mask[:, :, :, t] *= a
                    mask[:, :, :, mask.shape[3] - 1 - t] *= a

            oy1 = y1 // downscale
            oy2 = oy1 + tile_out.shape[2]
            ox1 = x1 // downscale
            ox2 = ox1 + tile_out.shape[3]

            output[:, :, oy1:oy2, ox1:ox2] += tile_out * mask
            out_div[:, :, oy1:oy2, ox1:ox2] += mask

            del tile_out, mask

    result = output / out_div.clamp(min=1e-6)
    del output, out_div
    return result.to(samples.device)


def decode_latent(vae, latent: torch.Tensor) -> torch.Tensor:
    """latent를 이미지로 디코딩 (ComfyUI 방식, 큰 해상도는 자동 타일링)"""
    # VAE 스케일 팩터 역적용
    latent = latent / 0.13025

    vae_dtype = next(vae.parameters()).dtype

    # 큰 해상도(latent 한 변이 128 초과, 즉 pixel 1024 초과)면 타일링 사용
    _, _, lh, lw = latent.shape
    if lh > 128 or lw > 128:
        image = _decode_latent_tiled(vae, latent, vae_dtype)
    else:
        with torch.no_grad():
            image = vae.decode(latent.to(vae_dtype)).float()

    # [-1, 1] -> [0, 1], clamp로 범위 제한 (ComfyUI 방식)
    image = torch.clamp((image + 1.0) / 2.0, min=0.0, max=1.0)
    return image


def _decode_latent_tiled(vae, latent: torch.Tensor, vae_dtype, tile_size=64, overlap=16) -> torch.Tensor:
    """
    타일링 VAE 디코딩 (ComfyUI 방식)

    큰 해상도에서 VAE가 한번에 처리하면 VRAM이 급증하므로,
    latent를 타일로 나누어 디코딩 후 feathering mask로 블렌딩합니다.

    ComfyUI와 동일하게 3가지 타일 비율로 디코딩 후 평균하여 경계 아티팩트를 최소화합니다.

    Args:
        vae: VAE 모델
        latent: [1, 4, H, W] latent 텐서 (스케일 역적용 완료 상태)
        vae_dtype: VAE 연산 dtype
        tile_size: 기본 타일 크기 (latent 공간, default: 64 = pixel 512)
        overlap: 타일 간 오버랩 (latent 공간, default: 16 = pixel 128)
    """
    upscale = 8  # VAE upscale factor

    def decode_fn(s):
        with torch.no_grad():
            return vae.decode(s.to(vae_dtype)).float()

    # ComfyUI 방식: 3가지 타일 비율로 디코딩 후 평균 (경계 아티팩트 최소화)
    result = (
        _tiled_scale(latent, decode_fn, tile_size // 2, tile_size * 2, overlap, upscale) +
        _tiled_scale(latent, decode_fn, tile_size * 2, tile_size // 2, overlap, upscale) +
        _tiled_scale(latent, decode_fn, tile_size, tile_size, overlap, upscale)
    ) / 3.0

    return result


def _tiled_scale(samples, function, tile_x, tile_y, overlap, upscale_amount, out_channels=3):
    """
    타일링 처리 (ComfyUI tiled_scale_multidim 간소화 버전)

    feathering mask로 타일 경계를 부드럽게 블렌딩합니다.
    출력은 CPU에 누적하여 GPU 메모리를 절약합니다.
    """
    _, _, h, w = samples.shape
    output = torch.zeros(1, out_channels, h * upscale_amount, w * upscale_amount, device="cpu")
    out_div = torch.zeros_like(output)

    # 타일이 전체를 커버하도록 위치 계산
    y_positions = list(range(0, max(1, h - overlap), max(1, tile_y - overlap))) if h > tile_y else [0]
    x_positions = list(range(0, max(1, w - overlap), max(1, tile_x - overlap))) if w > tile_x else [0]

    for y in y_positions:
        for x in x_positions:
            # 타일 범위 (경계 클램핑)
            y1 = max(0, min(h - overlap, y))
            x1 = max(0, min(w - overlap, x))
            y2 = min(y1 + tile_y, h)
            x2 = min(x1 + tile_x, w)

            # 타일 추출 및 디코딩
            tile_in = samples[:, :, y1:y2, x1:x2]
            tile_out = function(tile_in).cpu()

            # Feathering mask 생성 (타일 경계를 부드럽게)
            mask = torch.ones_like(tile_out)
            feather_y = overlap * upscale_amount
            feather_x = overlap * upscale_amount

            # 상하 feathering
            if feather_y < mask.shape[2]:
                for t in range(feather_y):
                    a = (t + 1) / feather_y
                    mask[:, :, t, :] *= a
                    mask[:, :, mask.shape[2] - 1 - t, :] *= a

            # 좌우 feathering
            if feather_x < mask.shape[3]:
                for t in range(feather_x):
                    a = (t + 1) / feather_x
                    mask[:, :, :, t] *= a
                    mask[:, :, :, mask.shape[3] - 1 - t] *= a

            # 출력에 누적 (CPU에서)
            oy1 = y1 * upscale_amount
            oy2 = y1 * upscale_amount + tile_out.shape[2]
            ox1 = x1 * upscale_amount
            ox2 = x1 * upscale_amount + tile_out.shape[3]

            output[:, :, oy1:oy2, ox1:ox2] += tile_out * mask
            out_div[:, :, oy1:oy2, ox1:ox2] += mask

            del tile_out, mask

    # 가중 평균으로 최종 결과
    result = output / out_div.clamp(min=1e-6)
    del output, out_div
    return result.to(samples.device)


class SDXLGenerator:
    """
    SDXL 이미지 생성기

    ComfyUI 방식의 샘플링으로 동일한 결과물 생성
    임베딩 지원: embedding:name 구문으로 텍스트 임베딩 사용
    """

    def __init__(
        self,
        model_path: str,
        device: str = "cuda",
        dtype: torch.dtype = torch.float16,
        embedding_directory: Optional[str] = None
    ):
        self.device = device
        self.dtype = dtype
        self.model_path = model_path
        self.embedding_directory = embedding_directory

        # 모델 로드
        self.unet, self.vae, self.clip = load_sdxl_model(
            model_path, dtype=dtype, device=device,
            embedding_directory=embedding_directory
        )

        # 모델 샘플링 설정 (GPU에서 실행)
        self.model_sampling = ModelSamplingDiscrete().to(device)
        self.eps = EPS()

        # LoRA 로더 (UNet과 CLIP 각각 별도 - 키 맵이 다르므로)
        self.unet_lora_loader = LoRALoader(device=device, dtype=dtype)
        self.clip_lora_loader = LoRALoader(device=device, dtype=dtype)

    @property
    def loaded_loras(self) -> dict:
        """로드된 LoRA 목록 반환"""
        return self.unet_lora_loader._loaded_loras

    def unload(self):
        """모델 언로드 및 VRAM 해제"""
        del self.unet
        del self.vae
        del self.clip
        del self.model_sampling
        self.unet = None
        self.vae = None
        self.clip = None
        self.model_sampling = None
        torch.cuda.empty_cache()

    def apply_lora(self, lora_path: str, scale: float = 1.0):
        """LoRA 적용 (UNet + CLIP)"""
        lora_name = Path(lora_path).stem
        # UNet에 LoRA 적용
        self.unet_lora_loader.apply_lora_to_model(self.unet, lora_path, scale, lora_name=lora_name)
        # CLIP에도 LoRA 적용 (스타일 LoRA는 CLIP 가중치가 중요)
        self.clip_lora_loader.apply_lora_to_model(self.clip, lora_path, scale, lora_name=lora_name)

    def remove_loras(self):
        """모든 LoRA 제거 (UNet + CLIP)"""
        self.unet_lora_loader.remove_lora(self.unet)
        self.clip_lora_loader.remove_lora(self.clip)

    def encode_prompt(
        self,
        prompt: str,
        negative_prompt: str = ""
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        프롬프트 인코딩

        Returns:
            (cond, cond_pooled, uncond, uncond_pooled)
        """
        # Positive
        cond, cond_pooled = self.clip.encode_text(prompt)
        cond = cond.to(device=self.device, dtype=self.dtype)
        cond_pooled = cond_pooled.to(device=self.device, dtype=self.dtype)

        # Negative
        if negative_prompt:
            uncond, uncond_pooled = self.clip.encode_text(negative_prompt)
        else:
            uncond, uncond_pooled = self.clip.encode_text("")
        uncond = uncond.to(device=self.device, dtype=self.dtype)
        uncond_pooled = uncond_pooled.to(device=self.device, dtype=self.dtype)

        return cond, cond_pooled, uncond, uncond_pooled

    def prepare_y(
        self,
        pooled: torch.Tensor,
        width: int,
        height: int,
        crop_w: int = 0,
        crop_h: int = 0,
        target_width: Optional[int] = None,
        target_height: Optional[int] = None
    ) -> torch.Tensor:
        """
        SDXL y (class embeddings) 준비

        pooled: [B, 1280] CLIP-G pooled output
        + size embeddings (original size, crop coords, target size)

        ComfyUI의 SDXL.encode_adm() 방식:
        각 size 값에 sinusoidal timestep embedding (256d) 적용
        """
        from .ldm.modules.diffusionmodules.util import timestep_embedding

        if target_width is None:
            target_width = width
        if target_height is None:
            target_height = height

        batch_size = pooled.shape[0]

        # Size embeddings: 각 값에 256차원 sinusoidal embedding 적용
        # ComfyUI: self.embedder = Timestep(256)
        size_values = [height, width, crop_h, crop_w, target_height, target_width]
        size_embs = []
        for val in size_values:
            # timestep_embedding expects [B] tensor, returns [B, dim]
            t = torch.tensor([val], dtype=torch.float32, device=self.device)
            emb = timestep_embedding(t, 256)  # [1, 256]
            size_embs.append(emb)

        # Concatenate all size embeddings: [1, 256*6] = [1, 1536]
        size_emb = torch.cat(size_embs, dim=-1)  # [1, 1536]
        size_emb = size_emb.repeat(batch_size, 1)  # [B, 1536]
        size_emb = size_emb.to(dtype=self.dtype)

        # SDXL y: [B, 2816] = pooled (1280) + size_emb (1536)
        y = torch.cat([pooled, size_emb], dim=-1)

        return y

    def get_noise(
        self,
        batch_size: int,
        height: int,
        width: int,
        seed: int
    ) -> torch.Tensor:
        """
        초기 노이즈 생성

        ComfyUI와 동일한 방식:
        1. torch.manual_seed(seed)
        2. torch.randn(..., dtype=latent_image.dtype) - 즉 float32
        3. CPU에서 생성, device로 이동

        중요: dtype은 float32로 유지 (ComfyUI 방식)
        """
        latent_height = height // 8
        latent_width = width // 8

        # ComfyUI 방식: float32로 생성
        generator = torch.manual_seed(seed)
        noise = torch.randn(
            (batch_size, 4, latent_height, latent_width),
            dtype=torch.float32,  # ComfyUI: latent_image.dtype = float32
            generator=generator,
            device="cpu"
        ).to(device=self.device)  # device만 이동, dtype은 float32 유지

        return noise

    def model_wrapper(
        self,
        cond: torch.Tensor,
        cond_pooled: torch.Tensor,
        uncond: torch.Tensor,
        uncond_pooled: torch.Tensor,
        cfg_scale: float,
        width: int,
        height: int
    ):
        """
        CFG가 적용된 모델 래퍼

        샘플러에서 호출되는 함수

        중요: UNet은 eps (noise prediction)을 출력합니다.
        샘플러는 denoised 이미지를 기대하므로 변환이 필요합니다.
        denoised = x - eps * sigma
        """
        # y 준비 (1회만 계산)
        y_cond = self.prepare_y(cond_pooled, width, height)
        y_uncond = self.prepare_y(uncond_pooled, width, height)

        # cond와 uncond의 시퀀스 길이를 맞춤 (긴 프롬프트 지원)
        # ComfyUI 방식: LCM(최소공배수)으로 타겟 길이 결정, repeat로 확장 (0 패딩 아님!)
        import math as _math
        cond_len = cond.shape[1]
        uncond_len = uncond.shape[1]
        if cond_len != uncond_len:
            # LCM으로 타겟 길이 결정 (ComfyUI conds.py CONDCrossAttn.concat 참조)
            target_len = _math.lcm(cond_len, uncond_len)

            if cond_len < target_len:
                repeat_times = target_len // cond_len
                cond = cond.repeat(1, repeat_times, 1)
            if uncond_len < target_len:
                repeat_times = target_len // uncond_len
                uncond = uncond.repeat(1, repeat_times, 1)

        # UNet의 실제 dtype 가져오기 (bfloat16 또는 float16)
        unet_dtype = next(self.unet.parameters()).dtype

        # 성능 최적화: step과 무관한 값들을 미리 계산 (클로저 생성 시 1회)
        # conditioning도 UNet dtype과 일치시킴
        c_in = torch.cat([cond, uncond], dim=0).to(dtype=unet_dtype)
        y_in = torch.cat([y_cond, y_uncond], dim=0).to(dtype=unet_dtype)

        def wrapper(x, sigma, **kwargs):
            # sigma -> timestep (ComfyUI model_base.py:182 참조)
            timestep = self.model_sampling.timestep(sigma).float()
            timestep = timestep.expand(x.shape[0])

            # 입력 스케일링: x_scaled = x / sqrt(sigma^2 + sigma_data^2)
            x_scaled = self.eps.calculate_input(sigma, x)

            # 배치 처리 (cond + uncond)
            # x_scaled는 이미 float32이므로 UNet의 dtype으로 변환
            x_in = torch.cat([x_scaled, x_scaled], dim=0).to(dtype=unet_dtype)
            t_in = torch.cat([timestep, timestep], dim=0).to(dtype=unet_dtype)

            # UNet forward - eps (noise prediction) 출력
            with torch.no_grad():
                eps_out = self.unet(x_in, timesteps=t_in, context=c_in, y=y_in)

            # CFG 적용 (eps 공간에서, float32로) - ComfyUI 방식
            # 정밀도를 위해 float32에서 CFG 계산
            eps_cond, eps_uncond = eps_out.float().chunk(2)
            cfg_eps = eps_uncond + cfg_scale * (eps_cond - eps_uncond)

            # eps -> denoised 변환 (이미 float32)
            cfg_result = self.eps.calculate_denoised(sigma, cfg_eps, x)

            return cfg_result

        return wrapper

    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        cfg_scale: float = 7.0,
        seed: int = -1,
        sampler: str = "euler",
        scheduler: str = "normal",
        base_image: Optional[Image.Image] = None,
        mask: Optional[Image.Image] = None,
        denoise: float = 1.0,
        callback: Optional[callable] = None,
        cached_cond: Optional[Tuple] = None
    ) -> Tuple[Image.Image, int, Optional[Tuple]]:
        """
        이미지 생성

        Args:
            prompt: 프롬프트
            negative_prompt: 네거티브 프롬프트
            width: 이미지 너비
            height: 이미지 높이
            steps: 샘플링 스텝
            cfg_scale: CFG 스케일
            seed: 랜덤 시드 (-1이면 랜덤)
            sampler: 샘플러 이름 (euler, euler_ancestral)
            scheduler: 스케줄러 이름 (normal, karras, simple, sgm_uniform, exponential)
            base_image: img2img/inpaint 베이스 이미지
            mask: 인페인트 마스크 (검정=유지, 흰색=인페인트)
            denoise: 디노이즈 강도 (0.0-1.0)
            callback: 진행 콜백
            cached_cond: 캐시된 conditioning (cond, cond_pooled, uncond, uncond_pooled)
                         hires fix 등에서 CLIP 중복 계산 방지용

        Returns:
            (생성된 이미지, 사용된 시드, conditioning 캐시)
        """
        # 시드 처리
        if seed == -1:
            seed = torch.randint(0, 2**32, (1,)).item()

        # 프롬프트 인코딩 (캐시 있으면 재사용)
        if cached_cond is not None:
            cond, cond_pooled, uncond, uncond_pooled = cached_cond
            logger.debug("[Generate] Using cached conditioning (skip CLIP encoding)")
        else:
            cond, cond_pooled, uncond, uncond_pooled = self.encode_prompt(prompt, negative_prompt)

        # 시그마 스케줄 생성
        sigmas = get_sigmas(self.model_sampling, scheduler, steps, device=self.device)

        # img2img/inpaint 처리
        if base_image is not None:
            # 이미지를 latent로 인코딩
            image_tensor = pil_to_tensor(base_image.resize((width, height)))
            latent = encode_image(self.vae, image_tensor, self.device)

            # denoise에 따라 시그마 조정 (ComfyUI 방식: samplers.py:1131-1141)
            # denoise=0.5, steps=28 -> new_steps=56, sigmas[-(28+1):]
            if denoise is not None and denoise < 0.9999:
                if denoise <= 0.0:
                    # denoise=0이면 원본 이미지 그대로 반환
                    pil_image = base_image.resize((width, height))
                    cond_cache = (cond.clone(), cond_pooled.clone(), uncond.clone(), uncond_pooled.clone())
                    return pil_image, seed, cond_cache
                else:
                    new_steps = int(steps / denoise)
                    sigmas = get_sigmas(self.model_sampling, scheduler, new_steps, device=self.device)
                    sigmas = sigmas[-(steps + 1):]

            # max_denoise 판단 (ComfyUI 방식: samplers.py:718-721)
            # 중요: 잘린 후의 sigmas[0]으로 판단해야 함
            sigma_max = float(self.model_sampling.sigma_max)
            sigma_start = float(sigmas[0])
            is_max_denoise = math.isclose(sigma_max, sigma_start, rel_tol=1e-05) or sigma_start > sigma_max

            # 초기 latent = noise_scaling(sigma[0], noise, latent)
            noise = self.get_noise(1, height, width, seed)
            x = self.eps.noise_scaling(sigmas[0], noise, latent, max_denoise=is_max_denoise)
            # noise, latent은 x에 합쳐졌으므로 즉시 해제
            del noise, latent, image_tensor
        else:
            # txt2img: ComfyUI 방식의 noise_scaling 사용
            # max_denoise 판단 (ComfyUI 방식: samplers.py:718-721)
            sigma_max = float(self.model_sampling.sigma_max)
            sigma_start = float(sigmas[0])
            is_max_denoise = math.isclose(sigma_max, sigma_start, rel_tol=1e-05) or sigma_start > sigma_max

            # latent_image는 0 텐서
            noise = self.get_noise(1, height, width, seed)
            latent_image = torch.zeros_like(noise)
            x = self.eps.noise_scaling(sigmas[0], noise, latent_image, max_denoise=is_max_denoise)
            # noise, latent_image는 x에 합쳐졌으므로 즉시 해제
            del noise, latent_image

        # 인페인트 마스크 처리
        latent_mask = None
        original_latent = None
        if mask is not None and base_image is not None:
            # 마스크를 latent 크기로 리사이즈
            mask_resized = mask.resize((width // 8, height // 8), Image.NEAREST)
            mask_tensor = torch.from_numpy(np.array(mask_resized) / 255.0)
            latent_mask = mask_tensor.unsqueeze(0).unsqueeze(0).to(device=self.device, dtype=self.dtype)

            # 원본 latent 저장
            image_tensor = pil_to_tensor(base_image.resize((width, height)))
            original_latent = encode_image(self.vae, image_tensor, self.device)
            del image_tensor, mask_tensor, mask_resized

        # 모델 래퍼 생성
        model_fn = self.model_wrapper(
            cond, cond_pooled, uncond, uncond_pooled,
            cfg_scale, width, height
        )

        # 샘플러 선택
        sampler_fn = get_sampler(sampler)
        logger.debug(f"[Generate] Using sampler: {sampler} -> {sampler_fn.__name__}")

        # 콜백 래퍼 (취소 체크 포함)
        def step_callback(info):
            if callback:
                step = info.get("i", 0)
                total = len(sigmas) - 1
                callback(step, total)  # 여기서 취소 예외가 발생할 수 있음

        # 샘플링 시작 전 취소 체크 (CLIP 인코딩 후)
        if callback:
            callback(0, steps)  # step 0에서 취소 체크

        # 샘플링
        samples = sampler_fn(
            model_fn, x, sigmas,
            extra_args={"seed": seed},
            callback=step_callback if callback else None,
            disable=True  # tqdm 비활성화 - 콘솔 출력 오버헤드 방지
        )

        # 샘플링 완료 후 model_fn 클로저 해제 (c_in, y_in 등 VRAM 텐서 포함)
        del model_fn

        # 인페인트: 마스크된 영역만 업데이트
        if latent_mask is not None and original_latent is not None:
            samples = original_latent * (1 - latent_mask) + samples * latent_mask

        # VAE 디코딩
        image = decode_latent(self.vae, samples)
        pil_image = tensor_to_pil(image)

        # conditioning 캐시 저장 (hires fix용, 1st pass에서만 필요)
        # cached_cond가 제공된 경우(2nd pass) clone 불필요 - VRAM 절약
        if cached_cond is not None:
            cond_cache = None
        else:
            cond_cache = (cond.clone(), cond_pooled.clone(), uncond.clone(), uncond_pooled.clone())

        # 중간 텐서 해제 (VRAM 절약)
        del cond, cond_pooled, uncond, uncond_pooled
        del sigmas, x, samples, image
        if latent_mask is not None:
            del latent_mask
        if original_latent is not None:
            del original_latent

        # GPU 캐시 정리
        import gc
        gc.collect()
        torch.cuda.empty_cache()

        return pil_image, seed, cond_cache


# 편의 함수
def create_generator(
    model_path: str,
    device: str = "cuda",
    dtype: torch.dtype = torch.float16
) -> SDXLGenerator:
    """SDXL 생성기 생성"""
    return SDXLGenerator(model_path, device, dtype)


def generate(
    model_path: str,
    prompt: str,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    steps: int = 20,
    cfg_scale: float = 7.0,
    seed: int = -1,
    sampler: str = "euler",
    scheduler: str = "normal",
    device: str = "cuda",
    dtype: torch.dtype = torch.float16,
    **kwargs
) -> Tuple[Image.Image, int]:
    """
    이미지 생성 편의 함수

    매번 모델을 로드하므로 배치 생성에는 SDXLGenerator 사용 권장
    """
    generator = SDXLGenerator(model_path, device, dtype)
    return generator.generate(
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        steps=steps,
        cfg_scale=cfg_scale,
        seed=seed,
        sampler=sampler,
        scheduler=scheduler,
        **kwargs
    )
