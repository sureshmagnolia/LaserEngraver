"""
Bed Calibration Grid & Scale G-code Generator.
Generates customizable precision reference grids for Creality CR-Laser Falcon 5W.
Supports material-specific tuning for Glass, Wood/MDF, and Anodized/Coated Metal,
with prominent physical (0,0) Machine Origin Datum markings and rulers.
"""

from typing import List, Dict, Any, Tuple
import math

class BedScaleGenerator:
    # Material-specific calibrated defaults for Falcon 5W
    MATERIAL_PROFILES = {
        "glass": {
            "name": "Black / Coated Glass Bed",
            "speed": 800.0,
            "power": 450,
            "passes": 1,
            "safety_note": "CRITICAL: Cover glass with paper masking tape or matte black paint before firing to prevent 450nm specular reflection."
        },
        "wood": {
            "name": "Wood / MDF Spoilboard",
            "speed": 1200.0,
            "power": 300,
            "passes": 1,
            "safety_note": "Zero masking needed. Produces crisp, dark charred millimeter lines and target pockets."
        },
        "metal": {
            "name": "Anodized / Coated Metal",
            "speed": 600.0,
            "power": 850,
            "passes": 1,
            "safety_note": "Bleaches the anodized color layer or marks laser coating for brilliant high-contrast white markings."
        }
    }

    @classmethod
    def generate_grid_gcode(
        cls,
        material: str = "glass",
        size_mm: float = 380.0,
        origin_mode: str = "front_left",  # "front_left" (0,0 datum) or "center"
        center_x: float = 200.0,
        center_y: float = 207.5,
        include_origin_datum: bool = True,
        include_40mm_targets: bool = True,
        include_100mm_targets: bool = True,
        include_rulers: bool = True,
        include_grid: bool = True,
        custom_speed: float = None,
        custom_power: int = None
    ) -> Dict[str, Any]:
        """
        Generate complete G-code and normalized vector paths for bed scale,
        including the dedicated physical (0,0) Origin Mark.
        """
        profile = cls.MATERIAL_PROFILES.get(material, cls.MATERIAL_PROFILES["wood"])
        speed = custom_speed or profile["speed"]
        power = custom_power or profile["power"]

        if origin_mode == "front_left":
            # Bed coordinates directly reference Machine Front-Left Home (0,0)
            # Safe margin: x starts at 5.0 mm or 0.0 mm
            x_min = 0.0
            y_min = 0.0
            x_max = size_mm
            y_max = min(415.0, size_mm)
            origin_x = 0.0
            origin_y = 0.0
            mid_x = x_max / 2.0
            mid_y = y_max / 2.0
        else:
            # Centered mode
            half_s = size_mm / 2.0
            x_min = center_x - half_s
            x_max = center_x + half_s
            y_min = center_y - half_s
            y_max = center_y + half_s
            origin_x = center_x
            origin_y = center_y
            mid_x = center_x
            mid_y = center_y

        lines: List[str] = [
            "; --- FALCON BED REFERENCE SCALE WITH (0,0) ORIGIN ---",
            f"; Material: {profile['name']}",
            f"; Origin Mode: {origin_mode.upper()} at ({origin_x:.1f}, {origin_y:.1f})",
            f"; Size: {size_mm:.1f} x {size_mm:.1f} mm",
            f"; Bounds: X[{x_min:.1f}..{x_max:.1f}], Y[{y_min:.1f}..{y_max:.1f}]",
            f"; Feed: {speed:.0f} mm/min | Power: S{power}",
            "G90 G21",
            "M4 S0",
            f"G0 F{speed * 1.5:.0f}"
        ]

        norm_paths: List[List[Tuple[float, float]]] = []

        def to_norm(gx: float, gy: float) -> Tuple[float, float]:
            nx = (gx - x_min) / max(1e-5, (x_max - x_min))
            ny = (gy - y_min) / max(1e-5, (y_max - y_min))
            return (round(nx, 4), round(ny, 4))

        def add_line(x1, y1, x2, y2):
            lines.append(f"G0 X{x1:.3f} Y{y1:.3f}")
            lines.append(f"G1 X{x2:.3f} Y{y2:.3f} F{speed:.0f} S{power}")
            lines.append("M5")
            norm_paths.append([to_norm(x1, y1), to_norm(x2, y2)])

        def add_circle(cx, cy, r):
            pts = []
            steps = 36
            for s in range(steps + 1):
                ang = s * (2.0 * math.pi / steps)
                pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
            
            lines.append(f"G0 X{pts[0][0]:.3f} Y{pts[0][1]:.3f}")
            for p in pts[1:]:
                lines.append(f"G1 X{p[0]:.3f} Y{p[1]:.3f} F{speed:.0f} S{power}")
            lines.append("M5")
            norm_paths.append([to_norm(p[0], p[1]) for p in pts])

        def add_arc(cx: float, cy: float, r: float, start_deg: float, end_deg: float, steps: int = 24):
            pts = []
            for s in range(steps + 1):
                t = s / float(steps)
                ang_deg = start_deg + t * (end_deg - start_deg)
                ang = math.radians(ang_deg)
                px = max(x_min, min(x_max, cx + r * math.cos(ang)))
                py = max(y_min, min(y_max, cy + r * math.sin(ang)))
                pts.append((px, py))
            if pts:
                lines.append(f"G0 X{pts[0][0]:.3f} Y{pts[0][1]:.3f}")
                for p in pts[1:]:
                    lines.append(f"G1 X{p[0]:.3f} Y{p[1]:.3f} F{speed:.0f} S{power}")
                lines.append("M5")
                norm_paths.append([to_norm(p[0], p[1]) for p in pts])

        # Stroke font character definitions
        CHAR_MAP = {
            'O': [(0,0, 1,0), (1,0, 1,1), (1,1, 0,1), (0,1, 0,0)],
            'R': [(0,0, 0,1), (0,1, 1,1), (1,1, 1,0.5), (1,0.5, 0,0.5), (0.5,0.5, 1,0)],
            'I': [(0.5,0, 0.5,1), (0.2,1, 0.8,1), (0.2,0, 0.8,0)],
            'G': [(1,1, 0,1), (0,1, 0,0), (0,0, 1,0), (1,0, 1,0.5), (1,0.5, 0.5,0.5)],
            'N': [(0,0, 0,1), (0,1, 1,0), (1,0, 1,1)],
            '(': [(0.8,1, 0.3,0.5), (0.3,0.5, 0.8,0)],
            ')': [(0.2,1, 0.7,0.5), (0.7,0.5, 0.2,0)],
            '0': [(0,0, 1,0), (1,0, 1,1), (1,1, 0,1), (0,1, 0,0), (0.2,0.2, 0.8,0.8)],
            ',': [(0.5,0.2, 0.3,-0.2)],
            '+': [(0.1,0.5, 0.9,0.5), (0.5,0.1, 0.5,0.9)],
            'X': [(0.1,0.1, 0.9,0.9), (0.1,0.9, 0.9,0.1)],
            'Y': [(0.1,0.9, 0.5,0.5), (0.9,0.9, 0.5,0.5), (0.5,0.5, 0.5,0.1)],
            'C': [(1,1, 0,1), (0,1, 0,0), (0,0, 1,0)],
            'E': [(1,1, 0,1), (0,1, 0,0), (0,0, 1,0), (0,0.5, 0.8,0.5)],
            'T': [(0,1, 1,1), (0.5,1, 0.5,0)],
            ' ': []
        }

        def add_text(text: str, start_x: float, start_y: float, cw: float = 2.8, ch: float = 4.2, sp: float = 1.0):
            cx = start_x
            for ch_char in text.upper():
                strokes = CHAR_MAP.get(ch_char, [])
                for x1, y1, x2, y2 in strokes:
                    lx1 = cx + x1 * cw
                    ly1 = start_y + y1 * ch
                    lx2 = cx + x2 * cw
                    ly2 = start_y + y2 * ch
                    add_line(lx1, ly1, lx2, ly2)
                cx += cw + sp

        # --- 1. PROMINENT (0,0) PHYSICAL MACHINE ORIGIN DATUM MARK ---
        if include_origin_datum:
            if origin_mode == "front_left":
                # Quarter-bullseye arcs radiating directly from physical (0,0) into Quadrant 1
                for r_val in [5.0, 10.0, 20.0, 30.0, 45.0]:
                    add_arc(origin_x, origin_y, r_val, 0.0, 90.0, steps=28)

                # Heavy double-pass origin corner fence along +X and +Y
                fence_len = min(70.0, size_mm * 0.25)
                # +X Baseline and offset pass for visual thickness
                add_line(origin_x, origin_y, origin_x + fence_len, origin_y)
                add_line(origin_x, origin_y + 0.3, origin_x + fence_len, origin_y + 0.3)
                # +Y Baseline and offset pass
                add_line(origin_x, origin_y, origin_x, origin_y + fence_len)
                add_line(origin_x + 0.3, origin_y, origin_x + 0.3, origin_y + fence_len)

                # 45-degree corner alignment ray
                add_line(origin_x, origin_y, origin_x + 22.0, origin_y + 22.0)

                # Small 5x5mm zero-datum box right at the corner
                add_line(origin_x + 5.0, origin_y, origin_x + 5.0, origin_y + 5.0)
                add_line(origin_x, origin_y + 5.0, origin_x + 5.0, origin_y + 5.0)

                # Precision mm ticks right from origin (1mm fine ticks for the first 20mm)
                for d in range(1, 21):
                    th = 4.0 if d % 10 == 0 else (2.5 if d % 5 == 0 else 1.2)
                    add_line(origin_x + d, origin_y, origin_x + d, origin_y + th)
                    add_line(origin_x, origin_y + d, origin_x + th, origin_y + d)

                # Directional Arrowheads (strictly within positive workspace)
                # +X Arrow
                add_line(origin_x + fence_len - 5.0, origin_y + 3.5, origin_x + fence_len, origin_y)
                add_line(origin_x + fence_len - 5.0, origin_y, origin_x + fence_len, origin_y)
                # +Y Arrow
                add_line(origin_x + 3.5, origin_y + fence_len - 5.0, origin_x, origin_y + fence_len)
                add_line(origin_x, origin_y + fence_len - 5.0, origin_x, origin_y + fence_len)

                # Engrave Text: "ORIGIN (0,0)", "+X", "+Y"
                add_text("ORIGIN (0,0)", origin_x + 8.0, origin_y + 11.0, cw=2.6, ch=4.0, sp=0.9)
                add_text("+X", origin_x + fence_len + 3.0, origin_y + 1.0, cw=2.4, ch=3.8, sp=0.8)
                add_text("+Y", origin_x + 1.0, origin_y + fence_len + 3.0, cw=2.4, ch=3.8, sp=0.8)
            else:
                # Centered origin mode (360-degree bullseye)
                for r_val in [5.0, 10.0, 20.0, 30.0]:
                    add_circle(origin_x, origin_y, r_val)
                # Full crosshairs
                add_line(origin_x - 40.0, origin_y, origin_x + 40.0, origin_y)
                add_line(origin_x, origin_y - 40.0, origin_x, origin_y + 40.0)
                add_line(origin_x - 15.0, origin_y - 15.0, origin_x + 15.0, origin_y + 15.0)
                add_line(origin_x - 15.0, origin_y + 15.0, origin_x + 15.0, origin_y - 15.0)
                add_text("CENTER (0,0)", origin_x + 8.0, origin_y + 8.0, cw=2.4, ch=3.8, sp=0.8)

        # --- 2. OUTER BED SCALE BORDER ---
        add_line(x_min, y_min, x_max, y_min)
        add_line(x_max, y_min, x_max, y_max)
        add_line(x_max, y_max, x_min, y_max)
        add_line(x_min, y_max, x_min, y_min)

        # --- 3. GRID CROSSES & GUIDES ---
        if include_grid:
            grid_step = 50.0
            curr_x = x_min + grid_step
            while curr_x < x_max:
                add_line(curr_x, y_min, curr_x, y_max)
                curr_x += grid_step

            curr_y = y_min + grid_step
            while curr_y < y_max:
                add_line(x_min, curr_y, x_max, curr_y)
                curr_y += grid_step

        # --- 4. MILLIMETER RULERS ---
        if include_rulers:
            # X-Axis ticks along the bottom and center
            curr_x = x_min
            while curr_x <= x_max:
                dist = curr_x - x_min
                tick_h = 5.0 if round(dist) % 10 == 0 else 2.5
                if round(dist) % 50 == 0:
                    tick_h = 8.0
                add_line(curr_x, y_min, curr_x, y_min + tick_h)
                curr_x += 5.0

            # Y-Axis ticks along the left edge
            curr_y = y_min
            while curr_y <= y_max:
                dist = curr_y - y_min
                tick_w = 5.0 if round(dist) % 10 == 0 else 2.5
                if round(dist) % 50 == 0:
                    tick_w = 8.0
                add_line(x_min, curr_y, x_min + tick_w, curr_y)
                curr_y += 5.0

        # --- 5. TARGET POCKETS FOR KEYCHAINS (40mm) & PLAQUES (100mm) ---
        if include_100mm_targets:
            # Central 100 mm Plaque target
            add_circle(mid_x, mid_y, 50.0)
            # Center crosshair for plaque
            add_line(mid_x - 10.0, mid_y, mid_x + 10.0, mid_y)
            add_line(mid_x, mid_y - 10.0, mid_x, mid_y + 10.0)

        if include_40mm_targets:
            # Central 40 mm Keychain target
            add_circle(mid_x, mid_y, 20.0)

            # 4 Quadrant targets if bed >= 240mm
            if size_mm >= 240.0:
                off_x = min(100.0, (x_max - x_min) * 0.28)
                off_y = min(100.0, (y_max - y_min) * 0.28)
                for qx, qy in [
                    (mid_x - off_x, mid_y - off_y),
                    (mid_x + off_x, mid_y - off_y),
                    (mid_x - off_x, mid_y + off_y),
                    (mid_x + off_x, mid_y + off_y)
                ]:
                    add_circle(qx, qy, 20.0)
                    add_line(qx - 5.0, qy, qx + 5.0, qy)
                    add_line(qx, qy - 5.0, qx, qy + 5.0)

        # Finish job and return laser safely to the Origin
        lines.append("M5")
        lines.append(f"G0 X{origin_x:.3f} Y{origin_y:.3f}")

        return {
            "material": material,
            "material_name": profile["name"],
            "safety_note": profile["safety_note"],
            "speed": speed,
            "power": power,
            "size_mm": size_mm,
            "origin_mode": origin_mode,
            "origin": {"x": origin_x, "y": origin_y},
            "bounds": {"xmin": x_min, "ymin": y_min, "xmax": x_max, "ymax": y_max},
            "line_count": len(lines),
            "gcode_lines": lines,
            "norm_paths": norm_paths
        }
