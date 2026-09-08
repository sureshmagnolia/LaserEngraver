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
        speed_mm_min: float = 900.0,
        power_s: int = 280,
        passes: int = 1
    ) -> List[str]:
        """
        Generate continuous vector G-code from normalized (0.0-1.0) polylines.
        """
        lines = [
            "; --- FALCON VECTOR TRACE JOB ---",
            f"; Size: {width_mm:.2f} x {height_mm:.2f} mm at ({x_pos:.2f}, {y_pos:.2f})",
            f"; Feed: {speed_mm_min:.0f} mm/min | Power: S{power_s} | Passes: {passes}",
            "G90 G21",
            "M4 S0",
            f"G0 F{speed_mm_min * 1.5:.0f}"
        ]

        for p_num in range(passes):
            if passes > 1:
                lines.append(f"; Pass {p_num + 1}/{passes}")
            
            for poly in norm_paths:
                if len(poly) < 2:
                    continue
                # Start point
                sx = x_pos + poly[0][0] * width_mm
                sy = y_pos + poly[0][1] * height_mm
                
                # Rapid to start with laser OFF
                lines.append(f"G0 X{sx:.3f} Y{sy:.3f}")
                
                # Trace path with laser ON
                for pt in poly[1:]:
                    tx = x_pos + pt[0] * width_mm
                    ty = y_pos + pt[1] * height_mm
                    lines.append(f"G1 X{tx:.3f} Y{ty:.3f} F{speed_mm_min:.0f} S{power_s}")
                
                # Laser OFF between segments
                lines.append("M5")

        lines.append("M5")
        lines.append(f"G0 X{x_pos:.3f} Y{y_pos:.3f}")
        return lines
