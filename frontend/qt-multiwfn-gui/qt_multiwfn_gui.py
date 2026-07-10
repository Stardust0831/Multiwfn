#!/usr/bin/env python3
"""Qt shell prototype for the Multiwfn GUI replacement.

This program reads the same session manifest produced by the current
Multiwfn 3Dmol backend.  It mirrors the legacy DISLIN widget layout with Qt
controls and, when QtWebEngine is available, embeds the existing 3Dmol frontend
as the render viewport.
"""

from __future__ import annotations

import argparse
import http.server
import json
import mimetypes
import os
from pathlib import Path
import socket
import socketserver
import subprocess
import sys
import threading
import time
import tempfile
import urllib.parse

PROCESS_STARTED_AT = time.perf_counter()


def _arg_value(argv: list[str], option: str) -> str | None:
    for index, value in enumerate(argv):
        if value == option and index + 1 < len(argv):
            return argv[index + 1]
        prefix = option + "="
        if value.startswith(prefix):
            return value[len(prefix) :]
    return None


def _default_cache_root(argv: list[str]) -> Path:
    configured = os.environ.get("MULTIWFN_QT_CACHE_DIR")
    if configured:
        return Path(configured).expanduser()

    manifest = _arg_value(argv, "--manifest")
    if manifest:
        return Path(manifest).expanduser().parent / "qt-cache"

    output = _arg_value(argv, "--output")
    if output:
        return Path(output).expanduser().parent / "qt-cache"

    return Path(tempfile.gettempdir()) / f"multiwfn-qt-cache-{os.getuid() if hasattr(os, 'getuid') else 'user'}"


def configure_writable_qt_cache(argv: list[str] | None = None) -> Path:
    """Keep QtWebEngine, Mesa and fontconfig caches away from read-only HOME."""
    args = list(sys.argv[1:] if argv is None else argv)
    root = _default_cache_root(args).resolve()
    xdg_cache = root / "xdg-cache"
    mesa_cache = root / "mesa-shader-cache"
    runtime_dir = root / "xdg-runtime"
    for directory in (xdg_cache, mesa_cache, runtime_dir):
        directory.mkdir(parents=True, exist_ok=True)
    try:
        runtime_dir.chmod(0o700)
    except OSError:
        pass
    os.environ.setdefault("XDG_CACHE_HOME", str(xdg_cache))
    os.environ.setdefault("MESA_SHADER_CACHE_DIR", str(mesa_cache))
    os.environ.setdefault("XDG_RUNTIME_DIR", str(runtime_dir))
    return root


QT_CACHE_ROOT = configure_writable_qt_cache()


def is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8").lower()
    except OSError:
        return False


def open_system_browser(url: str) -> bool:
    if is_wsl():
        cmd_exe = Path("/mnt/c/Windows/System32/cmd.exe")
        if cmd_exe.is_file():
            try:
                subprocess.Popen(
                    [str(cmd_exe), "/c", "start", "", url],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return True
            except OSError:
                pass
    return QDesktopServices.openUrl(QUrl(url))

from PyQt6.QtCore import Qt, QTimer, QUrl
from PyQt6.QtGui import QAction, QDesktopServices
from PyQt6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSlider,
    QSpinBox,
    QSplitter,
    QStackedWidget,
    QStatusBar,
    QTabWidget,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)

try:
    from PyQt6.QtWebEngineCore import QWebEngineProfile
    from PyQt6.QtWebEngineWidgets import QWebEngineView
except Exception:  # pragma: no cover - depends on optional runtime package
    QWebEngineProfile = None
    QWebEngineView = None

QT_IMPORTED_AT = time.perf_counter()


BACKEND_REQUEST_LOCK = threading.Lock()
BACKEND_REQUEST_CONSUME_TIMEOUT = 5.0
ORBITAL_REQUEST_TIMEOUT = 300.0
BOND_REQUEST_TIMEOUT = 300.0
FBO_REQUEST_TIMEOUT = 900.0
BACKEND_REQUEST_POLL_INTERVAL = 0.2
MAX_DYNAMIC_ORBITAL_CUBES = 12
BOND_METHODS = frozenset(("mayer", "gwbo", "wiberg_lowdin", "mulliken", "fbo"))
LAST_REQUEST_ID = 0
BACKEND_UNAVAILABLE_MESSAGE = (
    "Multiwfn backend unavailable; restart visualization from menu 0 and keep the terminal open"
)
FILE_FILTER = (
    "Multiwfn inputs (*.wfn *.wfx *.fch *.fchk *.molden *.mwfn *.chg *.pdb *.xyz *.mol *.mol2 *.cif *.cub *.cube);;"
    "All files (*)"
)


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def send_file(handler: http.server.BaseHTTPRequestHandler, path: Path) -> None:
    if not path.is_file():
        handler.send_error(404, "File not found")
        return
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    data = path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def send_json(handler: http.server.BaseHTTPRequestHandler, payload: dict, status: int = 200) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def cleanup_session_files(session_dir: Path, *, startup: bool = False) -> None:
    patterns = ["response_*.json"]
    if startup:
        patterns.append("orbital_*.cube")
    for pattern in patterns:
        for path in session_dir.glob(pattern):
            try:
                path.unlink()
            except OSError:
                pass


def prune_dynamic_orbital_cubes(session_dir: Path, keep: int = MAX_DYNAMIC_ORBITAL_CUBES) -> None:
    cubes = sorted(
        session_dir.glob("orbital_*.cube"),
        key=lambda path: path.stat().st_mtime if path.exists() else 0,
        reverse=True,
    )
    for path in cubes[max(0, keep):]:
        try:
            path.unlink()
        except OSError:
            pass


def next_request_id() -> int:
    global LAST_REQUEST_ID
    LAST_REQUEST_ID = max(int(time.time() * 1000), LAST_REQUEST_ID + 1)
    return LAST_REQUEST_ID


def request_backend(
    session_dir: Path,
    request_payload: str,
    *,
    timeout: float,
    timeout_message: str,
) -> dict:
    with BACKEND_REQUEST_LOCK:
        stop = session_dir / "gui_stop.flag"
        if stop.is_file():
            return {"ok": False, "message": BACKEND_UNAVAILABLE_MESSAGE}

        reqid = next_request_id()
        response = session_dir / f"response_{reqid}.json"
        request = session_dir / "gui_request.txt"
        if response.exists():
            response.unlink()
        request.write_text(f"{reqid} {request_payload}\n", encoding="utf-8")

        consumed = False
        consume_deadline = time.monotonic() + BACKEND_REQUEST_CONSUME_TIMEOUT
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if response.is_file():
                try:
                    return json.loads(response.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    pass

            if not consumed:
                if not request.is_file():
                    consumed = True
                elif stop.is_file():
                    return {"ok": False, "message": BACKEND_UNAVAILABLE_MESSAGE}
                elif time.monotonic() >= consume_deadline:
                    try:
                        pending = request.read_text(encoding="utf-8")
                    except FileNotFoundError:
                        consumed = True
                        continue
                    if pending.startswith(f"{reqid} "):
                        try:
                            request.unlink()
                        except FileNotFoundError:
                            pass
                        return {"ok": False, "message": BACKEND_UNAVAILABLE_MESSAGE}
                    return {"ok": False, "message": "Backend request was superseded; try again"}

            time.sleep(BACKEND_REQUEST_POLL_INTERVAL)

        return {"ok": False, "message": timeout_message}


def request_orbital(session_dir: Path, query: dict[str, list[str]]) -> dict:
    index = int(query.get("index", ["0"])[0] or 0)
    quality = int(query.get("quality", ["0"])[0] or 0)
    isovalue = float(query.get("isovalue", ["0.0"])[0] or 0.0)
    payload = request_backend(
        session_dir,
        f"orbital {index} {quality} {isovalue:.10g}",
        timeout=ORBITAL_REQUEST_TIMEOUT,
        timeout_message="Timed out waiting for Multiwfn orbital grid",
    )
    if payload.get("ok"):
        prune_dynamic_orbital_cubes(session_dir)
    return payload


def request_bond(session_dir: Path, query: dict[str, list[str]]) -> dict:
    try:
        atom1 = int(query.get("atom1", ["0"])[0] or 0)
        atom2 = int(query.get("atom2", ["0"])[0] or 0)
    except ValueError:
        return {"ok": False, "message": "Atom indices must be integers"}
    method = str(query.get("method", [""])[0] or "").strip().lower()
    if atom1 <= 0 or atom2 <= 0 or atom1 == atom2:
        return {"ok": False, "message": "Two distinct positive atom indices are required"}
    if method not in BOND_METHODS:
        return {"ok": False, "message": "Unsupported bond-order method"}
    timeout = FBO_REQUEST_TIMEOUT if method == "fbo" else BOND_REQUEST_TIMEOUT
    return request_backend(
        session_dir,
        f"bond {atom1} {atom2} {method}",
        timeout=timeout,
        timeout_message=f"Timed out waiting for Multiwfn {method} calculation",
    )


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def find_free_port(host: str = "127.0.0.1", preferred: int = 8765) -> int:
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind((host, port))
                return int(probe.getsockname()[1])
            except OSError:
                continue
    raise OSError("No free local port")


def make_handler(frontend_dir: Path, session_dir: Path, manifest: Path):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(frontend_dir), **kwargs)

        def log_message(self, fmt: str, *args) -> None:
            sys.stderr.write("[multiwfn-qt] " + fmt % args + "\n")

        def end_headers(self) -> None:
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            request_path = urllib.parse.unquote(parsed.path)
            query = urllib.parse.parse_qs(parsed.query)
            if request_path in ("", "/"):
                self.send_response(302)
                self.send_header("Location", "/index.html?manifest=/session/manifest.json")
                self.end_headers()
                return
            if request_path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if request_path == "/api/orbital":
                try:
                    send_json(self, request_orbital(session_dir, query))
                except Exception as exc:
                    send_json(self, {"ok": False, "message": str(exc)}, status=500)
                return
            if request_path == "/api/bond":
                try:
                    send_json(self, request_bond(session_dir, query))
                except Exception as exc:
                    send_json(self, {"ok": False, "message": str(exc)}, status=500)
                return
            if request_path == "/api/return":
                (session_dir / "gui_stop.flag").write_text("return\n", encoding="utf-8")
                send_json(self, {"ok": True})
                return
            if request_path == "/session/manifest.json":
                send_file(self, manifest)
                return
            if request_path.startswith("/session/"):
                rel = request_path[len("/session/") :]
                candidate = (session_dir / rel).resolve()
                try:
                    candidate.relative_to(session_dir)
                except ValueError:
                    self.send_error(403, "Invalid session path")
                    return
                send_file(self, candidate)
                return
            super().do_GET()

    return Handler


class LocalFrontendServer:
    def __init__(self, frontend_dir: Path, session_dir: Path, manifest: Path, port: int = 8765):
        self.host = "127.0.0.1"
        self.port = find_free_port(self.host, port)
        handler = make_handler(frontend_dir, session_dir, manifest)
        self.server = ThreadingHTTPServer((self.host, self.port), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> str:
        self.thread.start()
        return f"http://{self.host}:{self.port}/index.html?manifest=/session/manifest.json"

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class MultiwfnQtGui(QMainWindow):
    def __init__(
        self,
        manifest_path: Path,
        frontend_dir: Path | None = None,
        *,
        profile_startup: bool = False,
        application_created_at_ms: float | None = None,
        open_browser: bool = False,
    ):
        window_init_started = time.perf_counter()
        super().__init__()
        self.profile_startup = profile_startup
        self.startup_marks = {
            "processStartedAt": 0.0,
            "qtImportedAt": (QT_IMPORTED_AT - PROCESS_STARTED_AT) * 1000.0,
            "windowInitStartedAt": (window_init_started - PROCESS_STARTED_AT) * 1000.0,
        }
        if application_created_at_ms is not None:
            self.startup_marks["applicationCreatedAt"] = application_created_at_ms
        self.profile_timer: QTimer | None = None
        self.profile_poll_pending = False
        self.profile_reported = False
        self.manifest_path = manifest_path.resolve()
        self.session_dir = self.manifest_path.parent
        cleanup_session_files(self.session_dir, startup=True)
        self.frontend_dir = frontend_dir.resolve() if frontend_dir else None
        self.manifest = load_json(self.manifest_path)
        self.server: LocalFrontendServer | None = None
        self.viewer_url: str | None = None
        self.web_view = None
        self.web_only = bool(QWebEngineView and self.frontend_dir and self.frontend_dir.is_dir())
        self.stop_timer: QTimer | None = None

        try:
            (self.session_dir / "gui_stop.flag").unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass

        self.setWindowTitle("Multiwfn Qt GUI")
        self.resize(1280, 820)
        self._build_menu()
        self._build_ui()
        self._load_manifest()
        self._start_stop_watcher()
        self._mark_startup("windowConstructedAt")
        self._start_startup_profiler()
        if open_browser:
            QTimer.singleShot(0, self._open_in_browser)

    def _mark_startup(self, name: str) -> None:
        if self.profile_startup:
            self.startup_marks[name] = (time.perf_counter() - PROCESS_STARTED_AT) * 1000.0

    def mark_window_shown(self) -> None:
        self._mark_startup("windowShownAt")

    def _build_menu(self) -> None:
        menu_bar = self.menuBar()
        view_menu = menu_bar.addMenu("View")
        open_action = QAction("Open 3D viewer in browser", self)
        open_action.triggered.connect(self._open_in_browser)
        view_menu.addAction(open_action)
        copy_action = QAction("Copy 3D viewer URL", self)
        copy_action.triggered.connect(self._copy_viewer_url)
        view_menu.addAction(copy_action)

        if self.web_only:
            return

        for title, entries in (
            ("Orbital info.", ["Show all", "Show up to LUMO+10", "Show occupied orbitals"]),
            (" Isosur#1 style", [
                "Use solid face",
                "Use mesh",
                "Use mesh only for negative part",
                "Use points",
                "Use solid face+mesh",
                "Use solid face+mesh only for negative part",
                "Use transparent face",
                "Set color for face",
                "Set color for mesh and points",
                "Set opacity for transparent face",
                "Exchange positive and negative colors",
            ]),
            (" Isosur#2 style", [
                "Use solid face",
                "Use mesh",
                "Use points",
                "Use solid face+mesh",
                "Use transparent face",
                "Set color for face",
                "Set color for mesh and points",
                "Set opacity for transparent face",
                "Exchange positive and negative colors",
            ]),
            (" Isosur. quality", [
                "Set number of grid points",
                "Very poor quality (super fast, 25k points)",
                "Poor quality (very fast, 50k points)",
                "Default (fast, 120k points)",
                "Good quality (300k points)",
                "High quality (500k points)",
                "Very high quality (1000k points)",
                "Perfect quality (1500k points)",
            ]),
            ("Set view", [
                "Set rotation of viewpoint",
                "Set rotation along screen",
                "Set zoom distance",
                "Set position of focus point",
                "Toggle between perspective and orthographic modes",
                "Set focus length of perspective mode",
            ]),
            ("Other settings", [
                "Set extension distance",
                "Make box size consistent to cell",
                "Set isovalue",
                "Set lightings",
                "Set atomic label type",
                "Set atomic label color",
                "Use CPK style",
                "Use vdW style",
                "Use line style",
                "Toggle showing hydrogens",
                "Toggle showing data range",
                "Toggle showing cell frame",
                "Toggle showing all boundary atoms",
                "Set atom highlighting",
                "Choose plotting wavefunction or density",
                "Load bonding connectivity from mol/mol2 file",
            ]),
            ("Tools", [
                "Write settings to GUIsettings.ini",
                "Load settings from GUIsettings.ini",
                "Measure geometry",
                "Batch plotting orbitals",
                "Select fragment",
                "Get atom indices of a given element",
                "Print XYZ coordinates in Angstrom",
                "Print XYZ coordinates in Bohr",
                "Print fractional coordinates",
                "Export all internal coordinates",
            ]),
        ):
            menu = menu_bar.addMenu(title)
            for entry in entries:
                action = QAction(entry, self)
                action.triggered.connect(lambda checked=False, text=entry: self._not_implemented(text))
                menu.addAction(action)

    def _build_ui(self) -> None:
        if self.web_only:
            self.setCentralWidget(self._viewer_widget())
            self.setStatusBar(QStatusBar())
            self.statusBar().showMessage("Starting 3D viewer...")
            return

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(self._build_view_panel())
        splitter.addWidget(self._build_control_panel())
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 0)
        splitter.setSizes([900, 360])
        self.setCentralWidget(splitter)
        self.setStatusBar(QStatusBar())
        self.statusBar().showMessage("Ready")

    def _build_control_panel(self) -> QWidget:
        panel = QWidget()
        panel.setObjectName("controlPanel")
        outer = QVBoxLayout(panel)
        outer.setContentsMargins(12, 12, 12, 12)
        outer.setSpacing(10)

        title = QLabel("Geometry structure / Orbital isosurfaces")
        title.setObjectName("appTitle")
        subtitle = QLabel("Qt replacement for the legacy DISLIN panel")
        subtitle.setObjectName("appSubtitle")
        outer.addWidget(title)
        outer.addWidget(subtitle)

        mode_row = QHBoxLayout()
        for label, index in (("Molecule", 0), ("Isosurface", 1), ("Plane/2D", 2), ("Periodic", 3)):
            button = QPushButton(label)
            button.clicked.connect(lambda checked=False, idx=index: self.mode_stack.setCurrentIndex(idx))
            mode_row.addWidget(button)
        outer.addLayout(mode_row)

        actions = QGridLayout()
        for row, text in enumerate(("RETURN", "Open in browser", "Up", "Down", "Left", "Right", "Reset view", "Save picture")):
            button = QPushButton(text)
            if text == "RETURN":
                button.setObjectName("returnButton")
                button.clicked.connect(self.close)
            elif text == "Open in browser":
                button.clicked.connect(self._open_in_browser)
            elif text == "Save picture":
                button.clicked.connect(lambda: self._not_implemented("Save picture"))
            elif text == "Reset view":
                button.clicked.connect(self._reload_web_view)
            else:
                button.clicked.connect(lambda checked=False, t=text: self._status(f"View command: {t}"))
            actions.addWidget(button, row // 2, row % 2)
        outer.addLayout(actions)

        self.mode_stack = QStackedWidget()
        self.mode_stack.addWidget(self._molecule_page())
        self.mode_stack.addWidget(self._isosurface_page())
        self.mode_stack.addWidget(self._plane_page())
        self.mode_stack.addWidget(self._periodic_page())
        outer.addWidget(self.mode_stack, 1)
        return panel

    def _molecule_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.addWidget(self._display_group())

        group = QGroupBox("Orbitals")
        group_layout = QVBoxLayout(group)
        self.orbital_list = QListWidget()
        self.orbital_list.currentItemChanged.connect(self._select_orbital_item)
        group_layout.addWidget(self.orbital_list)

        form = QFormLayout()
        self.orbital_input = QLineEdit("0")
        self.orbital_input.returnPressed.connect(self._select_orbital_text)
        form.addRow("Orbital index", self.orbital_input)
        self.orbital_iso = QDoubleSpinBox()
        self.orbital_iso.setRange(0.0, 1.0)
        self.orbital_iso.setDecimals(4)
        self.orbital_iso.setSingleStep(0.001)
        self.orbital_iso.setValue(0.015)
        form.addRow("Isovalue", self.orbital_iso)
        group_layout.addLayout(form)

        row = QHBoxLayout()
        prev_button = QPushButton("Previous")
        next_button = QPushButton("Next")
        prev_button.clicked.connect(lambda: self._step_orbital(-1))
        next_button.clicked.connect(lambda: self._step_orbital(1))
        row.addWidget(prev_button)
        row.addWidget(next_button)
        group_layout.addLayout(row)
        layout.addWidget(group, 1)
        return page

    def _display_group(self) -> QGroupBox:
        group = QGroupBox("Geometry structure / orbital isosurfaces")
        layout = QGridLayout(group)
        for i, text in enumerate(("Show molecule", "Show labels", "Show axis", "Show+Sel. isosur#2")):
            check = QCheckBox(text)
            check.setChecked(text in ("Show molecule", "Show axis"))
            layout.addWidget(check, i // 2, i % 2)

        for row, (text, value) in enumerate((
            ("Bonding threshold", 115),
            ("Ratio of atomic size", 100),
            ("Radius of bonds", 20),
            ("Size of atomic labels", 38),
        ), start=2):
            label = QLabel(text)
            slider = QSlider(Qt.Orientation.Horizontal)
            slider.setRange(0, 200 if "labels" in text else 500)
            slider.setValue(value)
            layout.addWidget(label, row, 0)
            layout.addWidget(slider, row, 1)
        return group

    def _isosurface_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        group = QGroupBox("Isosurface")
        form = QFormLayout(group)
        self.layer_combo = QComboBox()
        form.addRow("Active isosurface", self.layer_combo)
        self.sign_combo = QComboBox()
        self.sign_combo.addItems(["Show both sign", "Positive only", "Negative only"])
        form.addRow("Draw sign", self.sign_combo)
        self.surface_value = QDoubleSpinBox()
        self.surface_value.setDecimals(5)
        self.surface_value.setRange(0.0, 10.0)
        self.surface_value.setSingleStep(0.001)
        form.addRow("Isosurface value", self.surface_value)
        self.surface_style = QComboBox()
        self.surface_style.addItems(["Use solid face", "Use mesh", "Use points", "Use solid face+mesh", "Use transparent face"])
        form.addRow("Isosur#1 style", self.surface_style)
        self.quality_combo = QComboBox()
        self.quality_combo.addItems(["Very poor quality", "Default", "Good quality", "High quality"])
        form.addRow("Isosur. quality", self.quality_combo)
        for text, checked in (
            ("Show both sign", True),
            ("Show molecule", True),
            ("Show atomic labels", False),
            ("Show axis", True),
            ("Show data range", False),
            ("Show isosurface", True),
            ("Show cell", False),
        ):
            check = QCheckBox(text)
            check.setChecked(checked)
            form.addRow(check)
        layout.addWidget(group)
        layout.addStretch(1)
        return page

    def _plane_page(self) -> QWidget:
        page = QWidget()
        layout = QFormLayout(page)
        self.slice_layer_combo = QComboBox()
        layout.addRow("Cube", self.slice_layer_combo)
        axis = QComboBox()
        axis.addItems(["XY at Z", "XZ at Y", "YZ at X"])
        layout.addRow("Plane", axis)
        pos = QSlider(Qt.Orientation.Horizontal)
        pos.setRange(0, 100)
        pos.setValue(50)
        layout.addRow("Position", pos)
        draw = QPushButton("Draw plane map")
        draw.clicked.connect(lambda: self._not_implemented("Draw plane map"))
        layout.addRow(draw)
        return page

    def _periodic_page(self) -> QWidget:
        page = QWidget()
        layout = QFormLayout(page)
        for text in ("Periodic", "Show cell frame", "Show boundary cube images"):
            check = QCheckBox(text)
            check.setChecked(text == "Show cell frame")
            layout.addRow(check)
        for text in ("a vector", "b vector", "c vector", "A range", "B range", "C range"):
            layout.addRow(text, QLineEdit())
        return page

    def _build_view_panel(self) -> QWidget:
        tabs = QTabWidget()
        tabs.addTab(self._viewer_widget(), "Viewer")
        tabs.addTab(self._session_widget(), "Session")
        return tabs

    def _viewer_widget(self) -> QWidget:
        if QWebEngineView and self.frontend_dir and self.frontend_dir.is_dir():
            if QWebEngineProfile:
                profile = QWebEngineProfile.defaultProfile()
                web_cache = QT_CACHE_ROOT / "webengine-cache"
                web_storage = QT_CACHE_ROOT / "webengine-storage"
                web_cache.mkdir(parents=True, exist_ok=True)
                web_storage.mkdir(parents=True, exist_ok=True)
                profile.setCachePath(str(web_cache))
                profile.setPersistentStoragePath(str(web_storage))
            self.web_view = QWebEngineView()
            if self.profile_startup:
                self.web_view.loadStarted.connect(lambda: self._mark_startup("webLoadStartedAt"))
                self.web_view.loadFinished.connect(self._web_load_finished)
            url = self._ensure_viewer_url()
            self._mark_startup("serverStartedAt")
            self.web_view.setUrl(QUrl(url))
            self._mark_startup("urlSetAt")
            return self.web_view

        widget = QTextBrowser()
        widget.setOpenExternalLinks(True)
        widget.setHtml(
            "<h2>Qt viewer shell</h2>"
            "<p>QtWebEngine is not available in this Python environment, so the "
            "3Dmol viewport cannot be embedded here.</p>"
            "<p>The controls on the left still load the Multiwfn session and mirror "
            "the legacy DISLIN GUI layout. Install PyQt6-WebEngine or use a Qt build "
            "with WebEngine to embed the 3Dmol renderer.</p>"
        )
        return widget

    def _ensure_viewer_url(self) -> str | None:
        if self.viewer_url:
            return self.viewer_url
        if not self.frontend_dir or not self.frontend_dir.is_dir():
            return None
        self.server = LocalFrontendServer(self.frontend_dir, self.session_dir, self.manifest_path)
        self.viewer_url = self.server.start()
        return self.viewer_url

    def _open_in_browser(self) -> None:
        url = self._ensure_viewer_url()
        if not url:
            self._status("3D viewer frontend is unavailable")
            return
        QApplication.clipboard().setText(url)
        if open_system_browser(url):
            self._status(f"Opened browser: {url}")
        else:
            self._status(f"Could not open browser; URL copied: {url}")

    def _copy_viewer_url(self) -> None:
        url = self._ensure_viewer_url()
        if not url:
            self._status("3D viewer frontend is unavailable")
            return
        QApplication.clipboard().setText(url)
        self._status(f"Copied browser URL: {url}")

    def _session_widget(self) -> QWidget:
        self.session_browser = QTextBrowser()
        return self.session_browser

    def _load_manifest(self) -> None:
        gui = self.manifest.get("multiwfnGui", {})
        state = gui.get("state", {})
        self.statusBar().showMessage(f"Loaded {gui.get('entry', 'session')}")

        if self.web_only:
            return

        self.orbital_iso.setValue(float(state.get("sur_value_orb", 0.015) or 0.015))
        self.surface_value.setValue(float(state.get("sur_value", 0.015) or 0.015))

        self._load_orbitals()
        self._load_layers()
        self._render_session_summary()

    def _load_orbitals(self) -> None:
        self.orbital_list.clear()
        orbitals_section = self.manifest.get("orbitals", {})
        orbitals = orbitals_section.get("items", [])
        if not orbitals:
            gui_state = self.manifest.get("multiwfnGui", {}).get("state", {})
            count = int(orbitals_section.get("count") or gui_state.get("orbitalCount") or 0)
            orbitals = [{"index": index} for index in range(1, min(count, 2000) + 1)]
        layers = self.manifest.get("cubes", [])
        layer_by_orbital = {
            int(layer.get("orbitalIndex")): layer
            for layer in layers
            if str(layer.get("orbitalIndex", "")).isdigit()
        }
        none_item = QListWidgetItem("    0  None")
        none_item.setData(Qt.ItemDataRole.UserRole, {"index": 0, "layer": None})
        self.orbital_list.addItem(none_item)
        if not orbitals:
            return
        for orbital in orbitals:
            index = int(orbital.get("index", 0))
            suffix = " *" if index in layer_by_orbital else ""
            if "occupation" in orbital or "energy" in orbital:
                label = f"{index:5d}  occ={float(orbital.get('occupation', 0.0)):.3f}  ene={float(orbital.get('energy', 0.0)):.5f}{suffix}"
            else:
                label = f"{index:5d}{suffix}"
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, {"index": index, "layer": layer_by_orbital.get(index)})
            self.orbital_list.addItem(item)

    def _load_layers(self) -> None:
        self.layer_combo.clear()
        self.slice_layer_combo.clear()
        for layer in self.manifest.get("cubes", []):
            label = layer.get("name") or layer.get("path") or "cube"
            self.layer_combo.addItem(label, layer)
            self.slice_layer_combo.addItem(label, layer)

    def _render_session_summary(self) -> None:
        structure = self.manifest.get("structure") or {}
        cubes = self.manifest.get("cubes", [])
        html = [
            "<h2>Multiwfn session</h2>",
            f"<p><b>Manifest:</b> {self.manifest_path}</p>",
            f"<p><b>Structure:</b> {structure.get('path', 'None')}</p>",
            "<h3>Cube layers</h3>",
            "<ul>",
        ]
        for cube in cubes:
            html.append(f"<li>{cube.get('name', cube.get('path'))} - {cube.get('path')}</li>")
        html.extend(["</ul>"])
        self.session_browser.setHtml("".join(html))

    def _select_orbital_item(self, current: QListWidgetItem | None, previous: QListWidgetItem | None) -> None:
        if not current:
            return
        data = current.data(Qt.ItemDataRole.UserRole) or {}
        index = data.get("index")
        if index is not None:
            self.orbital_input.setText(str(index))
            self._request_orbital_in_viewer(int(index))
        layer = data.get("layer")
        if index == 0:
            self._status("No orbital selected")
        elif layer:
            self._status(f"Selected orbital {index}")
        elif index:
            self._status(f"Calculating orbital {index}")

    def _select_orbital_text(self) -> None:
        text = self.orbital_input.text().strip()
        if not text.isdigit():
            self._status("Invalid orbital index")
            return
        target = int(text)
        for row in range(self.orbital_list.count()):
            item = self.orbital_list.item(row)
            data = item.data(Qt.ItemDataRole.UserRole) or {}
            if data.get("index") == target:
                self.orbital_list.setCurrentRow(row)
                return
        self.orbital_input.setText(str(target))
        self._request_orbital_in_viewer(target)
        self._status(f"Calculating orbital {target}")

    def _step_orbital(self, delta: int) -> None:
        row = self.orbital_list.currentRow()
        row = max(0, min(self.orbital_list.count() - 1, row + delta))
        self.orbital_list.setCurrentRow(row)

    def _reload_web_view(self) -> None:
        if self.web_view:
            self.web_view.reload()
        self._status("View reset requested")

    def _request_orbital_in_viewer(self, index: int) -> None:
        if not self.web_view:
            return
        isovalue = float(self.orbital_iso.value())
        script = (
            "window.multiwfnGui && window.multiwfnGui.requestOrbital"
            f" ? window.multiwfnGui.requestOrbital({int(index)}, {{isovalue: {isovalue:.10g}}})"
            " : undefined"
        )
        self.web_view.page().runJavaScript(script)

    def _not_implemented(self, text: str) -> None:
        QMessageBox.information(self, "Multiwfn Qt GUI", f"{text} is not wired to Multiwfn callbacks yet.")

    def _status(self, text: str) -> None:
        self.statusBar().showMessage(text, 5000)

    def _start_stop_watcher(self) -> None:
        if not self.web_only:
            return
        self.stop_timer = QTimer(self)
        self.stop_timer.setInterval(250)
        self.stop_timer.timeout.connect(self._check_stop_flag)
        self.stop_timer.start()

    def _web_load_finished(self, ok: bool) -> None:
        self._mark_startup("webLoadFinishedAt" if ok else "webLoadFailedAt")

    def _start_startup_profiler(self) -> None:
        if not self.profile_startup or not self.web_view:
            return
        self.profile_timer = QTimer(self)
        self.profile_timer.setInterval(50)
        self.profile_timer.timeout.connect(self._poll_startup_profile)
        self.profile_timer.start()

    def _poll_startup_profile(self) -> None:
        if self.profile_poll_pending or self.profile_reported or not self.web_view:
            return
        self.profile_poll_pending = True
        self.web_view.page().runJavaScript(
            "(() => { const value = window.__multiwfnStartup; "
            "return value?.ready && Number.isFinite(value.backgroundLayersReadyAt) ? value : null; })()",
            self._handle_startup_profile,
        )

    def _handle_startup_profile(self, frontend_metrics) -> None:
        self.profile_poll_pending = False
        if not frontend_metrics or self.profile_reported:
            return
        self.profile_reported = True
        self._mark_startup("frontendReadyAt")
        if self.profile_timer:
            self.profile_timer.stop()
        payload = {
            "python": self.startup_marks,
            "frontend": frontend_metrics,
            "totalMs": (time.perf_counter() - PROCESS_STARTED_AT) * 1000.0,
        }
        print("[multiwfn-qt-startup] " + json.dumps(payload, separators=(",", ":")), file=sys.stderr, flush=True)

    def _check_stop_flag(self) -> None:
        if (self.session_dir / "gui_stop.flag").is_file():
            self.close()

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt API name
        if self.stop_timer:
            self.stop_timer.stop()
        if self.profile_timer:
            self.profile_timer.stop()
        try:
            (self.session_dir / "gui_stop.flag").write_text("return\n", encoding="utf-8")
        except OSError:
            pass
        if self.server:
            self.server.stop()
        super().closeEvent(event)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Qt prototype shell for Multiwfn GUI sessions")
    parser.add_argument("--manifest", default="multiwfn_3dmol_session/manifest.json")
    parser.add_argument("--frontend", default=None, help="Path to frontend/3dmol-viewer")
    parser.add_argument("--profile-startup", action="store_true", help="Print Qt and frontend startup timings")
    parser.add_argument("--select-file", action="store_true", help="Open a native file dialog and exit")
    parser.add_argument("--output", default=None, help="Output path for --select-file")
    parser.add_argument("--title", default="Choose a Multiwfn input file", help="Dialog title for --select-file")
    parser.add_argument("--open-browser", action="store_true", help="Open the 3Dmol viewer in the system browser after startup")
    args = parser.parse_args(argv)

    if args.select_file:
        if not args.output:
            print("--output is required with --select-file", file=sys.stderr)
            return 2
        app = QApplication(sys.argv)
        selected, _ = QFileDialog.getOpenFileName(None, args.title, "", FILE_FILTER)
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"{selected}\n" if selected else "", encoding="utf-8")
        app.quit()
        return 0

    manifest = Path(args.manifest)
    if not manifest.is_file():
        print(f"Manifest not found: {manifest}", file=sys.stderr)
        return 2
    frontend = Path(args.frontend) if args.frontend else None

    app = QApplication(sys.argv)
    application_created_at_ms = (time.perf_counter() - PROCESS_STARTED_AT) * 1000.0
    app.setStyleSheet(
        """
        #controlPanel { background: #f3f5f6; border-left: 1px solid #c9d0d3; }
        #appTitle { font-size: 15px; font-weight: 700; }
        #appSubtitle { color: #66757d; }
        #returnButton { background: #14796f; color: white; font-weight: 700; }
        QGroupBox { font-weight: 700; margin-top: 10px; }
        QGroupBox::title { subcontrol-origin: margin; left: 8px; padding: 0 4px; }
        QPushButton { min-height: 28px; }
        QListWidget { font-family: Consolas, Menlo, monospace; }
        """
    )
    window = MultiwfnQtGui(
        manifest,
        frontend,
        profile_startup=args.profile_startup,
        application_created_at_ms=application_created_at_ms,
        open_browser=args.open_browser or os.environ.get("MULTIWFN_QT_OPEN_BROWSER") == "1",
    )
    window.show()
    window.mark_window_shown()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
