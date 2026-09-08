/**
 * Client-Side Bed Calibration Grid & Scale G-code Generator.
 * Enables zero-dependency generation on GitHub Pages.
 */
class ClientBedScaleGenerator {
  static MATERIAL_PROFILES = {
    glass: {
      name: "Black / Coated Glass Bed",
      speed: 800.0,
      power: 450,
      passes: 1,
      safety_note: "CRITICAL: Cover glass with paper masking tape or matte black paint before firing to prevent 450nm specular reflection."
    },
    wood: {
      name: "Wood / MDF Spoilboard",
      speed: 1200.0,
      power: 300,
      passes: 1,
      safety_note: "Zero masking needed. Produces crisp, dark charred millimeter lines and target pockets."
    },
    metal: {
      name: "Anodized / Coated Metal",
      speed: 600.0,
      power: 850,
      passes: 1,
      safety_note: "Bleaches the anodized color layer or marks laser coating for brilliant high-contrast white markings."
    }
  };

  static CHAR_MAP = {
    'O': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0]],
    'R': [[0,0, 0,1], [0,1, 1,1], [1,1, 1,0.5], [1,0.5, 0,0.5], [0.5,0.5, 1,0]],
    'I': [[0.5,0, 0.5,1], [0.2,1, 0.8,1], [0.2,0, 0.8,0]],
    'G': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0], [1,0, 1,0.5], [1,0.5, 0.5,0.5]],
    'N': [[0,0, 0,1], [0,1, 1,0], [1,0, 1,1]],
    '(': [[0.8,1, 0.3,0.5], [0.3,0.5, 0.8,0]],
    ')': [[0.2,1, 0.7,0.5], [0.7,0.5, 0.2,0]],
    '0': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1), (0,1, 0,0], [0.2,0.2, 0.8,0.8]],
    ',': [[0.5,0.2, 0.3,-0.2]],
    '+': [[0.1,0.5, 0.9,0.5], [0.5,0.1, 0.5,0.9]],
    'X': [[0.1,0.1, 0.9,0.9], [0.1,0.9, 0.9,0.1]],
    'Y': [[0.1,0.9, 0.5,0.5], [0.9,0.9, 0.5,0.5], [0.5,0.5, 0.5,0.1]],
    'C': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0]],
    'E': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0], [0,0.5, 0.8,0.5]],
    'T': [[0,1, 1,1], [0.5,1, 0.5,0]],
    ' ': []
  };

  static generateGridGcode({
    material = "glass",
    size_mm = 380.0,
    origin_mode = "front_left",
    center_x = 200.0,
    center_y = 207.5,
    include_origin_datum = true,
    include_40mm_targets = true,
    include_100mm_targets = true,
    include_rulers = true,
    include_grid = true,
    custom_speed = null,
    custom_power = null
  }) {
    const profile = this.MATERIAL_PROFILES[material] || this.MATERIAL_PROFILES.wood;
    const speed = custom_speed || profile.speed;
    const power = custom_power || profile.power;

    let x_min = 0.0, y_min = 0.0, x_max = size_mm, y_max = Math.min(415.0, size_mm);
    let origin_x = 0.0, origin_y = 0.0;
    let mid_x = x_max / 2.0, mid_y = y_max / 2.0;

    if (origin_mode === "center") {
      const half = size_mm / 2.0;
      x_min = center_x - half;
      x_max = center_x + half;
      y_min = center_y - half;
      y_max = center_y + half;
      origin_x = center_x;
      origin_y = center_y;
      mid_x = center_x;
      mid_y = center_y;
    }

    const lines = [
      "; --- FALCON BED REFERENCE SCALE WITH (0,0) ORIGIN ---",
      `; Material: ${profile.name}`,
      `; Origin Mode: ${origin_mode.toUpperCase()} at (${origin_x.toFixed(1)}, ${origin_y.toFixed(1)})`,
      `; Size: ${size_mm.toFixed(1)} x ${size_mm.toFixed(1)} mm`,
      `; Bounds: X[${x_min.toFixed(1)}..${x_max.toFixed(1)}], Y[${y_min.toFixed(1)}..${y_max.toFixed(1)}]`,
      `; Feed: ${speed.toFixed(0)} mm/min | Power: S${power}`,
      "G90 G21",
      "M4 S0",
      `G0 F${(speed * 1.5).toFixed(0)}`
    ];

    const norm_paths = [];

    const toNorm = (gx, gy) => [
      Math.round(((gx - x_min) / Math.max(1e-5, (x_max - x_min))) * 10000) / 10000,
      Math.round(((gy - y_min) / Math.max(1e-5, (y_max - y_min))) * 10000) / 10000
    ];

    const addLine = (x1, y1, x2, y2) => {
      lines.push(`G0 X${x1.toFixed(3)} Y${y1.toFixed(3)}`);
      lines.push(`G1 X${x2.toFixed(3)} Y${y2.toFixed(3)} F${speed.toFixed(0)} S${power}`);
      lines.push("M5");
      norm_paths.push([toNorm(x1, y1), toNorm(x2, y2)]);
    };

    const addCircle = (cx, cy, r) => {
      const pts = [];
      const steps = 36;
      for (let s = 0; s <= steps; s++) {
        const ang = s * (2.0 * Math.PI / steps);
        pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
      }
      lines.push(`G0 X${pts[0][0].toFixed(3)} Y${pts[0][1].toFixed(3)}`);
      for (let i = 1; i < pts.length; i++) {
        lines.push(`G1 X${pts[i][0].toFixed(3)} Y${pts[i][1].toFixed(3)} F${speed.toFixed(0)} S${power}`);
      }
      lines.push("M5");
      norm_paths.push(pts.map(p => toNorm(p[0], p[1])));
    };

    const addArc = (cx, cy, r, startDeg, endDeg, steps = 24) => {
      const pts = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const angDeg = startDeg + t * (endDeg - startDeg);
        const ang = (angDeg * Math.PI) / 180.0;
        const px = Math.max(x_min, Math.min(x_max, cx + r * Math.cos(ang)));
        const py = Math.max(y_min, Math.min(y_max, cy + r * Math.sin(ang)));
        pts.push([px, py]);
      }
      if (pts.length > 0) {
        lines.push(`G0 X${pts[0][0].toFixed(3)} Y${pts[0][1].toFixed(3)}`);
        for (let i = 1; i < pts.length; i++) {
          lines.push(`G1 X${pts[i][0].toFixed(3)} Y${pts[i][1].toFixed(3)} F${speed.toFixed(0)} S${power}`);
        }
        lines.push("M5");
        norm_paths.push(pts.map(p => toNorm(p[0], p[1])));
      }
    };

    const addText = (text, startX, startY, cw = 2.8, ch = 4.2, sp = 1.0) => {
      let cx = startX;
      for (const char of text.toUpperCase()) {
        const strokes = this.CHAR_MAP[char] || [];
        for (const [x1, y1, x2, y2] of strokes) {
          addLine(cx + x1 * cw, startY + y1 * ch, cx + x2 * cw, startY + y2 * ch);
        }
        cx += cw + sp;
      }
    };

    // --- 1. PROMINENT (0,0) PHYSICAL MACHINE ORIGIN DATUM MARK ---
    if (include_origin_datum) {
      if (origin_mode === "front_left") {
        for (const r of [5.0, 10.0, 20.0, 30.0, 45.0]) {
          addArc(origin_x, origin_y, r, 0.0, 90.0, 28);
        }
        const fenceLen = Math.min(70.0, size_mm * 0.25);
        addLine(origin_x, origin_y, origin_x + fenceLen, origin_y);
        addLine(origin_x, origin_y + 0.3, origin_x + fenceLen, origin_y + 0.3);
        addLine(origin_x, origin_y, origin_x, origin_y + fenceLen);
        addLine(origin_x + 0.3, origin_y, origin_x + 0.3, origin_y + fenceLen);
        addLine(origin_x, origin_y, origin_x + 22.0, origin_y + 22.0);
        addLine(origin_x + 5.0, origin_y, origin_x + 5.0, origin_y + 5.0);
        addLine(origin_x, origin_y + 5.0, origin_x + 5.0, origin_y + 5.0);

        for (let d = 1; d <= 20; d++) {
          const th = d % 10 === 0 ? 4.0 : (d % 5 === 0 ? 2.5 : 1.2);
          addLine(origin_x + d, origin_y, origin_x + d, origin_y + th);
          addLine(origin_x, origin_y + d, origin_x + th, origin_y + d);
        }

        addLine(origin_x + fenceLen - 5.0, origin_y + 3.5, origin_x + fenceLen, origin_y);
        addLine(origin_x + fenceLen - 5.0, origin_y, origin_x + fenceLen, origin_y);
        addLine(origin_x + 3.5, origin_y + fenceLen - 5.0, origin_x, origin_y + fenceLen);
        addLine(origin_x, origin_y + fenceLen - 5.0, origin_x, origin_y + fenceLen);

        addText("ORIGIN (0,0)", origin_x + 8.0, origin_y + 11.0, 2.6, 4.0, 0.9);
        addText("+X", origin_x + fenceLen + 3.0, origin_y + 1.0, 2.4, 3.8, 0.8);
        addText("+Y", origin_x + 1.0, origin_y + fenceLen + 3.0, 2.4, 3.8, 0.8);
      } else {
        for (const r of [5.0, 10.0, 20.0, 30.0]) {
          addCircle(origin_x, origin_y, r);
        }
        addLine(origin_x - 40.0, origin_y, origin_x + 40.0, origin_y);
        addLine(origin_x, origin_y - 40.0, origin_x, origin_y + 40.0);
        addLine(origin_x - 15.0, origin_y - 15.0, origin_x + 15.0, origin_y + 15.0);
        addLine(origin_x - 15.0, origin_y + 15.0, origin_x + 15.0, origin_y - 15.0);
        addText("CENTER (0,0)", origin_x + 8.0, origin_y + 8.0, 2.4, 3.8, 0.8);
      }
    }

    // --- 2. OUTER BED SCALE BORDER ---
    addLine(x_min, y_min, x_max, y_min);
    addLine(x_max, y_min, x_max, y_max);
    addLine(x_max, y_max, x_min, y_max);
    addLine(x_min, y_max, x_min, y_min);

    // --- 3. GRID CROSSES & GUIDES ---
    if (include_grid) {
      const gridStep = 50.0;
      let currX = x_min + gridStep;
      while (currX < x_max) {
        addLine(currX, y_min, currX, y_max);
        currX += gridStep;
      }
      let currY = y_min + gridStep;
      while (currY < y_max) {
        addLine(x_min, currY, x_max, currY);
        currY += gridStep;
      }
    }

    // --- 4. MILLIMETER RULERS ---
    if (include_rulers) {
      let currX = x_min;
      while (currX <= x_max) {
        const dist = currX - x_min;
        let tickH = Math.round(dist) % 10 === 0 ? 5.0 : 2.5;
        if (Math.round(dist) % 50 === 0) tickH = 8.0;
        addLine(currX, y_min, currX, y_min + tickH);
        currX += 5.0;
      }
      let currY = y_min;
      while (currY <= y_max) {
        const dist = currY - y_min;
        let tickW = Math.round(dist) % 10 === 0 ? 5.0 : 2.5;
        if (Math.round(dist) % 50 === 0) tickW = 8.0;
        addLine(x_min, currY, x_min + tickW, currY);
        currY += 5.0;
      }
    }

    // --- 5. TARGET POCKETS ---
    if (include_100mm_targets) {
      addCircle(mid_x, mid_y, 50.0);
      addLine(mid_x - 10.0, mid_y, mid_x + 10.0, mid_y);
      addLine(mid_x, mid_y - 10.0, mid_x, mid_y + 10.0);
    }

    if (include_40mm_targets) {
      addCircle(mid_x, mid_y, 20.0);
      if (size_mm >= 240.0) {
        const offX = Math.min(100.0, (x_max - x_min) * 0.28);
        const offY = Math.min(100.0, (y_max - y_min) * 0.28);
        for (const [qx, qy] of [
          [mid_x - offX, mid_y - offY],
          [mid_x + offX, mid_y - offY],
          [mid_x - offX, mid_y + offY],
          [mid_x + offX, mid_y + offY]
        ]) {
          addCircle(qx, qy, 20.0);
          addLine(qx - 5.0, qy, qx + 5.0, qy);
          addLine(qx, qy - 5.0, qx, qy + 5.0);
        }
      }
    }

    lines.push("M5");
    lines.push(`G0 X${origin_x.toFixed(3)} Y${origin_y.toFixed(3)}`);

    return {
      success: true,
      material,
      material_name: profile.name,
      safety_note: profile.safety_note,
      speed,
      power,
      size_mm,
      origin_mode,
      origin: { x: origin_x, y: origin_y },
      bounds: { xmin: x_min, ymin: y_min, xmax: x_max, ymax: y_max },
      line_count: lines.length,
      gcode_lines: lines,
      norm_paths
    };
  }
}

window.ClientBedScaleGenerator = ClientBedScaleGenerator;
