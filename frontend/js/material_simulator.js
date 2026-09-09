/**
 * MaterialSimulator - High-Fidelity Virtual Laser Engraver & Substrate Simulator
 * Creality CR-Laser Falcon 5W
 * 
 * Features:
 * - Ultra-realistic procedural substrate shaders: Wood, Acrylic, Glass, Metal.
 * - Dynamic laser burn/etching effects specific to each material.
 * - Animated Falcon 5W laser head with gantry rail, nozzle, 450nm blue beam & spark particles.
 * - Multi-speed playback (1x, 5x, 10x, 25x, 50x, 100x) & instant final result toggle.
 * - Interactive timeline progress scrubber (0% - 100%).
 * - High-resolution snapshot export.
 */

class MaterialSimulator {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Offscreen canvas for progressive burn marks
    this.burnCanvas = document.createElement('canvas');
    this.burnCtx = this.burnCanvas.getContext('2d');

    // Procedural substrate texture cache
    this.substrateCanvas = document.createElement('canvas');
    this.substrateCtx = this.substrateCanvas.getContext('2d');

    // Material definitions
    this.materials = {
      wood: {
        name: 'Basswood / Birch Plywood',
        baseColor: '#e0c192',
        burnColor: '#1a0d05',
        burnHaloColor: 'rgba(180, 75, 15, 0.28)',
        burnWidthMultiplier: 1.25,
        burnGlow: 'rgba(255, 120, 20, 0.2)',
        laserColor: 'rgba(60, 140, 255, 0.95)',
        sparks: true,
        recommendedSpeed: 900,
        recommendedPower: 280,
        desc: 'Natural wood grain with deep carbonized charring, amber heat-affected border, and subtle soot shading.'
      },
      acrylic: {
        name: 'Cast Optical Acrylic (Black / Clear)',
        baseColor: '#12151b',
        burnColor: '#ffffff',
        burnHaloColor: 'rgba(255, 255, 255, 0.45)',
        burnWidthMultiplier: 0.95,
        burnGlow: 'rgba(180, 225, 255, 0.65)',
        laserColor: 'rgba(90, 170, 255, 0.98)',
        sparks: false,
        recommendedSpeed: 800,
        recommendedPower: 350,
        desc: 'Sleek glossy surface with brilliant crystalline frosted white micro-pits and edge-lit optical glow.'
      },
      glass: {
        name: 'Frosted / Coated Glass Plate',
        baseColor: '#0a1618',
        burnColor: '#f0f8ff',
        burnHaloColor: 'rgba(215, 240, 255, 0.35)',
        burnWidthMultiplier: 1.1,
        burnGlow: 'rgba(160, 230, 255, 0.45)',
        laserColor: 'rgba(80, 150, 255, 0.95)',
        sparks: true,
        recommendedSpeed: 800,
        recommendedPower: 450,
        desc: 'Float glass with beveled edge reflection. Laser creates delicate diffuse micro-fractured frosted marks.'
      },
      metal: {
        name: 'Anodized Aluminum / Laser Metal',
        baseColor: '#1f2228',
        burnColor: '#f2f4f8',
        burnHaloColor: 'rgba(255, 255, 255, 0.22)',
        burnWidthMultiplier: 0.85,
        burnGlow: 'rgba(255, 255, 255, 0.5)',
        laserColor: 'rgba(100, 180, 255, 0.98)',
        sparks: true,
        recommendedSpeed: 600,
        recommendedPower: 850,
        desc: 'Brushed anodized metal. Laser cleanly ablates the anodized layer revealing bright silvery-white aluminum.'
      }
    };

    this.currentMaterial = 'wood';

    // Workpiece parameters (in mm)
    this.workpiece = {
      width: 40.0,
      height: 40.0,
      shape: 'round' // 'round' or 'rect'
    };

    // Toolpath data: array of segment commands [{ type: 'move'|'cut', x, y, feed, power, dist }]
    this.segments = [];
    this.totalCutDistance = 0.0;
    this.totalRapidDistance = 0.0;
    this.estimatedTotalTime = 0.0;

    // Simulation Playback State
    this.isPlaying = false;
    this.speedMultiplier = 10.0; // 1x, 5x, 10x, 25x, 50x, 100x
    this.currentSegmentIndex = 0;
    this.currentSegmentProgress = 0.0; // 0.0 to 1.0 within segment
    this.accumulatedSimulatedTime = 0.0;
    this.currentHeadPos = { x: 0.0, y: 0.0 };
    this.isLaserFiring = false;
    this.currentPower = 0;
    this.currentFeed = 0;

    // Animation loop & spark particles
    this.particles = [];
    this.animFrameId = null;
    this.lastFrameTimestamp = 0;

    // Callbacks for UI sync
    this.onProgressUpdate = null;
    this.onSimulationComplete = null;

    this.initCanvasSize();
    this.generateSubstrateTexture();
    this.render();
  }

  initCanvasSize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth || 800;
    const h = parent.clientHeight || 550;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';

    this.burnCanvas.width = this.canvas.width;
    this.burnCanvas.height = this.canvas.height;
    this.substrateCanvas.width = this.canvas.width;
    this.substrateCanvas.height = this.canvas.height;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.burnCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.substrateCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.displayWidth = w;
    this.displayHeight = h;
  }

  setMaterial(materialKey) {
    if (this.materials[materialKey]) {
      this.currentMaterial = materialKey;
      this.generateSubstrateTexture();
      this.rebuildBurnCanvasUpToIndex(this.currentSegmentIndex);
      this.render();
    }
  }

  setWorkpiece(widthMm, heightMm, shape = 'round') {
    this.workpiece.width = Math.max(5.0, widthMm);
    this.workpiece.height = Math.max(5.0, heightMm);
    this.workpiece.shape = shape;
    this.generateSubstrateTexture();
    this.rebuildSegmentsFromRawToolpaths();
    this.rebuildBurnCanvasUpToIndex(this.currentSegmentIndex);
    this.render();
  }

  setArtworkDimensions(artW, artH) {
    if (artW && artW > 0) this.artworkWidth = artW;
    if (artH && artH > 0) this.artworkHeight = artH;
    this.rebuildSegmentsFromRawToolpaths();
    this.rebuildBurnCanvasUpToIndex(this.currentSegmentIndex);
    this.render();
  }

  rebuildSegmentsFromRawToolpaths() {
    if (!this.rawNormalizedToolpaths || this.rawNormalizedToolpaths.length === 0) return;
    this.segments = [];
    this.totalCutDistance = 0.0;
    this.totalRapidDistance = 0.0;

    const artW = this.artworkWidth || this.workpiece.width;
    const artH = this.artworkHeight || this.workpiece.height;
    const feed = this.currentFeedSetting || 900;
    const power = this.currentPowerSetting || 280;

    let lastX = 0;
    let lastY = 0;

    for (const poly of this.rawNormalizedToolpaths) {
      if (!poly || poly.length < 2) continue;

      // Rapid to start of polyline (normalized coordinates 0..1 centered on substrate)
      const startX = (poly[0][0] - 0.5) * artW;
      const startY = (poly[0][1] - 0.5) * artH;
      const rapidDist = Math.hypot(startX - lastX, startY - lastY);
      
      this.segments.push({
        type: 'move',
        x0: lastX,
        y0: lastY,
        x1: startX,
        y1: startY,
        dist: rapidDist,
        feed: 2500,
        power: 0
      });
      this.totalRapidDistance += rapidDist;
      lastX = startX;
      lastY = startY;

      // Cutting moves
      for (let i = 1; i < poly.length; i++) {
        const cx = (poly[i][0] - 0.5) * artW;
        const cy = (poly[i][1] - 0.5) * artH;
        const cutDist = Math.hypot(cx - lastX, cy - lastY);

        this.segments.push({
          type: 'cut',
          x0: lastX,
          y0: lastY,
          x1: cx,
          y1: cy,
          dist: cutDist,
          feed: feed,
          power: power
        });
        this.totalCutDistance += cutDist;
        lastX = cx;
        lastY = cy;
      }
    }
  }

  // Load vector toolpaths from BedVisualizer (array of normalized 0-1 polylines)
  loadNormalizedToolpaths(toolpaths, feed = 900, power = 280, artW, artH) {
    this.rawNormalizedToolpaths = toolpaths;
    this.currentFeedSetting = feed;
    this.currentPowerSetting = power;
    if (artW && artW > 0) this.artworkWidth = artW;
    if (artH && artH > 0) this.artworkHeight = artH;

    this.rebuildSegmentsFromRawToolpaths();
    if (!toolpaths || toolpaths.length === 0) {
      this.reset();
      return;
    }

    // Calculate realistic estimated time (seconds)
    const cutTime = this.segments
      .filter(s => s.type === 'cut')
      .reduce((sum, s) => sum + (s.dist / (s.feed / 60)), 0);
    const rapidTime = this.segments
      .filter(s => s.type === 'move')
      .reduce((sum, s) => sum + (s.dist / (s.feed / 60)), 0);
    this.estimatedTotalTime = cutTime + rapidTime;

    this.reset();
  }

  // Load raw G-code parsed segments
  loadGcodeSegments(parsedSegments) {
    this.segments = parsedSegments || [];
    this.totalCutDistance = 0.0;
    this.totalRapidDistance = 0.0;

    for (const s of this.segments) {
      if (s.type === 'cut') this.totalCutDistance += s.dist;
      else this.totalRapidDistance += s.dist;
    }

    const cutTime = this.segments
      .filter(s => s.type === 'cut')
      .reduce((sum, s) => sum + (s.dist / ((s.feed || 900) / 60)), 0);
    const rapidTime = this.segments
      .filter(s => s.type === 'move')
      .reduce((sum, s) => sum + (s.dist / ((s.feed || 2500) / 60)), 0);
    this.estimatedTotalTime = cutTime + rapidTime;

    this.reset();
  }

  // Convert workpiece coordinates (centered at 0,0 mm) to Canvas pixels
  mmToCanvas(x, y) {
    const cx = this.displayWidth / 2;
    const cy = this.displayHeight / 2;

    // Fit workpiece nicely on canvas with padding
    const maxDim = Math.max(this.workpiece.width, this.workpiece.height, 40.0);
    const availDim = Math.min(this.displayWidth, this.displayHeight) * 0.72;
    const scale = availDim / maxDim;

    return {
      x: cx + x * scale,
      y: cy + y * scale,
      scale: scale
    };
  }

  // --- Procedural Substrate Texture Generator ---
  generateSubstrateTexture() {
    const ctx = this.substrateCtx;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const mat = this.materials[this.currentMaterial];

    ctx.clearRect(0, 0, w, h);

    // 1. Studio Backdrop (Dark industrial bench)
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h));
    bgGrad.addColorStop(0, '#151821');
    bgGrad.addColorStop(1, '#090b0e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle alignment grid on workbench
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy < h; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // 2. Substrate Workpiece Geometry
    const center = this.mmToCanvas(0, 0);
    const hw = (this.workpiece.width / 2) * center.scale;
    const hh = (this.workpiece.height / 2) * center.scale;

    ctx.save();
    ctx.translate(center.x, center.y);

    // Soft drop shadow under substrate
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 12;

    ctx.beginPath();
    if (this.workpiece.shape === 'round') {
      const radius = Math.min(hw, hh);
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    } else {
      const r = 8;
      ctx.roundRect(-hw, -hh, hw * 2, hh * 2, r);
    }
    ctx.fillStyle = mat.baseColor;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Clip texture inside workpiece boundary
    ctx.clip();

    // Material-specific shaders
    if (this.currentMaterial === 'wood') {
      this.renderWoodShader(ctx, hw, hh);
    } else if (this.currentMaterial === 'acrylic') {
      this.renderAcrylicShader(ctx, hw, hh);
    } else if (this.currentMaterial === 'glass') {
      this.renderGlassShader(ctx, hw, hh);
    } else if (this.currentMaterial === 'metal') {
      this.renderMetalShader(ctx, hw, hh);
    }

    // Workpiece Edge Highlight / Chamfer Ring
    ctx.restore();

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.beginPath();
    if (this.workpiece.shape === 'round') {
      const radius = Math.min(hw, hh);
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    } else {
      ctx.roundRect(-hw, -hh, hw * 2, hh * 2, 8);
    }
    ctx.strokeStyle = this.currentMaterial === 'acrylic' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2.0;
    ctx.stroke();
    ctx.restore();
  }

  renderWoodShader(ctx, hw, hh) {
    const dim = Math.max(hw, hh) * 2;
    // Base wood warm gradient
    const grad = ctx.createLinearGradient(-hw, -hh, hw, hh);
    grad.addColorStop(0, '#e5c494');
    grad.addColorStop(0.4, '#d8b584');
    grad.addColorStop(0.7, '#e0be8d');
    grad.addColorStop(1, '#cfa875');
    ctx.fillStyle = grad;
    ctx.fillRect(-hw - 10, -hh - 10, dim + 20, dim + 20);

    // Natural wood growth rings and grain lines
    ctx.lineWidth = 1.2;
    for (let r = 15; r < dim * 1.5; r += 7) {
      const alpha = 0.04 + (Math.sin(r * 0.15) + 1) * 0.04;
      ctx.strokeStyle = `rgba(95, 55, 20, ${alpha})`;
      ctx.beginPath();
      // Slightly wavy rings
      for (let th = 0; th < Math.PI * 2; th += 0.2) {
        const wobble = Math.sin(th * 6 + r) * 2.5 + Math.cos(th * 3) * 3;
        const px = (r + wobble) * Math.cos(th) - hw * 0.4;
        const py = (r + wobble) * Math.sin(th) * 0.85 - hh * 0.3;
        if (th === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Micro-fibers (perpendicular fine grain)
    ctx.strokeStyle = 'rgba(70, 40, 10, 0.035)';
    ctx.lineWidth = 0.8;
    for (let i = -hw; i < hw; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, -hh);
      ctx.lineTo(i + (Math.sin(i) * 6), hh);
      ctx.stroke();
    }

    // Subtle edge burn / vignette on wood
    const edgeVignette = ctx.createRadialGradient(0, 0, Math.min(hw, hh) * 0.7, 0, 0, Math.max(hw, hh));
    edgeVignette.addColorStop(0, 'rgba(0,0,0,0)');
    edgeVignette.addColorStop(1, 'rgba(70, 30, 5, 0.25)');
    ctx.fillStyle = edgeVignette;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
  }

  renderAcrylicShader(ctx, hw, hh) {
    const dim = Math.max(hw, hh) * 2;
    // Deep glossy black or smoked acrylic
    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, dim);
    grad.addColorStop(0, '#1a1f29');
    grad.addColorStop(0.6, '#0f1217');
    grad.addColorStop(1, '#080a0d');
    ctx.fillStyle = grad;
    ctx.fillRect(-hw, -hh, dim, dim);

    // Diagonal specular reflection streak
    ctx.save();
    ctx.rotate(-Math.PI / 4);
    const specGrad = ctx.createLinearGradient(-dim, 0, dim, 0);
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    specGrad.addColorStop(0.48, 'rgba(255, 255, 255, 0.03)');
    specGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)');
    specGrad.addColorStop(0.52, 'rgba(255, 255, 255, 0.03)');
    specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = specGrad;
    ctx.fillRect(-dim, -dim, dim * 2, dim * 2);
    ctx.restore();

    // Edge internal glow ring
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.lineWidth = 3;
    if (this.workpiece.shape === 'round') {
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(hw, hh) - 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  renderGlassShader(ctx, hw, hh) {
    const dim = Math.max(hw, hh) * 2;
    // Semi-translucent icy deep float glass
    const grad = ctx.createRadialGradient(0, 0, 20, 0, 0, dim);
    grad.addColorStop(0, '#102224');
    grad.addColorStop(0.7, '#091517');
    grad.addColorStop(1, '#050c0d');
    ctx.fillStyle = grad;
    ctx.fillRect(-hw, -hh, dim, dim);

    // Subtle turquoise / sea-green tinted bevel
    const bevelGrad = ctx.createRadialGradient(0, 0, Math.min(hw, hh) * 0.85, 0, 0, Math.max(hw, hh));
    bevelGrad.addColorStop(0, 'rgba(0, 240, 180, 0)');
    bevelGrad.addColorStop(1, 'rgba(0, 220, 190, 0.28)');
    ctx.fillStyle = bevelGrad;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);

    // Specular light reflection
    const spec = ctx.createLinearGradient(-hw, -hh, hw, hh);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    spec.addColorStop(0.2, 'rgba(255, 255, 255, 0.02)');
    spec.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = spec;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
  }

  renderMetalShader(ctx, hw, hh) {
    const dim = Math.max(hw, hh) * 2;
    // Matte anodized dark metal base
    const grad = ctx.createLinearGradient(-hw, -hh, hw, hh);
    grad.addColorStop(0, '#2d323a');
    grad.addColorStop(0.5, '#1e2127');
    grad.addColorStop(1, '#15171b');
    ctx.fillStyle = grad;
    ctx.fillRect(-hw, -hh, dim, dim);

    // Fine horizontal anisotropic brushing streaks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 0.75;
    for (let y = -hh; y < hh; y += 2) {
      ctx.beginPath();
      ctx.moveTo(-hw, y);
      ctx.lineTo(hw, y);
      ctx.stroke();
    }

    // Metallic sheen gradient
    const sheen = ctx.createLinearGradient(-hw, 0, hw, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0.02)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.09)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
  }

  // --- Burn Marks Accumulation ---
  rebuildBurnCanvasUpToIndex(targetIndex) {
    const bctx = this.burnCtx;
    bctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.segments || this.segments.length === 0) return;

    const limit = Math.min(targetIndex, this.segments.length);
    const mat = this.materials[this.currentMaterial];
    const powerFactor = this.getPowerIntensityFactor();

    // Multi-pass burn rendering for maximum realism
    // Pass 1: Heat-affected zone / amber halo / glow
    bctx.save();
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';

    bctx.strokeStyle = mat.burnHaloColor;
    bctx.lineWidth = 3.5 * mat.burnWidthMultiplier * powerFactor;
    for (let i = 0; i < limit; i++) {
      const seg = this.segments[i];
      if (seg.type !== 'cut') continue;
      const p0 = this.mmToCanvas(seg.x0, seg.y0);
      const p1 = this.mmToCanvas(seg.x1, seg.y1);
      bctx.beginPath();
      bctx.moveTo(p0.x, p0.y);
      bctx.lineTo(p1.x, p1.y);
      bctx.stroke();
    }

    // Pass 2: Core crisp groove / frosted line / ablated metal
    bctx.strokeStyle = mat.burnColor;
    bctx.lineWidth = 1.6 * mat.burnWidthMultiplier * powerFactor;
    bctx.shadowColor = mat.burnGlow;
    bctx.shadowBlur = this.currentMaterial === 'acrylic' ? 6 : 2;

    for (let i = 0; i < limit; i++) {
      const seg = this.segments[i];
      if (seg.type !== 'cut') continue;
      const p0 = this.mmToCanvas(seg.x0, seg.y0);
      const p1 = this.mmToCanvas(seg.x1, seg.y1);
      bctx.beginPath();
      bctx.moveTo(p0.x, p0.y);
      bctx.lineTo(p1.x, p1.y);
      bctx.stroke();
    }
    bctx.restore();
  }

  getPowerIntensityFactor() {
    const p = this.currentPowerSetting || 280;
    const f = this.currentFeedSetting || 900;
    // Energy per mm factor: scaled to reference (P280, F900)
    const energy = (p / 280) * (900 / Math.max(150, f));
    return Math.max(0.4, Math.min(2.4, Math.sqrt(energy)));
  }

  setLaserParameters(feed, power, passes = 1) {
    if (feed && feed > 0) this.currentFeedSetting = feed;
    if (power !== undefined && power >= 0) this.currentPowerSetting = power;
    this.currentPasses = passes || 1;
    this.rebuildSegmentsFromRawToolpaths();
    this.rebuildBurnCanvasUpToIndex(this.currentSegmentIndex);
    this.render();
  }

  appendBurnSegment(x0, y0, x1, y1) {
    const bctx = this.burnCtx;
    const mat = this.materials[this.currentMaterial];
    const powerFactor = this.getPowerIntensityFactor();
    const p0 = this.mmToCanvas(x0, y0);
    const p1 = this.mmToCanvas(x1, y1);

    bctx.save();
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';

    // 1. Halo
    bctx.strokeStyle = mat.burnHaloColor;
    bctx.lineWidth = 3.5 * mat.burnWidthMultiplier * powerFactor;
    bctx.beginPath();
    bctx.moveTo(p0.x, p0.y);
    bctx.lineTo(p1.x, p1.y);
    bctx.stroke();

    // 2. Core
    bctx.strokeStyle = mat.burnColor;
    bctx.lineWidth = 1.6 * mat.burnWidthMultiplier * powerFactor;
    bctx.shadowColor = mat.burnGlow;
    bctx.shadowBlur = this.currentMaterial === 'acrylic' ? 6 : 2;
    bctx.beginPath();
    bctx.moveTo(p0.x, p0.y);
    bctx.lineTo(p1.x, p1.y);
    bctx.stroke();

    bctx.restore();
  }

  // --- Virtual Laser Head & Beam Animation ---
  renderLaserHead(ctx, headPx) {
    // If simulation finished or instant result active, park head away to keep view 100% pristine
    if (!this.isPlaying && this.currentSegmentIndex >= this.segments.length && this.segments.length > 0) {
      return; // Head parked off-canvas for unobstructed viewing of finished engraving
    }

    const mat = this.materials[this.currentMaterial];
    const x = headPx.x;
    const y = headPx.y;

    // Laser Carriage Shroud (Falcon 5W compact module - NO full-width horizontal bars)
    ctx.save();
    ctx.translate(x, y - 38);

    // Carriage Body
    ctx.fillStyle = '#1e222d';
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 10;
    ctx.roundRect(-22, -18, 44, 38, 4);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';

    // Aluminum Heatsink Fins
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.2;
    for (let f = -16; f <= 16; f += 4) {
      ctx.beginPath();
      ctx.moveTo(f, -12);
      ctx.lineTo(f, 10);
      ctx.stroke();
    }

    // Status LED on Laser Module
    ctx.fillStyle = this.isLaserFiring ? '#00e5ff' : '#ff9100';
    ctx.shadowColor = this.isLaserFiring ? '#00e5ff' : '#ff9100';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, -10, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Brass Air Assist Nozzle Tip
    ctx.fillStyle = '#d4af37';
    ctx.beginPath();
    ctx.moveTo(-5, 20);
    ctx.lineTo(5, 20);
    ctx.lineTo(2, 28);
    ctx.lineTo(-2, 28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. Laser Beam Cone & Focal Point
    const nozzleTipY = y - 10;
    if (this.isLaserFiring) {
      // 450nm Deep Blue Laser Beam Cone
      ctx.save();
      const beamGrad = ctx.createLinearGradient(x, nozzleTipY, x, y);
      beamGrad.addColorStop(0, 'rgba(0, 229, 255, 0.9)');
      beamGrad.addColorStop(0.7, 'rgba(80, 140, 255, 0.85)');
      beamGrad.addColorStop(1, '#ffffff');

      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, nozzleTipY);
      ctx.lineTo(x + 2.5, nozzleTipY);
      ctx.lineTo(x + 0.5, y);
      ctx.lineTo(x - 0.5, y);
      ctx.closePath();
      ctx.fill();

      // Intense focal burning core
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 2.0, 0, Math.PI * 2);
      ctx.fill();

      // Burning molten ring
      ctx.strokeStyle = '#ff9100';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4.5 + Math.sin(Date.now() * 0.02) * 1.0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Spawn Sparks
      if (mat.sparks && Math.random() < 0.45) {
        this.spawnSparks(x, y);
      }
    } else {
      // Low-power red/cyan guide dot
      ctx.save();
      ctx.fillStyle = 'rgba(255, 40, 40, 0.85)';
      ctx.shadowColor = '#ff2828';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 4. Update and Render Spark Particles
    this.renderSparks(ctx);
  }

  spawnSparks(x, y) {
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI * (0.2 + Math.random() * 0.6); // upward arc
      const speed = 1.5 + Math.random() * 3.5;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.04 + Math.random() * 0.06,
        color: Math.random() > 0.4 ? '#ff9100' : '#ffffff'
      });
    }
  }

  renderSparks(ctx) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.life -= p.decay;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // --- Main Render Frame ---
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

    // 1. Draw Substrate Base & Texture
    ctx.drawImage(this.substrateCanvas, 0, 0, this.displayWidth, this.displayHeight);

    // 2. Draw Accumulated Burn Marks
    ctx.drawImage(this.burnCanvas, 0, 0, this.displayWidth, this.displayHeight);

    // 3. Draw Laser Head & Beam at Current Position
    const headPx = this.mmToCanvas(this.currentHeadPos.x, this.currentHeadPos.y);
    this.renderLaserHead(ctx, headPx);

    // 4. Floating HUD Badge (Simulated Progress, Coordinates, Feedrate, Power)
    this.renderHUD(ctx);
  }

  renderHUD(ctx) {
    const pct = this.getProgressPercent();
    const mat = this.materials[this.currentMaterial];

    ctx.save();
    ctx.font = '10px JetBrains Mono, monospace';

    // Left HUD Box: Coordinates & Machine State
    const boxW = 210;
    const boxH = 46;
    const boxX = 14;
    const boxY = 14;

    ctx.fillStyle = 'rgba(17, 20, 29, 0.85)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#00e5ff';
    ctx.fillText(`SIMULATED FALCON 5W [${this.speedMultiplier}x]`, boxX + 10, boxY + 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`X: ${this.currentHeadPos.x.toFixed(1)} mm | Y: ${this.currentHeadPos.y.toFixed(1)} mm`, boxX + 10, boxY + 30);
    ctx.fillStyle = this.isLaserFiring ? '#ff9100' : '#888888';
    ctx.fillText(`LASER: ${this.isLaserFiring ? `ON (S${this.currentPower})` : 'OFF (M5)'} | F${this.currentFeed}`, boxX + 10, boxY + 42);

    // Right HUD Box: Progress & Material
    const rBoxW = 180;
    const rBoxX = this.displayWidth - rBoxW - 14;
    ctx.fillStyle = 'rgba(17, 20, 29, 0.85)';
    ctx.strokeStyle = 'rgba(255, 145, 0, 0.3)';
    ctx.roundRect(rBoxX, boxY, rBoxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff9100';
    ctx.fillText(`SUBSTRATE: ${this.currentMaterial.toUpperCase()}`, rBoxX + 10, boxY + 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`PROGRESS: ${pct.toFixed(1)}%`, rBoxX + 10, boxY + 30);
    const elapsedM = Math.floor(this.accumulatedSimulatedTime / 60);
    const elapsedS = Math.floor(this.accumulatedSimulatedTime % 60);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(`SIM TIME: ${elapsedM}m ${elapsedS}s`, rBoxX + 10, boxY + 42);

    ctx.restore();
  }

  getProgressPercent() {
    if (!this.segments || this.segments.length === 0) return 0;
    return (this.currentSegmentIndex / this.segments.length) * 100;
  }

  // --- Playback Control Methods ---
  play() {
    if (this.isPlaying) return;
    if (this.currentSegmentIndex >= this.segments.length - 1) {
      this.reset();
    }
    this.isPlaying = true;
    this.lastFrameTimestamp = performance.now();
    this.loop();
  }

  pause() {
    this.isPlaying = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.isLaserFiring = false;
    this.render();
  }

  reset() {
    this.pause();
    this.currentSegmentIndex = 0;
    this.currentSegmentProgress = 0.0;
    this.accumulatedSimulatedTime = 0.0;
    this.burnCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.segments && this.segments.length > 0) {
      this.currentHeadPos = { x: this.segments[0].x0, y: this.segments[0].y0 };
      this.currentPower = this.segments[0].power || 0;
      this.currentFeed = this.segments[0].feed || 0;
    } else {
      this.currentHeadPos = { x: 0.0, y: 0.0 };
      this.currentPower = 0;
      this.currentFeed = 0;
    }
    this.isLaserFiring = false;
    this.render();
    if (this.onProgressUpdate) this.onProgressUpdate(0, this.accumulatedSimulatedTime);
  }

  setSpeed(multiplier) {
    this.speedMultiplier = Math.max(1.0, multiplier);
  }

  scrubToPercent(pct) {
    this.pause();
    const clamped = Math.max(0, Math.min(100, pct));
    const targetIdx = Math.floor((clamped / 100) * (this.segments.length - 1));
    this.currentSegmentIndex = targetIdx;
    this.currentSegmentProgress = 0.0;

    // Recalculate accumulated time up to target index
    let accTime = 0;
    for (let i = 0; i < targetIdx; i++) {
      const s = this.segments[i];
      accTime += s.dist / ((s.feed || 900) / 60);
    }
    this.accumulatedSimulatedTime = accTime;

    if (this.segments[targetIdx]) {
      this.currentHeadPos = { x: this.segments[targetIdx].x0, y: this.segments[targetIdx].y0 };
      this.currentPower = this.segments[targetIdx].power;
      this.currentFeed = this.segments[targetIdx].feed;
      this.isLaserFiring = this.segments[targetIdx].type === 'cut';
    }

    this.rebuildBurnCanvasUpToIndex(targetIdx);
    this.render();

    if (this.onProgressUpdate) {
      this.onProgressUpdate(clamped, this.accumulatedSimulatedTime);
    }
  }

  renderInstantResult() {
    this.pause();
    this.currentSegmentIndex = this.segments.length;
    this.accumulatedSimulatedTime = this.estimatedTotalTime;
    this.rebuildBurnCanvasUpToIndex(this.segments.length);

    if (this.segments.length > 0) {
      const last = this.segments[this.segments.length - 1];
      this.currentHeadPos = { x: last.x1, y: last.y1 };
    }
    this.isLaserFiring = false;
    this.render();

    if (this.onProgressUpdate) {
      this.onProgressUpdate(100, this.accumulatedSimulatedTime);
    }
  }

  // --- Animation Loop ---
  loop() {
    if (!this.isPlaying) return;

    const now = performance.now();
    const deltaMs = Math.min(100, now - this.lastFrameTimestamp);
    this.lastFrameTimestamp = now;

    // Simulated delta time scaled by speedMultiplier (in seconds)
    const simDeltaSec = (deltaMs / 1000.0) * this.speedMultiplier;
    this.advanceSimulation(simDeltaSec);

    this.render();

    if (this.currentSegmentIndex < this.segments.length) {
      this.animFrameId = requestAnimationFrame(() => this.loop());
    } else {
      this.pause();
      this.isLaserFiring = false;
      this.render();
      if (this.onSimulationComplete) this.onSimulationComplete();
    }
  }

  advanceSimulation(dtSec) {
    if (!this.segments || this.segments.length === 0) return;

    let remainingDt = dtSec;

    while (remainingDt > 0 && this.currentSegmentIndex < this.segments.length) {
      const seg = this.segments[this.currentSegmentIndex];
      const feed = seg.feed || 900; // mm/min
      const speedMmPerSec = feed / 60.0;
      const segDurationSec = seg.dist > 0.001 ? seg.dist / speedMmPerSec : 0.001;

      const neededTime = segDurationSec * (1.0 - this.currentSegmentProgress);

      if (remainingDt >= neededTime) {
        // Complete current segment
        const prevProg = this.currentSegmentProgress;
        this.currentSegmentProgress = 1.0;

        if (seg.type === 'cut') {
          const x0 = seg.x0 + (seg.x1 - seg.x0) * prevProg;
          const y0 = seg.y0 + (seg.y1 - seg.y0) * prevProg;
          this.appendBurnSegment(x0, y0, seg.x1, seg.y1);
        }

        this.currentHeadPos = { x: seg.x1, y: seg.y1 };
        this.accumulatedSimulatedTime += neededTime;
        remainingDt -= neededTime;

        this.currentSegmentIndex++;
        this.currentSegmentProgress = 0.0;
      } else {
        // Partial move along segment
        const deltaProgress = (remainingDt * speedMmPerSec) / (seg.dist || 1.0);
        const nextProgress = Math.min(1.0, this.currentSegmentProgress + deltaProgress);

        const x0 = seg.x0 + (seg.x1 - seg.x0) * this.currentSegmentProgress;
        const y0 = seg.y0 + (seg.y1 - seg.y0) * this.currentSegmentProgress;
        const x1 = seg.x0 + (seg.x1 - seg.x0) * nextProgress;
        const y1 = seg.y0 + (seg.y1 - seg.y0) * nextProgress;

        if (seg.type === 'cut') {
          this.appendBurnSegment(x0, y0, x1, y1);
        }

        this.currentHeadPos = { x: x1, y: y1 };
        this.currentSegmentProgress = nextProgress;
        this.accumulatedSimulatedTime += remainingDt;
        remainingDt = 0;
      }
    }

    if (this.currentSegmentIndex < this.segments.length) {
      const activeSeg = this.segments[this.currentSegmentIndex];
      this.isLaserFiring = activeSeg.type === 'cut';
      this.currentPower = activeSeg.power;
      this.currentFeed = activeSeg.feed;
    } else {
      this.isLaserFiring = false;
    }

    if (this.onProgressUpdate) {
      this.onProgressUpdate(this.getProgressPercent(), this.accumulatedSimulatedTime);
    }
  }

  // Export high-resolution PNG snapshot of the simulation
  exportSnapshot(filename = 'falcon_simulation.png') {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.canvas.width;
    exportCanvas.height = this.canvas.height;
    const eCtx = exportCanvas.getContext('2d');

    // Draw Substrate + Burns (exclude laser head and HUD)
    eCtx.drawImage(this.substrateCanvas, 0, 0);
    eCtx.drawImage(this.burnCanvas, 0, 0);

    // Watermark
    eCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    eCtx.font = '14px Outfit, sans-serif';
    eCtx.fillText(`Falcon Laser Studio • ${this.materials[this.currentMaterial].name}`, 20, exportCanvas.height - 20);

    const link = document.createElement('a');
    link.download = filename;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }
}

// Attach globally
window.MaterialSimulator = MaterialSimulator;
