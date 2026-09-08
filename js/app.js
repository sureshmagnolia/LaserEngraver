/**
 * Falcon Laser Studio - Main Frontend Application Logic.
 * Handles WebSocket telemetry, file ingestion, photo-to-line-art conversion,
 * raster dithering, G-code generation, and real-time machine streaming.
 */

class FalconApp {
  constructor() {
    this.visualizer = new BedVisualizer('bedCanvas');
    this.ws = null;
    
    // Application State
    this.currentMode = 'vector'; // 'vector' or 'raster'
    this.currentFile = null;
    this.fileBase64 = null;
    this.svgXml = null;
    this.currentPaths = [];
    this.currentPresetId = null;
    this.selectedBedMaterial = 'glass';
    this.jogStep = 1.0;

    // Undo / Redo History Stack
    this.history = [];
    this.historyIndex = -1;
    this.isPerformingHistoryAction = false;
    this.autoSaveTimeout = null;
    
    // Wire global callbacks for canvas drag, resize, and rotation
    window.onWorkpieceMoved = (x, y) => {
      const elX = document.getElementById('inputX');
      const elY = document.getElementById('inputY');
      if (elX) elX.value = x.toFixed(1);
      if (elY) elY.value = y.toFixed(1);
    };
    window.onWorkpieceResized = (w, h) => {
      const elW = document.getElementById('inputWidth');
      const elH = document.getElementById('inputHeight');
      if (elW) elW.value = w.toFixed(1);
      if (elH) elH.value = h.toFixed(1);
    };
    window.onWorkpieceRotated = (deg) => {
      const elR = document.getElementById('inputRotation');
      if (elR) elR.value = deg.toFixed(1);
    };
    window.isAspectLocked = () => {
      const el = document.getElementById('checkLockAspect');
      return el ? el.checked : true;
    };
    window.getWorkpieceAspectRatio = () => {
      return this.aspectRatio || (parseFloat(document.getElementById('inputWidth').value) / parseFloat(document.getElementById('inputHeight').value)) || 1.0;
    };

    // Transform completion hook -> pushes to undo stack
    window.onWorkpieceTransformEnd = (action) => {
      this.saveState(action || 'Transform Artwork');
    };

    this.initElements();
    this.initEvents();
    this.initWebSocket();
    this.refreshPorts();
    this.restoreFromLocalStorage();
  }

  initElements() {
    this.btnWebSerial = document.getElementById('btnWebSerial');
    this.portSelect = document.getElementById('portSelect');
    this.btnAutoDetectPort = document.getElementById('btnAutoDetectPort');
    this.btnRefreshPorts = document.getElementById('btnRefreshPorts');
    this.btnConnect = document.getElementById('btnConnect');
    this.btnEmergencyStop = document.getElementById('btnEmergencyStop');
    this.statusBadge = document.getElementById('statusBadge');

    // History & Canvas Item Toolbar buttons
    this.btnUndo = document.getElementById('btnUndo');
    this.btnRedo = document.getElementById('btnRedo');
    this.btnAddCanvasItem = document.getElementById('btnAddCanvasItem');
    this.btnDeleteCanvasItem = document.getElementById('btnDeleteCanvasItem');
    this.btnDeleteWorkpiece = document.getElementById('btnDeleteWorkpiece');
    this.autoSaveIndicator = document.getElementById('autoSaveIndicator');
    this.statusText = document.getElementById('statusText');
    this.hudCoords = document.getElementById('hudCoords');
    this.hudFeedPower = document.getElementById('hudFeedPower');

    // Web Serial Controller
    this.serialController = new WebSerialController();
    this.serialController.onStatus = (status) => this.handleStatusUpdate(status);
    this.serialController.onLog = (msg) => this.log(msg);
    this.hudCoords = document.getElementById('hudCoords');
    this.hudFeedPower = document.getElementById('hudFeedPower');

    // Transforms
    this.btnFlipH = document.getElementById('btnFlipH');
    this.btnFlipV = document.getElementById('btnFlipV');
    this.btnRotateCCW = document.getElementById('btnRotateCCW');
    this.btnRotateCW = document.getElementById('btnRotateCW');
    this.scaleButtons = document.querySelectorAll('.btn-scale');

    // Input & Modes
    this.dropZone = document.getElementById('dropZone');
    this.fileInput = document.getElementById('fileInput');
    this.fileLoadedInfo = document.getElementById('fileLoadedInfo');
    this.loadedFileName = document.getElementById('loadedFileName');
    this.loadedFileMeta = document.getElementById('loadedFileMeta');
    this.btnClearFile = document.getElementById('btnClearFile');
    this.btnModeVector = document.getElementById('btnModeVector');
    this.btnModeRaster = document.getElementById('btnModeRaster');

    // Tabs
    this.tabBedMap = document.getElementById('tabBedMap');
    this.tabPhotoStudio = document.getElementById('tabPhotoStudio');
    this.tabBedScale = document.getElementById('tabBedScale');
    this.viewBedMap = document.getElementById('viewBedMap');
    this.viewPhotoStudio = document.getElementById('viewPhotoStudio');
    this.viewBedScale = document.getElementById('viewBedScale');

    // Bed Scale controls
    this.materialCards = document.querySelectorAll('.material-card');
    this.btnGenerateBedScale = document.getElementById('btnGenerateBedScale');
    this.btnEngraveBedScaleDirect = document.getElementById('btnEngraveBedScaleDirect');
    this.checkScale40mm = document.getElementById('checkScale40mm');
    this.checkScale100mm = document.getElementById('checkScale100mm');
    this.checkScaleRulers = document.getElementById('checkScaleRulers');
    this.checkScaleGrid = document.getElementById('checkScaleGrid');

    // Photo studio controls
    this.vectorTraceControls = document.getElementById('vectorTraceControls');
    this.rasterControls = document.getElementById('rasterControls');
    this.filterAlgorithm = document.getElementById('filterAlgorithm');
    this.sliderDetail = document.getElementById('sliderDetail');
    this.valDetail = document.getElementById('valDetail');
    this.sliderThickness = document.getElementById('sliderThickness');
    this.valThickness = document.getElementById('valThickness');
    this.sliderSmoothing = document.getElementById('sliderSmoothing');
    this.valSmoothing = document.getElementById('valSmoothing');
    this.checkRemoveBg = document.getElementById('checkRemoveBg');
    this.checkInvert = document.getElementById('checkInvert');
    this.btnApplyFilter = document.getElementById('btnApplyFilter');

    // Raster controls
    this.rasterDitherMode = document.getElementById('rasterDitherMode');
    this.sliderContrast = document.getElementById('sliderContrast');
    this.valContrast = document.getElementById('valContrast');
    this.sliderBrightness = document.getElementById('sliderBrightness');
    this.valBrightness = document.getElementById('valBrightness');
    this.sliderInterval = document.getElementById('sliderInterval');
    this.valInterval = document.getElementById('valInterval');
    this.btnApplyRaster = document.getElementById('btnApplyRaster');

    // Image previews
    this.imgOriginalPreview = document.getElementById('imgOriginalPreview');
    this.imgProcessedPreview = document.getElementById('imgProcessedPreview');
    this.placeholderOriginal = document.getElementById('placeholderOriginal');
    this.placeholderProcessed = document.getElementById('placeholderProcessed');
    this.pathCountTag = document.getElementById('pathCountTag');
    this.processedPreviewTitle = document.getElementById('processedPreviewTitle');

    // Transform inputs
    this.inputX = document.getElementById('inputX');
    this.inputY = document.getElementById('inputY');
    this.inputWidth = document.getElementById('inputWidth');
    this.inputHeight = document.getElementById('inputHeight');
    this.inputRotation = document.getElementById('inputRotation');
    this.btnResetRotation = document.getElementById('btnResetRotation');
    this.checkLockAspect = document.getElementById('checkLockAspect');
    this.btnCenterBed = document.getElementById('btnCenterBed');
    this.btnBatch2x2 = document.getElementById('btnBatch2x2');

    // Laser parameters
    this.inputSpeed = document.getElementById('inputSpeed');
    this.inputPower = document.getElementById('inputPower');
    this.inputPasses = document.getElementById('inputPasses');
    this.btnToggleLaserDot = document.getElementById('btnToggleLaserDot');
    this.btnTraceFrame = document.getElementById('btnTraceFrame');

    // Jog controls
    this.btnJogYPlus = document.getElementById('btnJogYPlus');
    this.btnJogXMinus = document.getElementById('btnJogXMinus');
    this.btnHome = document.getElementById('btnHome');
    this.btnJogXPlus = document.getElementById('btnJogXPlus');
    this.btnJogYMinus = document.getElementById('btnJogYMinus');
    this.btnSetZero = document.getElementById('btnSetZero');
    this.stepButtons = document.querySelectorAll('.btn-step');

    // Job Execution
    this.btnGenerateGcode = document.getElementById('btnGenerateGcode');
    this.btnStartJob = document.getElementById('btnStartJob');
    this.btnPauseJob = document.getElementById('btnPauseJob');
    this.btnStopJob = document.getElementById('btnStopJob');
    this.jobProgressBar = document.getElementById('jobProgressBar');
    this.jobProgressPct = document.getElementById('jobProgressPct');
    this.jobEtaText = document.getElementById('jobEtaText');
    this.jobLinesText = document.getElementById('jobLinesText');
    this.jobElapsedText = document.getElementById('jobElapsedText');
    this.footerConsoleMsg = document.getElementById('footerConsoleMsg');
  }

  initEvents() {
    // Mode toggles
    this.btnModeVector.addEventListener('click', () => this.setMode('vector'));
    this.btnModeRaster.addEventListener('click', () => this.setMode('raster'));

    // View Tabs
    this.tabBedMap.addEventListener('click', () => this.switchTab('bedMap'));
    this.tabPhotoStudio.addEventListener('click', () => this.switchTab('photoStudio'));
    this.tabBedScale.addEventListener('click', () => this.switchTab('bedScale'));

    // Material selector for Bed Scale
    this.materialCards.forEach(card => {
      card.addEventListener('click', () => {
        this.materialCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.selectedBedMaterial = card.getAttribute('data-material') || 'glass';
      });
    });

    this.btnGenerateBedScale.addEventListener('click', () => this.generateBedScale(false));
    this.btnEngraveBedScaleDirect.addEventListener('click', () => this.generateBedScale(true));

    // Toolbar History & Canvas Item Actions
    if (this.btnUndo) this.btnUndo.addEventListener('click', () => this.undo());
    if (this.btnRedo) this.btnRedo.addEventListener('click', () => this.redo());
    if (this.btnAddCanvasItem) this.btnAddCanvasItem.addEventListener('click', () => this.fileInput.click());
    if (this.btnDeleteCanvasItem) this.btnDeleteCanvasItem.addEventListener('click', () => this.deleteWorkpiece());
    if (this.btnDeleteWorkpiece) this.btnDeleteWorkpiece.addEventListener('click', () => this.deleteWorkpiece());

    // Global Keyboard Shortcuts (Undo, Redo, Delete)
    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      // Ctrl+Z / Cmd+Z -> Undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          this.undo();
        }
      }
      // Ctrl+Y / Cmd+Y or Ctrl+Shift+Z -> Redo
      else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
               ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        if (!isInput) {
          e.preventDefault();
          this.redo();
        }
      }
      // Delete or Backspace -> Delete artwork from canvas
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        if (this.visualizer && this.visualizer.workpiece.visible) {
          e.preventDefault();
          this.deleteWorkpiece();
        }
      }
    });

    // Toolbar zoom
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      this.visualizer.scale = Math.min(8.0, this.visualizer.scale * 1.2);
      this.visualizer.render();
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      this.visualizer.scale = Math.max(0.2, this.visualizer.scale / 1.2);
      this.visualizer.render();
    });
    document.getElementById('btnResetView').addEventListener('click', () => {
      this.visualizer.fitToScreen();
    });

    // File Drag & Drop
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('dragover');
    });
    this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('dragover'));
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.handleFile(e.dataTransfer.files[0]);
      }
    });
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFile(e.target.files[0]);
      }
    });
    this.btnClearFile.addEventListener('click', () => this.clearFile());

    // Sliders live readout
    this.sliderDetail.addEventListener('input', (e) => this.valDetail.textContent = `${e.target.value}%`);
    this.sliderThickness.addEventListener('input', (e) => this.valThickness.textContent = `${e.target.value} px`);
    this.sliderSmoothing.addEventListener('input', (e) => this.valSmoothing.textContent = e.target.value);
    this.sliderContrast.addEventListener('input', (e) => this.valContrast.textContent = e.target.value);
    this.sliderBrightness.addEventListener('input', (e) => this.valBrightness.textContent = e.target.value);
    this.sliderInterval.addEventListener('input', (e) => this.valInterval.textContent = `${e.target.value} mm`);

    // Process buttons
    this.btnApplyFilter.addEventListener('click', () => this.processPhotoLineArt());
    this.btnApplyRaster.addEventListener('click', () => this.previewRasterDither());

    // Workpiece transform inputs
    const onTransformChange = () => {
      const x = parseFloat(this.inputX.value) || 200;
      const y = parseFloat(this.inputY.value) || 207.5;
      const w = parseFloat(this.inputWidth.value) || 40;
      const h = parseFloat(this.inputHeight.value) || 40;
      const rot = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0;
      this.visualizer.setWorkpiece(x, y, w, h, rot, this.visualizer.workpiece.visible);
    };

    let inputDebounceTimer = null;
    const triggerDebouncedStateSave = (label) => {
      if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
      inputDebounceTimer = setTimeout(() => {
        this.saveState(label);
      }, 500);
    };

    this.inputX.addEventListener('input', onTransformChange);
    this.inputY.addEventListener('input', onTransformChange);
    this.inputWidth.addEventListener('input', () => {
      if (this.checkLockAspect.checked && this.aspectRatio) {
        this.inputHeight.value = (parseFloat(this.inputWidth.value) / this.aspectRatio).toFixed(1);
      }
      onTransformChange();
    });
    this.inputHeight.addEventListener('input', () => {
      if (this.checkLockAspect.checked && this.aspectRatio) {
        this.inputWidth.value = (parseFloat(this.inputHeight.value) * this.aspectRatio).toFixed(1);
      }
      onTransformChange();
    });

    this.inputX.addEventListener('change', () => triggerDebouncedStateSave('Move Artwork (X)'));
    this.inputY.addEventListener('change', () => triggerDebouncedStateSave('Move Artwork (Y)'));
    this.inputWidth.addEventListener('change', () => triggerDebouncedStateSave('Resize Width'));
    this.inputHeight.addEventListener('change', () => triggerDebouncedStateSave('Resize Height'));

    if (this.inputRotation) {
      this.inputRotation.addEventListener('input', () => {
        const deg = parseFloat(this.inputRotation.value) || 0;
        this.visualizer.setRotation(deg);
      });
      this.inputRotation.addEventListener('change', () => triggerDebouncedStateSave('Rotate Angle'));
    }

    if (this.btnResetRotation) {
      this.btnResetRotation.addEventListener('click', () => {
        if (this.inputRotation) this.inputRotation.value = "0.0";
        this.visualizer.setRotation(0);
        this.log('Workpiece rotation reset to 0°.');
        this.saveState('Reset Rotation (0°)');
      });
    }

    if (this.btnAutoDetectPort) {
      this.btnAutoDetectPort.addEventListener('click', () => this.autoDetectLaserPort());
    }

    this.btnCenterBed.addEventListener('click', () => {
      this.inputX.value = "200.0";
      this.inputY.value = "207.5";
      onTransformChange();
      this.saveState('Center on Bed');
    });

    const btnBatch2x2 = document.getElementById('btnBatch2x2');
    if (btnBatch2x2) {
      btnBatch2x2.addEventListener('click', () => {
        if (!this.currentPaths || this.currentPaths.length === 0) {
          alert('Please load an artwork or preset first before creating a 2×2 batch.');
          return;
        }
        const w = parseFloat(this.inputWidth.value) || 40;
        const h = parseFloat(this.inputHeight.value) || 40;
        const batched = [];
        const scale = 0.45;
        const offsets = [[0, 0], [0.55, 0], [0, 0.55], [0.55, 0.55]];
        for (const [ox, oy] of offsets) {
          for (const poly of this.currentPaths) {
            const shifted = poly.map(pt => [pt[0] * scale + ox, pt[1] * scale + oy]);
            batched.push(shifted);
          }
        }
        this.currentPaths = batched;
        const newW = (w * 2).toFixed(1);
        const newH = (h * 2).toFixed(1);
        this.inputWidth.value = newW;
        this.inputHeight.value = newH;
        this.visualizer.setWorkpiece(
          parseFloat(this.inputX.value),
          parseFloat(this.inputY.value),
          parseFloat(newW),
          parseFloat(newH),
          0,
          true
        );
        this.visualizer.setToolpaths(this.currentPaths, true);
        this.log('Arranged 2×2 batch grid (4 items) on bed.');
        this.saveState('2×2 Batch Grid');
      });
    }

    // Transforms: Flip, Rotate, Quick Scale
    this.btnFlipH.addEventListener('click', () => this.flipHorizontal());
    this.btnFlipV.addEventListener('click', () => this.flipVertical());
    this.btnRotateCW.addEventListener('click', () => this.rotateCW());
    this.btnRotateCCW.addEventListener('click', () => this.rotateCCW());
    this.scaleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const factor = parseFloat(btn.getAttribute('data-scale'));
        this.scaleWorkpiece(factor);
      });
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-preset');
        this.loadPreset(pId);
      });
    });

    // Jog Step Size buttons
    this.stepButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.stepButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.jogStep = parseFloat(btn.getAttribute('data-step')) || 1.0;
      });
    });

    // Hardware Jog Actions
    this.btnJogYPlus.addEventListener('click', () => this.jog(0, this.jogStep));
    this.btnJogYMinus.addEventListener('click', () => this.jog(0, -this.jogStep));
    this.btnJogXPlus.addEventListener('click', () => this.jog(this.jogStep, 0));
    this.btnJogXMinus.addEventListener('click', () => this.jog(-this.jogStep, 0));
    this.btnHome.addEventListener('click', () => this.home());
    this.btnSetZero.addEventListener('click', () => this.setZero());

    const btnGoToOrigin = document.getElementById('btnGoToOrigin');
    if (btnGoToOrigin) {
      btnGoToOrigin.addEventListener('click', () => this.goToOrigin());
    }
    const btnHomeDetailed = document.getElementById('btnHomeDetailed');
    if (btnHomeDetailed) {
      btnHomeDetailed.addEventListener('click', () => this.home());
    }

    // Optical Aiming
    this.btnToggleLaserDot.addEventListener('click', () => this.toggleLaserDot());
    this.btnTraceFrame.addEventListener('click', () => this.traceFrame());

    // Connection
    if (this.btnWebSerial) {
      this.btnWebSerial.addEventListener('click', () => this.toggleWebSerial());
      if (!WebSerialController.isSupported()) {
        this.btnWebSerial.title = "Web Serial API not supported in this browser (use Chrome, Edge, or Opera)";
        this.btnWebSerial.style.opacity = "0.5";
      }
    }
    this.btnRefreshPorts.addEventListener('click', () => this.refreshPorts());
    this.btnConnect.addEventListener('click', () => this.toggleConnect());
    this.btnEmergencyStop.addEventListener('click', () => this.emergencyStop());

    // Job Execution
    this.btnGenerateGcode.addEventListener('click', () => this.generateGcode());
    this.btnStartJob.addEventListener('click', () => this.startJob());
    this.btnPauseJob.addEventListener('click', () => this.pauseJob());
    this.btnStopJob.addEventListener('click', () => this.stopJob());
  }

  setMode(mode) {
    this.currentMode = mode;
    if (mode === 'vector') {
      this.btnModeVector.classList.add('active');
      this.btnModeRaster.classList.remove('active');
      this.vectorTraceControls.classList.remove('hidden');
      this.rasterControls.classList.add('hidden');
      this.processedPreviewTitle.textContent = 'Converted Line Drawing';
    } else {
      this.btnModeRaster.classList.add('active');
      this.btnModeVector.classList.remove('active');
      this.rasterControls.classList.remove('hidden');
      this.vectorTraceControls.classList.add('hidden');
      this.processedPreviewTitle.textContent = 'Inkjet Dither Simulation';
      if (this.fileBase64) this.previewRasterDither();
    }
  }

  switchTab(tabId) {
    this.tabBedMap.classList.toggle('active', tabId === 'bedMap');
    this.tabPhotoStudio.classList.toggle('active', tabId === 'photoStudio');
    this.tabBedScale.classList.toggle('active', tabId === 'bedScale');

    this.viewBedMap.classList.toggle('active', tabId === 'bedMap');
    this.viewPhotoStudio.classList.toggle('active', tabId === 'photoStudio');
    this.viewBedScale.classList.toggle('active', tabId === 'bedScale');

    if (tabId === 'bedMap') {
      this.visualizer.resizeCanvas();
    }
  }

  initWebSocket() {
    // Only connect WebSocket if running on local Python server
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return;
    }
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.updateTelemetry(data);
        } catch (err) {
          console.error('WS error:', err);
        }
      };
      this.ws.onclose = () => {
        setTimeout(() => this.initWebSocket(), 3000);
      };
      this.ws.onerror = () => {};
    } catch (e) {}
  }

  updateTelemetry(status) {
    // State badge
    const state = status.state || 'DISCONNECTED';
    this.statusText.textContent = state;
    this.statusBadge.className = 'status-badge';
    if (status.connected) {
      if (state === 'RUN') this.statusBadge.classList.add('running');
      else this.statusBadge.classList.add('connected');
      this.btnConnect.textContent = 'Disconnect';
      this.btnConnect.classList.remove('btn-connect');
      this.btnConnect.classList.add('btn-secondary');
    } else {
      this.statusBadge.classList.add('disconnected');
      this.btnConnect.textContent = 'Connect';
      this.btnConnect.classList.add('btn-connect');
      this.btnConnect.classList.remove('btn-secondary');
    }

    // Coordinates
    const pos = status.wpos || { x: 0, y: 0 };
    this.hudCoords.textContent = `X: ${pos.x.toFixed(2)} | Y: ${pos.y.toFixed(2)}`;
    this.hudFeedPower.textContent = `F: ${status.feed || 0} | S: ${status.spindle || 0}`;

    // Update laser position on canvas
    this.visualizer.setLaserPosition(pos.x, pos.y);

    // Streaming progress
    const st = status.streaming || {};
    if (st.active) {
      this.jobProgressBar.style.width = `${st.progress_pct}%`;
      this.jobProgressPct.textContent = `${st.progress_pct}%`;
      this.jobLinesText.textContent = `Line: ${st.current_line} / ${st.total_lines}`;
      
      const elapsedM = Math.floor(st.elapsed_sec / 60);
      const elapsedS = Math.floor(st.elapsed_sec % 60);
      this.jobElapsedText.textContent = `Elapsed: ${String(elapsedM).padStart(2,'0')}:${String(elapsedS).padStart(2,'0')}`;

      const remM = Math.floor(st.remaining_sec / 60);
      const remS = Math.floor(st.remaining_sec % 60);
      this.jobEtaText.textContent = `ETA: ${String(remM).padStart(2,'0')}:${String(remS).padStart(2,'0')}`;

      this.btnStartJob.disabled = true;
      this.btnPauseJob.disabled = false;
      this.btnStopJob.disabled = false;
      this.btnPauseJob.textContent = st.paused ? '▶ Resume' : '⏸ Pause';
    } else {
      this.btnStartJob.disabled = false;
      this.btnPauseJob.disabled = true;
      this.btnStopJob.disabled = true;
      if (st.total_lines > 0 && st.current_line >= st.total_lines) {
        this.jobProgressBar.style.width = '100%';
        this.jobProgressPct.textContent = '100% Complete';
        this.jobEtaText.textContent = 'Done!';
      }
    }
  }

  async refreshPorts() {
    this.portSelect.innerHTML = '';

    // Auto-detect option
    const autoOpt = document.createElement('option');
    autoOpt.value = 'AUTO';
    autoOpt.textContent = '🔍 Auto-Detect Laser Port';
    this.portSelect.appendChild(autoOpt);

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let autoSelected = false;

    if (isLocalhost) {
      try {
        const res = await fetch('/api/ports');
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = await res.json();
            if (data.ports && data.ports.length > 0) {
              data.ports.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.port;
                const star = p.is_laser ? ' ★ (Falcon Laser)' : '';
                opt.textContent = `${p.port} (${p.description})${star}`;
                if (p.is_laser && !autoSelected) {
                  opt.selected = true;
                  autoSelected = true;
                }
                this.portSelect.appendChild(opt);
              });
            }
          }
        }
      } catch (e) {
        // Local bridge not running
      }
    }

    // Always list common COM ports for quick selection (COM1 to COM12)
    const commonPorts = ['COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'COM10', 'COM11', 'COM12'];
    const existing = new Set(Array.from(this.portSelect.options).map(o => o.value));
    commonPorts.forEach(cp => {
      if (!existing.has(cp)) {
        const opt = document.createElement('option');
        opt.value = cp;
        opt.textContent = `${cp} (Serial Port)`;
        this.portSelect.appendChild(opt);
      }
    });

    // Web Serial Option
    if ('serial' in navigator) {
      const webSerialOpt = document.createElement('option');
      webSerialOpt.value = 'WEB_SERIAL';
      webSerialOpt.textContent = '⚡ Web Serial USB (Direct Browser)';
      this.portSelect.appendChild(webSerialOpt);

      if (!isLocalhost && !autoSelected) {
        this.portSelect.value = 'AUTO';
      }
    }
  }

  async autoDetectLaserPort() {
    this.log('Scanning open ports to auto-identify Creality Falcon laser...');

    // 1. If running in browser with Web Serial support and not localhost
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost && 'serial' in navigator) {
      try {
        await this.toggleWebSerial();
        return;
      } catch (err) {
        this.log(`Web Serial: ${err.message}`);
      }
    }

    // 2. If running locally with Python server
    try {
      this.log('Probing COM ports via local controller bridge...');
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: 'AUTO' })
      });
      const data = await res.json();
      if (data.success) {
        const portName = data.connected_port || 'USB';
        this.log(`Successfully auto-identified and connected to Falcon on ${portName}!`);
        this.btnConnect.textContent = 'Disconnect';
        this.btnConnect.classList.add('btn-active');
        this.statusBadge.className = 'status-badge active';
        this.statusText.textContent = 'CONNECTED';
        if (data.connected_port) {
          this.portSelect.value = data.connected_port;
        }
        return;
      }
    } catch (e) {}

    // 3. Fallback to Web Serial prompt
    if ('serial' in navigator) {
      this.log('Attempting Web Serial USB connection directly in browser...');
      await this.toggleWebSerial();
    } else {
      this.log('Could not auto-detect laser. Please select your COM port or click USB Connect.');
    }
  }

  async toggleConnect() {
    const port = this.portSelect.value || 'AUTO';
    if (this.btnConnect.textContent === 'Connect' || this.btnConnect.textContent === 'Local Bridge') {
      this.log(`Connecting to ${port}...`);
      try {
        const res = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port })
        });
        const data = await res.json();
        if (data.success) {
          this.log(`Successfully connected to ${data.connected_port || port}!`);
          this.btnConnect.textContent = 'Disconnect';
          this.btnConnect.classList.add('btn-active');
          this.statusBadge.className = 'status-badge active';
          this.statusText.textContent = 'CONNECTED';
        } else {
          this.log(`Failed to connect to ${port}. Make sure 24V power and USB cable are plugged in.`);
        }
      } catch (e) {
        this.log(`Connection error: ${e.message}. If using standalone web app, click '⚡ USB Connect'.`);
      }
    } else {
      try {
        await fetch('/api/disconnect', { method: 'POST' });
      } catch (e) {}
      this.btnConnect.textContent = 'Local Bridge';
      this.btnConnect.classList.remove('btn-active');
      this.statusBadge.className = 'status-badge disconnected';
      this.statusText.textContent = 'DISCONNECTED';
      this.log('Disconnected from Falcon.');
    }
  }

  async toggleWebSerial() {
    if (this.serialController.isConnected) {
      await this.serialController.disconnect();
      this.btnWebSerial.textContent = "⚡ USB Connect";
      this.btnWebSerial.classList.remove("btn-active");
      this.statusBadge.className = 'status-badge disconnected';
      this.statusText.textContent = 'DISCONNECTED';
      this.log("USB disconnected.");
    } else {
      try {
        await this.serialController.connect(115200);
        this.btnWebSerial.textContent = "⚡ Disconnect USB";
        this.btnWebSerial.classList.add("btn-active");
        this.statusBadge.className = 'status-badge active';
        this.statusText.textContent = 'USB CONNECTED';
        this.log("Connected to Falcon 5W via Web Serial API!");
      } catch (err) {
        this.log(`Web Serial: ${err.message}`);
      }
    }
  }

  async jog(dx, dy) {
    const feed = parseFloat(this.inputSpeed.value) || 1200;
    if (this.serialController && this.serialController.isConnected) {
      await this.serialController.jog(dx, dy, feed);
      return;
    }
    await fetch('/api/jog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dx, dy, feed })
    });
  }

  async home() {
    if (this.serialController && this.serialController.isConnected) {
      await this.serialController.home();
      return;
    }
    this.log('Executing physical homing ($H)...');
    await fetch('/api/home', { method: 'POST' });
  }

  async setZero() {
    if (this.serialController && this.serialController.isConnected) {
      await this.serialController.setZero();
      return;
    }
    this.log('Set current coordinates as Origin (G92 X0 Y0)');
    await fetch('/api/zero', { method: 'POST' });
  }

  async goToOrigin() {
    if (this.serialController && this.serialController.isConnected) {
      await this.serialController.goToOrigin();
      this.visualizer.setLaserPosition(0, 0);
      return;
    }
    this.log('Moving laser directly to Physical Origin (0,0)...');
    try {
      const res = await fetch('/api/go_to_origin', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.visualizer.setLaserPosition(0, 0);
        this.log('Laser head arrived at Origin (0,0). Aiming dot pulsed on datum mark.');
      } else {
        this.log(`Error moving to origin: ${data.error}`);
      }
    } catch (e) {
      this.log(`Origin navigation error: ${e.message}`);
    }
  }

  async generateBedScale(directStart = false) {
    this.log('Generating precision bed reference scale with (0,0) Origin...');
    try {
      const sizeRadio = document.querySelector('input[name="scaleSize"]:checked');
      const sizeMm = sizeRadio ? parseFloat(sizeRadio.value) : 380.0;
      const material = this.selectedBedMaterial || 'glass';

      const payload = {
        material: material,
        size_mm: sizeMm,
        origin_mode: 'front_left',
        include_40mm: this.checkScale40mm.checked,
        include_100mm: this.checkScale100mm.checked,
        include_rulers: this.checkScaleRulers.checked,
        include_grid: this.checkScaleGrid.checked
      };

      let data = null;
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalhost) {
        try {
          const res = await fetch('/api/generate_bed_scale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) data = await res.json();
        } catch (e) {
          // Local bridge error
        }
      }

      if (!data || !data.success) {
        if (typeof ClientBedScaleGenerator !== 'undefined') {
          data = ClientBedScaleGenerator.generateGridGcode(payload);
        }
      }

      if (data && data.success) {
        this.currentPaths = data.norm_paths;
        this.aspectRatio = 1.0;
        this.inputWidth.value = String(data.size_mm);
        this.inputHeight.value = String(data.size_mm);
        this.inputX.value = (data.size_mm / 2.0).toFixed(1);
        this.inputY.value = (data.size_mm / 2.0).toFixed(1);
        if (this.inputRotation) this.inputRotation.value = "0.0";
        this.inputSpeed.value = String(data.speed);
        this.inputPower.value = String(data.power);

        this.visualizer.setWorkpiece(
          data.size_mm / 2.0,
          data.size_mm / 2.0,
          data.size_mm,
          data.size_mm,
          0.0,
          true
        );
        this.visualizer.setToolpaths(data.norm_paths);
        this.jobLinesText.textContent = `Line: 0 / ${data.line_count}`;
        this.btnStartJob.disabled = false;

        this.switchTab('bedMap');
        this.log(`Bed Scale ready: ${data.line_count} lines on ${data.material_name}. ${data.safety_note}`);
        this.saveState(`Generate Bed Scale (${data.size_mm}mm)`);
        this.queueAutoSave();

        if (directStart) {
          if (material === 'glass') {
            const ok = confirm(`SAFETY CHECK: ${data.safety_note}\n\nHave you applied paper masking tape or black tempera paint to your 72x72 glass platform?\nClick OK to proceed with burning the scale.`);
            if (!ok) return;
          }
          await this.startJob();
        }
      } else {
        this.log(`Error generating bed scale: ${data.error}`);
      }
    } catch (e) {
      this.log(`Bed scale error: ${e.message}`);
    }
  }

  async toggleLaserDot() {
    const res = await fetch('/api/laser_dot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ power: 5 })
    });
    const data = await res.json();
    if (data.laser_dot_on) {
      this.btnToggleLaserDot.style.background = 'rgba(0, 229, 255, 0.3)';
      this.log('Laser aiming dot ON (0.5% power)');
    } else {
      this.btnToggleLaserDot.style.background = '';
      this.log('Laser aiming dot OFF');
    }
  }

  async traceFrame() {
    const x = parseFloat(this.inputX.value);
    const y = parseFloat(this.inputY.value);
    const w = parseFloat(this.inputWidth.value);
    const h = parseFloat(this.inputHeight.value);
    const xmin = x - w / 2;
    const ymin = y - h / 2;
    const xmax = x + w / 2;
    const ymax = y + h / 2;
    
    this.log(`Tracing optical frame around (${xmin.toFixed(1)}, ${ymin.toFixed(1)}) to (${xmax.toFixed(1)}, ${ymax.toFixed(1)})...`);
    await fetch('/api/trace_frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xmin, ymin, xmax, ymax, speed: 1500 })
    });
  }

  async handleFile(file) {
    this.currentFile = file;
    this.loadedFileName.textContent = file.name;
    this.loadedFileMeta.textContent = `${(file.size / 1024).toFixed(1)} KB • ${file.type || 'file'}`;
    this.fileLoadedInfo.classList.remove('hidden');

    if (file.name.toLowerCase().endsWith('.svg')) {
      const text = await file.text();
      this.svgXml = text;
      this.parseSvg(text);
    } else {
      // PNG/JPG
      const reader = new FileReader();
      reader.onload = (e) => {
        this.fileBase64 = e.target.result;
        this.imgOriginalPreview.src = this.fileBase64;
        this.imgOriginalPreview.classList.remove('hidden');
        this.placeholderOriginal.classList.add('hidden');
        
        // Auto-process
        if (this.currentMode === 'vector') {
          this.switchTab('photoStudio');
          this.processPhotoLineArt();
        } else {
          this.switchTab('photoStudio');
          this.previewRasterDither();
        }
      };
      reader.readAsDataURL(file);
    }
  }

  clearFile() {
    this.currentFile = null;
    this.fileBase64 = null;
    this.svgXml = null;
    this.currentPaths = [];
    this.fileLoadedInfo.classList.add('hidden');
    this.imgOriginalPreview.src = '';
    this.imgOriginalPreview.classList.add('hidden');
    this.placeholderOriginal.classList.remove('hidden');
    this.imgProcessedPreview.src = '';
    this.imgProcessedPreview.classList.add('hidden');
    this.placeholderProcessed.classList.remove('hidden');
    this.pathCountTag.classList.add('hidden');
    this.visualizer.setToolpaths([]);
    this.visualizer.setVisible(false);
    this.log('File cleared. Workpiece boundary removed from bed.');
  }

  async parseSvg(xml) {
    this.log('Parsing SVG vectors...');
    try {
      let data = null;
      try {
        const res = await fetch('/api/parse_svg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ svg_xml: xml })
        });
        if (res.ok) data = await res.json();
      } catch (e) {
        // Standalone / GitHub Pages
      }

      if (!data || !data.paths || data.paths.length === 0) {
        data = ClientSvgCompiler.parseSvgXml(xml);
      }

      if (data && data.paths && data.paths.length > 0) {
        this.currentPaths = data.paths;
        this.aspectRatio = data.aspect_ratio || 1.0;
        
        // Adjust height to match aspect
        const w = parseFloat(this.inputWidth.value) || 40;
        this.inputHeight.value = (w / this.aspectRatio).toFixed(1);
        const rot = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0;
        
        this.visualizer.setWorkpiece(
          parseFloat(this.inputX.value),
          parseFloat(this.inputY.value),
          w,
          parseFloat(this.inputHeight.value),
          rot,
          true
        );
        this.visualizer.setToolpaths(this.currentPaths, true);
        this.switchTab('bedMap');
        this.log(`SVG loaded: ${data.path_count} vector paths extracted!`);
        this.saveState(`Load SVG (${this.currentFile ? this.currentFile.name : 'Vector Artwork'})`);
      }
    } catch (e) {
      this.log(`Error parsing SVG: ${e.message}`);
    }
  }

  async processPhotoLineArt() {
    if (!this.fileBase64) return;
    this.log('Processing photo to vector line art...');
    try {
      const payload = {
        image_base64: this.fileBase64,
        mode: this.filterAlgorithm.value,
        remove_bg: this.checkRemoveBg.checked,
        invert: this.checkInvert.checked,
        detail_level: parseInt(this.sliderDetail.value),
        line_thickness: parseInt(this.sliderThickness.value),
        smoothing: parseFloat(this.sliderSmoothing.value)
      };

      let data = null;
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalhost) {
        try {
          const res = await fetch('/api/process_photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              data = await res.json();
            }
          }
        } catch (e) {
          // Local bridge error
        }
      }

      // Standalone browser client fallback
      if (!data || !data.preview) {
        if (typeof ClientPhotoTracer !== 'undefined') {
          data = await ClientPhotoTracer.processImage(this.fileBase64, {
            mode: payload.mode,
            invert: payload.invert,
            remove_bg: payload.remove_bg,
            detail_level: payload.detail_level,
            line_thickness: payload.line_thickness,
            smoothing: payload.smoothing
          });
        }
      }
      
      if (data && data.preview) {
        this.imgProcessedPreview.src = data.preview;
        this.imgProcessedPreview.classList.remove('hidden');
        this.placeholderProcessed.classList.add('hidden');
        this.pathCountTag.textContent = `${data.path_count} Paths`;
        this.pathCountTag.classList.remove('hidden');
        
        this.currentPaths = data.paths;
        this.aspectRatio = data.aspect_ratio || 1.0;
        
        // Ensure workpiece is active and visible on bed
        const w = parseFloat(this.inputWidth.value) || 40;
        this.inputHeight.value = (w / this.aspectRatio).toFixed(1);
        const rot = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0;
        this.visualizer.setWorkpiece(
          parseFloat(this.inputX.value),
          parseFloat(this.inputY.value),
          w,
          parseFloat(this.inputHeight.value),
          rot,
          true
        );
        this.visualizer.setToolpaths(this.currentPaths, true);
        this.log(`Converted to line art: ${data.path_count} paths generated.`);
        this.saveState(`Convert Photo (${this.filterAlgorithm.value})`);
      }
    } catch (e) {
      this.log(`Error processing photo: ${e.message}`);
    }
  }

  async previewRasterDither() {
    if (!this.fileBase64) return;
    this.log('Generating inkjet raster dither simulation...');
    try {
      const payload = {
        image_base64: this.fileBase64,
        mode: this.rasterDitherMode.value,
        invert: this.checkInvert.checked,
        contrast: parseFloat(this.sliderContrast.value),
        brightness: parseInt(this.sliderBrightness.value)
      };

      let data = null;
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalhost) {
        try {
          const res = await fetch('/api/preview_raster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              data = await res.json();
            }
          }
        } catch (e) {}
      }

      if (!data || !data.preview) {
        if (typeof ClientRasterCompiler !== 'undefined' && ClientRasterCompiler.generatePreview) {
          data = await ClientRasterCompiler.generatePreview(this.fileBase64, payload);
        }
      }
      
      if (data && data.preview) {
        this.imgProcessedPreview.src = data.preview;
        this.imgProcessedPreview.classList.remove('hidden');
        this.placeholderProcessed.classList.add('hidden');
        this.pathCountTag.textContent = `${data.width}×${data.height} px`;
        this.pathCountTag.classList.remove('hidden');
        this.aspectRatio = data.aspect_ratio || 1.0;
        const w = parseFloat(this.inputWidth.value) || 40;
        this.inputHeight.value = (w / this.aspectRatio).toFixed(1);
        const rot = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0;
        this.visualizer.setWorkpiece(
          parseFloat(this.inputX.value),
          parseFloat(this.inputY.value),
          w,
          parseFloat(this.inputHeight.value),
          rot,
          true
        );
        this.log('Raster dither preview updated.');
        this.saveState(`Raster Dither (${this.rasterDitherMode.value})`);
      }
    } catch (e) {
      this.log(`Error generating raster preview: ${e.message}`);
    }
  }

  parseGcodeToolpaths(lines) {
    const rawPolys = [];
    let cur = [];
    let curX = 0, curY = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.startsWith(';')) continue;
      const xMatch = l.match(/X([0-9.-]+)/i);
      const yMatch = l.match(/Y([0-9.-]+)/i);
      if (xMatch) curX = parseFloat(xMatch[1]);
      if (yMatch) curY = parseFloat(yMatch[1]);

      if (l.startsWith('G0')) {
        if (cur.length > 1) rawPolys.push(cur);
        cur = [[curX, curY]];
      } else if (l.startsWith('G1')) {
        if (cur.length === 0) cur.push([curX, curY]);
        cur.push([curX, curY]);
        minX = Math.min(minX, curX);
        maxX = Math.max(maxX, curX);
        minY = Math.min(minY, curY);
        maxY = Math.max(maxY, curY);
      }
    }
    if (cur.length > 1) rawPolys.push(cur);
    if (rawPolys.length === 0 || !isFinite(minX)) return [];

    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const normPaths = [];
    for (const poly of rawPolys) {
      normPaths.push(poly.map(pt => [
        (pt[0] - minX) / spanX,
        1.0 - (pt[1] - minY) / spanY
      ]));
    }
    return normPaths;
  }

  async loadPreset(presetId) {
    this.currentPresetId = presetId;
    this.log(`Loading preset: ${presetId}...`);

    const presetMeta = {
      'chittur_4cm': { file: 'presets/keychain_4cm_vector.gcode', w: 35.0, h: 35.0, speed: 900, power: 280 },
      'chittur_10cm': { file: 'presets/keychain_10cm_vector.gcode', w: 90.0, h: 90.0, speed: 1000, power: 320 },
      'bed_scale_200mm': { file: 'presets/black_glass_bed_scale.gcode', w: 200.0, h: 200.0, speed: 800, power: 450 }
    };
    const info = presetMeta[presetId] || { file: 'presets/keychain_4cm_vector.gcode', w: 35.0, h: 35.0, speed: 900, power: 280 };

    this.inputWidth.value = String(info.w);
    this.inputHeight.value = String(info.h);
    this.inputSpeed.value = String(info.speed);
    this.inputPower.value = String(info.power);
    if (this.inputRotation) this.inputRotation.value = "0.0";

    let loadedLines = null;
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    if (isLocalhost) {
      try {
        const res = await fetch('/api/load_preset_gcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: presetId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            this.log(`Preset loaded on local bridge (${data.line_count} lines).`);
          }
        }
      } catch (e) {}
    }

    try {
      const gRes = await fetch(info.file);
      if (gRes.ok) {
        const text = await gRes.text();
        loadedLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      }
    } catch (e) {}

    if (loadedLines && loadedLines.length > 0) {
      this.currentActiveGcode = loadedLines;
      this.jobLinesText.textContent = `Line: 0 / ${loadedLines.length}`;
      this.btnStartJob.disabled = false;
      const paths = this.parseGcodeToolpaths(loadedLines);
      if (paths && paths.length > 0) {
        this.currentPaths = paths;
        this.visualizer.setToolpaths(paths, true);
      }
      this.log(`Preset ${presetId} ready: ${loadedLines.length} G-code lines loaded!`);
    } else {
      this.log(`Preset ${presetId} parameters set.`);
    }

    this.visualizer.setWorkpiece(
      parseFloat(this.inputX.value),
      parseFloat(this.inputY.value),
      info.w,
      info.h,
      0.0,
      true
    );
    this.switchTab('bedMap');
    this.saveState(`Load Preset (${presetId})`);
  }

  async generateGcode() {
    this.log('Generating G-code toolpath...');
    try {
      const payload = {
        job_type: this.currentMode,
        x: parseFloat(this.inputX.value) - parseFloat(this.inputWidth.value) / 2,
        y: parseFloat(this.inputY.value) - parseFloat(this.inputHeight.value) / 2,
        width: parseFloat(this.inputWidth.value),
        height: parseFloat(this.inputHeight.value),
        speed: parseFloat(this.inputSpeed.value),
        power: parseInt(this.inputPower.value),
        passes: parseInt(this.inputPasses.value) || 1
      };

      if (this.currentMode === 'vector') {
        if (!this.currentPaths || this.currentPaths.length === 0) {
          alert('No vector paths loaded. Please upload an SVG or convert a photo first.');
          return;
        }
        payload.paths = this.currentPaths;
      } else {
        if (!this.fileBase64) {
          alert('No image loaded for raster printing.');
          return;
        }
        payload.image_base64 = this.fileBase64;
        payload.interval = parseFloat(this.sliderInterval.value);
        payload.dither_mode = this.rasterDitherMode.value;
        payload.invert = this.checkInvert.checked;
      }

      let data = null;
      try {
        const res = await fetch('/api/generate_gcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) data = await res.json();
      } catch (e) {
        // Standalone / GitHub Pages
      }

      if (!data || !data.success) {
        if (this.currentMode === 'vector') {
          const rotDeg = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0;
          const lines = ClientSvgCompiler.generateVectorGcode({
            norm_paths: this.currentPaths,
            center_x: parseFloat(this.inputX.value),
            center_y: parseFloat(this.inputY.value),
            x_pos: payload.x,
            y_pos: payload.y,
            width_mm: payload.width,
            height_mm: payload.height,
            rotation_deg: rotDeg,
            speed_mm_min: payload.speed,
            power_s: payload.power,
            passes: payload.passes
          });
          data = { success: true, line_count: lines.length, snippet: lines.slice(0, 25) };
          this.currentActiveGcode = lines;
        } else {
          // Client raster dither G-code compilation
          const dither = ClientRasterCompiler.ditherImage(
            this.imgOriginalPreview,
            payload.dither_mode,
            payload.invert,
            parseFloat(this.sliderContrast.value),
            parseInt(this.sliderBrightness.value)
          );
          const lines = ClientRasterCompiler.generateRasterGcode({
            binary: dither.binary,
            width: dither.width,
            height: dither.height,
            x_start: payload.x,
            y_start: payload.y,
            target_width_mm: payload.width,
            target_height_mm: payload.height,
            speed_mm_min: payload.speed,
            max_power_s: payload.power
          });
          data = { success: true, line_count: lines.length, snippet: lines.slice(0, 25) };
          this.currentActiveGcode = lines;
        }
      }

      if (data && data.success) {
        this.log(`G-code generated: ${data.line_count} lines! Ready to stream.`);
        this.jobLinesText.textContent = `Line: 0 / ${data.line_count}`;
        this.btnStartJob.disabled = false;
      } else {
        this.log(`Error generating G-code: ${data ? data.error : 'Unknown'}`);
      }
    } catch (e) {
      this.log(`Error: ${e.message}`);
    }
  }

  async startJob() {
    const jobName = this.currentFile ? this.currentFile.name : (this.currentPresetId || 'Engrave Job');
    if (this.serialController && this.serialController.isConnected) {
      if (!this.currentActiveGcode || this.currentActiveGcode.length === 0) {
        await this.generateGcode();
      }
      if (!this.currentActiveGcode || this.currentActiveGcode.length === 0) {
        alert("Please generate G-code toolpaths first.");
        return;
      }
      this.serialController.streamGcode(this.currentActiveGcode, jobName, (st) => this.handleStatusUpdate(st));
      return;
    }
    this.log(`Starting laser job: ${jobName}...`);
    const res = await fetch('/api/start_job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_name: jobName })
    });
    const data = await res.json();
    if (data.success) {
      this.log(`Streaming started for ${jobName}!`);
    } else {
      alert(data.error || 'Failed to start job.');
    }
  }

  async pauseJob() {
    if (this.serialController && this.serialController.isConnected) {
      this.serialController.pauseStream();
      return;
    }
    await fetch('/api/pause_job', { method: 'POST' });
    this.log('Job paused. Laser turned off safely.');
  }

  async stopJob() {
    if (confirm('Are you sure you want to ABORT the engraving?')) {
      if (this.serialController && this.serialController.isConnected) {
        this.serialController.stopStream();
        return;
      }
      await fetch('/api/stop_job', { method: 'POST' });
      this.log('Job aborted! Soft reset sent to laser.');
    }
  }

  scaleWorkpiece(factor) {
    const curW = parseFloat(this.inputWidth.value) || 40.0;
    const curH = parseFloat(this.inputHeight.value) || 40.0;
    const newW = Math.round(curW * factor * 10) / 10;
    const newH = Math.round(curH * factor * 10) / 10;
    this.inputWidth.value = String(newW);
    this.inputHeight.value = String(newH);
    this.visualizer.setWorkpiece(
      parseFloat(this.inputX.value),
      parseFloat(this.inputY.value),
      newW,
      newH,
      this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0,
      this.visualizer.workpiece.visible
    );
    const sign = factor >= 1.0 ? '+' : '';
    const pct = Math.round((factor - 1.0) * 100);
    this.log(`Scaled workpiece by ${sign}${pct}% to ${newW} × ${newH} mm.`);
    this.saveState(`Scale Artwork (${sign}${pct}%)`);
  }

  transformImage(transformFn) {
    if (!this.fileBase64) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      transformFn(canvas, ctx, img);
      this.fileBase64 = canvas.toDataURL();
      this.imgOriginalPreview.src = this.fileBase64;
      if (this.currentMode === 'vector') {
        this.processPhotoLineArt();
      } else {
        this.previewRasterDither();
      }
    };
    img.src = this.fileBase64;
  }

  flipHorizontal() {
    if (this.currentPaths && this.currentPaths.length > 0) {
      for (const poly of this.currentPaths) {
        for (const pt of poly) {
          pt[0] = Math.round((1.0 - pt[0]) * 10000) / 10000;
        }
      }
      this.visualizer.setToolpaths(this.currentPaths, this.visualizer.workpiece.visible);
    }
    if (this.fileBase64) {
      this.transformImage((canvas, ctx, img) => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.translate(img.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
      });
    }
    this.log('Workpiece flipped horizontally (Mirror X).');
    this.saveState('Flip Horizontal');
  }

  flipVertical() {
    if (this.currentPaths && this.currentPaths.length > 0) {
      for (const poly of this.currentPaths) {
        for (const pt of poly) {
          pt[1] = Math.round((1.0 - pt[1]) * 10000) / 10000;
        }
      }
      this.visualizer.setToolpaths(this.currentPaths, this.visualizer.workpiece.visible);
    }
    if (this.fileBase64) {
      this.transformImage((canvas, ctx, img) => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.translate(0, img.height);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0);
      });
    }
    this.log('Workpiece flipped vertically (Mirror Y).');
    this.saveState('Flip Vertical');
  }

  rotateCW() {
    let cur = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : this.visualizer.workpiece.rotation;
    cur = ((cur + 90) % 360 + 360) % 360;
    if (this.inputRotation) this.inputRotation.value = cur.toFixed(1);
    this.visualizer.setRotation(cur);
    this.log(`Workpiece rotated to ${cur.toFixed(1)}° (+90° CW).`);
    this.saveState(`Rotate CW (${cur.toFixed(1)}°)`);
  }

  rotateCCW() {
    let cur = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : this.visualizer.workpiece.rotation;
    cur = ((cur - 90) % 360 + 360) % 360;
    if (this.inputRotation) this.inputRotation.value = cur.toFixed(1);
    this.visualizer.setRotation(cur);
    this.log(`Workpiece rotated to ${cur.toFixed(1)}° (-90° CCW).`);
    this.saveState(`Rotate CCW (${cur.toFixed(1)}°)`);
  }

  // ==========================================
  // UNDO / REDO HISTORY SYSTEM
  // ==========================================
  saveState(description = 'Edit Artwork') {
    if (this.isPerformingHistoryAction) return;
    if (!this.visualizer) return;

    const snapshot = {
      description,
      timestamp: Date.now(),
      workpiece: {
        x: this.visualizer.workpiece.x,
        y: this.visualizer.workpiece.y,
        width: this.visualizer.workpiece.width,
        height: this.visualizer.workpiece.height,
        rotation: this.visualizer.workpiece.rotation,
        visible: this.visualizer.workpiece.visible
      },
      currentPaths: this.currentPaths ? JSON.parse(JSON.stringify(this.currentPaths)) : [],
      fileBase64: (this.fileBase64 && this.fileBase64.length < 1500000) ? this.fileBase64 : null,
      svgXml: (this.svgXml && this.svgXml.length < 1000000) ? this.svgXml : null,
      fileName: this.currentFile ? this.currentFile.name : (this.currentPresetId || null),
      currentMode: this.currentMode,
      speed: this.inputSpeed ? this.inputSpeed.value : '1200',
      power: this.inputPower ? this.inputPower.value : '350',
      passes: this.inputPasses ? this.inputPasses.value : '1'
    };

    // If we've undone steps and then make a new edit, truncate forward history
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Limit stack depth to 50
    if (this.history.length >= 50) {
      this.history.shift();
    }

    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;
    this.updateHistoryButtons();
    this.queueAutoSave();
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const st = this.history[this.historyIndex];
      this.restoreState(st);
      this.log(`↶ Undo: ${st.description}`);
      this.updateHistoryButtons();
      this.queueAutoSave();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const st = this.history[this.historyIndex];
      this.restoreState(st);
      this.log(`↷ Redo: ${st.description}`);
      this.updateHistoryButtons();
      this.queueAutoSave();
    }
  }

  restoreState(st) {
    if (!st || !st.workpiece) return;
    this.isPerformingHistoryAction = true;
    try {
      // 1. Restore workpiece visualizer
      this.visualizer.setWorkpiece(
        st.workpiece.x,
        st.workpiece.y,
        st.workpiece.width,
        st.workpiece.height,
        st.workpiece.rotation,
        st.workpiece.visible
      );

      // 2. Restore placement inputs
      this.inputX.value = st.workpiece.x.toFixed(1);
      this.inputY.value = st.workpiece.y.toFixed(1);
      this.inputWidth.value = st.workpiece.width.toFixed(1);
      this.inputHeight.value = st.workpiece.height.toFixed(1);
      if (this.inputRotation) {
        this.inputRotation.value = (st.workpiece.rotation || 0).toFixed(1);
      }
      if (st.speed && this.inputSpeed) this.inputSpeed.value = st.speed;
      if (st.power && this.inputPower) this.inputPower.value = st.power;
      if (st.passes && this.inputPasses) this.inputPasses.value = st.passes;

      // 3. Restore toolpaths
      this.currentPaths = st.currentPaths ? JSON.parse(JSON.stringify(st.currentPaths)) : [];
      this.visualizer.setToolpaths(this.currentPaths, st.workpiece.visible);

      // 4. Restore file and images
      this.fileBase64 = st.fileBase64;
      this.svgXml = st.svgXml;

      if (st.fileName && st.workpiece.visible) {
        this.loadedFileName.textContent = st.fileName;
        this.fileLoadedInfo.classList.remove('hidden');
      } else if (!st.workpiece.visible) {
        this.fileLoadedInfo.classList.add('hidden');
      }

      if (st.fileBase64) {
        this.imgOriginalPreview.src = st.fileBase64;
        this.imgOriginalPreview.classList.remove('hidden');
        this.placeholderOriginal.classList.add('hidden');
      } else if (!st.workpiece.visible) {
        this.imgOriginalPreview.src = '';
        this.imgOriginalPreview.classList.add('hidden');
        this.placeholderOriginal.classList.remove('hidden');
      }

      if (st.currentMode && st.currentMode !== this.currentMode) {
        this.setMode(st.currentMode);
      }
    } finally {
      this.isPerformingHistoryAction = false;
    }
  }

  updateHistoryButtons() {
    if (this.btnUndo) this.btnUndo.disabled = (this.historyIndex <= 0);
    if (this.btnRedo) this.btnRedo.disabled = (this.historyIndex >= this.history.length - 1);
  }

  // ==========================================
  // ADD & DELETE CANVAS ITEM
  // ==========================================
  deleteWorkpiece() {
    if (!this.visualizer.workpiece.visible && !this.currentFile && (!this.currentPaths || this.currentPaths.length === 0)) {
      this.log('Canvas is already empty.');
      return;
    }
    this.clearFile();
    this.visualizer.setWorkpiece(200.0, 207.5, 40.0, 40.0, 0.0, false);
    this.visualizer.setToolpaths([]);
    this.currentActiveGcode = null;
    if (this.inputRotation) this.inputRotation.value = "0.0";
    this.saveState('Delete Canvas Item');
    this.queueAutoSave();
    this.log('Artwork removed from canvas. Bed is now empty.');
  }

  // ==========================================
  // LOCAL STORAGE PERSISTENCE (AUTOSAVE)
  // ==========================================
  queueAutoSave() {
    if (this.autoSaveTimeout) clearTimeout(this.autoSaveTimeout);
    if (this.autoSaveIndicator) {
      this.autoSaveIndicator.textContent = '💾 Saving...';
      this.autoSaveIndicator.style.color = '#ffb300';
    }
    this.autoSaveTimeout = setTimeout(() => {
      this.saveToLocalStorage();
    }, 600);
  }

  saveToLocalStorage() {
    try {
      if (!this.visualizer) return;
      const state = {
        version: 1,
        savedAt: Date.now(),
        workpiece: {
          x: this.visualizer.workpiece.x,
          y: this.visualizer.workpiece.y,
          width: this.visualizer.workpiece.width,
          height: this.visualizer.workpiece.height,
          rotation: this.visualizer.workpiece.rotation,
          visible: this.visualizer.workpiece.visible
        },
        currentPaths: (this.currentPaths && this.currentPaths.length < 5000) ? this.currentPaths : [],
        currentMode: this.currentMode,
        fileName: this.currentFile ? this.currentFile.name : (this.currentPresetId || null),
        fileBase64: (this.fileBase64 && this.fileBase64.length < 1000000) ? this.fileBase64 : null,
        svgXml: (this.svgXml && this.svgXml.length < 500000) ? this.svgXml : null,
        speed: this.inputSpeed ? this.inputSpeed.value : '1200',
        power: this.inputPower ? this.inputPower.value : '350',
        passes: this.inputPasses ? this.inputPasses.value : '1',
        lockAspect: this.checkLockAspect ? this.checkLockAspect.checked : true,
        detail: this.sliderDetail ? this.sliderDetail.value : '50',
        thickness: this.sliderThickness ? this.sliderThickness.value : '1',
        smoothing: this.sliderSmoothing ? this.sliderSmoothing.value : '1.0',
        contrast: this.sliderContrast ? this.sliderContrast.value : '1.0',
        brightness: this.sliderBrightness ? this.sliderBrightness.value : '0',
        interval: this.sliderInterval ? this.sliderInterval.value : '0.1'
      };

      localStorage.setItem('falcon_studio_state', JSON.stringify(state));
      if (this.autoSaveIndicator) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.autoSaveIndicator.textContent = `💾 Autosaved (${timeStr})`;
        this.autoSaveIndicator.style.color = '#00e5ff';
      }
    } catch (err) {
      console.warn('[Falcon Studio] Autosave to localStorage failed:', err);
      if (this.autoSaveIndicator) {
        this.autoSaveIndicator.textContent = '💾 Autosave Full';
        this.autoSaveIndicator.style.color = '#ff5252';
      }
    }
  }

  restoreFromLocalStorage() {
    try {
      const raw = localStorage.getItem('falcon_studio_state');
      if (!raw) {
        this.saveState('Initial Clean Bed');
        return;
      }
      const st = JSON.parse(raw);
      if (!st || !st.workpiece) {
        this.saveState('Initial Clean Bed');
        return;
      }

      this.isPerformingHistoryAction = true;
      try {
        if (st.workpiece.visible) {
          this.visualizer.setWorkpiece(
            st.workpiece.x,
            st.workpiece.y,
            st.workpiece.width,
            st.workpiece.height,
            st.workpiece.rotation || 0,
            true
          );
          this.inputX.value = st.workpiece.x.toFixed(1);
          this.inputY.value = st.workpiece.y.toFixed(1);
          this.inputWidth.value = st.workpiece.width.toFixed(1);
          this.inputHeight.value = st.workpiece.height.toFixed(1);
          if (this.inputRotation) this.inputRotation.value = (st.workpiece.rotation || 0).toFixed(1);

          if (st.currentPaths && st.currentPaths.length > 0) {
            this.currentPaths = st.currentPaths;
            this.visualizer.setToolpaths(this.currentPaths, true);
          }
          if (st.fileName) {
            this.loadedFileName.textContent = st.fileName;
            this.fileLoadedInfo.classList.remove('hidden');
          }
          if (st.fileBase64) {
            this.fileBase64 = st.fileBase64;
            this.imgOriginalPreview.src = st.fileBase64;
            this.imgOriginalPreview.classList.remove('hidden');
            this.placeholderOriginal.classList.add('hidden');
          }
          if (st.svgXml) this.svgXml = st.svgXml;
          this.log(`Restored previous canvas session from local storage (${st.fileName || 'Artwork'}).`);
        } else {
          this.visualizer.setWorkpiece(200, 207.5, 40, 40, 0, false);
          this.visualizer.setToolpaths([]);
        }

        if (st.speed && this.inputSpeed) this.inputSpeed.value = st.speed;
        if (st.power && this.inputPower) this.inputPower.value = st.power;
        if (st.passes && this.inputPasses) this.inputPasses.value = st.passes;
        if (st.lockAspect !== undefined && this.checkLockAspect) this.checkLockAspect.checked = st.lockAspect;
        if (st.currentMode) this.setMode(st.currentMode);
      } finally {
        this.isPerformingHistoryAction = false;
      }

      this.saveState(st.workpiece.visible ? 'Restored Workspace' : 'Initial Clean Bed');
      if (this.autoSaveIndicator) {
        this.autoSaveIndicator.textContent = '💾 Session Restored';
      }
    } catch (e) {
      console.warn('[Falcon Studio] Could not restore from localStorage:', e);
      this.saveState('Initial Clean Bed');
    }
  }

  log(msg) {
    this.footerConsoleMsg.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(`[Falcon Studio] ${msg}`);
  }
}

// Boot application when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  window.app = new FalconApp();
});
