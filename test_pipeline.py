"""
Automated unit & integration test for Falcon Laser Studio engines.
"""

import os
import sys
import numpy as np
import cv2

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(BASE_DIR, "backend"))

from svg_engine import SvgEngine
from photo_tracer import PhotoTracer
from raster_engine import RasterEngine

def test_svg():
    print("Testing SVG Engine...")
    sample_svg = """<svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" />
        <rect x="20" y="20" width="60" height="60" />
        <path d="M 10 10 L 90 90 M 10 90 L 90 10" />
    </svg>"""
    parsed = SvgEngine.parse_svg_string(sample_svg)
    assert parsed["path_count"] >= 3, f"Expected >= 3 paths, got {parsed['path_count']}"
    assert len(parsed["paths"]) > 0
    gcode = SvgEngine.generate_vector_gcode(
        norm_paths=parsed["paths"],
        x_pos=180.0,
        y_pos=180.0,
        width_mm=40.0,
        height_mm=40.0,
        speed_mm_min=900,
        power_s=280
    )
    assert len(gcode) > 20
    print(f"-> SVG OK: {parsed['path_count']} paths, {len(gcode)} G-code lines generated.")

def test_photo_tracer():
    print("Testing PhotoTracer...")
    # Create synthetic test image (face with circle and lines)
    img = np.ones((200, 200, 3), dtype=np.uint8) * 255
    cv2.circle(img, (100, 100), 50, (30, 30, 30), 4)
    cv2.putText(img, "TEST", (60, 110), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 3)
    _, buf = cv2.imencode(".png", img)
    img_bytes = buf.tobytes()

    for mode in ["sketch", "canny", "skeleton", "threshold"]:
        res = PhotoTracer.process_image(img_bytes, mode=mode, detail_level=60)
        assert "preview" in res
        assert "paths" in res
        assert len(res["paths"]) > 0
        print(f"-> Mode '{mode}' OK: {res['path_count']} vector paths extracted.")

def test_raster_engine():
    print("Testing RasterEngine...")
    img = np.zeros((100, 100), dtype=np.uint8)
    for i in range(100):
        img[i, :] = int(i * 2.55) # gradient
    _, buf = cv2.imencode(".png", img)
    img_bytes = buf.tobytes()

    prev = RasterEngine.generate_raster_preview(img_bytes, mode="floyd")
    assert "preview" in prev
    print("-> Raster Preview OK.")

    gcode = RasterEngine.generate_raster_gcode(
        img_bytes=img_bytes,
        x_start=180.0,
        y_start=180.0,
        target_width_mm=40.0,
        target_height_mm=40.0,
        line_interval_mm=0.2,
        speed_mm_min=1200,
        max_power_s=350,
        dither_mode="floyd"
    )
    assert len(gcode) > 50
    print(f"-> Raster G-code OK: {len(gcode)} lines generated.")

def test_bed_scale():
    print("Testing BedScaleGenerator for Glass, Wood, Metal...")
    from bed_scale_generator import BedScaleGenerator
    for mat in ["glass", "wood", "metal"]:
        res = BedScaleGenerator.generate_grid_gcode(material=mat, size_mm=380.0)
        assert res["line_count"] > 100
        assert len(res["norm_paths"]) > 0
        print(f"-> Material '{mat}': {res['line_count']} lines generated (Speed: {res['speed']}, Power: {res['power']})")

if __name__ == "__main__":
    test_svg()
    test_photo_tracer()
    test_raster_engine()
    test_bed_scale()
    print("\nALL FALCON STUDIO ENGINES PASSED VERIFICATION PERFECTLY!\n")
