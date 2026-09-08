/**
 * Interactive 2D Bed Visualizer for Falcon Laser Studio.
 * Renders the 400x415 mm work area, the 72x72 cm glass platform base,
 * coordinate grids, draggable workpiece placement, toolpaths, and real-time laser head position.
 */

class BedVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    
    // Machine physical dimensions (mm)
    this.bedWidth = 400.0;
    this.bedHeight = 415.0;
    this.glassWidth = 720.0; // 72 cm
    this.glassHeight = 720.0;
    
    // View transform (pan & zoom)
    this.scale = 1.2;
    this.panX = 60.0;
    this.panY = 60.0;
    
    // Workpiece
    this.workpiece = {
      x: 190.0,
      y: 190.0,
      width: 40.0,
      height: 40.0,
      isDragging: false,
      dragOffsetX: 0,
      dragOffsetY: 0
    };
    
    // Current toolpaths [[(nx, ny), ...]] normalized 0-1
    this.toolpaths = [];
    this.rasterPreviewImg = null;
    
    // Machine live position
    this.laserPos = { x: 0.0, y: 0.0 };
    
    // Mouse state
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    
    this.initEvents();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Start render loop
    this.render();
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
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
    
    // Center bed
    this.panX = (this.canvas.width - this.bedWidth * this.scale) / 2;
    this.panY = this.canvas.height - (this.canvas.height - this.bedHeight * this.scale) / 2;
    this.render();
  }

  // Coordinate transforms (Machine mm -> Canvas pixels, and vice versa)
  mmToCanvas(x, y) {
    // Machine origin (0,0) is bottom-left
    const cx = this.panX + x * this.scale;
    const cy = this.panY - y * this.scale;
    return { x: cx, y: cy };
  }

  canvasToMm(cx, cy) {
    const x = (cx - this.panX) / this.scale;
    const y = (this.panY - cy) / this.scale;
    return { x, y };
  }

  setWorkpiece(x, y, w, h) {
    this.workpiece.x = x;
    this.workpiece.y = y;
    this.workpiece.width = w;
    this.workpiece.height = h;
    this.render();
  }

  setToolpaths(paths) {
    this.toolpaths = paths || [];
    this.render();
  }

  getCornerHandles() {
    const wp = this.workpiece;
    const halfW = wp.width / 2;
    const halfH = wp.height / 2;
    return {
      nw: { pt: this.mmToCanvas(wp.x - halfW, wp.y + halfH) },
      ne: { pt: this.mmToCanvas(wp.x + halfW, wp.y + halfH) },
      sw: { pt: this.mmToCanvas(wp.x - halfW, wp.y - halfH) },
      se: { pt: this.mmToCanvas(wp.x + halfW, wp.y - halfH) }
    };
  }

  setLaserPosition(x, y) {
    this.laserPos.x = x;
    this.laserPos.y = y;
    this.render();
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const mmPos = this.canvasToMm(mx, my);
      
      // 1. Check if clicked on a corner resize handle (within 8px)
      const handles = this.getCornerHandles();
      let clickedHandle = null;
      for (const hKey in handles) {
        const hp = handles[hKey].pt;
        if (Math.hypot(mx - hp.x, my - hp.y) <= 9) {
          clickedHandle = hKey;
          break;
        }
      }

      if (e.button === 0 && clickedHandle) {
        this.workpiece.isResizing = true;
        this.workpiece.activeCorner = clickedHandle;
        return;
      }

      // 2. Check if clicked inside workpiece body
      const halfW = this.workpiece.width / 2;
      const halfH = this.workpiece.height / 2;
      const inside = (
        mmPos.x >= this.workpiece.x - halfW &&
        mmPos.x <= this.workpiece.x + halfW &&
        mmPos.y >= this.workpiece.y - halfH &&
        mmPos.y <= this.workpiece.y + halfH
      );
      
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
      const mmPos = this.canvasToMm(mx, my);

      if (this.workpiece.isResizing) {
        const dx = Math.abs(mmPos.x - this.workpiece.x);
        const dy = Math.abs(mmPos.y - this.workpiece.y);
        let newW = Math.max(5.0, Math.round(dx * 2 * 10) / 10);
        let newH = Math.max(5.0, Math.round(dy * 2 * 10) / 10);
        
        if (window.isAspectLocked && window.isAspectLocked()) {
          const aspect = window.getWorkpieceAspectRatio ? window.getWorkpieceAspectRatio() : (this.workpiece.width / this.workpiece.height);
          newH = Math.round((newW / (aspect || 1.0)) * 10) / 10;
        }

        this.workpiece.width = newW;
        this.workpiece.height = newH;
        if (window.onWorkpieceResized) {
          window.onWorkpieceResized(newW, newH);
        }
        this.render();
      } else if (this.workpiece.isDragging) {
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
      } else if (this.isPanning) {
        this.panX += mx - this.lastMouseX;
        this.panY += my - this.lastMouseY;
        this.lastMouseX = mx;
        this.lastMouseY = my;
        this.render();
      } else {
        // Cursor feedback
        const handles = this.getCornerHandles();
        let onHandle = null;
        for (const hKey in handles) {
          const hp = handles[hKey].pt;
          if (Math.hypot(mx - hp.x, my - hp.y) <= 9) {
            onHandle = hKey;
            break;
          }
        }
        if (onHandle === 'nw' || onHandle === 'se') {
          this.canvas.style.cursor = 'nwse-resize';
        } else if (onHandle === 'ne' || onHandle === 'sw') {
          this.canvas.style.cursor = 'nesw-resize';
        } else {
          const halfW = this.workpiece.width / 2;
          const halfH = this.workpiece.height / 2;
          const inside = (
            mmPos.x >= this.workpiece.x - halfW &&
            mmPos.x <= this.workpiece.x + halfW &&
            mmPos.y >= this.workpiece.y - halfH &&
            mmPos.y <= this.workpiece.y + halfH
          );
          this.canvas.style.cursor = inside ? 'move' : 'default';
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.workpiece.isDragging = false;
      this.workpiece.isResizing = false;
      this.isPanning = false;
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

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // 1. Draw 72x72 cm Glass Base Platform Outline
    // Assume machine is centered on 72cm plate
    const glassOffX = -(this.glassWidth - this.bedWidth) / 2;
    const glassOffY = -(this.glassHeight - this.bedHeight) / 2;
    const gTopLeft = this.mmToCanvas(glassOffX, glassOffY + this.glassHeight);
    const gW = this.glassWidth * this.scale;
    const gH = this.glassHeight * this.scale;
    
    ctx.strokeStyle = 'rgba(255, 145, 0, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(gTopLeft.x, gTopLeft.y, gW, gH);
    ctx.fillStyle = 'rgba(255, 145, 0, 0.03)';
    ctx.fillRect(gTopLeft.x, gTopLeft.y, gW, gH);
    ctx.setLineDash([]);
    
    ctx.fillStyle = 'rgba(255, 145, 0, 0.6)';
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

    // 3. Draw Grid Lines
    // 10mm grid
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

    // 5. Draw Workpiece Placement
    const wp = this.workpiece;
    const wpX = wp.x - wp.width / 2;
    const wpY = wp.y - wp.height / 2;
    const wpTopLeft = this.mmToCanvas(wpX, wpY + wp.height);
    const wpW = wp.width * this.scale;
    const wpH = wp.height * this.scale;

    // Fill & stroke
    ctx.fillStyle = 'rgba(255, 145, 0, 0.12)';
    ctx.fillRect(wpTopLeft.x, wpTopLeft.y, wpW, wpH);
    ctx.strokeStyle = 'rgba(255, 145, 0, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wpTopLeft.x, wpTopLeft.y, wpW, wpH);

    // Center crosshair in workpiece
    const wpCenter = this.mmToCanvas(wp.x, wp.y);
    ctx.strokeStyle = 'rgba(255, 145, 0, 0.9)';
    ctx.beginPath();
    ctx.moveTo(wpCenter.x - 8, wpCenter.y);
    ctx.lineTo(wpCenter.x + 8, wpCenter.y);
    ctx.moveTo(wpCenter.x, wpCenter.y - 8);
    ctx.lineTo(wpCenter.x, wpCenter.y + 8);
    ctx.stroke();

    // Dimensions text
    ctx.fillStyle = '#ff9100';
    ctx.font = '10px Outfit';
    ctx.fillText(`${wp.width} × ${wp.height} mm`, wpTopLeft.x + 6, wpTopLeft.y - 6);

    // Draw 4 corner resize handles
    const handles = this.getCornerHandles();
    ctx.fillStyle = '#ff9100';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    for (const hKey in handles) {
      const hPt = handles[hKey].pt;
      ctx.fillRect(hPt.x - 4, hPt.y - 4, 8, 8);
      ctx.strokeRect(hPt.x - 4, hPt.y - 4, 8, 8);
    }

    // 6. Draw Vector Toolpaths
    if (this.toolpaths && this.toolpaths.length > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.0;
      for (const poly of this.toolpaths) {
        if (!poly || poly.length < 2) continue;
        ctx.beginPath();
        for (let i = 0; i < poly.length; i++) {
          const px = wpX + poly[i][0] * wp.width;
          const py = wpY + poly[i][1] * wp.height;
          const cPt = this.mmToCanvas(px, py);
          if (i === 0) ctx.moveTo(cPt.x, cPt.y);
          else ctx.lineTo(cPt.x, cPt.y);
        }
        ctx.stroke();
      }
    }

    // 7. Draw Real-time Laser Head Position
    const lPos = this.mmToCanvas(this.laserPos.x, this.laserPos.y);
    ctx.save();
    // Glowing laser dot
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
    ctx.restore();
  }
}
