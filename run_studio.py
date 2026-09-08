"""
Launcher for Falcon Laser Studio.
Starts the local Starlette + Uvicorn server and automatically opens the user's web browser.
"""

import os
import sys
import time
import webbrowser
import threading

# Ensure backend directory is on sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
sys.path.insert(0, BACKEND_DIR)

from server import app

def open_browser():
    time.sleep(1.2)
    url = "http://localhost:8000"
    print(f"\n========================================================")
    print(f"   FALCON LASER STUDIO IS RUNNING!")
    print(f"   Opening browser at: {url}")
    print(f"   Press Ctrl+C to stop the server.")
    print(f"========================================================\n")
    webbrowser.open(url)

if __name__ == "__main__":
    import uvicorn
    # Launch browser in a background thread
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
