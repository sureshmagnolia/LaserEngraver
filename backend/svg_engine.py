"""
SVG Vector Parser & G-code Generator.
Extracts continuous toolpaths from SVG paths, lines, polylines, rects, circles, and polygons.
Translates and scales to machine bed coordinates with optimized G0/G1 moves.
"""

import xml.etree.ElementTree as ET
import re
import math
from typing import List, Tuple, Dict, Any, Optional

class SvgEngine:
    @staticmethod
    def _tokenize_path(d: str) -> List[str]:
        """Split path data into tokens (commands and coordinate numbers)."""
        tokens = re.findall(r"([A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)", d)
        return tokens

    @classmethod
    def _parse_path_d(cls, d: str) -> List[List[Tuple[float, float]]]:
        """Parse SVG path 'd' string into a list of polylines."""
        tokens = cls._tokenize_path(d)
        if not tokens:
            return []

        paths: List[List[Tuple[float, float]]] = []
        curr_path: List[Tuple[float, float]] = []
        
        curr_x = 0.0
        curr_y = 0.0
        start_x = 0.0
        start_y = 0.0
        last_cmd = ""
        last_control_x = 0.0
        last_control_y = 0.0

        i = 0
        n = len(tokens)

        def next_num() -> float:
            nonlocal i
            val = float(tokens[i])
            i += 1
            return val

        while i < n:
            token = tokens[i]
            if re.match(r"[A-Za-z]", token):
                cmd = token
                i += 1
            else:
                # Repeat last command (implicit L or l if last was M or m)
                if last_cmd == 'M':
                    cmd = 'L'
                elif last_cmd == 'm':
                    cmd = 'l'
                else:
                    cmd = last_cmd

            # Execute command
            if cmd == 'M':
                if curr_path:
                    paths.append(curr_path)
                    curr_path = []
                curr_x = next_num()
                curr_y = next_num()
                start_x, start_y = curr_x, curr_y
                curr_path.append((curr_x, curr_y))
            elif cmd == 'm':
                if curr_path:
                    paths.append(curr_path)
                    curr_path = []
                curr_x += next_num()
                curr_y += next_num()
                start_x, start_y = curr_x, curr_y
                curr_path.append((curr_x, curr_y))
            elif cmd == 'L':
                curr_x = next_num()
                curr_y = next_num()
                curr_path.append((curr_x, curr_y))
            elif cmd == 'l':
                curr_x += next_num()
                curr_y += next_num()
                curr_path.append((curr_x, curr_y))
            elif cmd == 'H':
                curr_x = next_num()
                curr_path.append((curr_x, curr_y))
            elif cmd == 'h':
                curr_x += next_num()
                curr_path.append((curr_x, curr_y))
            elif cmd == 'V':
                curr_y = next_num()
                curr_path.append((curr_x, curr_y))
            elif cmd == 'v':
                curr_y += next_num()
                curr_path.append((curr_x, curr_y))
            elif cmd in ('C', 'c'):
                # Cubic Bezier
                p0 = (curr_x, curr_y)
                if cmd == 'C':
                    p1 = (next_num(), next_num())
                    p2 = (next_num(), next_num())
                    p3 = (next_num(), next_num())
                else:
                    p1 = (curr_x + next_num(), curr_y + next_num())
                    p2 = (curr_x + next_num(), curr_y + next_num())
                    p3 = (curr_x + next_num(), curr_y + next_num())
                
                # Approximate with 8 line segments
                for step in range(1, 9):
                    t = step / 8.0
                    bx = (1-t)**3 * p0[0] + 3*(1-t)**2*t * p1[0] + 3*(1-t)*t**2 * p2[0] + t**3 * p3[0]
                    by = (1-t)**3 * p0[1] + 3*(1-t)**2*t * p1[1] + 3*(1-t)*t**2 * p2[1] + t**3 * p3[1]
                    curr_path.append((bx, by))
                curr_x, curr_y = p3
                last_control_x, last_control_y = p2
            elif cmd in ('Z', 'z'):
                if curr_path and (curr_x != start_x or curr_y != start_y):
                    curr_path.append((start_x, start_y))
                curr_x, curr_y = start_x, start_y
                if curr_path:
                    paths.append(curr_path)
                    curr_path = []
            else:
                # Skip unsupported token argument
                if i < n and not re.match(r"[A-Za-z]", tokens[i]):
                    i += 1

            last_cmd = cmd

        if curr_path:
            paths.append(curr_path)

        return paths

    @classmethod
    def parse_svg_string(cls, svg_xml: str) -> Dict[str, Any]:
        """Parse complete SVG XML into normalized vector polylines."""
        root = ET.fromstring(svg_xml)
        
        # Remove namespace prefixes
        for elem in root.iter():
            if '}' in elem.tag:
                elem.tag = elem.tag.split('}', 1)[1]

        all_paths: List[List[Tuple[float, float]]] = []

        # Find paths
        for p in root.iter('path'):
            d = p.attrib.get('d', '')
            if d:
                all_paths.extend(cls._parse_path_d(d))

        # Find lines
        for l in root.iter('line'):
            x1 = float(l.attrib.get('x1', 0))
            y1 = float(l.attrib.get('y1', 0))
            x2 = float(l.attrib.get('x2', 0))
            y2 = float(l.attrib.get('y2', 0))
            all_paths.append([(x1, y1), (x2, y2)])

        # Find polylines & polygons
        for poly in list(root.iter('polyline')) + list(root.iter('polygon')):
            pts_str = poly.attrib.get('points', '')
            coords = [float(v) for v in re.findall(r"[-+]?(?:\d*\.\d+|\d+)", pts_str)]
            poly_pts = []
            for k in range(0, len(coords) - 1, 2):
                poly_pts.append((coords[k], coords[k+1]))
            if poly.tag == 'polygon' and poly_pts:
                poly_pts.append(poly_pts[0])
            if poly_pts:
                all_paths.append(poly_pts)

        # Find rects
        for r in root.iter('rect'):
            x = float(r.attrib.get('x', 0))
            y = float(r.attrib.get('y', 0))
            w = float(r.attrib.get('width', 0))
            h = float(r.attrib.get('height', 0))
            if w > 0 and h > 0:
                all_paths.append([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])

        # Find circles
        for c in root.iter('circle'):
            cx = float(c.attrib.get('cx', 0))
            cy = float(c.attrib.get('cy', 0))
            radius = float(c.attrib.get('r', 0))
            if radius > 0:
                circle_pts = []
                for step in range(37):
                    ang = step * (2.0 * math.pi / 36.0)
                    circle_pts.append((cx + radius * math.cos(ang), cy + radius * math.sin(ang)))
                all_paths.append(circle_pts)

        if not all_paths:
            return {"paths": [], "min_x": 0, "min_y": 0, "max_x": 0, "max_y": 0, "width": 0, "height": 0}

        # Calculate bounding box
        min_x = min(min(pt[0] for pt in p) for p in all_paths)
        max_x = max(max(pt[0] for pt in p) for p in all_paths)
        min_y = min(min(pt[1] for pt in p) for p in all_paths)
        max_y = max(max(pt[1] for pt in p) for p in all_paths)
        
        span_x = max(1e-5, max_x - min_x)
        span_y = max(1e-5, max_y - min_y)

        # Normalize paths to 0.0 ... 1.0 (with SVG Y-down inverted to Cartesian Y-up)
        norm_paths = []
        for poly in all_paths:
            norm_poly = []
            for x, y in poly:
                nx = (x - min_x) / span_x
                ny = 1.0 - ((y - min_y) / span_y) # Flip SVG Y-down to standard Cartesian
                norm_poly.append((round(nx, 5), round(ny, 5)))
            norm_paths.append(norm_poly)

        return {
            "paths": norm_paths,
            "path_count": len(norm_paths),
            "orig_width": span_x,
            "orig_height": span_y,
            "aspect_ratio": round(span_x / span_y, 4)
        }

    @classmethod
    def generate_vector_gcode(
        cls,
        norm_paths: List[List[Tuple[float, float]]],
        x_pos: float,
        y_pos: float,
        width_mm: float,
        height_mm: float,
        center_x: float = None,
        center_y: float = None,
        rotation_deg: float = 0.0,
        flip_x: bool = False,
        flip_y: bool = False,
        speed_mm_min: float = 900.0,
        power_s: int = 280,
        passes: int = 1
    ) -> List[str]:
        """
        Generate continuous vector G-code from normalized (0.0-1.0) polylines.
        Matches screen canvas coordinate space 1:1 (Canvas Top -> Machine Back +Y, Canvas Bottom -> Machine Front -Y).
        Supports rotation and horizontal/vertical flips.
        Includes Nearest-Neighbor TSP path ordering to eliminate random jumping,
        and uses GRBL 1.1 M4 Dynamic Laser Mode without jerky M5 stops between segments.
        """
        cx = center_x if center_x is not None else (x_pos + width_mm / 2.0)
        cy = center_y if center_y is not None else (y_pos + height_mm / 2.0)
        rad = (-rotation_deg * math.pi) / 180.0
        cos_val = math.cos(rad)
        sin_val = math.sin(rad)

        def transform_point(nx: float, ny: float) -> Tuple[float, float]:
            if flip_x:
                nx = 1.0 - nx
            if flip_y:
                ny = 1.0 - ny
            # In screen space, ny=0 is TOP and ny=1 is BOTTOM.
            # In CNC Cartesian space, +Y is Back/Top and -Y is Front/Bottom.
            # Thus (0.5 - ny) correctly maps screen top to machine back!
            lx = (nx - 0.5) * width_mm
            ly = (0.5 - ny) * height_mm
            rx = lx * cos_val - ly * sin_val
            ry = lx * sin_val + ly * cos_val
            return (round(cx + rx, 3), round(cy + ry, 3))

        rapid_speed = max(1500.0, speed_mm_min * 1.5)
        lines = [
            "; --- FALCON VECTOR TRACE JOB ---",
            f"; Center: ({cx:.2f}, {cy:.2f}) | Size: {width_mm:.2f} x {height_mm:.2f} mm | Rotation: {rotation_deg:.1f}°",
            f"; Feed: {speed_mm_min:.0f} mm/min | Power: S{power_s} | Passes: {passes}",
            "G90 G21",
            "$X",
            "$32=1",
            "M4 S0",
            f"G0 F{rapid_speed:.0f}"
        ]

        valid_paths = [p for p in norm_paths if len(p) >= 2]
        if not valid_paths:
            lines.append("M5")
            return lines

        # Nearest-Neighbor TSP path ordering with transform awareness
        ordered_paths: List[List[Tuple[float, float]]] = []
        curr_pos = (cx, cy)
        remaining = list(valid_paths)

        while remaining:
            best_idx = 0
            best_dist = float("inf")
            reverse_best = False

            for i, p in enumerate(remaining):
                p_start = transform_point(p[0][0], p[0][1])
                d1 = (p_start[0] - curr_pos[0])**2 + (p_start[1] - curr_pos[1])**2
                if d1 < best_dist:
                    best_dist = d1
                    best_idx = i
                    reverse_best = False

                p_end = transform_point(p[-1][0], p[-1][1])
                d2 = (p_end[0] - curr_pos[0])**2 + (p_end[1] - curr_pos[1])**2
                if d2 < best_dist:
                    best_dist = d2
                    best_idx = i
                    reverse_best = True

            chosen = remaining.pop(best_idx)
            if reverse_best:
                chosen = chosen[::-1]
            ordered_paths.append(chosen)
            curr_pos = transform_point(chosen[-1][0], chosen[-1][1])

        for p_num in range(passes):
            if passes > 1:
                lines.append(f"; --- Pass {p_num + 1}/{passes} ---")
            
            for poly in ordered_paths:
                # Rapid travel to polyline start with laser suppressed by G0
                sx, sy = transform_point(poly[0][0], poly[0][1])
                lines.append(f"G0 X{sx:.3f} Y{sy:.3f}")
                
                # First cutting move engages power S
                pt1_x, pt1_y = transform_point(poly[1][0], poly[1][1])
                lines.append(f"G1 X{pt1_x:.3f} Y{pt1_y:.3f} S{power_s} F{speed_mm_min:.0f}")
                
                # Remaining continuous cutting moves
                for pt in poly[2:]:
                    tx, ty = transform_point(pt[0], pt[1])
                    lines.append(f"G1 X{tx:.3f} Y{ty:.3f}")

        lines.append("M5 ; Laser OFF")
        lines.append(f"G0 X0 Y0 F{rapid_speed:.0f} ; Return to Origin")
        return lines
