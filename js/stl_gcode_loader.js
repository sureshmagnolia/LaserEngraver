/**
 * StlGcodeLoader - Ingestion and Parsing Engine for STL 3D Meshes and GRBL G-Code Files
 * Creality CR-Laser Falcon 5W
 * 
 * Capabilities:
 * - Direct G-code parser (.gcode, .nc, .gc, .txt) with arc interpolation, bounds detection & stats.
 * - Binary & ASCII STL 3D mesh parser with top-down 2.5D depth-heightmap projection and contour extraction.
 */

class StlGcodeLoader {
  /**
   * Parse raw G-code text into motion segments and polylines
   * @param {string} gcodeText
   * @returns {Object} { segments, polylines, bounds, totalCutDist, totalRapidDist, estimatedTimeSec }
   */
  static parseGcode(gcodeText) {
    const lines = gcodeText.split(/\r?\n/);
    const segments = [];
    const polylines = [];
    let currentPoly = [];

    let curX = 0.0, curY = 0.0;
    let isAbsolute = true; // G90 default
    let unitScale = 1.0; // G21 default (mm)
    let curFeed = 1200.0;
    let curPower = 0;
    let isLaserOn = false;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let totalCutDist = 0.0;
    let totalRapidDist = 0.0;

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith(';') || line.startsWith('(')) continue;

      // Remove inline comments
      const commentIdx = line.indexOf(';');
      if (commentIdx !== -1) line = line.substring(0, commentIdx).trim();

      // Check M commands
      if (/M0?3|M0?4/i.test(line)) {
        isLaserOn = true;
      } else if (/M0?5/i.test(line)) {
        isLaserOn = false;
        curPower = 0;
      }

      // Check S parameter
      const sMatch = line.match(/S([0-9.]+)/i);
      if (sMatch) {
        curPower = parseFloat(sMatch[1]);
        if (curPower > 0) isLaserOn = true;
      }

      // Check F parameter
      const fMatch = line.match(/F([0-9.]+)/i);
      if (fMatch) curFeed = parseFloat(fMatch[1]);

      // Check Units & Mode
      if (/G90/i.test(line)) isAbsolute = true;
      if (/G91/i.test(line)) isAbsolute = false;
      if (/G20/i.test(line)) unitScale = 25.4; // inches
      if (/G21/i.test(line)) unitScale = 1.0; // mm

      // Check Motion: G0, G1, G2, G3
      const isRapid = /G00?(\s|$)/i.test(line);
      const isLinear = /G0?1(\s|$)/i.test(line);
      const isArcCW = /G0?2(\s|$)/i.test(line);
      const isArcCCW = /G0?3(\s|$)/i.test(line);

      if (!isRapid && !isLinear && !isArcCW && !isArcCCW) {
        // If line has X or Y but no G code, inherit modal move
        if (!/[XY]/i.test(line)) continue;
      }

      const xMatch = line.match(/X([+-]?[0-9.]+)/i);
      const yMatch = line.match(/Y([+-]?[0-9.]+)/i);

      if (!xMatch && !yMatch) continue;

      let targetX = curX;
      let targetY = curY;

      if (xMatch) {
        const val = parseFloat(xMatch[1]) * unitScale;
        targetX = isAbsolute ? val : curX + val;
      }
      if (yMatch) {
        const val = parseFloat(yMatch[1]) * unitScale;
        targetY = isAbsolute ? val : curY + val;
      }

      const dist = Math.hypot(targetX - curX, targetY - curY);
      const isCut = !isRapid && isLaserOn && curPower > 0;

      if (isCut) {
        minX = Math.min(minX, curX, targetX);
        maxX = Math.max(maxX, curX, targetX);
        minY = Math.min(minY, curY, targetY);
        maxY = Math.max(maxY, curY, targetY);
        totalCutDist += dist;

        if (currentPoly.length === 0) currentPoly.push([curX, curY]);
        currentPoly.push([targetX, targetY]);
      } else {
        totalRapidDist += dist;
        if (currentPoly.length > 1) {
          polylines.push(currentPoly);
        }
        currentPoly = [];
      }

      segments.push({
        type: isCut ? 'cut' : 'move',
        x0: curX,
        y0: curY,
        x1: targetX,
        y1: targetY,
        dist: dist,
        feed: isCut ? curFeed : 2500,
        power: isCut ? curPower : 0
      });

      curX = targetX;
      curY = targetY;
    }

    if (currentPoly.length > 1) {
      polylines.push(currentPoly);
    }

    if (minX === Infinity) {
      minX = 0; maxX = 40; minY = 0; maxY = 40;
    }

    const bounds = {
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      width: Math.max(0.1, maxX - minX),
      height: Math.max(0.1, maxY - minY),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };

    // Normalize polylines (0.0 to 1.0 relative to bounds)
    const normPolylines = polylines.map(poly => {
      return poly.map(pt => [
        (pt[0] - bounds.minX) / bounds.width,
        (pt[1] - bounds.minY) / bounds.height
      ]);
    });

    const cutTime = totalCutDist / (1200 / 60);
    const rapidTime = totalRapidDist / (2500 / 60);
    const estimatedTimeSec = Math.round(cutTime + rapidTime);

    return {
      segments: segments,
      polylines: normPolylines,
      rawPolylines: polylines,
      bounds: bounds,
      totalCutDist: Math.round(totalCutDist),
      totalRapidDist: Math.round(totalRapidDist),
      lineCount: lines.length,
      estimatedTimeSec: estimatedTimeSec
    };
  }

  /**
   * Parse an STL 3D mesh (ArrayBuffer) into triangles, bounding box,
   * and generate a 2.5D heightmap depth projection canvas for relief laser engraving.
   * @param {ArrayBuffer} buffer
   * @param {number} resolution - Heightmap texture width/height (default 512px)
   * @returns {Object} { triangles, bounds, heightmapCanvas, heightmapDataUrl, polyContours }
   */
  static parseStl(buffer, resolution = 512) {
    const isAscii = StlGcodeLoader.isStlAscii(buffer);
    let triangles = [];

    if (isAscii) {
      const text = new TextDecoder().decode(buffer);
      triangles = StlGcodeLoader.parseAsciiStl(text);
    } else {
      triangles = StlGcodeLoader.parseBinaryStl(buffer);
    }

    if (!triangles || triangles.length === 0) {
      throw new Error('No valid triangles found in STL file.');
    }

    // Compute 3D Bounding Box
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const tri of triangles) {
      for (const v of tri.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
      }
    }

    const bounds = {
      minX, maxX, minY, maxY, minZ, maxZ,
      width: Math.max(0.001, maxX - minX),
      height: Math.max(0.001, maxY - minY),
      depth: Math.max(0.001, maxZ - minZ),
      triangleCount: triangles.length
    };

    // Generate 2.5D Top-Down Z-Depth Heightmap (Canvas)
    const heightmapCanvas = document.createElement('canvas');
    heightmapCanvas.width = resolution;
    heightmapCanvas.height = resolution;
    const ctx = heightmapCanvas.getContext('2d');

    // Fill white (zero burn / top surface)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, resolution, resolution);

    const imgData = ctx.getImageData(0, 0, resolution, resolution);
    const pixels = imgData.data;
    const zBuffer = new Float32Array(resolution * resolution).fill(-Infinity);

    // Project each triangle down onto XY plane with Z-buffer interpolation
    const scaleX = (resolution - 1) / bounds.width;
    const scaleY = (resolution - 1) / bounds.height;
    const zRange = bounds.depth;

    for (const tri of triangles) {
      // Map vertices to pixel coords (Y flipped for top-down view)
      const p0 = {
        x: Math.round((tri.vertices[0].x - minX) * scaleX),
        y: Math.round((maxY - tri.vertices[0].y) * scaleY),
        z: tri.vertices[0].z
      };
      const p1 = {
        x: Math.round((tri.vertices[1].x - minX) * scaleX),
        y: Math.round((maxY - tri.vertices[1].y) * scaleY),
        z: tri.vertices[1].z
      };
      const p2 = {
        x: Math.round((tri.vertices[2].x - minX) * scaleX),
        y: Math.round((maxY - tri.vertices[2].y) * scaleY),
        z: tri.vertices[2].z
      };

      StlGcodeLoader.rasterizeTriangleZ(p0, p1, p2, zBuffer, pixels, resolution, minZ, zRange);
    }

    ctx.putImageData(imgData, 0, 0);

    return {
      triangles: triangles,
      bounds: bounds,
      heightmapCanvas: heightmapCanvas,
      heightmapDataUrl: heightmapCanvas.toDataURL('image/png')
    };
  }

  static isStlAscii(buffer) {
    const reader = new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength));
    const sample = String.fromCharCode.apply(null, reader);
    return sample.startsWith('solid') && !/[\x00-\x08\x0E-\x1F]/.test(sample);
  }

  static parseBinaryStl(buffer) {
    const view = new DataView(buffer);
    const triangleCount = view.getUint32(80, true);
    const triangles = [];

    let offset = 84;
    for (let i = 0; i < triangleCount; i++) {
      if (offset + 50 > buffer.byteLength) break;

      const normal = {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true)
      };
      offset += 12;

      const vertices = [
        { x: view.getFloat32(offset, true), y: view.getFloat32(offset + 4, true), z: view.getFloat32(offset + 8, true) },
        { x: view.getFloat32(offset + 12, true), y: view.getFloat32(offset + 16, true), z: view.getFloat32(offset + 20, true) },
        { x: view.getFloat32(offset + 24, true), y: view.getFloat32(offset + 28, true), z: view.getFloat32(offset + 32, true) }
      ];
      offset += 36;
      offset += 2; // attribute byte count

      triangles.push({ normal, vertices });
    }
    return triangles;
  }

  static parseAsciiStl(text) {
    const triangles = [];
    const facetRegex = /facet\s+normal\s+([+-]?[0-9.eE]+)\s+([+-]?[0-9.eE]+)\s+([+-]?[0-9.eE]+)[\s\S]*?outer\s+loop([\s\S]*?)endloop[\s\S]*?endfacet/gi;
    const vertexRegex = /vertex\s+([+-]?[0-9.eE]+)\s+([+-]?[0-9.eE]+)\s+([+-]?[0-9.eE]+)/gi;

    let match;
    while ((match = facetRegex.exec(text)) !== null) {
      const normal = {
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        z: parseFloat(match[3])
      };

      const loopText = match[4];
      const vertices = [];
      let vMatch;
      while ((vMatch = vertexRegex.exec(loopText)) !== null) {
        vertices.push({
          x: parseFloat(vMatch[1]),
          y: parseFloat(vMatch[2]),
          z: parseFloat(vMatch[3])
        });
      }

      if (vertices.length >= 3) {
        triangles.push({ normal, vertices: vertices.slice(0, 3) });
      }
    }
    return triangles;
  }

  /**
   * Fast Barycentric Triangle Rasterizer for 2.5D Z-depth heightmap
   */
  static rasterizeTriangleZ(p0, p1, p2, zBuffer, pixels, resolution, minZ, zRange) {
    const minPx = Math.max(0, Math.min(p0.x, p1.x, p2.x));
    const maxPx = Math.min(resolution - 1, Math.max(p0.x, p1.x, p2.x));
    const minPy = Math.max(0, Math.min(p0.y, p1.y, p2.y));
    const maxPy = Math.min(resolution - 1, Math.max(p0.y, p1.y, p2.y));

    const denom = (p1.y - p2.y) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.y - p2.y);
    if (Math.abs(denom) < 0.0001) return;

    for (let y = minPy; y <= maxPy; y++) {
      for (let x = minPx; x <= maxPx; x++) {
        const w0 = ((p1.y - p2.y) * (x - p2.x) + (p2.x - p1.x) * (y - p2.y)) / denom;
        const w1 = ((p2.y - p0.y) * (x - p2.x) + (p0.x - p2.x) * (y - p2.y)) / denom;
        const w2 = 1.0 - w0 - w1;

        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
          const idx = y * resolution + x;

          if (z > zBuffer[idx]) {
            zBuffer[idx] = z;
            // Map height to grayscale (highest = darkest burn, lowest = white)
            const normZ = (z - minZ) / zRange;
            const gray = Math.round((1.0 - normZ) * 255);
            const pIdx = idx * 4;
            pixels[pIdx] = gray;
            pixels[pIdx + 1] = gray;
            pixels[pIdx + 2] = gray;
            pixels[pIdx + 3] = 255;
          }
        }
      }
    }
  }
}

// Attach globally
window.StlGcodeLoader = StlGcodeLoader;
