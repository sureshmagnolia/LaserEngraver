"""
Photo-to-Line-Art Vector Tracing Engine.
Converts photos, logos, and raster images into crisp vector line drawings and continuous paths.
Supports AI background removal, pencil sketch (DoG), Canny, Otsu, and Zhang-Suen skeletonization.
"""

import cv2
import numpy as np
from PIL import Image
import io
import base64
from typing import Dict, Any, List, Tuple, Optional

# Optional AI background removal
try:
    import rembg
    REMBG_AVAILABLE = True
except ImportError:
    REMBG_AVAILABLE = False

class PhotoTracer:
    @staticmethod
    def process_image(
        img_bytes: bytes,
        mode: str = "sketch",          # "sketch", "canny", "skeleton", "threshold"
        remove_bg: bool = False,
        invert: bool = False,
        detail_level: int = 50,        # 1 to 100
        line_thickness: int = 1,       # 1 to 5
        smoothing: float = 1.0         # 0.1 to 5.0 (approxPolyDP epsilon)
    ) -> Dict[str, Any]:
        """
        Processes image and returns:
        - preview_base64: data URL of line art preview
        - paths: list of polylines [[(x,y), (x,y), ...]] normalized to 0.0-1.0
        - width: original width
        - height: original height
        """
        # Load image
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("Invalid image data")

        # Optional AI background removal
        if remove_bg and REMBG_AVAILABLE:
            try:
                pil_in = Image.open(io.BytesIO(img_bytes))
                pil_out = rembg.remove(pil_in)
                img = cv2.cvtColor(np.array(pil_out), cv2.COLOR_RGBA2BGRA)
            except Exception as e:
                print(f"[PhotoTracer] Background removal error: {e}")

        # Handle alpha channel (transparent background -> white)
        if len(img.shape) == 3 and img.shape[2] == 4:
            alpha = img[:, :, 3]
            bgr = img[:, :, :3]
            white_bg = np.ones_like(bgr, dtype=np.uint8) * 255
            alpha_factor = alpha[:, :, np.newaxis].astype(np.float32) / 255.0
            composite = (bgr.astype(np.float32) * alpha_factor + white_bg.astype(np.float32) * (1.0 - alpha_factor)).astype(np.uint8)
            gray = cv2.cvtColor(composite, cv2.COLOR_BGR2GRAY)
        elif len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img.copy()

        h, w = gray.shape[:2]

        # Invert if requested
        if invert:
            gray = cv2.bitwise_not(gray)

        # Bilateral filter to smooth noise while keeping sharp edges
        denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)

        # Line art generation based on mode
        binary_lines = np.zeros_like(gray)

        if mode == "sketch":
            # Pencil sketch via Difference of Gaussians / Dodge blend
            ksize = max(3, int(15 * (101 - detail_level) / 50.0))
            if ksize % 2 == 0:
                ksize += 1
            inv = cv2.bitwise_not(denoised)
            blur = cv2.GaussianBlur(inv, (ksize, ksize), 0)
            sketch = cv2.divide(denoised, 255 - blur, scale=256)
            
            # Threshold to clean black strokes
            thresh_val = int(220 + (detail_level - 50) * 0.5)
            thresh_val = np.clip(thresh_val, 150, 245)
            _, bin_inv = cv2.threshold(sketch, thresh_val, 255, cv2.THRESH_BINARY_INV)
            binary_lines = bin_inv

        elif mode == "canny":
            # Canny edge detection
            high_thresh = int(np.clip(250 - detail_level * 1.8, 30, 250))
            low_thresh = int(high_thresh * 0.4)
            edges = cv2.Canny(denoised, low_thresh, high_thresh)
            binary_lines = edges

        elif mode == "skeleton":
            # Zhang-Suen morphological thinning for single centerlines
            thresh_val = int(np.clip(128 + (detail_level - 50) * 1.5, 30, 240))
            _, binary = cv2.threshold(denoised, thresh_val, 255, cv2.THRESH_BINARY_INV)
            try:
                skeleton = cv2.ximgproc.thinning(binary, thinningType=cv2.ximgproc.THINNING_ZHANGSUEN)
                binary_lines = skeleton
            except Exception:
                # Fallback to morphological gradient
                kernel = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
                binary_lines = cv2.morphologyEx(binary, cv2.MORPH_GRADIENT, kernel)

        elif mode == "threshold":
            # Adaptive threshold
            block_size = max(3, int(21 * (101 - detail_level) / 50.0))
            if block_size % 2 == 0:
                block_size += 1
            bin_adapt = cv2.adaptiveThreshold(
                denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY_INV, block_size, C=5
            )
            binary_lines = bin_adapt

        # Optional line thickness dilation
        if line_thickness > 1:
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (line_thickness, line_thickness))
            binary_lines = cv2.dilate(binary_lines, k)

        # Extract continuous vector paths via contours
        contours, hierarchy = cv2.findContours(
            binary_lines, cv2.RETR_LIST, cv2.CHAIN_APPROX_TC89_KCOS
        )

        paths: List[List[Tuple[float, float]]] = []
        for cnt in contours:
            if len(cnt) < 2:
                continue
            # Simplify polygon with epsilon
            eps = max(0.5, smoothing * 0.002 * max(w, h))
            approx = cv2.approxPolyDP(cnt, eps, closed=False)
            if len(approx) < 2:
                continue
            
            # Normalize coordinates to 0.0 ... 1.0
            polyline = []
            for pt in approx:
                px, py = pt[0]
                polyline.append((round(float(px) / w, 5), round(float(py) / h, 5)))
            paths.append(polyline)

        # Create high-contrast preview image (black lines on white background)
        preview_img = np.ones((h, w, 3), dtype=np.uint8) * 255
        preview_img[binary_lines > 0] = [20, 20, 20] # dark charcoal strokes
        
        # Encode preview to base64 PNG
        _, buf = cv2.imencode(".png", preview_img)
        b64_preview = "data:image/png;base64," + base64.b64encode(buf).decode("utf-8")

        return {
            "preview": b64_preview,
            "paths": paths,
            "path_count": len(paths),
            "width": w,
            "height": h,
            "aspect_ratio": round(w / max(1, h), 4)
        }
