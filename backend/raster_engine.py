"""
Inkjet-Style Raster Engraving Engine.
Converts photos and images into line-by-line raster G-code with Floyd-Steinberg dithering,
Atkinson dithering, power modulation, and bidirectional acceleration overscan.
"""

import cv2
import numpy as np
import io
import base64
from typing import Dict, Any, List, Tuple

class RasterEngine:
    @staticmethod
    def dither_floyd_steinberg(gray: np.ndarray) -> np.ndarray:
        """Floyd-Steinberg error diffusion dithering."""
        h, w = gray.shape
        img = gray.astype(np.float32).copy()
        
        for y in range(h):
            for x in range(w):
                old_val = img[y, x]
                new_val = 255.0 if old_val >= 128.0 else 0.0
                img[y, x] = new_val
                err = old_val - new_val
                
                if x + 1 < w:
                    img[y, x + 1] += err * (7.0 / 16.0)
                if y + 1 < h:
                    if x - 1 >= 0:
                        img[y + 1, x - 1] += err * (3.0 / 16.0)
                    img[y + 1, x] += err * (5.0 / 16.0)
                    if x + 1 < w:
                        img[y + 1, x + 1] += err * (1.0 / 16.0)
                        
        return np.clip(img, 0, 255).astype(np.uint8)

    @staticmethod
    def dither_atkinson(gray: np.ndarray) -> np.ndarray:
        """Atkinson dithering (preserves fine detail and highlights)."""
        h, w = gray.shape
        img = gray.astype(np.float32).copy()
        
        for y in range(h):
            for x in range(w):
                old_val = img[y, x]
                new_val = 255.0 if old_val >= 128.0 else 0.0
                img[y, x] = new_val
                err = (old_val - new_val) / 8.0
                
                if x + 1 < w:
                    img[y, x + 1] += err
                if x + 2 < w:
                    img[y, x + 2] += err
                if y + 1 < h:
                    if x - 1 >= 0:
                        img[y + 1, x - 1] += err
                    img[y + 1, x] += err
                    if x + 1 < w:
                        img[y + 1, x + 1] += err
                if y + 2 < h:
                    img[y + 2, x] += err
                    
        return np.clip(img, 0, 255).astype(np.uint8)

    @classmethod
    def generate_raster_preview(
        cls,
        img_bytes: bytes,
        mode: str = "floyd",      # "floyd", "atkinson", "grayscale", "threshold"
        invert: bool = False,
        contrast: float = 1.0,    # 0.5 to 2.0
        brightness: int = 0       # -100 to 100
    ) -> Dict[str, Any]:
        """Generate high-contrast visual simulation of raster engraving."""
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("Invalid image")
            
        if len(img.shape) == 3 and img.shape[2] == 4:
            alpha = img[:, :, 3]
            bgr = img[:, :, :3]
            white = np.ones_like(bgr) * 255
            a_factor = alpha[:, :, None].astype(float) / 255.0
            comp = (bgr.astype(float) * a_factor + white.astype(float) * (1.0 - a_factor)).astype(np.uint8)
            gray = cv2.cvtColor(comp, cv2.COLOR_BGR2GRAY)
        elif len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img.copy()

        # Adjust contrast and brightness
        adjusted = cv2.convertScaleAbs(gray, alpha=contrast, beta=brightness)

        if invert:
            adjusted = cv2.bitwise_not(adjusted)

        # Apply dithering
        if mode == "floyd":
            processed = cls.dither_floyd_steinberg(adjusted)
        elif mode == "atkinson":
            processed = cls.dither_atkinson(adjusted)
        elif mode == "threshold":
            _, processed = cv2.threshold(adjusted, 128, 255, cv2.THRESH_BINARY)
        else:
            processed = adjusted # Grayscale direct

        h, w = processed.shape
        _, buf = cv2.imencode(".png", processed)
        b64_preview = "data:image/png;base64," + base64.b64encode(buf).decode("utf-8")

        return {
            "preview": b64_preview,
            "width": w,
            "height": h,
            "aspect_ratio": round(w / max(1, h), 4)
        }

    @classmethod
    def generate_raster_gcode(
        cls,
        img_bytes: bytes,
        x_start: float,
        y_start: float,
        target_width_mm: float,
        target_height_mm: float,
        line_interval_mm: float = 0.15,
        speed_mm_min: float = 1200.0,
        max_power_s: int = 350,
        min_power_s: int = 0,
        dither_mode: str = "floyd",
        invert: bool = False,
        overscan_mm: float = 2.5
    ) -> List[str]:
        """
        Generate bidirectional inkjet-style line raster G-code with overscan.
        """
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
        if len(img.shape) == 3 and img.shape[2] == 4:
            alpha = img[:, :, 3]
            bgr = img[:, :, :3]
            white = np.ones_like(bgr) * 255
            a_factor = alpha[:, :, None].astype(float) / 255.0
            comp = (bgr.astype(float) * a_factor + white.astype(float) * (1.0 - a_factor)).astype(np.uint8)
            gray = cv2.cvtColor(comp, cv2.COLOR_BGR2GRAY)
        elif len(img.shape) == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        else:
            gray = img.copy()

        if invert:
            gray = cv2.bitwise_not(gray)

        # Determine target grid dimensions
        rows = max(2, int(round(target_height_mm / line_interval_mm)))
        cols = max(2, int(round(target_width_mm / line_interval_mm)))

        # Resize image to exact raster grid
        resized = cv2.resize(gray, (cols, rows), interpolation=cv2.INTER_AREA)

        # Dither or power modulate
        if dither_mode == "floyd":
            dithered = cls.dither_floyd_steinberg(resized)
            # Binary: 0 is black (burn), 255 is white (no burn)
            power_grid = np.where(dithered < 128, max_power_s, min_power_s)
        elif dither_mode == "atkinson":
            dithered = cls.dither_atkinson(resized)
            power_grid = np.where(dithered < 128, max_power_s, min_power_s)
        else:
            # Grayscale linear mapping: 0 (black) -> max_power_s, 255 (white) -> min_power_s
            normalized = (255.0 - resized.astype(float)) / 255.0
            power_grid = (min_power_s + normalized * (max_power_s - min_power_s)).astype(int)

        lines: List[str] = [
            "; --- FALCON RASTER INKJET ENGRAVE ---",
            "; Mode: " + dither_mode,
            f"; Size: {target_width_mm:.1f} x {target_height_mm:.1f} mm",
            f"; Feed: {speed_mm_min:.0f} mm/min | Max S: {max_power_s}",
            "G90 G21",
            "M4 S0", # Dynamic laser power mode
            f"G0 F{speed_mm_min * 1.5:.0f}"
        ]

        x_step = target_width_mm / cols
        y_step = target_height_mm / rows

        # Scan line by line (top to bottom)
        for r in range(rows):
            y_pos = y_start + target_height_mm - (r * y_step)
            row_powers = power_grid[r]

            # Check if line has any burning pixels
            if np.max(row_powers) <= min_power_s:
                continue

            # Bidirectional sweep: even rows L->R, odd rows R->L
            left_to_right = (r % 2 == 0)

            # Find active burn segment in row
            active_indices = np.where(row_powers > min_power_s)[0]
            first_col = active_indices[0]
            last_col = active_indices[-1]

            if left_to_right:
                x_burn_start = x_start + first_col * x_step
                x_burn_end = x_start + (last_col + 1) * x_step
                x_entry = x_burn_start - overscan_mm
                x_exit = x_burn_end + overscan_mm

                # Rapid to overscan entry
                lines.append(f"G0 X{x_entry:.3f} Y{y_pos:.3f}")
                # Accelerate into burn start at S0
                lines.append(f"G1 X{x_burn_start:.3f} Y{y_pos:.3f} F{speed_mm_min:.0f} S0")

                # Burn across segments
                curr_s = row_powers[first_col]
                seg_start_col = first_col
                for c in range(first_col, last_col + 1):
                    p = row_powers[c]
                    if p != curr_s:
                        x_seg = x_start + c * x_step
                        lines.append(f"G1 X{x_seg:.3f} S{curr_s}")
                        curr_s = p
                # Final pixel
                lines.append(f"G1 X{x_burn_end:.3f} S{curr_s}")

                # Decelerate out at S0
                lines.append(f"G1 X{x_exit:.3f} S0")
            else:
                x_burn_start = x_start + (last_col + 1) * x_step
                x_burn_end = x_start + first_col * x_step
                x_entry = x_burn_start + overscan_mm
                x_exit = x_burn_end - overscan_mm

                # Rapid to overscan entry
                lines.append(f"G0 X{x_entry:.3f} Y{y_pos:.3f}")
                # Accelerate into burn start at S0
                lines.append(f"G1 X{x_burn_start:.3f} Y{y_pos:.3f} F{speed_mm_min:.0f} S0")

                # Burn in reverse
                curr_s = row_powers[last_col]
                for c in range(last_col, first_col - 1, -1):
                    p = row_powers[c]
                    if p != curr_s:
                        x_seg = x_start + (c + 1) * x_step
                        lines.append(f"G1 X{x_seg:.3f} S{curr_s}")
                        curr_s = p
                # Final pixel
                lines.append(f"G1 X{x_burn_end:.3f} S{curr_s}")

                # Decelerate out at S0
                lines.append(f"G1 X{x_exit:.3f} S0")

        lines.append("M5")
        lines.append(f"G0 X{x_start:.3f} Y{y_start:.3f}")
        return lines
