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
from pathlib import Path
import socket
import socketserver
import sys
import threading
import time
import urllib.parse

from PyQt6.QtCore import Qt, QTimer, QUrl
from PyQt6.QtGui import QAction
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
    from PyQt6.QtWebEngineWidgets import QWebEngineView
except Exception:  # pragma: no cover - depends on optional runtime package
    QWebEngineView = None


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


def request_orbital(session_dir: Path, query: dict[str, list[str]]) -> dict:
    reqid = int(time.time() * 1000)
    index = int(query.get("index", ["0"])[0] or 0)
    quality = int(query.get("quality", ["0"])[0] or 0)
    isovalue = float(query.get("isovalue", ["0.0"])[0] or 0.0)
    response = session_dir / f"response_{reqid}.json"
    request = session_dir / "gui_request.txt"
    if response.exists():
        response.unlink()
    request.write_text(f"{reqid} orbital {index} {quality} {isovalue:.10g}\n", encoding="utf-8")
    deadline = time.time() + 300
    while time.time() < deadline:
        if response.is_file():
            return json.loads(response.read_text(encoding="utf-8"))
        time.sleep(0.2)
    return {"ok": False, "message": "Timed out waiting for Multiwfn orbital grid"}


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
    def __init__(self, manifest_path: Path, frontend_dir: Path | None = None):
        super().__init__()
        self.manifest_path = manifest_path.resolve()
        self.session_dir = self.manifest_path.parent
        self.frontend_dir = frontend_dir.resolve() if frontend_dir else None
        self.manifest = load_json(self.manifest_path)
        self.server: LocalFrontendServer | None = None
        self.web_view = None
        self.web_only = bool(QWebEngine and self.frontend_dir and self.frontend_dir.is_dir())
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

    def _build_menu(self) -> None:
        if self.web_only:
            self.menuBar().hide()
            return

        menu_bar = self.menuBar()
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
            self.statusBar().showMessage("Ready")
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
        for row, text in enumerate(("RETURN", "Up", "Down", "Left", "Right", "Reset view", "Save picture")):
            button = QPushButton(text)
            if text == "RETURN":
                button.setObjectName("returnButton")
                button.clicked.connect(self.close)
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
            self.web_view = QWebEngineView()
            self.server = LocalFrontendServer(self.frontend_dir, self.session_dir, self.manifest_path)
            url = self.server.start()
            self.web_view.setUrl(QUrl(url))
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
        orbitals = self.manifest.get("orbitals", {}).get("items", [])
        layers = self.manifest.get("cubes", [])
        layer_by_orbital = {
            int(layer.get("orbitalIndex")): layer
            for layer in layers
            if str(layer.get("orbitalIndex", "")).isdigit()
        }
        if not orbitals:
            self.orbital_list.addItem(QListWidgetItem("0  None"))
            return
        for orbital in orbitals:
            index = int(orbital.get("index", 0))
            suffix = " *" if index in layer_by_orbital else ""
            item = QListWidgetItem(f"{index:5d}  occ={float(orbital.get('occupation', 0.0)):.3f}  ene={float(orbital.get('energy', 0.0)):.5f}{suffix}")
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
        if index:
            self.orbital_input.setText(str(index))
        layer = data.get("layer")
        if layer:
            self._status(f"Selected orbital {index}")
        elif index:
            self._status(f"Orbital {index} has no generated cube in this session")

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
        self._status(f"Orbital {target} is not listed")

    def _step_orbital(self, delta: int) -> None:
        row = self.orbital_list.currentRow()
        row = max(0, min(self.orbital_list.count() - 1, row + delta))
        self.orbital_list.setCurrentRow(row)

    def _reload_web_view(self) -> None:
        if self.web_view:
            self.web_view.reload()
        self._status("View reset requested")

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

    def _check_stop_flag(self) -> None:
        if (self.session_dir / "gui_stop.flag").is_file():
            self.close()

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt API name
        if self.stop_timer:
            self.stop_timer.stop()
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
    args = parser.parse_args(argv)

    manifest = Path(args.manifest)
    if not manifest.is_file():
        print(f"Manifest not found: {manifest}", file=sys.stderr)
        return 2
    frontend = Path(args.frontend) if args.frontend else None

    app = QApplication(sys.argv)
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
    window = MultiwfnQtGui(manifest, frontend)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
