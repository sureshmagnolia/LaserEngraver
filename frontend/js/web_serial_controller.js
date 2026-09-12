/**
 * WebSerialController - W3C Web Serial API Driver for Creality CR-Laser Falcon 5W (GRBL 1.1)
 * Enables direct USB communication from browser without any local backend server.
 */
class WebSerialController {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readableStreamClosed = null;
    this.writableStreamClosed = null;
    this.isConnected = false;
    
    // Machine state
    this.state = "DISCONNECTED"; // IDLE, RUN, HOLD, ALARM, DISCONNECTED
    this.mpos = { x: 0.0, y: 0.0, z: 0.0 };
    this.wpos = { x: 0.0, y: 0.0, z: 0.0 };
    this.feed = 0.0;
    this.spindle = 0.0;
    this.isLaserDotOn = false;

    // Streaming
    this.isStreaming = false;
    this.isPaused = false;
    this.abortRequested = false;
    this.streamingTotalLines = 0;
    this.streamingCurrentLine = 0;
    this.jobStartTime = 0;

    // Callbacks
    this.onStatus = null;
    this.onLog = null;

    // Poll interval
    this.pollTimer = null;
    this.incomingBuffer = "";
  }

  static isSupported() {
    return 'serial' in navigator;
  }

  log(msg) {
    if (this.onLog) this.onLog(msg);
    console.log(`[WebSerial] ${msg}`);
  }

  async connect(baudRate = 115200) {
    if (!WebSerialController.isSupported()) {
      throw new Error("Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera.");
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate });

      const textDecoder = new TextDecoderStream();
      this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      const textEncoder = new TextEncoderStream();
      this.writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();

      this.isConnected = true;
      this.state = "IDLE";
      this.log("Connected to USB Serial port at 115200 baud!");

      // Start read loop
      this.readLoop();

      // Send wakeup/reset
      await this.sendLine("\r\n\r\n");
      await new Promise(r => setTimeout(r, 500));
      await this.sendLine("$X"); // Unlock alarm if any
      await this.sendLine("?");

      // Start 10Hz status polling
      this.startPolling();

      return true;
    } catch (err) {
      this.isConnected = false;
      this.log(`Connection failed: ${err.message}`);
      throw err;
    }
  }

  async disconnect() {
    this.stopPolling();
    this.isConnected = false;
    this.state = "DISCONNECTED";

    try {
      if (this.reader) {
        await this.reader.cancel();
        await this.readableStreamClosed.catch(() => {});
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close();
        await this.writableStreamClosed.catch(() => {});
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
      this.log("Serial port disconnected.");
    } catch (err) {
      console.warn("Error during disconnect:", err);
    }
  }

  async sendLine(line) {
    if (!this.writer || !this.isConnected) return;
    const clean = line.trim() + "\r\n";
    await this.writer.write(clean);
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.isConnected && !this.isStreaming) {
        this.sendLine("?");
      }
    }, 150); // ~7Hz polling
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async readLoop() {
    try {
      while (this.isConnected && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.handleIncomingData(value);
        }
      }
    } catch (err) {
      console.warn("Read loop ended:", err);
    }
  }

  handleIncomingData(chunk) {
    this.incomingBuffer += chunk;
    const lines = this.incomingBuffer.split("\n");
    this.incomingBuffer = lines.pop(); // keep partial

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith("<") && line.endsWith(">")) {
        this.parseGrblStatus(line);
      } else if (line.toLowerCase() === "ok" || line.toLowerCase().includes("ok")) {
        // Ack for streaming
        if (this.streamingAckResolve) {
          const resolve = this.streamingAckResolve;
          this.streamingAckResolve = null;
          resolve();
        }
      } else if (line.toLowerCase().startsWith("error") || line.toLowerCase().startsWith("alarm")) {
        this.log(`GRBL Alert: ${line}`);
        // CRUCIAL: Do not hang the streamer on error!
        if (this.streamingAckResolve) {
          const resolve = this.streamingAckResolve;
          this.streamingAckResolve = null;
          resolve();
        }
      }
    }
  }

  parseGrblStatus(statusStr) {
    // Format: <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000>
    const content = statusStr.slice(1, -1);
    const parts = content.split("|");
    this.state = parts[0].toUpperCase();

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith("MPos:")) {
        const coords = p.substring(5).split(",").map(Number);
        this.mpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
        this.wpos = { ...this.mpos };
      } else if (p.startsWith("WPos:")) {
        const coords = p.substring(5).split(",").map(Number);
        this.wpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
      } else if (p.startsWith("FS:")) {
        const vals = p.substring(3).split(",").map(Number);
        this.feed = vals[0] || 0;
        this.spindle = vals[1] || 0;
      }
    }

    if (this.onStatus) {
      try {
        this.onStatus(this.getStatusDict());
      } catch (err) {
        console.warn("[WebSerial] onStatus callback error:", err);
      }
    }
  }

  getStatusDict() {
    const elapsed = this.isStreaming ? (Date.now() - this.jobStartTime) / 1000 : 0;
    const pct = this.streamingTotalLines > 0 ? (this.streamingCurrentLine / this.streamingTotalLines) * 100 : 0;
    const remaining = (this.streamingTotalLines > 0 && this.streamingCurrentLine > 0)
      ? (elapsed / this.streamingCurrentLine) * (this.streamingTotalLines - this.streamingCurrentLine)
      : 0;

    return {
      connected: this.isConnected,
      port: "Web Serial (USB)",
      state: this.state,
      wpos: this.wpos,
      mpos: this.mpos,
      feed: this.feed,
      spindle: this.spindle,
      laser_dot: this.isLaserDotOn,
      streaming: {
        active: this.isStreaming,
        paused: this.isPaused,
        current_line: this.streamingCurrentLine,
        total_lines: this.streamingTotalLines,
        progress_pct: Math.min(100, Math.round(pct * 10) / 10),
        elapsed_sec: Math.round(elapsed),
        remaining_sec: Math.round(remaining),
        job_name: this.currentJobName || ""
      }
    };
  }

  // --- HARDWARE ACTIONS ---

  async jog(dx, dy, feed = 1200) {
    if (!this.isConnected) return;
    await this.sendLine(`$J=G91 G21 X${dx.toFixed(3)} Y${dy.toFixed(3)} F${feed}`);
  }

  async home() {
    if (!this.isConnected) return;
    this.log("Executing GRBL physical homing ($H)...");
    await this.sendLine("$H");
  }

  async setZero() {
    if (!this.isConnected) return;
    this.log("Setting active coordinate system origin (G92 X0 Y0)...");
    await this.sendLine("G92 X0 Y0");
  }

  async goToOrigin() {
    if (!this.isConnected) {
      this.wpos = { x: 0.0, y: 0.0, z: 0.0 };
      this.mpos = { x: 0.0, y: 0.0, z: 0.0 };
      if (this.onStatus) this.onStatus(this.getStatusDict());
      return;
    }
    this.log("Moving laser directly to Physical Origin (0,0)...");
    await this.sendLine("G90 G21");
    await this.sendLine("G0 X0 Y0 F1500");
    await this.sendLine("M3 S20"); // 2.0% aiming dot
    this.isLaserDotOn = true;

    setTimeout(async () => {
      await this.sendLine("M5");
      this.isLaserDotOn = false;
      this.log("Aiming dot turned off after origin verification.");
    }, 4000);
  }

  async toggleLaserDot(power = 20) {
    if (!this.isConnected) return false;
    this.isLaserDotOn = !this.isLaserDotOn;
    if (this.isLaserDotOn) {
      await this.sendLine(`M3 S${power}`);
      this.log(`Aiming dot ON (${(power / 10).toFixed(1)}% power)`);
    } else {
      await this.sendLine("M5");
      this.log("Aiming dot OFF");
    }
    return this.isLaserDotOn;
  }

  async traceFrame(xmin, ymin, xmax, ymax, feed = 1500) {
    if (!this.isConnected) return;
    this.log(`Tracing workpiece frame [${xmin}, ${ymin}] to [${xmax}, ${ymax}]...`);
    await this.sendLine("G90 G21");
    await this.sendLine(`G0 X${xmin} Y${ymin} F${feed}`);
    await this.sendLine("M3 S20");
    await this.sendLine(`G1 X${xmax} Y${ymin} F${feed}`);
    await this.sendLine(`G1 X${xmax} Y${ymax} F${feed}`);
    await this.sendLine(`G1 X${xmin} Y${ymax} F${feed}`);
    await this.sendLine(`G1 X${xmin} Y${ymin} F${feed}`);
    await this.sendLine("M5");
    this.log("Frame trace complete.");
  }

  // --- STREAMING G-CODE ---

  async streamGcode(lines, jobName = "Engraving Job", onProgress = null) {
    if (!this.isConnected || !lines || lines.length === 0) {
      throw new Error("Laser not connected or empty G-code.");
    }

    this.isStreaming = true;
    this.isPaused = false;
    this.abortRequested = false;
    this.streamingTotalLines = lines.length;
    this.streamingCurrentLine = 0;
    this.jobStartTime = Date.now();
    this.currentJobName = jobName;
    this.stopPolling();

    this.log(`Starting stream for "${jobName}" (${lines.length} lines)...`);

    try {
      // Ensure machine is awake, laser mode is active, and alarm is cleared
      await this.sendLine("$X");
      await new Promise(r => setTimeout(r, 80));
      await this.sendLine("$32=1");
      await new Promise(r => setTimeout(r, 80));

      for (let i = 0; i < lines.length; i++) {
        if (this.abortRequested) {
          await this.sendLine("M5");
          await this.sendLine("\x18"); // Ctrl+X soft reset
          this.log("Stream aborted by user.");
          break;
        }

        while (this.isPaused && !this.abortRequested) {
          await new Promise(r => setTimeout(r, 200));
        }

        const line = lines[i].trim();
        this.streamingCurrentLine = i + 1;

        if (line && !line.startsWith(";")) {
          // Wait for ok ack with a safe 3.5s timeout
          let timer = null;
          const ackPromise = new Promise(resolve => {
            this.streamingAckResolve = () => {
              if (timer) clearTimeout(timer);
              resolve();
            };
            timer = setTimeout(() => {
              this.streamingAckResolve = null;
              resolve(); // Don't hang forever
            }, 3500);
          });
          await this.sendLine(line);
          await ackPromise;
        }

        if (i % 15 === 0 && onProgress) {
          try {
            onProgress(this.getStatusDict());
          } catch (e) {
            console.warn("[WebSerial] onProgress callback error:", e);
          }
        }
      }

      // Safe finish
      await this.sendLine("M5");
      await this.sendLine("G0 X0 Y0 F1500");
      this.log(`Stream complete: ${jobName}!`);
    } finally {
      this.isStreaming = false;
      this.startPolling();
      if (onProgress) onProgress(this.getStatusDict());
    }
  }

  pauseStream() {
    this.isPaused = true;
    this.sendLine("!"); // GRBL Feed hold
    this.sendLine("M5"); // Turn off laser immediately for safety
    this.log("Job paused.");
  }

  resumeStream() {
    this.isPaused = false;
    this.sendLine("~"); // GRBL Cycle start / resume
    this.log("Job resumed.");
  }

  stopStream() {
    this.abortRequested = true;
    this.sendLine("M5");
    this.sendLine("\x18"); // GRBL Soft Reset
    this.log("Job stopped.");
  }
}

window.WebSerialController = WebSerialController;
