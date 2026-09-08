"""
Starlette + Uvicorn Local Web Server for Falcon Laser Studio.
Provides REST APIs for GRBL hardware control, SVG parsing, photo-to-line-art conversion,
raster G-code generation, and real-time WebSocket status updates.
"""

import os
import sys
import json
import base64
import asyncio
from typing import Dict, Any, List

from starlette.applications import Starlette
from starlette.responses import JSONResponse, FileResponse, HTMLResponse
from starlette.routing import Route, Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

# Add backend directory to sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STUDIO_DIR = os.path.dirname(BASE_DIR)
sys.path.insert(0, BASE_DIR)

from grbl_controller import GrblController
from photo_tracer import PhotoTracer
from svg_engine import SvgEngine
from raster_engine import RasterEngine
from bed_scale_generator import BedScaleGenerator

# Global controller instance
controller = GrblController(port="COM9")

# Global cached generated G-code for current active job
current_active_gcode: List[str] = []

# Connected WebSockets
active_websockets: List[WebSocket] = []

# --- API Endpoints ---

async def api_get_ports(request):
    ports = GrblController.list_ports()
    return JSONResponse({"ports": ports})

async def api_connect(request):
    data = await request.json()
    port = data.get("port", "COM9")
    success = controller.connect(port)
    return JSONResponse({"success": success, "status": controller.get_status_dict()})

async def api_disconnect(request):
    controller.disconnect()
    return JSONResponse({"success": True, "status": controller.get_status_dict()})

async def api_status(request):
    return JSONResponse(controller.get_status_dict())

async def api_jog(request):
    data = await request.json()
    dx = float(data.get("dx", 0.0))
    dy = float(data.get("dy", 0.0))
    feed = float(data.get("feed", 1200.0))
    success = controller.jog(dx, dy, feed)
    return JSONResponse({"success": success})

async def api_home(request):
    success = controller.home()
    return JSONResponse({"success": success})

async def api_zero(request):
    success = controller.set_zero()
    return JSONResponse({"success": success})

async def api_laser_dot(request):
    data = await request.json() if request.headers.get("content-type") == "application/json" else {}
    power = int(data.get("power", 5))
    is_on = controller.toggle_laser_dot(power)
    return JSONResponse({"laser_dot_on": is_on})

async def api_trace_frame(request):
    data = await request.json()
    xmin = float(data.get("xmin", 0.0))
    ymin = float(data.get("ymin", 0.0))
    xmax = float(data.get("xmax", 50.0))
    ymax = float(data.get("ymax", 50.0))
    speed = float(data.get("speed", 1500.0))
    success = controller.trace_frame(xmin, ymin, xmax, ymax, speed)
    return JSONResponse({"success": success})

async def api_process_photo(request):
    """Photo-to-line-art vector tracing endpoint."""
    try:
        data = await request.json()
        b64_img = data.get("image_base64", "")
        if "," in b64_img:
            b64_img = b64_img.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_img)

        mode = data.get("mode", "sketch")
        remove_bg = bool(data.get("remove_bg", False))
        invert = bool(data.get("invert", False))
        detail_level = int(data.get("detail_level", 50))
        line_thickness = int(data.get("line_thickness", 1))
        smoothing = float(data.get("smoothing", 1.0))

        result = PhotoTracer.process_image(
            img_bytes=img_bytes,
            mode=mode,
            remove_bg=remove_bg,
            invert=invert,
            detail_level=detail_level,
            line_thickness=line_thickness,
            smoothing=smoothing
        )
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_preview_raster(request):
    """Inkjet raster dithering preview endpoint."""
    try:
        data = await request.json()
        b64_img = data.get("image_base64", "")
        if "," in b64_img:
            b64_img = b64_img.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_img)

        mode = data.get("mode", "floyd")
        invert = bool(data.get("invert", False))
        contrast = float(data.get("contrast", 1.0))
        brightness = int(data.get("brightness", 0))

        result = RasterEngine.generate_raster_preview(
            img_bytes=img_bytes,
            mode=mode,
            invert=invert,
            contrast=contrast,
            brightness=brightness
        )
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_parse_svg(request):
    """Parse SVG XML string into normalized vector paths."""
    try:
        data = await request.json()
        svg_xml = data.get("svg_xml", "")
        result = SvgEngine.parse_svg_string(svg_xml)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_generate_gcode(request):
    """Generate G-code for either Vector Trace or Inkjet Raster."""
    global current_active_gcode
    try:
        data = await request.json()
        job_type = data.get("job_type", "vector") # "vector" or "raster"
        x_pos = float(data.get("x", 190.0))
        y_pos = float(data.get("y", 190.0))
        width_mm = float(data.get("width", 40.0))
        height_mm = float(data.get("height", 40.0))
        speed = float(data.get("speed", 900.0))
        power = int(data.get("power", 280))

        if job_type == "vector":
            paths = data.get("paths", [])
            passes = int(data.get("passes", 1))
            lines = SvgEngine.generate_vector_gcode(
                norm_paths=paths,
                x_pos=x_pos,
                y_pos=y_pos,
                width_mm=width_mm,
                height_mm=height_mm,
                speed_mm_min=speed,
                power_s=power,
                passes=passes
            )
        else:
            # Raster
            b64_img = data.get("image_base64", "")
            if "," in b64_img:
                b64_img = b64_img.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_img)

            interval = float(data.get("interval", 0.15))
            dither_mode = data.get("dither_mode", "floyd")
            invert = bool(data.get("invert", False))

            lines = RasterEngine.generate_raster_gcode(
                img_bytes=img_bytes,
                x_start=x_pos,
                y_start=y_pos,
                target_width_mm=width_mm,
                target_height_mm=height_mm,
                line_interval_mm=interval,
                speed_mm_min=speed,
                max_power_s=power,
                min_power_s=0,
                dither_mode=dither_mode,
                invert=invert
            )

        current_active_gcode = lines
        return JSONResponse({
            "success": True,
            "line_count": len(lines),
            "estimated_time_sec": round(len(lines) * 0.03, 1),
            "snippet": lines[:25]
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_start_job(request):
    """Start streaming the generated job to the laser."""
    global current_active_gcode
    data = await request.json() if request.headers.get("content-type") == "application/json" else {}
    job_name = data.get("job_name", "Engraving Job")
    
    if not current_active_gcode:
        return JSONResponse({"error": "No G-code generated yet. Generate job first."}, status_code=400)
    
    success = controller.start_stream(current_active_gcode, job_name=job_name)
    return JSONResponse({"success": success, "status": controller.get_status_dict()})

async def api_pause_job(request):
    controller.pause_stream()
    return JSONResponse({"success": True})

async def api_resume_job(request):
    controller.resume_stream()
    return JSONResponse({"success": True})

async def api_stop_job(request):
    controller.stop_stream()
    return JSONResponse({"success": True})

async def api_presets(request):
    """Load pre-calibrated Chittur jobs and Bed Scale."""
    presets = [
        {
            "id": "chittur_4cm",
            "name": "Chittur Emblem - 4cm Keychain",
            "type": "vector",
            "width": 35.0,
            "height": 35.0,
            "speed": 900,
            "power": 280,
            "desc": "Calibrated 35mm emblem for 40mm wooden discs. Zero double lines, solid text, complete ribbon."
        },
        {
            "id": "chittur_10cm",
            "name": "Chittur Emblem - 10cm Plaque",
            "type": "vector",
            "width": 90.0,
            "height": 90.0,
            "speed": 1000,
            "power": 320,
            "desc": "Calibrated 90mm emblem for 100mm wooden discs/plaques."
        },
        {
            "id": "bed_scale_200mm",
            "name": "Alignment Scale (200x200 mm)",
            "type": "vector",
            "width": 200.0,
            "height": 200.0,
            "speed": 800,
            "power": 450,
            "desc": "Precision reference grid with 40mm & 100mm target rings and mm rulers."
        },
        {
            "id": "bed_scale_380mm",
            "name": "Full-Bed Calibration Grid (380x380 mm)",
            "type": "vector",
            "width": 380.0,
            "height": 380.0,
            "speed": 1000,
            "power": 400,
            "desc": "Full coverage grid across Falcon 5W's complete working envelope on 72cm platform."
        }
    ]
    return JSONResponse({"presets": presets})

async def api_load_preset_gcode(request):
    """Directly load one of our pre-generated master G-code files from D:\\FalconEngraving."""
    global current_active_gcode
    data = await request.json()
    preset_id = data.get("id", "")
    
    file_map = {
        "chittur_4cm": r"D:\FalconEngraving\keychain_4cm_vector.gcode",
        "chittur_10cm": r"D:\FalconEngraving\keychain_10cm_vector.gcode",
        "bed_scale_200mm": r"D:\FalconEngraving\black_glass_bed_scale.gcode",
    }
    
    target_path = file_map.get(preset_id)
    if target_path and os.path.exists(target_path):
        with open(target_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        current_active_gcode = lines
        return JSONResponse({"success": True, "line_count": len(lines), "path": target_path})
    return JSONResponse({"error": f"Preset file not found for {preset_id}"}, status_code=404)

# --- WebSocket Telemetry (10Hz) ---

async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    try:
        while True:
            status = controller.get_status_dict()
            await websocket.send_json(status)
            await asyncio.sleep(0.1) # 10Hz updates
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)

# --- App Definition ---

frontend_dir = os.path.join(STUDIO_DIR, "frontend")

async def index(request):
    return FileResponse(os.path.join(frontend_dir, "index.html"))

async def api_generate_bed_scale(request):
    """Generate G-code for Bed Reference Scale tuned for Glass, Wood, or Metal with (0,0) Origin."""
    global current_active_gcode
    try:
        data = await request.json()
        material = data.get("material", "glass")
        size_mm = float(data.get("size_mm", 380.0))
        origin_mode = data.get("origin_mode", "front_left")
        center_x = float(data.get("center_x", 200.0))
        center_y = float(data.get("center_y", 207.5))
        inc_40 = bool(data.get("include_40mm", True))
        inc_100 = bool(data.get("include_100mm", True))
        inc_rulers = bool(data.get("include_rulers", True))
        inc_grid = bool(data.get("include_grid", True))
        speed = data.get("speed")
        power = data.get("power")

        res = BedScaleGenerator.generate_grid_gcode(
            material=material,
            size_mm=size_mm,
            origin_mode=origin_mode,
            center_x=center_x,
            center_y=center_y,
            include_origin_datum=True,
            include_40mm_targets=inc_40,
            include_100mm_targets=inc_100,
            include_rulers=inc_rulers,
            include_grid=inc_grid,
            custom_speed=float(speed) if speed else None,
            custom_power=int(power) if power else None
        )

        current_active_gcode = res["gcode_lines"]
        return JSONResponse({
            "success": True,
            "material_name": res["material_name"],
            "safety_note": res["safety_note"],
            "speed": res["speed"],
            "power": res["power"],
            "line_count": res["line_count"],
            "origin_mode": res["origin_mode"],
            "origin": res["origin"],
            "bounds": res["bounds"],
            "norm_paths": res["norm_paths"],
            "size_mm": size_mm
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_go_to_origin(request):
    """Move laser head directly to physical (0,0) Origin and flash low-power aiming dot."""
    if not controller.is_connected:
        controller.wpos = [0.0, 0.0, 0.0]
        controller.mpos = [0.0, 0.0, 0.0]
        return JSONResponse({"success": True, "simulated": True, "message": "Simulated move to Origin (0,0)"})

    if controller.is_streaming:
        return JSONResponse({"success": False, "error": "Machine is actively streaming a job"}, status_code=400)
    
    # Rapid to 0,0 and pulse aiming beam
    controller.send_line("G90 G21")
    controller.send_line("G0 X0 Y0 F1500")
    controller.send_line("M3 S5")
    # Turn off after 4 seconds in background thread
    def turn_off():
        time.sleep(4.0)
        controller.send_line("M5")
    threading.Thread(target=turn_off, daemon=True).start()
    return JSONResponse({"success": True, "message": "Laser moved to Origin (0,0) with aiming dot active for 4s"})

routes = [
    Route("/", endpoint=index),
    Route("/api/ports", endpoint=api_get_ports, methods=["GET"]),
    Route("/api/connect", endpoint=api_connect, methods=["POST"]),
    Route("/api/disconnect", endpoint=api_disconnect, methods=["POST"]),
    Route("/api/status", endpoint=api_status, methods=["GET"]),
    Route("/api/jog", endpoint=api_jog, methods=["POST"]),
    Route("/api/home", endpoint=api_home, methods=["POST"]),
    Route("/api/zero", endpoint=api_zero, methods=["POST"]),
    Route("/api/laser_dot", endpoint=api_laser_dot, methods=["POST"]),
    Route("/api/trace_frame", endpoint=api_trace_frame, methods=["POST"]),
    Route("/api/process_photo", endpoint=api_process_photo, methods=["POST"]),
    Route("/api/preview_raster", endpoint=api_preview_raster, methods=["POST"]),
    Route("/api/parse_svg", endpoint=api_parse_svg, methods=["POST"]),
    Route("/api/generate_gcode", endpoint=api_generate_gcode, methods=["POST"]),
    Route("/api/generate_bed_scale", endpoint=api_generate_bed_scale, methods=["POST"]),
    Route("/api/go_to_origin", endpoint=api_go_to_origin, methods=["POST"]),
    Route("/api/start_job", endpoint=api_start_job, methods=["POST"]),
    Route("/api/pause_job", endpoint=api_pause_job, methods=["POST"]),
    Route("/api/resume_job", endpoint=api_resume_job, methods=["POST"]),
    Route("/api/stop_job", endpoint=api_stop_job, methods=["POST"]),
    Route("/api/presets", endpoint=api_presets, methods=["GET"]),
    Route("/api/load_preset_gcode", endpoint=api_load_preset_gcode, methods=["POST"]),
    WebSocketRoute("/ws", endpoint=websocket_telemetry),
    Mount("/css", app=StaticFiles(directory=os.path.join(frontend_dir, "css")), name="css"),
    Mount("/js", app=StaticFiles(directory=os.path.join(frontend_dir, "js")), name="js"),
    Mount("/static", app=StaticFiles(directory=frontend_dir), name="static")
]

middleware = [
    Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
]

app = Starlette(debug=True, routes=routes, middleware=middleware)

if __name__ == "__main__":
    import uvicorn
    print("[Falcon Studio] Starting server on http://localhost:8000 ...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
