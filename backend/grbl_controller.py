"""
GRBL 1.1 Serial Hardware Controller for Creality CR-Laser Falcon 5W.
Handles connection, status polling, jog commands, framing, and thread-safe streaming.
"""

import time
import threading
import re
import serial
import serial.tools.list_ports
from typing import Optional, Dict, Any, List

class GrblController:
    def __init__(self, port: str = "COM9", baudrate: int = 115200):
        self.port_name = port
        self.baudrate = baudrate
        self.ser: Optional[serial.Serial] = None
        self.lock = threading.Lock()
        
        # State
        self.is_connected = False
        self.machine_state = "DISCONNECTED" # IDLE, RUN, HOLD, ALARM, DISCONNECTED
        self.mpos = [0.0, 0.0, 0.0]
        self.wpos = [0.0, 0.0, 0.0]
        self.feed_rate = 0.0
        self.spindle_val = 0.0
        
        # Streaming state
        self.is_streaming = False
        self.is_paused = False
        self.stream_abort_requested = False
        self.current_line_idx = 0
        self.total_lines = 0
        self.job_start_time = 0.0
        self.current_job_name = ""
        self.job_elapsed_seconds = 0.0
        self.job_estimated_remaining = 0.0
        
        # Laser dot state
        self.is_laser_dot_on = False
        
        # Threads
        self.poll_thread: Optional[threading.Thread] = None
        self.stream_thread: Optional[threading.Thread] = None
        self.running = False

    @staticmethod
    def list_ports() -> List[Dict[str, str]]:
        ports = []
        for p in serial.tools.list_ports.comports():
            ports.append({
                "port": p.device,
                "description": p.description,
                "hwid": p.hwid
            })
        return ports

    def connect(self, port: Optional[str] = None) -> bool:
        with self.lock:
            if self.is_connected:
                return True
            target_port = port or self.port_name
            try:
                self.ser = serial.Serial()
                self.ser.port = target_port
                self.ser.baudrate = self.baudrate
                self.ser.timeout = 0.1
                self.ser.write_timeout = 1.0
                self.ser.dtr = False
                self.ser.rts = False
                self.ser.open()
                
                self.port_name = target_port
                self.is_connected = True
                self.machine_state = "IDLE"
                
                # Wakeup GRBL
                self.ser.write(b"\r\n\r\n")
                time.sleep(0.5)
                self.ser.flushInput()
                
                # Start poll thread
                self.running = True
                self.poll_thread = threading.Thread(target=self._status_poll_loop, daemon=True)
                self.poll_thread.start()
                return True
            except Exception as e:
                self.is_connected = False
                self.machine_state = "DISCONNECTED"
                print(f"[GRBL] Connection failed to {target_port}: {e}")
                return False

    def disconnect(self):
        with self.lock:
            self.running = False
            self.is_connected = False
            self.machine_state = "DISCONNECTED"
            if self.is_streaming:
                self.stream_abort_requested = True
            if self.ser and self.ser.is_open:
                try:
                    self.ser.write(b"M5\r\n")
                    time.sleep(0.1)
                    self.ser.close()
                except Exception:
                    pass
                self.ser = None

    def send_immediate(self, char_or_cmd: bytes):
        """Send immediate realtime command like '?' (0x3F), '!' (hold), '~' (resume), or 0x18 (reset)."""
        with self.lock:
            if self.ser and self.ser.is_open:
                try:
                    self.ser.write(char_or_cmd)
                except Exception as e:
                    print(f"[GRBL] Send immediate error: {e}")

    def send_line(self, line: str, timeout: float = 3.0) -> bool:
        """Send a single line and wait for 'ok' or 'error'."""
        with self.lock:
            if not self.ser or not self.ser.is_open:
                return False
            clean = line.strip()
            if not clean:
                return True
            try:
                self.ser.write((clean + "\n").encode("utf-8"))
                start = time.time()
                while time.time() - start < timeout:
                    res = self.ser.readline().decode("utf-8", errors="ignore").strip()
                    if res == "ok":
                        return True
                    if "error" in res.lower():
                        print(f"[GRBL Error] Command '{clean}' returned: {res}")
                        return False
                return False
            except Exception as e:
                print(f"[GRBL] Error sending line: {e}")
                return False

    def jog(self, dx: float = 0.0, dy: float = 0.0, feed: float = 1200.0) -> bool:
        """Send GRBL 1.1 jogging command."""
        if not self.is_connected or self.is_streaming:
            return False
        jog_cmd = f"$J=G91 G21 X{dx:.3f} Y{dy:.3f} F{feed:.0f}"
        return self.send_line(jog_cmd)

    def home(self) -> bool:
        """Run physical homing cycle ($H)."""
        if not self.is_connected or self.is_streaming:
            return False
        return self.send_line("$H", timeout=30.0)

    def set_zero(self) -> bool:
        """Zero current coordinates (G92 X0 Y0)."""
        if not self.is_connected:
            return False
        return self.send_line("G92 X0 Y0")

    def toggle_laser_dot(self, power_s: int = 5) -> bool:
        """Toggle a 0.5% low-power aiming laser dot."""
        if not self.is_connected:
            return False
        if self.is_laser_dot_on:
            self.send_line("M5")
            self.is_laser_dot_on = False
            return False
        else:
            self.send_line(f"M3 S{power_s}")
            self.is_laser_dot_on = True
            return True

    def trace_frame(self, x_min: float, y_min: float, x_max: float, y_max: float, speed: float = 1500.0) -> bool:
        """Trace the rectangular frame with safe low-power aiming beam."""
        if not self.is_connected or self.is_streaming:
            return False
        
        commands = [
            "G90 G21",
            f"G0 X{x_min:.3f} Y{y_min:.3f}",
            "M3 S5",  # 0.5% power safe trace
            f"G1 X{x_max:.3f} Y{y_min:.3f} F{speed:.0f}",
            f"G1 X{x_max:.3f} Y{y_max:.3f}",
            f"G1 X{x_min:.3f} Y{y_max:.3f}",
            f"G1 X{x_min:.3f} Y{y_min:.3f}",
            "M5",
            f"G0 X{x_min:.3f} Y{y_min:.3f}"
        ]
        for cmd in commands:
            if not self.send_line(cmd):
                self.send_line("M5")
                return False
        return True

    def start_stream(self, gcode_lines: List[str], job_name: str = "Job") -> bool:
        """Stream a full G-code job in a background thread."""
        if not self.is_connected or self.is_streaming:
            return False
        
        self.is_streaming = True
        self.is_paused = False
        self.stream_abort_requested = False
        self.current_line_idx = 0
        self.total_lines = len(gcode_lines)
        self.current_job_name = job_name
        self.job_start_time = time.time()
        self.job_elapsed_seconds = 0.0
        self.job_estimated_remaining = 0.0
        
        self.stream_thread = threading.Thread(
            target=self._streaming_worker,
            args=(gcode_lines,),
            daemon=True
        )
        self.stream_thread.start()
        return True

    def pause_stream(self):
        """Pause running job."""
        if self.is_streaming and not self.is_paused:
            self.is_paused = True
            self.send_immediate(b"!")
            self.send_line("M5")

    def resume_stream(self):
        """Resume running job."""
        if self.is_streaming and self.is_paused:
            self.is_paused = False
            self.send_immediate(b"~")

    def stop_stream(self):
        """Instant emergency abort."""
        self.stream_abort_requested = True
        self.is_streaming = False
        self.is_paused = False
        self.send_immediate(b"\x18")
        time.sleep(0.05)
        self.send_immediate(b"M5\r\n")

    def _streaming_worker(self, lines: List[str]):
        """Stream lines with flow control."""
        try:
            for idx, raw_line in enumerate(lines):
                if self.stream_abort_requested:
                    break
                
                while self.is_paused and not self.stream_abort_requested:
                    time.sleep(0.1)
                
                line = raw_line.strip()
                if not line or line.startswith(";"):
                    self.current_line_idx = idx + 1
                    continue
                
                success = self.send_line(line, timeout=10.0)
                if not success and not self.stream_abort_requested:
                    print(f"[GRBL Stream] Line failed: {line}")
                
                self.current_line_idx = idx + 1
                now = time.time()
                self.job_elapsed_seconds = now - self.job_start_time
                if self.current_line_idx > 10:
                    lines_per_sec = self.current_line_idx / max(1.0, self.job_elapsed_seconds)
                    remaining_lines = self.total_lines - self.current_line_idx
                    self.job_estimated_remaining = remaining_lines / max(0.1, lines_per_sec)
                    
        finally:
            self.send_line("M5")
            self.is_streaming = False
            self.is_paused = False
            self.stream_abort_requested = False

    def _status_poll_loop(self):
        """10Hz status polling loop sending '?'."""
        status_regex = re.compile(r"<([^,>]+)\|([^>]+)>")
        while self.running:
            if self.is_connected and self.ser and self.ser.is_open:
                try:
                    self.send_immediate(b"?")
                    time.sleep(0.08)
                    while self.ser and self.ser.is_open and self.ser.in_waiting > 0:
                        line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                        m = status_regex.match(line)
                        if m:
                            self.machine_state = m.group(1).upper()
                            fields = m.group(2).split("|")
                            for f in fields:
                                if f.startswith("WPos:"):
                                    coords = [float(v) for v in f[5:].split(",")]
                                    self.wpos = coords
                                elif f.startswith("MPos:"):
                                    coords = [float(v) for v in f[5:].split(",")]
                                    self.mpos = coords
                                elif f.startswith("FS:"):
                                    parts = f[3:].split(",")
                                    self.feed_rate = float(parts[0])
                                    if len(parts) > 1:
                                        self.spindle_val = float(parts[1])
                except Exception:
                    pass
            time.sleep(0.1)

    def get_status_dict(self) -> Dict[str, Any]:
        progress_pct = 0.0
        if self.total_lines > 0:
            progress_pct = round((self.current_line_idx / self.total_lines) * 100, 1)
        
        return {
            "connected": self.is_connected,
            "port": self.port_name,
            "state": self.machine_state,
            "wpos": {"x": self.wpos[0], "y": self.wpos[1], "z": self.wpos[2] if len(self.wpos) > 2 else 0.0},
            "mpos": {"x": self.mpos[0], "y": self.mpos[1], "z": self.mpos[2] if len(self.mpos) > 2 else 0.0},
            "feed": self.feed_rate,
            "spindle": self.spindle_val,
            "laser_dot": self.is_laser_dot_on,
            "streaming": {
                "active": self.is_streaming,
                "paused": self.is_paused,
                "current_line": self.current_line_idx,
                "total_lines": self.total_lines,
                "progress_pct": progress_pct,
                "elapsed_sec": round(self.job_elapsed_seconds, 1),
                "remaining_sec": round(self.job_estimated_remaining, 1),
                "job_name": self.current_job_name
            }
        }
