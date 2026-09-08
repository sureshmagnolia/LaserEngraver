# Falcon Laser Studio 🚀
### Precision Web Controller & CAM Studio for Creality CR-Laser Falcon 5W

[![Live GitHub Pages](https://img.shields.io/badge/Live%20App-GitHub%20Pages-00e5ff?style=for-the-badge&logo=github)](https://sureshmagnolia.github.io/LaserEngraver/)
[![Machine](https://img.shields.io/badge/Machine-Creality%20Falcon%205W-ff9100?style=for-the-badge)](https://www.creality.com/)
[![Firmware](https://img.shields.io/badge/Firmware-GRBL%201.1%20@%20115200-00e676?style=for-the-badge)](https://github.com/gnea/grbl)
[![Protocol](https://img.shields.io/badge/Protocol-Web%20Serial%20API%20(W3C)-7c4dff?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

**Falcon Laser Studio** is an open-source, web-based laser engraving application designed for the **Creality CR-Laser Falcon 5W** ($400 \times 415\text{ mm}$ travel) and precision spoilboards / glass platforms ($72 \times 72\text{ cm}$).

It runs **100% in the browser on GitHub Pages** using the native **W3C Web Serial API** for direct USB control, or with an optional local Python bridge for offline batch processing.

🔗 **Launch App Online:** [https://sureshmagnolia.github.io/LaserEngraver/](https://sureshmagnolia.github.io/LaserEngraver/)

---

## 🌟 Key Features

### 1. 🎯 Physical (0,0) Machine Origin & Bed Datum
* **Concentric Quarter-Bullseye Arcs:** Radiates directly from physical $(0,0)$ into Quadrant 1 ($R = 5, 10, 20, 30, 45\text{ mm}$).
* **Double-Pass Corner Fence Rulers:** Rigid boundary baselines along $+X$ and $+Y$ ($0..70\text{ mm}$) with precision 1mm and 5mm fine ticks.
* **45° Alignment Ray & Zero-Datum Notch:** $5 \times 5\text{ mm}$ square corner box for squaring workpieces.
* **Vector Text Labels:** Permanently burns single-stroke `ORIGIN (0,0)`, `+X (Width)`, and `+Y (Depth)`.
* **Zero Collision Risk:** All coordinates are strictly $\ge 0.0$ to prevent limit switch collisions.

### 2. 🪟 Bed Reference Scale Engraver (Glass, Wood, Metal)
Calibrate and burn a permanent millimeter coordinate grid onto any surface:
* 🪟 **Black / Coated Glass Bed:** Calibrated $F800\text{ mm/min}, S450$ ($45\%$). Features built-in safety reminder to apply paper masking tape or black tempera paint to eliminate 450nm specular reflection into the laser diode.
* 🪵 **Wood / MDF Spoilboard:** Calibrated $F1200\text{ mm/min}, S300$ ($30\%$). Burns clean, dark charred millimeter lines and target pockets.
* 🛡️ **Anodized / Coated Metal:** Calibrated $F600\text{ mm/min}, S850$ ($85\%$). Bleaches dye layer for bright white markings.
* **Preset Target Pockets:** Integrated circles for **40 mm keychains** (center + 4 quadrants) and **100 mm circular plaques**.

### 3. ⚡ Zero-Install Web Serial USB Control
* Connects directly from **Google Chrome**, **Microsoft Edge**, or **Opera** over USB at 115200 baud.
* **10Hz Status Polling:** Parses GRBL real-time reports (`<Idle|MPos:...|WPos:...|FS:...>`).
* **Line-by-Line Streaming:** Flow control with character count and `ok` acknowledgment.
* **Hardware Jog Pad:** $X\pm, Y\pm$ micro-stepping ($1\text{ mm}, 10\text{ mm}, 50\text{ mm}$).
* **1-Click Machine Homing:** `$H` optical limit switch homing.
* **Move to Origin:** Rapid move to $(0,0)$ with automatic 4-second $0.5\%$ aiming dot pulse.

### 4. 🎨 Dual Engraving Modes & File Ingestion
* **SVG Vector Trace Mode:** Continuous vector cutting (`G0`/`G1`) with zero raster sweeps.
* **Inkjet-Style Raster Engraving:** Bidirectional horizontal sweeps with Floyd-Steinberg and Atkinson dithering + overscan acceleration buffers.
* **Photo-to-Line-Art Conversion:** Converts ordinary photos and sketches into clean single-stroke vector line drawings.
* **Workpiece Transforms:** Flip Horizontal (Mirror X), Flip Vertical (Mirror Y), Rotate 90° CW/CCW, and Quick Scale buttons ($-20\%$, $-10\%$, $+10\%$, $+20\%$, $+50\%$).
* **Interactive Canvas Handles:** Drag corner handles on the 2D Bed Map to resize visually.

---

## 🚀 Quick Start (GitHub Pages)

1. Connect your **Creality CR-Laser Falcon 5W** to your computer via USB.
2. Turn on the 24V power supply on the Falcon machine.
3. Open **[https://sureshmagnolia.github.io/LaserEngraver/](https://sureshmagnolia.github.io/LaserEngraver/)** in Chrome or Edge.
4. Click **`⚡ USB Connect`** in the top header.
5. In the browser popup, select your Falcon USB serial device (e.g. `COM9` or `USB-SERIAL CH340`) and click **Connect**.
6. Under **Jog & Origin**:
   * Click **`⌂ Home ($H)`** to home the machine.
   * Click **`🎯 Move Laser to Origin (0, 0)`** — the laser moves to $(0,0)$ and pulses the aiming light.
7. Switch to the **Bed Scale** tab, pick your material (Glass, Wood, or Metal), and click **`▶ Burn Bed Scale Now`**!

---

## 💻 Optional: Running Locally (with Python Server)

If you prefer to run locally with advanced AI background removal (`rembg`) and OpenCV filters:

```powershell
# 1. Clone repository
git clone https://github.com/sureshmagnolia/LaserEngraver.git
cd LaserEngraver

# 2. Run local studio
python run_studio.py
```

The local Starlette server will start on `http://localhost:8000` and automatically open your default browser.

---

## 📁 Repository Structure

```
LaserEngraver/
├── index.html                  # Main UI for GitHub Pages
├── css/
│   └── style.css               # Dark glassmorphism styling & tokens
├── js/
│   ├── web_serial_controller.js # W3C Web Serial API hardware driver
│   ├── bed_scale_generator.js   # Client-side bed calibration & origin datum
│   ├── svg_gcode_compiler.js    # Client-side SVG to vector G-code
│   ├── raster_compiler.js       # Client-side Floyd-Steinberg dithering
│   ├── bed_canvas.js            # Interactive 2D bed digital twin
│   └── app.js                   # Application state & event dispatcher
├── backend/                    # Optional local Python backend
│   ├── grbl_controller.py      # Multi-threaded PySerial controller
│   ├── bed_scale_generator.py  # Python scale generator
│   ├── photo_tracer.py         # OpenCV / Rembg line art tracer
│   ├── raster_engine.py        # Python raster engine
│   ├── svg_engine.py           # Python SVG parser
│   └── server.py               # Starlette / Uvicorn API server
├── presets/                    # Pre-tuned G-code files
│   ├── keychain_4cm_vector.gcode
│   ├── keychain_10cm_vector.gcode
│   └── black_glass_bed_scale.gcode
├── run_studio.py               # 1-click Python launcher
└── start_studio.bat            # Windows batch shortcut
```

---

## 🔒 Safety Information for Diode Lasers

* **Eye Protection:** ALWAYS wear OD4+ 450nm safety goggles when the laser is energized.
* **Glass Reflection Risk:** When engraving on glass (such as a 72×72 cm black glass platform), never fire a 450nm laser directly onto bare reflective glass. Always apply paper masking tape or a coat of black tempera paint before firing to absorb the beam and prevent specular reflection.
* **Ventilation:** Ensure adequate cross-ventilation or extraction when engraving wood, acrylic, or coated materials.

---

## 📜 License

MIT License. Designed and crafted for laser enthusiasts and makers.
