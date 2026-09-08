/**
 * Interactive 2D Bed Visualizer for Falcon Laser Studio.
 * Renders the 400x415 mm work area, the 72x72 cm glass platform base,
 * coordinate grids, draggable workpiece placement, toolpaths, and real-time laser head position.
 * 
 * Features:
 * - Workpiece boundary visible ONLY after loading a file or preset.
 * - Corner Rotate Handles with curved circular arrow icons for rotating with mouse movement to custom angles.
 * - Corner Resize Handles for custom sizing with aspect lock support.
 * - Real-time floating HUD badges for dimensions, angle, and position.
 * - Physical (0,0) Machine Origin Datum Marker.
 */

class BedVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    
    // Machine physical dimensions (mm)
    this.bedWidth = 400.0;
    this.bedHeight = 415.0;
    this.glassWidth = 720.0; // 72 cm black glass base
    this.glassHeight = 720.0;
    
    // View transform (pan & zoom)
    this.scale = 1.2;
    this.panX = 60.0;
    this.panY = 60.0;
    
    // Workpiece State
    this.workpiece = {
      x: 200.0,
      y: 207.5,
      width: 40.0,
      height: 40.0,
      rotation: 0.0, // in degrees 0-360
      visible: false, // ONLY visible after loading an SVG/Image/Preset
      isDragging: false,
      isResizing: false,
      isRotating: false,
      activeCorner: null,
      dragOffsetX: 0,
      dragOffsetY: 0,
      rotateStartAngle: 0,
      rotateStartDeg: 0
    };
    
    // Current toolpaths [[(nx, ny), ...]] normalized 0-1
    this.toolpaths = [];
    this.rasterPreviewImg = null;
    
    // Machine live position
    this.laserPos = { x: 0.0, y: 0.0 };
    this.isAimingDotActive = false;
    this.engraveMode = 'bedScale'; // 'bedScale' or 'aimingDot'
    this.materialAnchor = 'center'; // 'center', 'top-left', 'top-center', 'top-right', 'mid-left', 'mid-right', 'bottom-left', 'bottom-center', 'bottom-right'
    
    // Mouse interaction state
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.currentMouseX = 0;
    this.currentMouseY = 0;
    
    this.initEvents();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Start render loop
    this.render();
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
    if (!container) return;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    this.fitToScreen();
  }

  fitToScreen() {
    const margin = 60;
    const availW = this.canvas.width - margin * 2;
    const availH = this.canvas.height - margin * 2;
    const scaleX = availW / this.bedWidth;
    const scaleY = availH / this.bedHeight;
    this.scale = Math.min(scaleX, scaleY);
    
    // Center bed in viewport
    this.panX = (this.canvas.width - this.bedWidth * this.scale) / 2;
    this.panY = this.canvas.height - (this.canvas.height - this.bedHeight * this.scale) / 2;
    this.render();
  }

  // Machine mm -> Canvas pixels
  mmToCanvas(x, y) {
    const cx = this.panX + x * this.scale;
    const cy = this.panY - y * this.scale;
    return { x: cx, y: cy };
  }

  // Canvas pixels -> Machine mm
  canvasToMm(cx, cy) {
    const x = (cx - this.panX) / this.scale;
    const y = (this.panY - cy) / this.scale;
    return { x, y };
  }

  setWorkpiece(x, y, w, h, rotation = null, visible = true) {
    this.workpiece.x = x;
    this.workpiece.y = y;
    this.workpiece.width = w;
    this.workpiece.height = h;
    if (rotation !== null && !isNaN(rotation)) {
      this.workpiece.rotation = ((rotation % 360) + 360) % 360;
    }
    this.workpiece.visible = visible;
    this.render();
  }

  setRotation(deg) {
    this.workpiece.rotation = ((deg % 360) + 360) % 360;
    this.render();
  }

  setVisible(visible) {
    this.workpiece.visible = visible;
    this.render();
  }

  setToolpaths(paths, makeVisible = true) {
    this.toolpaths = paths || [];
    if (makeVisible && this.toolpaths.length > 0) {
      this.workpiece.visible = true;
    }
    this.render();
  }

  setRasterPreview(img, makeVisible = true) {
    this.rasterPreviewImg = img;
    if (makeVisible && img) {
      this.workpiece.visible = true;
    }
    this.render();
  }

  setLaserPosition(x, y) {
    this.laserPos.x = x;
    this.laserPos.y = y;
    this.render();
  }

  setEngraveAlignmentMode(mode, anchor = 'center') {
    this.engraveMode = mode;
    if (anchor) this.materialAnchor = anchor;
    this.render();
  }

  setMaterialAnchor(anchor) {
    this.materialAnchor = anchor;
    this.render();
  }

  setAimingDot(active) {
    this.isAimingDotActive = !!active;
    this.render();
  }

  getMaterialAnchorPoint() {
    const { center, hw, hh, cos, sin } = this.getWorkpieceCorners();
    let lx = 0, ly = 0;
    const a = this.materialAnchor || 'center';
    if (a === 'top-left') { lx = -hw; ly = -hh; }
    else if (a === 'top-center') { lx = 0; ly = -hh; }
    else if (a === 'top-right') { lx = hw; ly = -hh; }
    else if (a === 'mid-left') { lx = -hw; ly = 0; }
    else if (a === 'mid-right') { lx = hw; ly = 0; }
    else if (a === 'bottom-left') { lx = -hw; ly = hh; }
    else if (a === 'bottom-center') { lx = 0; ly = hh; }
    else if (a === 'bottom-right') { lx = hw; ly = hh; }
    else { lx = 0; ly = 0; } // center

    return {
      x: center.x + (lx * cos - ly * sin),
      y: center.y + (lx * sin + ly * cos)
    };
  }

  // Helper: Get corner points of the rotated workpiece in canvas pixels
  getWorkpieceCorners() {
    const wp = this.workpiece;
    const center = this.mmToCanvas(wp.x, wp.y);
    const hw = (wp.width / 2) * this.scale;
    const hh = (wp.height / 2) * this.scale;
    const rad = (wp.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Local corner offsets relative to center
    // Machine Y is up, Canvas Y is down
    const locals = {
      nw: { x: -hw, y: -hh },
      ne: { x: hw, y: -hh },
      se: { x: hw, y: hh },
      sw: { x: -hw, y: hh }
    };

    const corners = {};
    for (const key in locals) {
      const lx = locals[key].x;
      const ly = locals[key].y;
      corners[key] = {
        x: center.x + (lx * cos - ly * sin),
        y: center.y + (lx * sin + ly * cos),
        localX: lx,
        localY: ly
      };
    }
    return { center, corners, hw, hh, rad, cos, sin };
  }

  // 4 Corner Resize Handles (solid square handles)
  getCornerResizeHandles() {
    const { corners } = this.getWorkpieceCorners();
    return corners;
  }

  // 4 Corner Rotate Handles with curved arrows + 1 Top Stalk Rotate Handle
  getCornerRotateHandles() {
    const { center, hw, hh, rad, cos, sin } = this.getWorkpieceCorners();
    const offsetDist = 18; // outward distance in pixels from corner
    const diag = Math.SQRT2;

    const rotLocals = {
      nw: { x: -hw - (offsetDist / diag), y: -hh - (offsetDist / diag) },
      ne: { x: hw + (offsetDist / diag), y: -hh - (offsetDist / diag) },
      se: { x: hw + (offsetDist / diag), y: hh + (offsetDist / diag) },
      sw: { x: -hw - (offsetDist / diag), y: hh + (offsetDist / diag) },
      topStalk: { x: 0, y: -hh - 24 } // stalk handle 24px above top center
    };

    const rotHandles = {};
    for (const key in rotLocals) {
      const lx = rotLocals[key].x;
      const ly = rotLocals[key].y;
      rotHandles[key] = {
        x: center.x + (lx * cos - ly * sin),
        y: center.y + (lx * sin + ly * cos),
        isStalk: key === 'topStalk'
      };
    }
    return rotHandles;
  }

  // Transform canvas mouse coordinates to workpiece unrotated local coordinates (mm)
  canvasToWorkpieceLocal(mx, my) {
    const { center, rad } = this.getWorkpieceCorners();
    const dx = mx - center.x;
    const dy = my - center.y;
    // Rotate backwards by -rad
    const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
    const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad);
    return { lx, ly, mmX: lx / this.scale, mmY: ly / this.scale };
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const mmPos = this.canvasToMm(mx, my);
      this.currentMouseX = mx;
      this.currentMouseY = my;

      // If workpiece is NOT visible yet (no file loaded), all clicks pan/zoom only!
      if (!this.workpiece.visible) {
        this.isPanning = true;
        this.lastMouseX = mx;
        this.lastMouseY = my;
        return;
      }

      const { center } = this.getWorkpieceCorners();

      // 1. Check if clicked on a Corner Rotate Handle (radius 12px)
      const rotHandles = this.getCornerRotateHandles();
      let clickedRotHandle = null;
      for (const rKey in rotHandles) {
        const hp = rotHandles[rKey];
        if (Math.hypot(mx - hp.x, my - hp.y) <= 12) {
          clickedRotHandle = rKey;
          break;
        }
      }

      if (e.button === 0 && clickedRotHandle) {
        this.workpiece.isRotating = true;
        this.workpiece.rotateStartAngle = Math.atan2(my - center.y, mx - center.x);
        this.workpiece.rotateStartDeg = this.workpiece.rotation;
        return;
      }

      // 2. Check if clicked on a Corner Resize Handle (radius 8px)
      const resizeHandles = this.getCornerResizeHandles();
      let clickedResizeHandle = null;
      for (const hKey in resizeHandles) {
        const hp = resizeHandles[hKey];
        if (Math.hypot(mx - hp.x, my - hp.y) <= 9) {
          clickedResizeHandle = hKey;
          break;
        }
      }

      if (e.button === 0 && clickedResizeHandle) {
        this.workpiece.isResizing = true;
        this.workpiece.activeCorner = clickedResizeHandle;
        return;
      }

      // 3. Check if clicked inside workpiece body
      const { hw, hh } = this.getWorkpieceCorners();
      const local = this.canvasToWorkpieceLocal(mx, my);
      const inside = Math.abs(local.lx) <= hw && Math.abs(local.ly) <= hh;

      if (e.button === 0 && inside) {
        this.workpiece.isDragging = true;
        this.workpiece.dragOffsetX = mmPos.x - this.workpiece.x;
        this.workpiece.dragOffsetY = mmPos.y - this.workpiece.y;
      } else {
        // Pan canvas
        this.isPanning = true;
        this.lastMouseX = mx;
        this.lastMouseY = my;
      }
    });

    window.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.currentMouseX = mx;
      this.currentMouseY = my;
      const mmPos = this.canvasToMm(mx, my);

      // Handle active rotation
      if (this.workpiece.isRotating) {
        const { center } = this.getWorkpieceCorners();
        const currentAngle = Math.atan2(my - center.y, mx - center.x);
        const deltaRad = currentAngle - this.workpiece.rotateStartAngle;
        const deltaDeg = (deltaRad * 180) / Math.PI;
        let newAngle = (this.workpiece.rotateStartDeg + deltaDeg) % 360;

        // Shift key snaps to 15 degree increments
        if (e.shiftKey) {
          newAngle = Math.round(newAngle / 15) * 15;
        }
        newAngle = ((newAngle % 360) + 360) % 360;
        this.workpiece.rotation = Math.round(newAngle * 10) / 10;

        if (window.onWorkpieceRotated) {
          window.onWorkpieceRotated(this.workpiece.rotation);
        }
        this.render();
        return;
      }

      // Handle active resizing
      if (this.workpiece.isResizing) {
        const local = this.canvasToWorkpieceLocal(mx, my);
        let newW = Math.max(5.0, Math.round(Math.abs(local.mmX) * 2 * 10) / 10);
        let newH = Math.max(5.0, Math.round(Math.abs(local.mmY) * 2 * 10) / 10);

        if (window.isAspectLocked && window.isAspectLocked()) {
          const aspect = window.getWorkpieceAspectRatio
            ? window.getWorkpieceAspectRatio()
            : this.workpiece.width / this.workpiece.height;
          newH = Math.round((newW / (aspect || 1.0)) * 10) / 10;
        }

        this.workpiece.width = newW;
        this.workpiece.height = newH;
        if (window.onWorkpieceResized) {
          window.onWorkpieceResized(newW, newH);
        }
        this.render();
        return;
      }

      // Handle active dragging (moving across bed)
      if (this.workpiece.isDragging) {
        let newX = mmPos.x - this.workpiece.dragOffsetX;
        let newY = mmPos.y - this.workpiece.dragOffsetY;

        // Clamp inside bed with margins
        const halfW = this.workpiece.width / 2;
        const halfH = this.workpiece.height / 2;
        newX = Math.max(halfW, Math.min(this.bedWidth - halfW, newX));
        newY = Math.max(halfH, Math.min(this.bedHeight - halfH, newY));

        this.workpiece.x = Math.round(newX * 10) / 10;
        this.workpiece.y = Math.round(newY * 10) / 10;

        if (window.onWorkpieceMoved) {
          window.onWorkpieceMoved(this.workpiece.x, this.workpiece.y);
        }
        this.render();
        return;
      }

      // Handle canvas panning
      if (this.isPanning) {
        this.panX += mx - this.lastMouseX;
        this.panY += my - this.lastMouseY;
        this.lastMouseX = mx;
        this.lastMouseY = my;
        this.render();
        return;
      }

      // Cursor feedback when hovering over elements
      if (!this.workpiece.visible) {
        this.canvas.style.cursor = 'default';
        return;
      }

      // 1. Hovering rotate handles
      const rotHandles = this.getCornerRotateHandles();
      let onRotHandle = false;
      for (const rKey in rotHandles) {
        const hp = rotHandles[rKey];
        if (Math.hypot(mx - hp.x, my - hp.y) <= 12) {
          onRotHandle = true;
          break;
        }
      }
      if (onRotHandle) {
        this.canvas.style.cursor = 'crosshair';
        return;
      }

      // 2. Hovering resize handles
      const resizeHandles = this.getCornerResizeHandles();
      let onResizeHandle = null;
      for (const hKey in resizeHandles) {
        const hp = resizeHandles[hKey];
        if (Math.hypot(mx - hp.x, my - hp.y) <= 9) {
          onResizeHandle = hKey;
          break;
        }
      }
      if (onResizeHandle) {
        this.canvas.style.cursor =
          onResizeHandle === 'nw' || onResizeHandle === 'se'
            ? 'nwse-resize'
            : 'nesw-resize';
        return;
      }

      // 3. Hovering workpiece body
      const { hw, hh } = this.getWorkpieceCorners();
      const local = this.canvasToWorkpieceLocal(mx, my);
      const inside = Math.abs(local.lx) <= hw && Math.abs(local.ly) <= hh;
      this.canvas.style.cursor = inside ? 'move' : 'default';
    });

    window.addEventListener('mouseup', () => {
      const wasTransforming = this.workpiece.isDragging || this.workpiece.isResizing || this.workpiece.isRotating;
      let actionName = 'Transform Artwork';
      if (this.workpiece.isRotating) actionName = `Rotate Artwork (${this.workpiece.rotation.toFixed(1)}°)`;
      else if (this.workpiece.isResizing) actionName = `Resize Artwork (${this.workpiece.width.toFixed(1)}×${this.workpiece.height.toFixed(1)} mm)`;
      else if (this.workpiece.isDragging) actionName = `Move Artwork (${this.workpiece.x.toFixed(1)}, ${this.workpiece.y.toFixed(1)})`;

      this.workpiece.isDragging = false;
      this.workpiece.isResizing = false;
      this.workpiece.isRotating = false;
      this.isPanning = false;
      this.render();

      if (wasTransforming && window.onWorkpieceTransformEnd) {
        window.onWorkpieceTransformEnd(actionName);
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const mmBefore = this.canvasToMm(mx, my);
      this.scale = Math.max(0.2, Math.min(8.0, this.scale * zoomFactor));

      // Keep mouse position anchored
      this.panX = mx - mmBefore.x * this.scale;
      this.panY = my + mmBefore.y * this.scale;
      this.render();
    });
  }

  // Draw a curved circular arrow icon on canvas
  drawCurvedArrow(ctx, cx, cy, radius, startAngle, endAngle, isClockwise = true) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle, !isClockwise);
    ctx.stroke();

    // Arrowhead at endAngle
    const arrowX = cx + radius * Math.cos(endAngle);
    const arrowY = cy + radius * Math.sin(endAngle);
    const tangent = endAngle + (isClockwise ? Math.PI / 2 : -Math.PI / 2);
    const arrowSize = 3.5;

    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(tangent - Math.PI / 6),
      arrowY - arrowSize * Math.sin(tangent - Math.PI / 6)
    );
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(tangent + Math.PI / 6),
      arrowY - arrowSize * Math.sin(tangent + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw 72x72 cm Glass Base Platform Outline
    const glassOffX = -(this.glassWidth - this.bedWidth) / 2;
    const glassOffY = -(this.glassHeight - this.bedHeight) / 2;
    const gTopLeft = this.mmToCanvas(glassOffX, glassOffY + this.glassHeight);
    const gW = this.glassWidth * this.scale;
    const gH = this.glassHeight * this.scale;

    ctx.strokeStyle = 'rgba(255, 145, 0, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(gTopLeft.x, gTopLeft.y, gW, gH);
    ctx.fillStyle = 'rgba(255, 145, 0, 0.02)';
    ctx.fillRect(gTopLeft.x, gTopLeft.y, gW, gH);
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255, 145, 0, 0.55)';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText('720 × 720 mm Black Glass Platform', gTopLeft.x + 10, gTopLeft.y + 18);

    // 2. Draw 400x415 mm Falcon Bed
    const bedTopLeft = this.mmToCanvas(0, this.bedHeight);
    const bedW = this.bedWidth * this.scale;
    const bedH = this.bedHeight * this.scale;

    ctx.fillStyle = '#11141d';
    ctx.fillRect(bedTopLeft.x, bedTopLeft.y, bedW, bedH);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bedTopLeft.x, bedTopLeft.y, bedW, bedH);

    // 2b. Draw Physical (0,0) Machine Origin Datum Marker
    const originP = this.mmToCanvas(0, 0);
    ctx.save();
    ctx.shadowColor = '#ff9100';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#ff9100';
    ctx.lineWidth = 2.0;

    // Outer bullseye ring
    ctx.beginPath();
    ctx.arc(originP.x, originP.y, 14, 0, Math.PI * 2);
    ctx.stroke();

    // Inner bullseye ring
    ctx.beginPath();
    ctx.arc(originP.x, originP.y, 6, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(originP.x - 18, originP.y);
    ctx.lineTo(originP.x + 35, originP.y);
    ctx.moveTo(originP.x, originP.y + 18);
    ctx.lineTo(originP.x, originP.y - 35);
    ctx.stroke();

    // Prominent datum corner bracket
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(originP.x, originP.y - 30);
    ctx.lineTo(originP.x, originP.y);
    ctx.lineTo(originP.x + 30, originP.y);
    ctx.stroke();

    // Origin label badge
    ctx.fillStyle = 'rgba(255, 145, 0, 0.95)';
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillText('⨁ (0,0) MACHINE ORIGIN', originP.x + 20, originP.y - 12);
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
    ctx.fillText('→ +X (Width)', originP.x + 40, originP.y + 14);
    ctx.fillText('↑ +Y (Depth)', originP.x - 4, originP.y - 42);
    ctx.restore();

    // 3. Draw Grid Lines (10mm minor, 50mm major)
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let x = 10; x < this.bedWidth; x += 10) {
      if (x % 50 === 0) continue;
      const p1 = this.mmToCanvas(x, 0);
      const p2 = this.mmToCanvas(x, this.bedHeight);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let y = 10; y < this.bedHeight; y += 10) {
      if (y % 50 === 0) continue;
      const p1 = this.mmToCanvas(0, y);
      const p2 = this.mmToCanvas(this.bedWidth, y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // 50mm major grid & labels
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '9px JetBrains Mono';
    for (let x = 50; x < this.bedWidth; x += 50) {
      const p1 = this.mmToCanvas(x, 0);
      const p2 = this.mmToCanvas(x, this.bedHeight);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.fillText(`${x}`, p1.x - 8, p1.y + 14);
    }
    for (let y = 50; y < this.bedHeight; y += 50) {
      const p1 = this.mmToCanvas(0, y);
      const p2 = this.mmToCanvas(this.bedWidth, y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.fillText(`${y}`, p1.x - 24, p1.y + 4);
    }

    // 4. Draw Center Crosshair of the Bed
    const midX = this.bedWidth / 2;
    const midY = this.bedHeight / 2;
    const centerP = this.mmToCanvas(midX, midY);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerP.x - 20, centerP.y);
    ctx.lineTo(centerP.x + 20, centerP.y);
    ctx.moveTo(centerP.x, centerP.y - 20);
    ctx.lineTo(centerP.x, centerP.y + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // 5. WORKPIECE BOUNDARY & ROTATION / RESIZE TOOLS
    // Workpiece boundary is ONLY rendered after a file or preset is loaded!
    if (!this.workpiece.visible) {
      // Empty Bed Watermark Prompt
      ctx.save();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.28)';
      ctx.font = '12px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        '✦ FALCON LASER BED READY — Drop SVG / Image or Select a Preset to Position Workpiece',
        centerP.x,
        centerP.y - 12
      );
      ctx.font = '10px JetBrains Mono';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillText('Working Envelope: 400 × 415 mm | Platform: 720 × 720 mm', centerP.x, centerP.y + 8);
      ctx.restore();
    } else {
      // RENDER WORKPIECE (ROTATED)
      const wp = this.workpiece;
      const { center, hw, hh, rad } = this.getWorkpieceCorners();
      const wpW = wp.width * this.scale;
      const wpH = wp.height * this.scale;

      ctx.save();
      // Translate to workpiece center and rotate
      ctx.translate(center.x, center.y);
      ctx.rotate(rad); // Correct: rotate in same direction as handle and mouse movement

      // Workpiece Box Fill & Stroke
      ctx.fillStyle = 'rgba(255, 145, 0, 0.12)';
      ctx.fillRect(-hw, -hh, wpW, wpH);
      ctx.strokeStyle = 'rgba(255, 145, 0, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-hw, -hh, wpW, wpH);

      // Workpiece Center Crosshair
      ctx.strokeStyle = 'rgba(255, 145, 0, 0.9)';
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();

      // Toolpaths (Vector)
      if (this.toolpaths && this.toolpaths.length > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        for (const poly of this.toolpaths) {
          if (!poly || poly.length < 2) continue;
          ctx.beginPath();
          for (let i = 0; i < poly.length; i++) {
            // Normalized 0-1 mapped relative to workpiece center (-hw to +hw, -hh to +hh)
            // SVG Y is inverted (0 is top)
            const px = -hw + poly[i][0] * wpW;
            const py = -hh + poly[i][1] * wpH;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }

      // Raster preview image (if loaded)
      if (this.rasterPreviewImg) {
        try {
          ctx.drawImage(this.rasterPreviewImg, -hw, -hh, wpW, wpH);
        } catch (e) {}
      }

      ctx.restore();

      // DRAW ROTATED CONTROLS & HANDLES IN SCREEN SPACE
      const { corners } = this.getWorkpieceCorners();
      const rotHandles = this.getCornerRotateHandles();

      // Dimension & Rotation HUD Label above Workpiece
      const topStalk = rotHandles.topStalk;
      ctx.save();
      ctx.fillStyle = '#ff9100';
      ctx.font = 'bold 10px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${wp.width.toFixed(1)} × ${wp.height.toFixed(1)} mm  |  ⟳ ${wp.rotation.toFixed(1)}°`,
        topStalk.x,
        topStalk.y - 10
      );
      ctx.restore();

      // Top Stalk Connection Line
      const topCenterCanvas = {
        x: (corners.nw.x + corners.ne.x) / 2,
        y: (corners.nw.y + corners.ne.y) / 2
      };
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(topCenterCanvas.x, topCenterCanvas.y);
      ctx.lineTo(topStalk.x, topStalk.y);
      ctx.stroke();
      ctx.restore();

      // 4 Corner Resize Handles (Square badges)
      ctx.fillStyle = '#ff9100';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      for (const hKey in corners) {
        const cp = corners[hKey];
        ctx.fillRect(cp.x - 4, cp.y - 4, 8, 8);
        ctx.strokeRect(cp.x - 4, cp.y - 4, 8, 8);
      }

      // Corner Rotate Handles with Curved Arrows + Top Stalk
      for (const rKey in rotHandles) {
        const rp = rotHandles[rKey];
        ctx.save();
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 6;

        // Badge Circle
        ctx.fillStyle = '#11141d';
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Curved Circular Arrow Icon inside Rotate Handle
        ctx.strokeStyle = '#00e5ff';
        ctx.fillStyle = '#00e5ff';
        ctx.lineWidth = 1.2;
        this.drawCurvedArrow(ctx, rp.x, rp.y, 4.5, -Math.PI / 4, (4 * Math.PI) / 3, true);

        ctx.restore();
      }

      // Real-time floating HUD badge while interacting
      if (this.workpiece.isRotating) {
        ctx.save();
        ctx.fillStyle = 'rgba(17, 20, 29, 0.92)';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1;
        const tipX = this.currentMouseX + 16;
        const tipY = this.currentMouseY - 16;
        ctx.beginPath();
        ctx.roundRect(tipX, tipY - 18, 90, 24, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 11px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(`⟳ ${wp.rotation.toFixed(1)}°`, tipX + 45, tipY - 2);
        ctx.restore();
      } else if (this.workpiece.isResizing) {
        ctx.save();
        ctx.fillStyle = 'rgba(17, 20, 29, 0.92)';
        ctx.strokeStyle = '#ff9100';
        ctx.lineWidth = 1;
        const tipX = this.currentMouseX + 16;
        const tipY = this.currentMouseY - 16;
        ctx.beginPath();
        ctx.roundRect(tipX, tipY - 18, 120, 24, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff9100';
        ctx.font = 'bold 11px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(`📐 ${wp.width.toFixed(1)} × ${wp.height.toFixed(1)} mm`, tipX + 60, tipY - 2);
        ctx.restore();
      } else if (this.workpiece.isDragging) {
        ctx.save();
        ctx.fillStyle = 'rgba(17, 20, 29, 0.92)';
        ctx.strokeStyle = '#ff9100';
        ctx.lineWidth = 1;
        const tipX = this.currentMouseX + 16;
        const tipY = this.currentMouseY - 16;
        ctx.beginPath();
        ctx.roundRect(tipX, tipY - 18, 130, 24, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff9100';
        ctx.font = 'bold 11px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText(`⌖ X:${wp.x.toFixed(1)} Y:${wp.y.toFixed(1)} mm`, tipX + 65, tipY - 2);
        ctx.restore();
      }
    }

    // 5.5 Draw Material Anchor Target Badge if in Aiming Dot Alignment Mode
    if (this.engraveMode === 'aimingDot' && this.workpiece.visible) {
      const anchorPt = this.getMaterialAnchorPoint();
      ctx.save();
      // Pulsing target concentric rings
      ctx.strokeStyle = '#ff1744';
      ctx.fillStyle = 'rgba(255, 23, 68, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ff1744';
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair lines on anchor
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(anchorPt.x - 14, anchorPt.y);
      ctx.lineTo(anchorPt.x + 14, anchorPt.y);
      ctx.moveTo(anchorPt.x, anchorPt.y - 14);
      ctx.lineTo(anchorPt.x, anchorPt.y + 14);
      ctx.stroke();

      // Target Label Badge
      ctx.fillStyle = 'rgba(17, 20, 29, 0.92)';
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 1;
      const tagText = `🎯 ${this.materialAnchor.toUpperCase()}`;
      ctx.font = 'bold 9px JetBrains Mono';
      const textW = ctx.measureText(tagText).width;
      ctx.beginPath();
      ctx.roundRect(anchorPt.x + 12, anchorPt.y - 16, textW + 12, 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff5252';
      ctx.textAlign = 'left';
      ctx.fillText(tagText, anchorPt.x + 18, anchorPt.y - 4);
      ctx.restore();
    }

    // 6. Draw Real-time Laser Head Position
    const lPos = this.mmToCanvas(this.laserPos.x, this.laserPos.y);
    ctx.save();
    if (this.isAimingDotActive) {
      // Powerful glowing red/cyan laser aiming beam
      ctx.shadowColor = '#ff1744';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#ff1744';
      ctx.beginPath();
      ctx.arc(lPos.x, lPos.y, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Outer aiming diode rings
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(lPos.x, lPos.y, 16, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 23, 68, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(lPos.x, lPos.y, 24, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair
      ctx.strokeStyle = 'rgba(255, 23, 68, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(lPos.x - 20, lPos.y);
      ctx.lineTo(lPos.x + 20, lPos.y);
      ctx.moveTo(lPos.x, lPos.y - 20);
      ctx.lineTo(lPos.x, lPos.y + 20);
      ctx.stroke();
    } else {
      // Normal Cyan Gantry Pointer
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(lPos.x, lPos.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair target
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lPos.x, lPos.y, 12, 0, Math.PI * 2);
      ctx.moveTo(lPos.x - 16, lPos.y);
      ctx.lineTo(lPos.x + 16, lPos.y);
      ctx.moveTo(lPos.x, lPos.y - 16);
      ctx.lineTo(lPos.x, lPos.y + 16);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Attach to window
window.BedVisualizer = BedVisualizer;
