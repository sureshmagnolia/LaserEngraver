/**
 * ClientRasterCompiler - Client-side photographic raster dithering (Floyd-Steinberg & Atkinson)
 * and G-code generator for CR-Laser Falcon 5W.
 */
class ClientRasterCompiler {
  static ditherImage(imgElement, mode = 'floyd', invert = false, contrast = 1.0, brightness = 0) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imgElement.naturalWidth || imgElement.width || 300;
    canvas.height = imgElement.naturalHeight || imgElement.height || 300;

    ctx.drawImage(imgElement, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const w = canvas.width, h = canvas.height;

    // Grayscale, brightness & contrast
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      let lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      lum = (lum - 128) * contrast + 128 + brightness;
      lum = Math.max(0, Math.min(255, lum));
      if (invert) lum = 255 - lum;
      gray[i] = lum;
    }

    // Dither
    const binary = new Uint8Array(w * h); // 1 = burn (black), 0 = no burn (white)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const oldVal = gray[idx];
        // Dark pixels (< 128) = burn
        const newVal = oldVal < 128 ? 0 : 255;
        binary[idx] = newVal === 0 ? 1 : 0;
        const err = oldVal - newVal;

        if (mode === 'floyd') {
          if (x + 1 < w) gray[y * w + (x + 1)] += err * (7 / 16);
          if (y + 1 < h) {
            if (x - 1 >= 0) gray[(y + 1) * w + (x - 1)] += err * (3 / 16);
            gray[(y + 1) * w + x] += err * (5 / 16);
            if (x + 1 < w) gray[(y + 1) * w + (x + 1)] += err * (1 / 16);
          }
        } else if (mode === 'atkinson') {
          const spread = err / 8;
          if (x + 1 < w) gray[y * w + (x + 1)] += spread;
          if (x + 2 < w) gray[y * w + (x + 2)] += spread;
          if (y + 1 < h) {
            if (x - 1 >= 0) gray[(y + 1) * w + (x - 1)] += spread;
            gray[(y + 1) * w + x] += spread;
            if (x + 1 < w) gray[(y + 1) * w + (x + 1)] += spread;
          }
          if (y + 2 < h) {
            gray[(y + 2) * w + x] += spread;
          }
        } else {
          // Threshold
          binary[idx] = oldVal < 128 ? 1 : 0;
        }
      }
    }

    // Write back to canvas for preview
    for (let i = 0; i < w * h; i++) {
      const v = binary[i] ? 0 : 255;
      const idx = i * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    return {
      canvas,
      dataUrl: canvas.toDataURL("image/png"),
      binary,
      width: w,
      height: h
    };
  }

  static async generatePreview(imageSource, options = {}) {
    const { mode = 'floyd', invert = false, contrast = 1.0, brightness = 0 } = options;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const res = ClientRasterCompiler.ditherImage(img, mode, invert, contrast, brightness);
          resolve({
            success: true,
            preview: res.dataUrl,
            width: res.width,
            height: res.height,
            aspect_ratio: Math.round((res.width / Math.max(1, res.height)) * 100) / 100
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image for raster dithering.'));
      img.src = typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource);
    });
  }

  static generateRasterGcode({
    binary,
    width,
    height,
    x_start,
    y_start,
    target_width_mm,
    target_height_mm,
    speed_mm_min = 1200,
    max_power_s = 350
  }) {
    const lines = [
      "; --- FALCON LASER STUDIO INKJET RASTER TOOLPATH ---",
      `; Dimensions: ${target_width_mm} x ${target_height_mm} mm`,
      `; Speed: ${speed_mm_min} mm/min | Max Power: S${max_power_s}`,
      "G90 G21",
      "M4 S0",
      `G0 F${(speed_mm_min * 1.5).toFixed(0)}`
    ];

    const dx = target_width_mm / width;
    const dy = target_height_mm / height;

    for (let r = 0; r < height; r++) {
      // In laser coordinates, row 0 is top
      const gy = y_start + target_height_mm - (r * dy);
      const isLtr = (r % 2 === 0);

      // Find burn spans
      const spans = [];
      let inSpan = false;
      let spanStart = 0;

      const cols = isLtr ? [...Array(width).keys()] : [...Array(width).keys()].reverse();

      for (let c of cols) {
        const isBurn = binary[r * width + c] === 1;
        if (isBurn && !inSpan) {
          inSpan = true;
          spanStart = c;
        } else if (!isBurn && inSpan) {
          inSpan = false;
          spans.push([spanStart, c]);
        }
      }
      if (inSpan) spans.push([spanStart, cols[cols.length - 1]]);

      if (spans.length === 0) continue;

      // Engrave spans in this line
      for (const [startCol, endCol] of spans) {
        const x1 = x_start + startCol * dx;
        const x2 = x_start + endCol * dx;
        lines.push(`G0 X${x1.toFixed(3)} Y${gy.toFixed(3)}`);
        lines.push(`G1 X${x2.toFixed(3)} Y${gy.toFixed(3)} F${speed_mm_min.toFixed(0)} S${max_power_s}`);
        lines.push("M5");
      }
    }

    lines.push("M5");
    lines.push("G0 X0 Y0 F1500");
    return lines;
  }
}

window.ClientRasterCompiler = ClientRasterCompiler;
