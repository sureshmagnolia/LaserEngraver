/**
 * ClientSvgCompiler - Parse SVG vector files directly in the browser and compile to G-code.
 */
class ClientSvgCompiler {
  static parseSvgXml(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) throw new Error("Invalid SVG: No <svg> root element found.");

    let viewBox = svg.getAttribute("viewBox");
    let vbWidth = 100, vbHeight = 100;
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        vbWidth = parts[2];
        vbHeight = parts[3];
      }
    } else {
      vbWidth = parseFloat(svg.getAttribute("width")) || 100;
      vbHeight = parseFloat(svg.getAttribute("height")) || 100;
    }

    const paths = [];

    // Process all shapes
    const elements = doc.querySelectorAll("path, line, polyline, polygon, rect, circle, ellipse");
    elements.forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === "circle") {
        const cx = parseFloat(el.getAttribute("cx") || 0);
        const cy = parseFloat(el.getAttribute("cy") || 0);
        const r = parseFloat(el.getAttribute("r") || 0);
        if (r > 0) {
          const pts = [];
          for (let s = 0; s <= 36; s++) {
            const a = s * (2 * Math.PI / 36);
            pts.push([
              Math.round(((cx + r * Math.cos(a)) / vbWidth) * 10000) / 10000,
              Math.round(((cy + r * Math.sin(a)) / vbHeight) * 10000) / 10000
            ]);
          }
          paths.push(pts);
        }
      } else if (tag === "rect") {
        const x = parseFloat(el.getAttribute("x") || 0);
        const y = parseFloat(el.getAttribute("y") || 0);
        const w = parseFloat(el.getAttribute("width") || 0);
        const h = parseFloat(el.getAttribute("height") || 0);
        if (w > 0 && h > 0) {
          paths.push([
            [x / vbWidth, y / vbHeight],
            [(x + w) / vbWidth, y / vbHeight],
            [(x + w) / vbWidth, (y + h) / vbHeight],
            [x / vbWidth, (y + h) / vbHeight],
            [x / vbWidth, y / vbHeight]
          ].map(p => [Math.round(p[0] * 10000) / 10000, Math.round(p[1] * 10000) / 10000]));
        }
      } else if (tag === "line") {
        const x1 = parseFloat(el.getAttribute("x1") || 0) / vbWidth;
        const y1 = parseFloat(el.getAttribute("y1") || 0) / vbHeight;
        const x2 = parseFloat(el.getAttribute("x2") || 0) / vbWidth;
        const y2 = parseFloat(el.getAttribute("y2") || 0) / vbHeight;
        paths.push([
          [Math.round(x1 * 10000) / 10000, Math.round(y1 * 10000) / 10000],
          [Math.round(x2 * 10000) / 10000, Math.round(y2 * 10000) / 10000]
        ]);
      } else if (tag === "path") {
        // Approximate SVG path commands (M, L, C, Z)
        const d = el.getAttribute("d") || "";
        const poly = this.approximatePath(d, vbWidth, vbHeight);
        if (poly && poly.length > 1) {
          paths.push(poly);
        }
      }
    });

    return {
      paths,
      aspect_ratio: Math.round((vbWidth / Math.max(1, vbHeight)) * 100) / 100,
      path_count: paths.length
    };
  }

  static approximatePath(d, vbW, vbH) {
    const pts = [];
    const commands = d.match(/([a-df-z]|[-+]?[0-9]*\.?[0-9]+(?:e[-+]?[0-9]+)?)/gi);
    if (!commands) return pts;

    let cx = 0, cy = 0;
    let i = 0;
    let curCmd = 'M';

    while (i < commands.length) {
      const token = commands[i];
      if (/^[a-df-z]$/i.test(token)) {
        curCmd = token;
        i++;
        continue;
      }

      if (curCmd === 'M' || curCmd === 'L') {
        cx = parseFloat(token);
        cy = parseFloat(commands[++i]);
        pts.push([
          Math.round((cx / vbW) * 10000) / 10000,
          Math.round((cy / vbH) * 10000) / 10000
        ]);
        if (curCmd === 'M') curCmd = 'L'; // Subsequent pairs are implicit L
      } else if (curCmd === 'm' || curCmd === 'l') {
        cx += parseFloat(token);
        cy += parseFloat(commands[++i]);
        pts.push([
          Math.round((cx / vbW) * 10000) / 10000,
          Math.round((cy / vbH) * 10000) / 10000
        ]);
        if (curCmd === 'm') curCmd = 'l';
      } else if (curCmd === 'H') {
        cx = parseFloat(token);
        pts.push([Math.round((cx / vbW) * 10000) / 10000, Math.round((cy / vbH) * 10000) / 10000]);
      } else if (curCmd === 'h') {
        cx += parseFloat(token);
        pts.push([Math.round((cx / vbW) * 10000) / 10000, Math.round((cy / vbH) * 10000) / 10000]);
      } else if (curCmd === 'V') {
        cy = parseFloat(token);
        pts.push([Math.round((cx / vbW) * 10000) / 10000, Math.round((cy / vbH) * 10000) / 10000]);
      } else if (curCmd === 'v') {
        cy += parseFloat(token);
        pts.push([Math.round((cx / vbW) * 10000) / 10000, Math.round((cy / vbH) * 10000) / 10000]);
      } else if (curCmd === 'C' || curCmd === 'c') {
        // Cubic bezier approximation (skip control points, jump to endpoint)
        i += 4;
        if (curCmd === 'C') {
          cx = parseFloat(commands[i]);
          cy = parseFloat(commands[++i]);
        } else {
          cx += parseFloat(commands[i]);
          cy += parseFloat(commands[++i]);
        }
        pts.push([Math.round((cx / vbW) * 10000) / 10000, Math.round((cy / vbH) * 10000) / 10000]);
      } else if (curCmd === 'Z' || curCmd === 'z') {
        if (pts.length > 0) pts.push([...pts[0]]);
        break;
      }
      i++;
    }
    return pts;
  }

  static generateVectorGcode({
    norm_paths,
    center_x,
    center_y,
    x_pos,
    y_pos,
    width_mm,
    height_mm,
    rotation_deg = 0,
    speed_mm_min = 900,
    power_s = 280,
    passes = 1
  }) {
    const cx = (center_x !== undefined) ? center_x : (x_pos + width_mm / 2);
    const cy = (center_y !== undefined) ? center_y : (y_pos + height_mm / 2);
    const rad = (-rotation_deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const transformPoint = (nx, ny) => {
      const lx = (nx - 0.5) * width_mm;
      const ly = (0.5 - ny) * height_mm;
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      return [cx + rx, cy + ry];
    };

    const lines = [
      "; --- FALCON LASER STUDIO VECTOR TRACE TOOLPATH ---",
      `; Center: (${cx.toFixed(1)}, ${cy.toFixed(1)}) | Size: ${width_mm} x ${height_mm} mm | Rotation: ${rotation_deg.toFixed(1)}°`,
      `; Speed: ${speed_mm_min} mm/min | Power: S${power_s} | Passes: ${passes}`,
      "G90 G21",
      "M4 S0",
      `G0 F${(speed_mm_min * 1.5).toFixed(0)}`
    ];

    for (let pass = 1; pass <= passes; pass++) {
      if (passes > 1) lines.push(`; --- PASS ${pass}/${passes} ---`);
      for (const poly of norm_paths) {
        if (!poly || poly.length < 2) continue;
        const [gx0, gy0] = transformPoint(poly[0][0], poly[0][1]);

        lines.push(`G0 X${gx0.toFixed(3)} Y${gy0.toFixed(3)}`);
        for (let j = 1; j < poly.length; j++) {
          const [gx, gy] = transformPoint(poly[j][0], poly[j][1]);
          lines.push(`G1 X${gx.toFixed(3)} Y${gy.toFixed(3)} F${speed_mm_min.toFixed(0)} S${power_s}`);
        }
        lines.push("M5");
      }
    }

    lines.push("M5");
    lines.push("G0 X0 Y0 F1500");
    return lines;
  }
}

window.ClientSvgCompiler = ClientSvgCompiler;
