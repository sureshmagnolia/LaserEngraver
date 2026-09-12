/**
 * Falcon Laser Studio - Main Frontend Application Logic.
 * Handles WebSocket telemetry, file ingestion, photo-to-line-art conversion,
 * raster dithering, G-code generation, and real-time machine streaming.
 */

class FalconApp {
  constructor() {
    this.visualizer = new BedVisualizer('bedCanvas');
    this.visualizer.onSelectionChanged = (selected) => {
      this.updateSelectionUI(selected);
    };
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
    this.engraveAlignmentMode = 'bedScale'; // 'bedScale' or 'aimingDot'
    this.isAimingDotActive = false;
    this.isVirtualConnected = false;

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
    this.btnAddImage = document.getElementById('btnAddImage') || document.getElementById('btnAddCanvasItem');
    this.btnAddCanvasItem = this.btnAddImage;
    this.btnSelectObject = document.getElementById('btnSelectObject');
    this.btnDeleteSelected = document.getElementById('btnDeleteSelected') || document.getElementById('btnDeleteCanvasItem');
    this.btnDeleteCanvasItem = this.btnDeleteSelected;
    this.btnClearBed = document.getElementById('btnClearBed');
    this.btnClearBedSidebar = document.getElementById('btnClearBedSidebar');
    this.btnDeleteWorkpiece = document.getElementById('btnDeleteWorkpiece');
    this.autoSaveIndicator = document.getElementById('autoSaveIndicator');
    this.statusText = document.getElementById('statusText');
    this.hudCoords = document.getElementById('hudCoords');
    this.hudFeedPower = document.getElementById('hudFeedPower');

    // Engraving Alignment Mode & Aiming Dot elements
    this.btnModeBedScale = document.getElementById('btnModeBedScale');
    this.btnModeAimingDot = document.getElementById('btnModeAimingDot');
    this.modeBedScaleInfo = document.getElementById('modeBedScaleInfo');
    this.modeAimingDotControls = document.getElementById('modeAimingDotControls');
    this.btnAimingDotToggle = document.getElementById('btnAimingDotToggle');
    this.laserDotStatusText = document.getElementById('laserDotStatusText');
    this.selectedAnchorLabel = document.getElementById('selectedAnchorLabel');
    this.anchorButtons = document.querySelectorAll('.btn-anchor');
    this.btnSnapToAimingDot = document.getElementById('btnSnapToAimingDot');
    this.btnTraceMaterialFrame = document.getElementById('btnTraceMaterialFrame');
    this.btnSetDotOriginG92 = document.getElementById('btnSetDotOriginG92');

    // Web Serial Controller
    this.serialController = new WebSerialController();
    this.serialController.onStatus = (status) => this.updateTelemetry(status);
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
    this.tabSimulation = document.getElementById('tabSimulation');
    this.tabPhotoStudio = document.getElementById('tabPhotoStudio');
    this.tabBedScale = document.getElementById('tabBedScale');
    this.viewBedMap = document.getElementById('viewBedMap');
    this.viewSimulation = document.getElementById('viewSimulation');
    this.viewPhotoStudio = document.getElementById('viewPhotoStudio');
    this.viewBedScale = document.getElementById('viewBedScale');

    // Virtual Material & Laser Simulator
    this.simulator = new MaterialSimulator('simCanvas');
    if (this.simulator) {
      this.simulator.onProgressUpdate = (pct, elapsedSec) => {
        if (this.simProgressPct) this.simProgressPct.textContent = `${pct.toFixed(1)}%`;
        if (this.simScrubber && !this.isUserDraggingScrubber) this.simScrubber.value = pct;
        if (this.simTimeDisplay) {
          const em = Math.floor(elapsedSec / 60);
          const es = Math.floor(elapsedSec % 60);
          const tm = Math.floor((this.simulator.estimatedTotalTime || 0) / 60);
          const ts = Math.floor((this.simulator.estimatedTotalTime || 0) % 60);
          this.simTimeDisplay.textContent = `${String(em).padStart(2,'0')}:${String(es).padStart(2,'0')} / ${String(tm).padStart(2,'0')}:${String(ts).padStart(2,'0')}`;
        }
        // Update Live Status HUD and Job Monitor when in Virtual Machine mode
        if (this.isVirtualConnected) {
          if (this.hudCoords) this.hudCoords.textContent = `X: ${this.simulator.currentHeadPos.x.toFixed(1)} | Y: ${this.simulator.currentHeadPos.y.toFixed(1)} (Sim)`;
          if (this.hudFeedPower) this.hudFeedPower.textContent = `F: ${this.simulator.currentFeed} | S: ${this.simulator.isLaserFiring ? this.simulator.currentPower : 0}`;
          if (this.jobProgressBar) this.jobProgressBar.style.width = `${pct}%`;
          if (this.jobProgressPct) this.jobProgressPct.textContent = `${pct.toFixed(1)}% (Virtual)`;
        }
      };
      this.simulator.onSimulationComplete = () => {
        if (this.btnSimPlay) this.btnSimPlay.disabled = false;
        if (this.btnSimPause) this.btnSimPause.disabled = true;
        if (this.btnProceedVirtualEngrave) this.btnProceedVirtualEngrave.disabled = false;
        if (this.isVirtualConnected && this.jobProgressPct) {
          this.jobProgressPct.textContent = '100% (Virtual Finished)';
          if (this.jobEtaText) this.jobEtaText.textContent = 'Done!';
        }
        this.log('Virtual laser simulation finished! Inspect engraved substrate.');
      };
    }

    // Simulation & Virtual Machine Controls
    this.simMaterialSection = document.getElementById('simMaterialSection');
    this.simMatHelpText = document.getElementById('simMatHelpText');
    this.btnProceedVirtualEngrave = document.getElementById('btnProceedVirtualEngrave');
    this.btnSimPlay = document.getElementById('btnSimPlay');
    this.btnSimPause = document.getElementById('btnSimPause');
    this.btnSimReset = document.getElementById('btnSimReset');
    this.btnSimInstant = document.getElementById('btnSimInstant');
    this.simScrubber = document.getElementById('simScrubber');
    this.simProgressPct = document.getElementById('simProgressPct');
    this.simTimeDisplay = document.getElementById('simTimeDisplay');
    this.btnExportSimSnapshot = document.getElementById('btnExportSimSnapshot');
    this.simMaterialButtons = document.querySelectorAll('.sim-mat-card');
    this.simSpeedButtons = document.querySelectorAll('.btn-speed');
    this.simActiveMaterialLabel = document.getElementById('simActiveMaterialLabel');

    // Substrate Dimensions & Shape Controls
    this.btnSimShapeRound = document.getElementById('btnSimShapeRound');
    this.btnSimShapeRect = document.getElementById('btnSimShapeRect');
    this.simMaterialWidth = document.getElementById('simMaterialWidth');
    this.simMaterialHeight = document.getElementById('simMaterialHeight');
    this.simPresetPills = document.querySelectorAll('.sim-preset-pill');
    this.btnSimFitArtwork = document.getElementById('btnSimFitArtwork');

    // Virtual Laser Speed & Power Controls
    this.simInputSpeed = document.getElementById('simInputSpeed');
    this.simInputPower = document.getElementById('simInputPower');
    this.simInputPasses = document.getElementById('simInputPasses');
    this.simPowerPctTag = document.getElementById('simPowerPctTag');
    this.simParamPresetPills = document.querySelectorAll('.sim-param-preset-pill');

    // Pre-Flight Audit Modal Elements
    this.btnTriggerAudit = document.getElementById('btnTriggerAudit');
    this.modalAudit = document.getElementById('modalAudit');
    this.btnCloseAuditModal = document.getElementById('btnCloseAuditModal');
    this.btnCloseAuditFooter = document.getElementById('btnCloseAuditFooter');
    this.btnAuditAutoFit = document.getElementById('btnAuditAutoFit');
    this.btnAuditStartEngrave = document.getElementById('btnAuditStartEngrave');
    this.auditSummaryBanner = document.getElementById('auditSummaryBanner');
    this.auditSummaryIcon = document.getElementById('auditSummaryIcon');
    this.auditSummaryText = document.getElementById('auditSummaryText');
    this.auditChecklist = document.getElementById('auditChecklist');

    // 5-Step Workflow Stepper
    this.workflowStepItems = document.querySelectorAll('.step-item');
    this.step4Title = document.getElementById('step4Title');
    this.step4Sub = document.getElementById('step4Sub');
    this.currentWorkflowStep = 1;

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
    if (this.tabSimulation) this.tabSimulation.addEventListener('click', () => this.switchTab('simulation'));
    this.tabPhotoStudio.addEventListener('click', () => this.switchTab('photoStudio'));
    this.tabBedScale.addEventListener('click', () => this.switchTab('bedScale'));

    // 5-Step Workflow Stepper Navigation
    if (this.workflowStepItems) {
      this.workflowStepItems.forEach(item => {
        item.addEventListener('click', () => {
          const step = parseInt(item.getAttribute('data-step')) || 1;
          this.navigateToWorkflowStep(step);
        });
      });
    }

    // Simulation Controls Events
    if (this.btnSimPlay) {
      this.btnSimPlay.addEventListener('click', () => {
        if (this.simulator) {
          this.simulator.play();
          this.btnSimPlay.disabled = true;
          this.btnSimPause.disabled = false;
        }
      });
    }
    if (this.btnSimPause) {
      this.btnSimPause.addEventListener('click', () => {
        if (this.simulator) {
          this.simulator.pause();
          this.btnSimPlay.disabled = false;
          this.btnSimPause.disabled = true;
        }
      });
    }
    if (this.btnSimReset) {
      this.btnSimReset.addEventListener('click', () => {
        if (this.simulator) {
          this.simulator.reset();
          this.btnSimPlay.disabled = false;
          this.btnSimPause.disabled = true;
        }
      });
    }
    if (this.btnSimInstant) {
      this.btnSimInstant.addEventListener('click', () => {
        if (this.simulator) {
          this.simulator.renderInstantResult();
          this.btnSimPlay.disabled = false;
          this.btnSimPause.disabled = true;
        }
      });
    }
    if (this.btnExportSimSnapshot) {
      this.btnExportSimSnapshot.addEventListener('click', () => {
        if (this.simulator) {
          const name = (this.currentFile ? this.currentFile.name.replace(/\.[^/.]+$/, '') : 'falcon_mockup') + `_${this.simulator.currentMaterial}.png`;
          this.simulator.exportSnapshot(name);
          this.log(`Exported simulation preview mockup snapshot: ${name}`);
        }
      });
    }
    if (this.simSpeedButtons) {
      this.simSpeedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          this.simSpeedButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const speed = parseFloat(btn.getAttribute('data-speed')) || 10;
          if (this.simulator) this.simulator.setSpeed(speed);
        });
      });
    }
    if (this.simScrubber) {
      this.simScrubber.addEventListener('input', (e) => {
        if (this.simulator) {
          this.isUserDraggingScrubber = true;
          this.simulator.scrubToPercent(parseFloat(e.target.value));
          this.btnSimPlay.disabled = false;
          this.btnSimPause.disabled = true;
        }
      });
      this.simScrubber.addEventListener('change', () => {
        this.isUserDraggingScrubber = false;
      });
    }
    // Virtual Falcon Machine Controls & Simulation Gating
    if (this.btnProceedVirtualEngrave) {
      this.btnProceedVirtualEngrave.addEventListener('click', () => this.proceedToVirtualEngrave());
    }

    if (this.simMaterialButtons) {
      this.simMaterialButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const mat = btn.getAttribute('data-sim-material') || 'wood';
          this.setSimulationMaterial(mat);
        });
      });
    }

    // Substrate Dimensions & Shape Controls
    if (this.btnSimShapeRound) {
      this.btnSimShapeRound.addEventListener('click', () => {
        this.setSimulationSubstrateShape('round');
      });
    }
    if (this.btnSimShapeRect) {
      this.btnSimShapeRect.addEventListener('click', () => {
        this.setSimulationSubstrateShape('rect');
      });
    }
    if (this.simMaterialWidth) {
      this.simMaterialWidth.addEventListener('input', () => this.updateSimulationSubstrateSize());
    }
    if (this.simMaterialHeight) {
      this.simMaterialHeight.addEventListener('input', () => this.updateSimulationSubstrateSize());
    }
    if (this.simPresetPills) {
      this.simPresetPills.forEach(pill => {
        pill.addEventListener('click', () => {
          const w = parseFloat(pill.getAttribute('data-w'));
          const h = parseFloat(pill.getAttribute('data-h'));
          const shape = pill.getAttribute('data-shape') || 'round';
          if (w && h) {
            this.setSimulationSubstrateDimensions(w, h, shape);
            this.simPresetPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
          }
        });
      });
    }
    if (this.btnSimFitArtwork) {
      this.btnSimFitArtwork.addEventListener('click', () => {
        const artW = parseFloat(this.inputWidth.value) || 40;
        const artH = parseFloat(this.inputHeight.value) || 40;
        const subW = Math.round(artW + 10);
        const subH = Math.round(artH + 10);
        const shape = Math.abs(artW - artH) < 2 ? 'round' : 'rect';
        this.setSimulationSubstrateDimensions(subW, subH, shape);
        if (this.simPresetPills) this.simPresetPills.forEach(p => p.classList.remove('active'));
        this.btnSimFitArtwork.classList.add('active');
      });
    }

    // Virtual Laser Speed & Power Listeners
    if (this.simInputSpeed) {
      this.simInputSpeed.addEventListener('input', () => this.updateSimulationLaserParams());
    }
    if (this.simInputPower) {
      this.simInputPower.addEventListener('input', () => this.updateSimulationLaserParams());
    }
    if (this.simInputPasses) {
      this.simInputPasses.addEventListener('input', () => this.updateSimulationLaserParams());
    }
    if (this.simParamPresetPills) {
      this.simParamPresetPills.forEach(pill => {
        pill.addEventListener('click', () => {
          const speed = parseFloat(pill.getAttribute('data-sim-speed'));
          const power = parseInt(pill.getAttribute('data-sim-power'));
          if (speed && power !== undefined) {
            if (this.simInputSpeed) this.simInputSpeed.value = speed;
            if (this.simInputPower) this.simInputPower.value = power;
            this.updateSimulationLaserParams();
            this.simParamPresetPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
          }
        });
      });
    }

    // Pre-Flight Safety Check Trigger
    if (this.btnTriggerAudit) {
      this.btnTriggerAudit.addEventListener('click', () => this.runJobAudit());
    }
    if (this.btnCloseAuditModal) {
      this.btnCloseAuditModal.addEventListener('click', () => {
        if (this.modalAudit) this.modalAudit.classList.add('hidden');
      });
    }
    if (this.btnCloseAuditFooter) {
      this.btnCloseAuditFooter.addEventListener('click', () => {
        if (this.modalAudit) this.modalAudit.classList.add('hidden');
      });
    }
    if (this.btnAuditAutoFit) {
      this.btnAuditAutoFit.addEventListener('click', () => {
        this.centerWorkpiece();
        if (this.modalAudit) this.modalAudit.classList.add('hidden');
        this.runJobAudit();
      });
    }
    if (this.btnAuditStartEngrave) {
      this.btnAuditStartEngrave.addEventListener('click', () => {
        if (this.modalAudit) this.modalAudit.classList.add('hidden');
        this.startJob();
      });
    }

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
    if (this.btnAddImage) this.btnAddImage.addEventListener('click', () => this.fileInput.click());
    else if (this.btnAddCanvasItem) this.btnAddCanvasItem.addEventListener('click', () => this.fileInput.click());
    if (this.btnSelectObject) this.btnSelectObject.addEventListener('click', () => this.toggleSelectObject());
    if (this.btnDeleteSelected) this.btnDeleteSelected.addEventListener('click', () => this.deleteSelected());
    if (this.btnDeleteCanvasItem && this.btnDeleteCanvasItem !== this.btnDeleteSelected) {
      this.btnDeleteCanvasItem.addEventListener('click', () => this.deleteSelected());
    }
    if (this.btnDeleteWorkpiece) this.btnDeleteWorkpiece.addEventListener('click', () => this.deleteSelected());
    if (this.btnClearBed) this.btnClearBed.addEventListener('click', () => this.clearBed());
    if (this.btnClearBedSidebar) this.btnClearBedSidebar.addEventListener('click', () => this.clearBed());

    // Engraving Alignment Modes & Aiming Dot Actions
    if (this.btnModeBedScale) {
      this.btnModeBedScale.addEventListener('click', () => this.setEngraveAlignmentMode('bedScale'));
    }
    if (this.btnModeAimingDot) {
      this.btnModeAimingDot.addEventListener('click', () => this.setEngraveAlignmentMode('aimingDot'));
    }
    if (this.btnAimingDotToggle) {
      this.btnAimingDotToggle.addEventListener('click', () => this.toggleLaserDot());
    }
    if (this.anchorButtons && this.anchorButtons.length > 0) {
      this.anchorButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const anchor = btn.getAttribute('data-anchor');
          this.setMaterialAnchor(anchor);
        });
      });
    }
    if (this.btnSnapToAimingDot) {
      this.btnSnapToAimingDot.addEventListener('click', () => this.snapWorkpieceToAimingDot());
    }
    if (this.btnTraceMaterialFrame) {
      this.btnTraceMaterialFrame.addEventListener('click', () => this.traceFrame());
    }
    if (this.btnSetDotOriginG92) {
      this.btnSetDotOriginG92.addEventListener('click', () => this.setDotOriginG92());
    }

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
    const btnZoomIn = document.getElementById('btnZoomIn');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        this.visualizer.scale = Math.min(8.0, this.visualizer.scale * 1.2);
        this.visualizer.render();
      });
    }
    const btnZoomOut = document.getElementById('btnZoomOut');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        this.visualizer.scale = Math.max(0.2, this.visualizer.scale / 1.2);
        this.visualizer.render();
      });
    }
    const btnZoomReset = document.getElementById('btnZoomReset') || document.getElementById('btnResetView');
    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', () => {
        this.visualizer.fitToScreen();
      });
    }

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
    if (this.tabSimulation) this.tabSimulation.classList.toggle('active', tabId === 'simulation');
    this.tabPhotoStudio.classList.toggle('active', tabId === 'photoStudio');
    this.tabBedScale.classList.toggle('active', tabId === 'bedScale');

    this.viewBedMap.classList.toggle('active', tabId === 'bedMap');
    if (this.viewSimulation) this.viewSimulation.classList.toggle('active', tabId === 'simulation');
    this.viewPhotoStudio.classList.toggle('active', tabId === 'photoStudio');
    this.viewBedScale.classList.toggle('active', tabId === 'bedScale');

    if (tabId === 'bedMap') {
      this.visualizer.resizeCanvas();
    } else if (tabId === 'simulation') {
      if (this.simulator) {
        this.simulator.initCanvasSize();
        this.syncSimulatorWithWorkpiece();
        this.simulator.render();
      }
      this.setWorkflowStep(4);
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
    if (this.isVirtualConnected && !status.connected) {
      // Do not overwrite Virtual Falcon Online status badge
      return;
    }

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

  handleStatusUpdate(status) {
    this.updateTelemetry(status);
  }

  async refreshPorts() {
    this.portSelect.innerHTML = '';

    // Virtual Falcon Machine Simulator (Always at top of connection options)
    const virtualOpt = document.createElement('option');
    virtualOpt.value = 'VIRTUAL';
    virtualOpt.textContent = '🎮 Virtual Falcon Machine (Simulator)';
    this.portSelect.appendChild(virtualOpt);

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
      this.portSelect.prepend(webSerialOpt);
      if (!this.isVirtualConnected && !autoSelected) {
        this.portSelect.value = 'WEB_SERIAL';
        autoSelected = true;
      }
    }

    // Preserve selection or default to Virtual Machine if no Web Serial
    if (this.isVirtualConnected) {
      this.portSelect.value = 'VIRTUAL';
    } else if (!autoSelected) {
      this.portSelect.value = 'VIRTUAL';
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
    const target = this.portSelect.value || 'VIRTUAL';

    // If currently connected (virtual or physical), handle disconnect
    if (this.btnConnect.textContent === 'Disconnect') {
      if (this.isVirtualConnected) {
        this.disconnectVirtualMachine();
        return;
      }
      if (this.serialController && this.serialController.isConnected) {
        await this.serialController.disconnect();
        this.btnConnect.textContent = 'Connect';
        this.btnConnect.classList.remove('btn-active');
        this.statusBadge.className = 'status-badge disconnected';
        this.statusText.textContent = 'DISCONNECTED';
        this.log('Web Serial USB disconnected.');
        return;
      }
      try {
        await fetch('/api/disconnect', { method: 'POST' });
      } catch (e) {}
      this.btnConnect.textContent = 'Connect';
      this.btnConnect.classList.remove('btn-active');
      this.statusBadge.className = 'status-badge disconnected';
      this.statusText.textContent = 'DISCONNECTED';
      this.log('Disconnected from Falcon.');
      return;
    }

    // Connect to chosen target
    if (target === 'VIRTUAL') {
      this.connectVirtualMachine();
      return;
    }

    if (target === 'WEB_SERIAL') {
      await this.connectWebSerial();
      return;
    }

    // Physical COM port or AUTO via local bridge
    this.log(`Connecting to ${target}...`);
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: target })
      });
      const data = await res.json();
      if (data.success) {
        this.log(`Successfully connected to physical Falcon on ${data.connected_port || target}!`);
        this.btnConnect.textContent = 'Disconnect';
        this.btnConnect.classList.add('btn-active');
        this.statusBadge.className = 'status-badge active';
        this.statusText.textContent = 'CONNECTED';
      } else {
        this.log(`Failed to connect to ${target}. Make sure 24V power and USB cable are plugged in.`);
      }
    } catch (e) {
      this.log(`Connection error: ${e.message}`);
    }
  }

  async connectWebSerial() {
    try {
      await this.serialController.connect(115200);
      this.btnConnect.textContent = 'Disconnect';
      this.btnConnect.classList.add('btn-active');
      this.statusBadge.className = 'status-badge active';
      this.statusText.textContent = 'USB CONNECTED';
      this.log('Connected to Falcon 5W via Web Serial USB!');
    } catch (err) {
      this.log(`Web Serial: ${err.message}`);
    }
  }

  // ==========================================
  // VIRTUAL FALCON MACHINE & GATED SUBSTRATE SIMULATION
  // ==========================================
  toggleVirtualMachine() {
    if (this.isVirtualConnected) {
      this.disconnectVirtualMachine();
    } else {
      this.connectVirtualMachine();
    }
  }

  connectVirtualMachine() {
    this.isVirtualConnected = true;

    // Update Status HUD
    this.statusBadge.className = 'status-badge active virtual-active';
    this.statusText.textContent = '🟢 VIRTUAL FALCON ONLINE';
    if (this.hudCoords) this.hudCoords.textContent = 'X: 0.00 | Y: 0.00 (Sim)';
    const curSpeed = this.simInputSpeed ? this.simInputSpeed.value : '900';
    const curPower = this.simInputPower ? this.simInputPower.value : '280';
    if (this.hudFeedPower) this.hudFeedPower.textContent = `F: ${curSpeed} | S: ${curPower}`;

    // Update Header Buttons
    this.btnConnect.textContent = 'Disconnect';
    this.btnConnect.classList.add('btn-active');
    if (this.portSelect) this.portSelect.value = 'VIRTUAL';

    // REVEAL VIRTUAL SIMULATION TAB AND SWITCH TO IT
    if (this.tabSimulation) {
      this.tabSimulation.classList.remove('hidden');
    }
    this.switchTab('simulation');

    // Update workflow stepper for virtual simulation mode
    if (this.step4Title) this.step4Title.textContent = 'Virtual Simulation';
    if (this.step4Sub) this.step4Sub.textContent = 'Wood • Acrylic • Glass • Metal';

    // ENABLE PROCEED TO VIRTUAL ENGRAVE BUTTON
    if (this.btnProceedVirtualEngrave) {
      this.btnProceedVirtualEngrave.disabled = false;
    }

    // Sync simulator with current workpiece / toolpaths
    if (this.simulator) {
      this.syncSimulatorWithWorkpiece();
      this.simulator.render();
    }

    this.log('🎮 Connected to Virtual Falcon Machine! Virtual Simulation tab unlocked.');
  }

  disconnectVirtualMachine() {
    this.isVirtualConnected = false;
    if (this.simulator) this.simulator.pause();

    // Reset Status HUD
    this.statusBadge.className = 'status-badge disconnected';
    this.statusText.textContent = 'DISCONNECTED';
    if (this.hudCoords) this.hudCoords.textContent = 'X: 0.00 | Y: 0.00';
    if (this.hudFeedPower) this.hudFeedPower.textContent = 'F: 0 | S: 0';

    // Reset Buttons
    this.btnConnect.textContent = 'Connect';
    this.btnConnect.classList.remove('btn-active');

    // HIDE VIRTUAL SIMULATION TAB AND RETURN TO 2D BED MAP
    if (this.tabSimulation) {
      this.tabSimulation.classList.add('hidden');
    }
    this.switchTab('bedMap');

    // Reset workflow stepper for standard mode
    if (this.step4Title) this.step4Title.textContent = 'Toolpath & Safety';
    if (this.step4Sub) this.step4Sub.textContent = 'Pre-Flight & Parameter Check';

    // DISABLE PROCEED BUTTON
    if (this.btnProceedVirtualEngrave) {
      this.btnProceedVirtualEngrave.disabled = true;
    }

    this.log('Virtual Falcon Machine disconnected.');
  }

  proceedToVirtualEngrave() {
    if (!this.isVirtualConnected) {
      this.connectVirtualMachine();
      return;
    }

    // Ensure we are on the simulation tab
    this.switchTab('simulation');

    // Ensure toolpaths are loaded into simulator
    if (!this.simulator.segments || this.simulator.segments.length === 0) {
      if (this.currentPaths && this.currentPaths.length > 0) {
        const feed = parseFloat(this.inputSpeed ? this.inputSpeed.value : 900) || 900;
        const power = parseInt(this.inputPower ? this.inputPower.value : 280) || 280;
        this.simulator.loadNormalizedToolpaths(this.currentPaths, feed, power);
      } else {
        // Automatically load default Chittur 4cm keychain preset so user sees instant action!
        this.loadPreset('chittur_4cm');
        setTimeout(() => {
          this.switchTab('simulation');
          this.simulator.reset();
          this.simulator.play();
          if (this.btnSimPlay) this.btnSimPlay.disabled = true;
          if (this.btnSimPause) this.btnSimPause.disabled = false;
        }, 150);
        return;
      }
    }

    // Reset timeline and start simulation playback
    this.simulator.reset();
    this.simulator.play();

    if (this.btnSimPlay) this.btnSimPlay.disabled = true;
    if (this.btnSimPause) this.btnSimPause.disabled = false;

    if (this.jobLinesText) this.jobLinesText.textContent = `Virtual Job: ${this.simulator.segments.length} segments`;
    const matName = this.simulator.materials[this.simulator.currentMaterial]?.name || 'Substrate';
    this.log(`🚀 Virtual engraving started on ${matName}! Laser carriage is moving at ${this.simulator.speedMultiplier}x speed.`);
  }

  async toggleWebSerial() {
    if (this.serialController.isConnected) {
      await this.serialController.disconnect();
      this.btnConnect.textContent = 'Connect';
      this.btnConnect.classList.remove('btn-active');
      this.statusBadge.className = 'status-badge disconnected';
      this.statusText.textContent = 'DISCONNECTED';
      this.log('USB disconnected.');
    } else {
      await this.connectWebSerial();
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

        // Populate and reveal fileLoadedInfo on left sidebar
        this.currentPresetId = `bed_scale_${data.size_mm}`;
        if (this.loadedFileName) {
          this.loadedFileName.textContent = `Bed Reference Scale (${data.size_mm}×${data.size_mm} mm)`;
        }
        if (this.loadedFileMeta) {
          this.loadedFileMeta.textContent = `${data.line_count} lines • ${data.material_name}`;
        }
        if (this.fileLoadedInfo) {
          this.fileLoadedInfo.classList.remove('hidden');
        }
        this.updateSelectionUI(true);

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

  setEngraveAlignmentMode(mode) {
    this.engraveAlignmentMode = mode;

    if (mode === 'bedScale') {
      if (this.btnModeBedScale) this.btnModeBedScale.classList.add('active');
      if (this.btnModeAimingDot) this.btnModeAimingDot.classList.remove('active');
      if (this.modeBedScaleInfo) this.modeBedScaleInfo.classList.remove('hidden');
      if (this.modeAimingDotControls) this.modeAimingDotControls.classList.add('hidden');
      if (this.visualizer) this.visualizer.setEngraveAlignmentMode('bedScale', this.selectedAnchor);
      this.log('Engrave Mode: Bed Scale (Absolute 400×415 mm machine coordinates).');
    } else {
      if (this.btnModeAimingDot) this.btnModeAimingDot.classList.add('active');
      if (this.btnModeBedScale) this.btnModeBedScale.classList.remove('active');
      if (this.modeBedScaleInfo) this.modeBedScaleInfo.classList.add('hidden');
      if (this.modeAimingDotControls) this.modeAimingDotControls.classList.remove('hidden');
      if (this.visualizer) this.visualizer.setEngraveAlignmentMode('aimingDot', this.selectedAnchor);
      this.log('Engrave Mode: Aiming Dot Alignment (Place material under laser beam & choose anchor).');
      if (!this.isAimingDotActive) {
        this.toggleLaserDot(true);
      }
    }

    this.saveState(`Switch Engrave Mode (${mode === 'bedScale' ? 'Bed Scale' : 'Aiming Dot'})`);
    this.queueAutoSave();
  }

  setMaterialAnchor(anchor) {
    this.selectedAnchor = anchor;
    if (this.anchorButtons && this.anchorButtons.length > 0) {
      this.anchorButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-anchor') === anchor);
      });
    }

    if (this.selectedAnchorLabel) {
      this.selectedAnchorLabel.textContent = this.getAnchorFriendlyName(anchor);
    }

    if (this.visualizer) {
      this.visualizer.setMaterialAnchor(anchor);
    }

    this.log(`Aiming Dot anchor set to: ${this.getAnchorFriendlyName(anchor)}.`);
    this.saveState(`Set Anchor (${anchor})`);
    this.queueAutoSave();
  }

  getAnchorFriendlyName(anchor) {
    const names = {
      'center': 'Center',
      'top-left': 'Top-Left Corner',
      'top-center': 'Top-Center',
      'top-right': 'Top-Right Corner',
      'mid-left': 'Middle-Left',
      'mid-right': 'Middle-Right',
      'bottom-left': 'Bottom-Left (Origin 0,0)',
      'bottom-center': 'Bottom-Center',
      'bottom-right': 'Bottom-Right Corner'
    };
    return names[anchor] || 'Center';
  }

  snapWorkpieceToAimingDot() {
    if (!this.visualizer) return;
    const lx = this.visualizer.laserPos.x;
    const ly = this.visualizer.laserPos.y;
    const w = parseFloat(this.inputWidth.value) || 40.0;
    const h = parseFloat(this.inputHeight.value) || 40.0;
    const rotDeg = this.visualizer.workpiece.rotation || 0.0;
    const rad = (rotDeg * Math.PI) / 180;

    // Anchor local offset from center (Machine coords: Y is positive up, X is positive right)
    let ax = 0, ay = 0;
    const a = this.selectedAnchor || 'center';
    if (a === 'top-left') { ax = -w / 2; ay = h / 2; }
    else if (a === 'top-center') { ax = 0; ay = h / 2; }
    else if (a === 'top-right') { ax = w / 2; ay = h / 2; }
    else if (a === 'mid-left') { ax = -w / 2; ay = 0; }
    else if (a === 'mid-right') { ax = w / 2; ay = 0; }
    else if (a === 'bottom-left') { ax = -w / 2; ay = -h / 2; }
    else if (a === 'bottom-center') { ax = 0; ay = -h / 2; }
    else if (a === 'bottom-right') { ax = w / 2; ay = -h / 2; }
    else { ax = 0; ay = 0; } // center

    // Rotated anchor offset in machine coordinates (Clockwise rotation in +Y UP machine coordinates)
    const deltaX = ax * Math.cos(rad) + ay * Math.sin(rad);
    const deltaY = -ax * Math.sin(rad) + ay * Math.cos(rad);

    // Target workpiece center
    const newCx = Math.round((lx - deltaX) * 10) / 10;
    const newCy = Math.round((ly - deltaY) * 10) / 10;

    this.inputX.value = newCx.toFixed(1);
    this.inputY.value = newCy.toFixed(1);

    this.visualizer.setWorkpiece(newCx, newCy, w, h, rotDeg, true);
    this.log(`Snapped workpiece [${this.getAnchorFriendlyName(a)}] to Aiming Dot at (${lx.toFixed(1)}, ${ly.toFixed(1)}) mm.`);
    this.saveState(`Snap to Aiming Dot (${a})`);
    this.queueAutoSave();
  }

  async toggleLaserDot(requestedState = null) {
    if (requestedState !== null) {
      this.isAimingDotActive = requestedState;
    } else {
      this.isAimingDotActive = !this.isAimingDotActive;
    }

    const pwr = this.isAimingDotActive ? 20 : 0; // 2.0% power (S20)

    // 1. Web Serial USB
    if (this.serialController && this.serialController.isConnected) {
      try {
        await this.serialController.toggleLaserDot(pwr);
      } catch (err) {
        this.log(`Web Serial laser dot error: ${err.message}`);
      }
    } else {
      // 2. Local Bridge
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalhost) {
        try {
          await fetch('/api/laser_dot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ power: pwr })
          });
        } catch (e) {}
      }
    }

    // 3. Update Visualizer and UI
    if (this.visualizer) {
      this.visualizer.setAimingDot(this.isAimingDotActive);
    }

    // Sync button in Laser Parameters card
    if (this.btnToggleLaserDot) {
      if (this.isAimingDotActive) {
        this.btnToggleLaserDot.classList.add('active');
        this.btnToggleLaserDot.style.background = 'rgba(255, 23, 68, 0.25)';
        this.btnToggleLaserDot.style.borderColor = '#ff1744';
      } else {
        this.btnToggleLaserDot.classList.remove('active');
        this.btnToggleLaserDot.style.background = '';
        this.btnToggleLaserDot.style.borderColor = '';
      }
    }

    // Sync button in Aiming Dot Alignment card
    if (this.btnAimingDotToggle) {
      if (this.isAimingDotActive) {
        this.btnAimingDotToggle.classList.add('active');
        this.btnAimingDotToggle.innerHTML = '<span class="dot-indicator"></span> Turn OFF Dot';
      } else {
        this.btnAimingDotToggle.classList.remove('active');
        this.btnAimingDotToggle.innerHTML = '<span class="dot-indicator"></span> Turn ON Dot';
      }
    }

    if (this.laserDotStatusText) {
      this.laserDotStatusText.textContent = this.isAimingDotActive 
        ? '🔴 Dot is ON (2% power diode active)' 
        : '⚪ Dot is currently OFF';
      this.laserDotStatusText.style.color = this.isAimingDotActive ? '#ff5252' : '#888';
    }

    this.log(this.isAimingDotActive 
      ? 'Laser Aiming Dot turned ON (2% power). Place your material under the beam.' 
      : 'Laser Aiming Dot turned OFF.');
  }

  async traceFrame() {
    const x = parseFloat(this.inputX.value);
    const y = parseFloat(this.inputY.value);
    const w = parseFloat(this.inputWidth.value);
    const h = parseFloat(this.inputHeight.value);
    const xmin = Math.max(0, x - w / 2);
    const ymin = Math.max(0, y - h / 2);
    const xmax = Math.min(400, x + w / 2);
    const ymax = Math.min(415, y + h / 2);
    
    this.log(`Tracing workpiece frame [${xmin.toFixed(1)}, ${ymin.toFixed(1)}] to [${xmax.toFixed(1)}, ${ymax.toFixed(1)}]...`);

    if (this.serialController && this.serialController.isConnected) {
      await this.serialController.traceFrame(xmin, ymin, xmax, ymax, 1500);
      return;
    }

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      try {
        await fetch('/api/trace_frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ xmin, ymin, xmax, ymax, speed: 1500 })
        });
      } catch (e) {}
    } else {
      this.log('Frame trace preview: Check boundary rectangle on bed canvas.');
    }
  }

  async setDotOriginG92() {
    this.log('Setting active machine coordinate zero at aiming dot (G92 X0 Y0)...');
    if (this.serialController && this.serialController.isConnected) {
      await this.serialController.setZero();
      this.log('Active Origin set at Aiming Dot (G92 X0 Y0)!');
      return;
    }

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost) {
      try {
        await fetch('/api/zero', { method: 'POST' });
        this.log('Active Origin set at Aiming Dot (G92 X0 Y0)!');
      } catch (e) {}
    } else {
      this.log('Simulated Origin (0,0) set at current aiming dot.');
    }
  }

  async handleFile(file) {
    this.currentFile = file;
    this.loadedFileName.textContent = file.name;
    this.loadedFileMeta.textContent = `${(file.size / 1024).toFixed(1)} KB • ${file.type || 'file'}`;
    this.fileLoadedInfo.classList.remove('hidden');

    const nameLower = file.name.toLowerCase();

    // 1. STL 3D Mesh Files (.stl)
    if (nameLower.endsWith('.stl')) {
      this.log(`Loading 3D STL mesh: ${file.name}...`);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buffer = e.target.result;
          const result = StlGcodeLoader.parseStl(buffer, 512);
          const b = result.bounds;

          this.fileBase64 = result.heightmapDataUrl;
          this.imgOriginalPreview.src = this.fileBase64;
          this.imgOriginalPreview.classList.remove('hidden');
          this.placeholderOriginal.classList.add('hidden');
          this.loadedFileMeta.textContent = `${b.triangleCount} Triangles • ${b.width.toFixed(1)}×${b.height.toFixed(1)}×${b.depth.toFixed(1)} mm`;

          // Scale dimensions onto workpiece
          this.aspectRatio = b.width / b.height;
          const fitW = Math.min(80.0, Math.max(20.0, b.width));
          this.inputWidth.value = fitW.toFixed(1);
          this.inputHeight.value = (fitW / this.aspectRatio).toFixed(1);

          this.visualizer.setWorkpiece(
            parseFloat(this.inputX.value),
            parseFloat(this.inputY.value),
            parseFloat(this.inputWidth.value),
            parseFloat(this.inputHeight.value),
            0.0,
            true
          );

          // Update Simulator
          if (this.simulator) {
            this.simulator.setWorkpiece(
              parseFloat(this.inputWidth.value),
              parseFloat(this.inputHeight.value),
              'rect'
            );
          }

          // Switch to Photo Studio in raster mode for 2.5D relief dithering
          this.setMode('raster');
          this.switchTab('photoStudio');
          this.previewRasterDither();
          this.log(`3D STL mesh loaded: ${b.triangleCount} triangles. 2.5D heightmap relief ready!`);
          this.saveState(`Load 3D STL (${file.name})`);
          this.setWorkflowStep(2);
        } catch (err) {
          alert(`Error loading STL: ${err.message}`);
          this.log(`STL load error: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // 2. GRBL G-Code Files (.gcode, .nc, .gc, .txt)
    if (nameLower.endsWith('.gcode') || nameLower.endsWith('.nc') || nameLower.endsWith('.gc') || (nameLower.endsWith('.txt') && !nameLower.includes('readme'))) {
      this.log(`Ingesting GRBL G-code toolpath: ${file.name}...`);
      const text = await file.text();
      try {
        const parsed = StlGcodeLoader.parseGcode(text);
        this.currentActiveGcode = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        this.currentPaths = parsed.polylines;
        this.aspectRatio = parsed.bounds.width / parsed.bounds.height;

        this.inputWidth.value = parsed.bounds.width.toFixed(1);
        this.inputHeight.value = parsed.bounds.height.toFixed(1);
        this.inputX.value = parsed.bounds.centerX.toFixed(1);
        this.inputY.value = parsed.bounds.centerY.toFixed(1);

        this.visualizer.setWorkpiece(
          parsed.bounds.centerX,
          parsed.bounds.centerY,
          parsed.bounds.width,
          parsed.bounds.height,
          0.0,
          true
        );
        this.visualizer.setToolpaths(this.currentPaths, true);

        // Load segments directly into virtual material simulator
        if (this.simulator) {
          this.simulator.setWorkpiece(parsed.bounds.width, parsed.bounds.height, 'rect');
          this.simulator.loadGcodeSegments(parsed.segments);
        }

        this.loadedFileMeta.textContent = `${parsed.lineCount} Lines • ${(parsed.totalCutDist / 1000).toFixed(1)}m Cut • ETA: ${Math.round(parsed.estimatedTimeSec / 60)}m`;
        this.jobLinesText.textContent = `Line: 0 / ${parsed.lineCount}`;
        this.btnStartJob.disabled = false;

        this.switchTab('simulation');
        this.log(`G-code toolpath ready: ${parsed.lineCount} lines, ${parsed.totalCutDist}mm cut distance.`);
        this.saveState(`Load G-Code (${file.name})`);
        this.setWorkflowStep(4);
        this.runJobAudit();
      } catch (err) {
        alert(`Error parsing G-code: ${err.message}`);
        this.log(`G-code parse error: ${err.message}`);
      }
      return;
    }

    // 3. SVG Vector Files (.svg)
    if (nameLower.endsWith('.svg')) {
      const text = await file.text();
      this.svgXml = text;
      this.parseSvg(text);
      this.setWorkflowStep(3);
      return;
    }

    // 4. Standard Images (PNG, JPG, BMP, WebP)
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
      this.setWorkflowStep(2);
    };
    reader.readAsDataURL(file);
  }

  setWorkflowStep(stepNum) {
    this.currentWorkflowStep = stepNum;
    if (this.workflowStepItems) {
      this.workflowStepItems.forEach(item => {
        const s = parseInt(item.getAttribute('data-step')) || 1;
        item.classList.toggle('active', s === stepNum);
      });
    }
  }

  navigateToWorkflowStep(stepNum) {
    this.setWorkflowStep(stepNum);
    switch (stepNum) {
      case 1:
        if (this.fileInput) this.fileInput.click();
        break;
      case 2:
        this.switchTab('photoStudio');
        break;
      case 3:
        this.switchTab('bedMap');
        break;
      case 4:
        if (!this.isVirtualConnected) {
          this.connectVirtualMachine();
        } else {
          this.switchTab('simulation');
        }
        break;
      case 5:
        const liveMonitor = document.querySelector('.highlight-card');
        if (liveMonitor) liveMonitor.scrollIntoView({ behavior: 'smooth' });
        this.log('Step 5: Review machine status & click START ENGRAVE.');
        break;
    }
  }

  setSimulationMaterial(matKey) {
    if (this.simulator) {
      this.simulator.setMaterial(matKey);
      if (this.simMaterialButtons) {
        this.simMaterialButtons.forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-sim-material') === matKey);
        });
      }
      if (this.simActiveMaterialLabel) {
        this.simActiveMaterialLabel.textContent = `Substrate: ${this.simulator.materials[matKey].name}`;
      }

      // Recommend calibrated laser parameters for selected material
      const rec = this.simulator.materials[matKey];
      if (rec) {
        if (this.simInputSpeed) this.simInputSpeed.value = rec.recommendedSpeed;
        if (this.simInputPower) this.simInputPower.value = rec.recommendedPower;
        this.updateSimulationLaserParams();
        this.log(`Applied calibrated parameters for ${rec.name}: Speed ${rec.recommendedSpeed} mm/min, Power S${rec.recommendedPower}.`);
      }
    }
  }

  updateSimulationLaserParams() {
    const speed = parseFloat(this.simInputSpeed ? this.simInputSpeed.value : 900) || 900;
    const power = parseInt(this.simInputPower ? this.simInputPower.value : 280) || 280;
    const passes = parseInt(this.simInputPasses ? this.simInputPasses.value : 1) || 1;

    // Sync with hardware inputs in right sidebar
    if (this.inputSpeed) this.inputSpeed.value = speed;
    if (this.inputPower) this.inputPower.value = power;
    if (this.inputPasses) this.inputPasses.value = passes;

    // Update power percentage and wattage badge (Falcon 5W: 1000 S = 5.0W optical)
    if (this.simPowerPctTag) {
      const pct = Math.round(power / 10);
      const watts = (power * 0.005).toFixed(1);
      this.simPowerPctTag.textContent = `${pct}% • ${watts}W`;
    }

    if (this.hudFeedPower && this.isVirtualConnected) {
      this.hudFeedPower.textContent = `F: ${speed} | S: ${power}`;
    }

    if (this.simulator) {
      this.simulator.setLaserParameters(speed, power, passes);
    }
  }

  syncSimulatorWithWorkpiece() {
    if (!this.simulator) return;
    const artW = parseFloat(this.inputWidth.value) || 35.0;
    const artH = parseFloat(this.inputHeight.value) || 35.0;
    const subW = this.simMaterialWidth ? (parseFloat(this.simMaterialWidth.value) || 100.0) : 100.0;
    const subH = this.simMaterialHeight ? (parseFloat(this.simMaterialHeight.value) || 100.0) : 100.0;
    const shape = this.btnSimShapeRound && this.btnSimShapeRound.classList.contains('active') ? 'round' : 'rect';

    this.simulator.setWorkpiece(subW, subH, shape);
    this.simulator.setArtworkDimensions(artW, artH);

    if (this.currentPaths && this.currentPaths.length > 0) {
      const feed = this.simInputSpeed ? (parseFloat(this.simInputSpeed.value) || 900) : (parseFloat(this.inputSpeed.value) || 900);
      const power = this.simInputPower ? (parseInt(this.simInputPower.value) || 280) : (parseInt(this.inputPower.value) || 280);
      this.simulator.loadNormalizedToolpaths(this.currentPaths, feed, power, artW, artH);
    }
    this.updateSimulationWatermark();
  }

  setSimulationSubstrateShape(shape) {
    if (this.btnSimShapeRound) this.btnSimShapeRound.classList.toggle('active', shape === 'round');
    if (this.btnSimShapeRect) this.btnSimShapeRect.classList.toggle('active', shape === 'rect');
    const w = this.simMaterialWidth ? (parseFloat(this.simMaterialWidth.value) || 100.0) : 100.0;
    const h = this.simMaterialHeight ? (parseFloat(this.simMaterialHeight.value) || 100.0) : 100.0;
    if (this.simulator) {
      this.simulator.setWorkpiece(w, h, shape);
      this.updateSimulationWatermark();
    }
  }

  updateSimulationSubstrateSize() {
    const w = Math.max(5, this.simMaterialWidth ? (parseFloat(this.simMaterialWidth.value) || 100.0) : 100.0);
    const h = Math.max(5, this.simMaterialHeight ? (parseFloat(this.simMaterialHeight.value) || 100.0) : 100.0);
    const shape = this.btnSimShapeRound && this.btnSimShapeRound.classList.contains('active') ? 'round' : 'rect';
    if (this.simulator) {
      this.simulator.setWorkpiece(w, h, shape);
      this.updateSimulationWatermark();
    }
  }

  setSimulationSubstrateDimensions(w, h, shape) {
    if (this.simMaterialWidth) this.simMaterialWidth.value = w;
    if (this.simMaterialHeight) this.simMaterialHeight.value = h;
    this.setSimulationSubstrateShape(shape);
  }

  updateSimulationWatermark() {
    if (!this.simulator || !this.simActiveMaterialLabel) return;
    const shapeName = this.simulator.workpiece.shape === 'round' ? 'Round' : 'Rect';
    const matObj = this.simulator.materials[this.simulator.currentMaterial];
    const matName = matObj ? matObj.name : (this.simulator.currentMaterial.charAt(0).toUpperCase() + this.simulator.currentMaterial.slice(1));
    this.simActiveMaterialLabel.textContent = `Substrate: ${matName} (${Math.round(this.simulator.workpiece.width)}×${Math.round(this.simulator.workpiece.height)} mm • ${shapeName})`;
  }

  runJobAudit() {
    const w = parseFloat(this.inputWidth.value) || 40.0;
    const h = parseFloat(this.inputHeight.value) || 40.0;
    const cx = parseFloat(this.inputX.value) || 200.0;
    const cy = parseFloat(this.inputY.value) || 207.5;

    const bounds = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minY: cy - h / 2,
      maxY: cy + h / 2,
      width: w,
      height: h,
      centerX: cx,
      centerY: cy
    };

    const segments = (this.simulator && this.simulator.segments.length > 0) ? this.simulator.segments : [];
    const mat = (this.simulator ? this.simulator.currentMaterial : 'wood') || 'wood';

    const auditResult = JobAuditor.auditJob({
      bounds: bounds,
      segments: segments,
      material: mat,
      bedWidth: 400.0,
      bedHeight: 415.0
    });

    // Populate modal
    if (this.auditSummaryBanner) {
      this.auditSummaryBanner.className = `audit-summary-banner ${auditResult.overallStatus.toLowerCase()}`;
      if (this.auditSummaryIcon) {
        this.auditSummaryIcon.textContent = auditResult.overallStatus === 'PASS' ? '✅' : (auditResult.overallStatus === 'WARNING' ? '⚠️' : '❌');
      }
      if (this.auditSummaryText) {
        this.auditSummaryText.textContent = auditResult.summary;
      }
    }

    if (this.auditChecklist) {
      this.auditChecklist.innerHTML = '';
      auditResult.checks.forEach(chk => {
        const item = document.createElement('div');
        item.className = `audit-check-item ${chk.status}`;
        const icon = chk.status === 'pass' ? '✅' : (chk.status === 'warning' ? '⚠️' : '❌');
        item.innerHTML = `
          <span class="audit-item-icon">${icon}</span>
          <div class="audit-item-body">
            <strong>${chk.title}</strong>
            <span>${chk.message}</span>
          </div>
        `;
        this.auditChecklist.appendChild(item);
      });
    }

    if (this.btnAuditAutoFit) {
      this.btnAuditAutoFit.classList.toggle('hidden', auditResult.overallStatus !== 'ERROR');
    }

    if (this.modalAudit) {
      this.modalAudit.classList.remove('hidden');
    }
    this.log(`Pre-Flight Job Audit: ${auditResult.overallStatus} (${auditResult.checks.length} checks performed).`);
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
        if (this.simulator) {
          const feed = parseFloat(this.inputSpeed.value) || 900;
          const power = parseInt(this.inputPower.value) || 280;
          this.simulator.setWorkpiece(w, parseFloat(this.inputHeight.value), 'rect');
          this.simulator.loadNormalizedToolpaths(this.currentPaths, feed, power);
        }
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
        if (this.simulator) {
          const feed = parseFloat(this.inputSpeed.value) || 900;
          const power = parseInt(this.inputPower.value) || 280;
          this.simulator.setWorkpiece(w, parseFloat(this.inputHeight.value), 'rect');
          this.simulator.loadNormalizedToolpaths(this.currentPaths, feed, power);
        }
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
    if (!lines || lines.length === 0) return [];
    const rawPolys = [];
    let cur = [];
    let curX = 0, curY = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || l.startsWith(';')) continue;

      if (l.includes('M5')) {
        if (cur.length > 1) rawPolys.push(cur);
        cur = [];
      }

      const xMatch = l.match(/X([-+]?[0-9.]+)/i);
      const yMatch = l.match(/Y([-+]?[0-9.]+)/i);
      const targetX = xMatch ? parseFloat(xMatch[1]) : curX;
      const targetY = yMatch ? parseFloat(yMatch[1]) : curY;

      if (l.startsWith('G0')) {
        if (cur.length > 1) rawPolys.push(cur);
        cur = [];
        curX = targetX;
        curY = targetY;
      } else if (l.startsWith('G1')) {
        if (cur.length === 0) cur.push([curX, curY]);
        cur.push([targetX, targetY]);
        minX = Math.min(minX, curX, targetX);
        maxX = Math.max(maxX, curX, targetX);
        minY = Math.min(minY, curY, targetY);
        maxY = Math.max(maxY, curY, targetY);
        curX = targetX;
        curY = targetY;
      } else if (l.startsWith('G2') || l.startsWith('G3')) {
        const iMatch = l.match(/I([-+]?[0-9.]+)/i);
        const jMatch = l.match(/J([-+]?[0-9.]+)/i);
        const iVal = iMatch ? parseFloat(iMatch[1]) : 0.0;
        const jVal = jMatch ? parseFloat(jMatch[1]) : 0.0;
        const cx = curX + iVal;
        const cy = curY + jVal;
        const r = Math.hypot(iVal, jVal);
        let startAng = Math.atan2(curY - cy, curX - cx);
        let endAng = Math.atan2(targetY - cy, targetX - cx);
        const isCw = l.startsWith('G2');
        if (isCw) {
          if (endAng >= startAng) endAng -= 2 * Math.PI;
        } else {
          if (endAng <= startAng) endAng += 2 * Math.PI;
        }
        const steps = Math.max(6, Math.round(Math.abs(endAng - startAng) / (2 * Math.PI) * 36));
        if (cur.length === 0) cur.push([curX, curY]);
        for (let s = 1; s <= steps; s++) {
          const ang = startAng + (endAng - startAng) * (s / steps);
          const px = cx + r * Math.cos(ang);
          const py = cy + r * Math.sin(ang);
          cur.push([px, py]);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
        curX = targetX;
        curY = targetY;
      }
    }
    if (cur.length > 1) rawPolys.push(cur);
    if (rawPolys.length === 0 || !isFinite(minX)) return [];

    const spanX = Math.max(1e-4, maxX - minX);
    const spanY = Math.max(1e-4, maxY - minY);
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
      'chittur_4cm': { file: 'presets/keychain_4cm_vector.gcode', w: 35.0, h: 35.0, wpW: 40.0, wpH: 40.0, shape: 'round', speed: 900, power: 280 },
      'chittur_10cm': { file: 'presets/keychain_10cm_vector.gcode', w: 90.0, h: 90.0, wpW: 100.0, wpH: 100.0, shape: 'round', speed: 1000, power: 320 },
      'bed_scale_200mm': { file: 'presets/black_glass_bed_scale.gcode', w: 200.0, h: 200.0, wpW: 200.0, wpH: 200.0, shape: 'rect', speed: 800, power: 450 },
      'bed_scale_380mm': { file: null, w: 380.0, h: 380.0, wpW: 380.0, wpH: 380.0, shape: 'rect', speed: 1000, power: 400 }
    };
    const info = presetMeta[presetId] || { file: 'presets/keychain_4cm_vector.gcode', w: 35.0, h: 35.0, wpW: 40.0, wpH: 40.0, shape: 'round', speed: 900, power: 280 };

    this.inputWidth.value = String(info.w);
    this.inputHeight.value = String(info.h);
    this.inputSpeed.value = String(info.speed);
    this.inputPower.value = String(info.power);
    if (this.inputRotation) this.inputRotation.value = "0.0";

    let loadedPaths = null;
    let lineCount = 0;

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
            lineCount = data.line_count || 0;
            if (data.lines && data.lines.length > 0) {
              this.currentActiveGcode = data.lines;
            }
            if (data.norm_paths && data.norm_paths.length > 0) {
              loadedPaths = data.norm_paths;
            }
            if (data.w) {
              info.w = data.w;
              info.h = data.h;
              this.inputWidth.value = String(data.w);
              this.inputHeight.value = String(data.h);
            }
            if (data.workpiece_w) {
              info.wpW = data.workpiece_w;
              info.wpH = data.workpiece_h;
            }
            if (data.shape) info.shape = data.shape;
            if (data.speed) {
              info.speed = data.speed;
              this.inputSpeed.value = String(data.speed);
            }
            if (data.power) {
              info.power = data.power;
              this.inputPower.value = String(data.power);
            }
            this.log(`Preset loaded on local bridge (${data.line_count} lines, ${loadedPaths ? loadedPaths.length : 0} toolpaths).`);
          }
        }
      } catch (e) {
        console.warn('Bridge preset load failed:', e);
      }
    }

    if (!this.currentActiveGcode && info.file) {
      try {
        const gRes = await fetch(info.file);
        if (gRes.ok) {
          const text = await gRes.text();
          const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          lineCount = lines.length;
          this.currentActiveGcode = lines;
          if (!loadedPaths) loadedPaths = this.parseGcodeToolpaths(lines);
        }
      } catch (e) {
        console.warn('Static preset file fetch failed:', e);
      }
    }

    if (!loadedPaths && presetId === 'bed_scale_380mm' && typeof ClientBedScaleGenerator !== 'undefined') {
      try {
        const res = ClientBedScaleGenerator.generateGridGcode({
          material: 'glass',
          size_mm: 380.0,
          origin_mode: 'front_left',
          center_x: 200.0,
          center_y: 207.5
        });
        if (res && res.norm_paths) {
          lineCount = res.line_count;
          this.currentActiveGcode = res.gcode_lines;
          loadedPaths = res.norm_paths;
        }
      } catch (e) {
        console.warn('ClientBedScaleGenerator fallback failed:', e);
      }
    }

    if (loadedPaths && loadedPaths.length > 0) {
      this.currentPaths = loadedPaths;
      this.visualizer.setToolpaths(loadedPaths, true);
      if (this.simulator) {
        const shape = info.shape || 'round';
        this.simulator.setWorkpiece(info.wpW, info.wpH, shape);
        this.simulator.loadNormalizedToolpaths(loadedPaths, info.speed, info.power, info.w, info.h);
      }
      this.log(`Preset ${presetId} ready: ${loadedPaths.length} toolpaths loaded!`);
    } else {
      this.log(`Preset ${presetId} parameters set.`);
    }

    if (lineCount > 0) {
      this.jobLinesText.textContent = `Line: 0 / ${lineCount}`;
      this.btnStartJob.disabled = false;
    }

    const curX = parseFloat(this.inputX.value) || 200.0;
    const curY = parseFloat(this.inputY.value) || 207.5;
    this.visualizer.setWorkpiece(
      curX,
      curY,
      info.wpW,
      info.wpH,
      0.0,
      true,
      info.shape || 'round'
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
        if (res.ok) {
          data = await res.json();
          if (data && data.lines && data.lines.length > 0) {
            this.currentActiveGcode = data.lines;
          }
        }
      } catch (e) {
        // Standalone / GitHub Pages
      }

      if (!this.currentActiveGcode || this.currentActiveGcode.length === 0 || !data || !data.lines || data.lines.length === 0) {
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
          data = { success: true, line_count: lines.length, lines: lines, snippet: lines.slice(0, 25) };
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
          data = { success: true, line_count: lines.length, lines: lines, snippet: lines.slice(0, 25) };
          this.currentActiveGcode = lines;
        }
      }

      const totalLines = (this.currentActiveGcode && this.currentActiveGcode.length) || (data && data.line_count) || 0;
      if (totalLines > 0) {
        this.log(`G-code generated: ${totalLines} lines! Ready to stream.`);
        this.jobLinesText.textContent = `Line: 0 / ${totalLines}`;
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
    if (!this.currentActiveGcode || this.currentActiveGcode.length === 0) {
      if (this.currentPresetId) {
        await this.loadPreset(this.currentPresetId);
      }
      if (!this.currentActiveGcode || this.currentActiveGcode.length === 0) {
        await this.generateGcode();
      }
    }

    // Guaranteed fallback: If still null but we have loaded paths, generate directly
    if ((!this.currentActiveGcode || this.currentActiveGcode.length === 0) && this.currentPaths && this.currentPaths.length > 0) {
      const rotDeg = this.inputRotation ? (parseFloat(this.inputRotation.value) || 0) : 0;
      const w = parseFloat(this.inputWidth.value) || 35;
      const h = parseFloat(this.inputHeight.value) || 35;
      const cx = parseFloat(this.inputX.value) || 200;
      const cy = parseFloat(this.inputY.value) || 207.5;
      this.currentActiveGcode = ClientSvgCompiler.generateVectorGcode({
        norm_paths: this.currentPaths,
        center_x: cx,
        center_y: cy,
        x_pos: cx - w / 2,
        y_pos: cy - h / 2,
        width_mm: w,
        height_mm: h,
        rotation_deg: rotDeg,
        speed_mm_min: parseFloat(this.inputSpeed.value) || 900,
        power_s: parseInt(this.inputPower.value) || 280,
        passes: parseInt(this.inputPasses.value) || 1
      });
      if (this.currentActiveGcode && this.currentActiveGcode.length > 0) {
        this.jobLinesText.textContent = `Line: 0 / ${this.currentActiveGcode.length}`;
        this.btnStartJob.disabled = false;
      }
    }

    if (!this.currentActiveGcode || this.currentActiveGcode.length === 0) {
      alert("Please generate G-code toolpaths first.");
      return;
    }


    if (this.serialController && this.serialController.isConnected) {
      this.log(`Streaming job via USB Serial: ${jobName} (${this.currentActiveGcode.length} lines)...`);
      try {
        await this.serialController.streamGcode(this.currentActiveGcode, jobName, (st) => this.handleStatusUpdate(st));
        this.log(`Job "${jobName}" completed successfully!`);
      } catch (err) {
        this.log(`Streaming error: ${err.message}`);
        alert(`Streaming failed: ${err.message}`);
      }
      return;
    }
    this.log(`Starting laser job via local backend: ${jobName}...`);
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
      engraveAlignmentMode: this.engraveAlignmentMode || 'bedScale',
      selectedAnchor: this.selectedAnchor || 'center',
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

      if (st.engraveAlignmentMode) {
        this.setEngraveAlignmentMode(st.engraveAlignmentMode);
      }
      if (st.selectedAnchor) {
        this.setMaterialAnchor(st.selectedAnchor);
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
  // OBJECT SELECTION, DELETE & CLEAR BED
  // ==========================================
  toggleSelectObject() {
    if (!this.visualizer || !this.visualizer.workpiece.visible) {
      this.log('No object on the bed to select.');
      return;
    }
    const newSelected = !this.visualizer.workpiece.isSelected;
    this.visualizer.setSelected(newSelected);
    this.updateSelectionUI(newSelected);
    this.log(newSelected ? '🎯 Object selected on 2D Bed Map (handles visible).' : 'Object deselected.');
  }

  updateSelectionUI(isSelected) {
    const hasItem = !!(this.visualizer && this.visualizer.workpiece && this.visualizer.workpiece.visible);
    if (this.btnSelectObject) {
      if (!hasItem) {
        this.btnSelectObject.classList.remove('active');
        this.btnSelectObject.textContent = '🎯 Select Object';
        this.btnSelectObject.disabled = true;
      } else if (isSelected) {
        this.btnSelectObject.classList.add('active');
        this.btnSelectObject.textContent = '🎯 Deselect Object';
        this.btnSelectObject.disabled = false;
      } else {
        this.btnSelectObject.classList.remove('active');
        this.btnSelectObject.textContent = '🎯 Select Object';
        this.btnSelectObject.disabled = false;
      }
    }
    if (this.btnDeleteSelected) {
      this.btnDeleteSelected.disabled = !hasItem;
    }
    if (this.btnDeleteWorkpiece) {
      this.btnDeleteWorkpiece.disabled = !hasItem;
    }
    if (this.btnClearBed) {
      this.btnClearBed.disabled = !hasItem && (!this.currentPaths || this.currentPaths.length === 0);
    }
    if (this.btnClearBedSidebar) {
      this.btnClearBedSidebar.disabled = !hasItem && (!this.currentPaths || this.currentPaths.length === 0);
    }
  }

  deleteSelected() {
    this.deleteWorkpiece();
  }

  deleteWorkpiece() {
    const hasVisible = this.visualizer && this.visualizer.workpiece && this.visualizer.workpiece.visible;
    const hasPaths = this.currentPaths && this.currentPaths.length > 0;
    const hasFile = !!this.currentFile;
    if (!hasVisible && !hasPaths && !hasFile) {
      this.log('Canvas is already empty. No object to delete.');
      return;
    }
    this.clearBed('Delete Selected Item');
  }

  clearBed(actionLabel = 'Clear Bed') {
    this.clearFile();
    this.currentPaths = [];
    this.currentActiveGcode = null;
    this.currentPresetId = null;
    this.currentFile = null;
    this.fileBase64 = null;
    this.svgXml = null;

    if (this.fileInput) this.fileInput.value = '';
    if (this.fileLoadedInfo) this.fileLoadedInfo.classList.add('hidden');
    if (this.loadedFileName) this.loadedFileName.textContent = '';
    if (this.jobLinesText) this.jobLinesText.textContent = 'Line: 0 / 0';
    if (this.btnStartJob) this.btnStartJob.disabled = true;
    if (this.inputRotation) this.inputRotation.value = "0.0";

    if (this.visualizer) {
      this.visualizer.setWorkpiece(200.0, 207.5, 40.0, 40.0, 0.0, false);
      this.visualizer.setToolpaths([]);
      this.visualizer.setRasterPreview(null);
      if (this.visualizer.setSelected) {
        this.visualizer.setSelected(false);
      }
    }

    this.updateSelectionUI(false);
    this.saveState(actionLabel);
    this.saveToLocalStorage();
    this.log(actionLabel === 'Clear Bed' ? '🧹 Bed cleared completely. All objects, bed scale grids, and toolpaths removed.' : '🗑 Artwork / scale item removed from bed.');
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
        engraveAlignmentMode: this.engraveAlignmentMode || 'bedScale',
        selectedAnchor: this.selectedAnchor || 'center',
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
        if (st.engraveAlignmentMode) this.setEngraveAlignmentMode(st.engraveAlignmentMode);
        if (st.selectedAnchor) this.setMaterialAnchor(st.selectedAnchor);
      } finally {
        this.isPerformingHistoryAction = false;
      }

      this.saveState(st.workpiece.visible ? 'Restored Workspace' : 'Initial Clean Bed');
      this.updateSelectionUI(this.visualizer && this.visualizer.workpiece && this.visualizer.workpiece.isSelected);
    } catch (e) {
      console.warn('[Falcon Studio] Could not restore from localStorage:', e);
      this.saveState('Initial Clean Bed');
      this.updateSelectionUI(false);
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
