/**
 * ClientPhotoTracer - In-browser vector line art and edge detection engine.
 * Converts photos, drawings, and logos directly into crisp vector line paths and dither previews
 * without requiring any server backend.
 */
class ClientPhotoTracer {
  static async processPhoto(imageSource, options = {}) {
    return this.processImage(imageSource, options);
  }

  static async processImage(imageSource, options = {}) {
    const {
      mode = 'sketch', // 'sketch', 'canny', 'threshold'
      remove_bg = false,
      invert = false,
      detail_level = 50,
      line_thickness = 1,
      smoothing = 1.0
    } = options;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const maxDim = 800; // Optimal resolution for fast in-browser vector tracing
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (w > maxDim || h > maxDim) {
            const factor = maxDim / Math.max(w, h);
            w = Math.round(w * factor);
            h = Math.round(h * factor);
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;

          // 1. Grayscale luminance
          const gray = new Float32Array(w * h);
          for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            const a = data[idx + 3] / 255.0;
            let lum = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) * a + 255 * (1 - a);
            if (invert) lum = 255 - lum;
            gray[i] = lum;
          }

          // 2. Filter / Edge detection
          const binary = new Uint8Array(w * h); // 1 = stroke (black), 0 = paper (white)

          if (mode === 'sketch') {
            // Pencil sketch: Invert -> Box Blur -> Color Dodge
            const ksize = Math.max(3, Math.floor(15 * (101 - detail_level) / 50.0));
            const inv = new Float32Array(w * h);
            for (let i = 0; i < w * h; i++) inv[i] = 255 - gray[i];

            const blurred = ClientPhotoTracer.boxBlur(inv, w, h, ksize);
            const thresh = Math.max(160, Math.min(245, 220 + (detail_level - 50) * 0.5));

            for (let i = 0; i < w * h; i++) {
              const denom = Math.max(1, 255 - blurred[i]);
              const val = Math.min(255, (gray[i] * 256) / denom);
              binary[i] = val < thresh ? 1 : 0;
            }
          } else if (mode === 'canny') {
            // Sobel gradient edge detector
            const blurred = ClientPhotoTracer.boxBlur(gray, w, h, 3);
            const edgeThresh = Math.max(15, 80 - detail_level * 0.6);
            for (let y = 1; y < h - 1; y++) {
              for (let x = 1; x < w - 1; x++) {
                const gx =
                  -blurred[(y - 1) * w + (x - 1)] + blurred[(y - 1) * w + (x + 1)]
                  - 2 * blurred[y * w + (x - 1)] + 2 * blurred[y * w + (x + 1)]
                  - blurred[(y + 1) * w + (x - 1)] + blurred[(y + 1) * w + (x + 1)];
                const gy =
                  -blurred[(y - 1) * w + (x - 1)] - 2 * blurred[(y - 1) * w + x] - blurred[(y - 1) * w + (x + 1)]
                  + blurred[(y + 1) * w + (x - 1)] + 2 * blurred[(y + 1) * w + x] + blurred[(y + 1) * w + (x + 1)];
                const mag = Math.hypot(gx, gy);
                binary[y * w + x] = mag > edgeThresh ? 1 : 0;
              }
            }
          } else {
            // Adaptive / global threshold
            const thresh = 128 + (detail_level - 50) * 1.5;
            for (let i = 0; i < w * h; i++) {
              binary[i] = gray[i] < thresh ? 1 : 0;
            }
          }

          // 3. Render binary preview
          for (let i = 0; i < w * h; i++) {
            const val = binary[i] ? 0 : 255;
            const idx = i * 4;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
            data[idx + 3] = 255;
          }
          ctx.putImageData(imgData, 0, 0);

          // 4. Vectorize binary image into continuous polylines
          const paths = ClientPhotoTracer.vectorizeBinary(binary, w, h, line_thickness, smoothing);

          resolve({
            success: true,
            preview: canvas.toDataURL('image/png'),
            paths: paths,
            path_count: paths.length,
            width: w,
            height: h,
            aspect_ratio: Math.round((w / Math.max(1, h)) * 100) / 100
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image for client photo tracing.'));
      img.src = typeof imageSource === 'string' ? imageSource : URL.createObjectURL(imageSource);
    });
  }

  // Fast Separable 2D Box Blur
  static boxBlur(input, w, h, radius) {
    const r = Math.max(1, Math.min(10, Math.floor(radius / 2)));
    const temp = new Float32Array(w * h);
    const output = new Float32Array(w * h);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const count = 2 * r + 1;
      for (let x = -r; x <= r; x++) {
        sum += input[y * w + Math.max(0, Math.min(w - 1, x))];
      }
      for (let x = 0; x < w; x++) {
        temp[y * w + x] = sum / count;
        const left = Math.max(0, x - r);
        const right = Math.min(w - 1, x + r + 1);
        sum += input[y * w + right] - input[y * w + left];
      }
    }

    // Vertical pass
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const count = 2 * r + 1;
      for (let y = -r; y <= r; y++) {
        sum += temp[Math.max(0, Math.min(h - 1, y)) * w + x];
      }
      for (let y = 0; y < h; y++) {
        output[y * w + x] = sum / count;
        const top = Math.max(0, y - r);
        const bottom = Math.min(h - 1, y + r + 1);
        sum += temp[bottom * w + x] - temp[top * w + x];
      }
    }
    return output;
  }

  // Trace horizontal and diagonal scanline runs into continuous vector polylines
  static vectorizeBinary(binary, w, h, step = 1, smoothTolerance = 1.0) {
    const paths = [];
    const stepSize = Math.max(1, Math.floor(w / 350));

    // Scan horizontal runs
    for (let y = 1; y < h - 1; y += stepSize) {
      let inRun = false;
      let curPoly = [];
      for (let x = 1; x < w - 1; x += stepSize) {
        const idx = y * w + x;
        if (binary[idx]) {
          if (!inRun) {
            inRun = true;
            curPoly = [[x / w, y / h]];
          } else {
            curPoly.push([x / w, y / h]);
          }
        } else {
          if (inRun) {
            inRun = false;
            if (curPoly.length > 2) {
              paths.push(ClientPhotoTracer.simplifyPath(curPoly, smoothTolerance / w));
            }
            curPoly = [];
          }
        }
      }
      if (inRun && curPoly.length > 2) {
        paths.push(ClientPhotoTracer.simplifyPath(curPoly, smoothTolerance / w));
      }
    }

    return paths;
  }

  // Ramer-Douglas-Peucker path simplification
  static simplifyPath(points, epsilon) {
    if (points.length <= 2) return points;
    let dmax = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
      const d = ClientPhotoTracer.perpendicularDistance(points[i], points[0], points[end]);
      if (d > dmax) {
        index = i;
        dmax = d;
      }
    }

    if (dmax > epsilon) {
      const rec1 = ClientPhotoTracer.simplifyPath(points.slice(0, index + 1), epsilon);
      const rec2 = ClientPhotoTracer.simplifyPath(points.slice(index), epsilon);
      return rec1.slice(0, rec1.length - 1).concat(rec2);
    } else {
      return [points[0], points[end]];
    }
  }

  static perpendicularDistance(pt, lineStart, lineEnd) {
    let dx = lineEnd[0] - lineStart[0];
    let dy = lineEnd[1] - lineStart[1];
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return Math.hypot(pt[0] - lineStart[0], pt[1] - lineStart[1]);
    const u = ((pt[0] - lineStart[0]) * dx + (pt[1] - lineStart[1]) * dy) / (mag * mag);
    const clampedU = Math.max(0, Math.min(1, u));
    const projX = lineStart[0] + clampedU * dx;
    const projY = lineStart[1] + clampedU * dy;
    return Math.hypot(pt[0] - projX, pt[1] - projY);
  }
}

window.ClientPhotoTracer = ClientPhotoTracer;
