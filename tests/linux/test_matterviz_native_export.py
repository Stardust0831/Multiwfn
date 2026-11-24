#!/usr/bin/env python3
"""Click the packaged WebView and native GTK chooser under an isolated Xvfb.

Requires the GTK/AT-SPI introspection files provided by the existing WebView
development dependencies. No WebDriver or browser replacement is used.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

import gi

gi.require_version("Atspi", "2.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Atspi, Gdk, GdkPixbuf, GLib


def nodes(root=None, depth=0):
    root = root or Atspi.get_desktop(0)
    if depth > 24:
        return
    yield root, depth
    for index in range(root.get_child_count()):
        child = root.get_child_at_index(index)
        if child:
            yield from nodes(child, depth + 1)


def label(node):
    name = node.get_name()
    text = node.get_text_iface()
    return name or (Atspi.Text.get_text(text, 0, -1) if text else "")


def wait(predicate, description, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = predicate()
        except GLib.Error:
            # WebKit can replace accessible objects during navigation. Retry a
            # fresh snapshot within the same deadline, retaining all assertions.
            result = None
        if result:
            return result
        time.sleep(0.15)
    raise AssertionError(f"Timed out: {description}")


def find(name, root=None, role=None):
    return next((node for node, _ in nodes(root)
                 if label(node) == name and (role is None or node.get_role_name() == role)), None)


def click(name, root=None):
    def locate():
        return next((node for node, _ in nodes(root) if label(node) == name
                     and node.get_action_iface()
                     and any(node.get_action_iface().get_action_name(i)
                             for i in range(node.get_action_iface().get_n_actions()))), None)
    node = wait(locate, f"action {name}")
    assert node.get_action_iface().do_action(0), name


def filename_entry(dialog):
    name_label = find("Name:", dialog, "label")
    if name_label:
        return next((node for node, _ in nodes(name_label.get_parent())
                     if node.get_role_name() == "text" and node.get_editable_text_iface()), None)
    return None


def capture(output, name):
    snapshot = wait(lambda: "\n".join(
        "  " * depth + f"{node.get_role_name()}: {label(node)!r}"
        for node, depth in nodes()), "stable accessibility snapshot")
    (output / f"{name}.txt").write_text(snapshot, encoding="utf-8")
    root = Gdk.get_default_root_window()
    image = Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height())
    image.savev(str(output / f"{name}.png"), "png", [], [])


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@contextmanager
def accessibility_bus(registry):
    """Use an extracted registry executable without installing desktop services."""
    if registry is None:
        yield
        return
    bus = subprocess.Popen(["dbus-daemon", "--session", "--nofork", "--print-address"],
                           stdout=subprocess.PIPE, text=True)
    daemon = None
    try:
        address = bus.stdout.readline().strip()
        assert address.startswith("unix:"), "accessibility bus did not start"
        os.environ["AT_SPI_BUS_ADDRESS"] = address
        daemon = subprocess.Popen([str(registry)])

        def registered():
            result = subprocess.run(["gdbus", "call", "--address", address,
                                     "--dest", "org.freedesktop.DBus",
                                     "--object-path", "/org/freedesktop/DBus",
                                     "--method", "org.freedesktop.DBus.NameHasOwner",
                                     "org.a11y.atspi.Registry"], capture_output=True, text=True)
            return result.returncode == 0 and "true" in result.stdout

        wait(registered, "private accessibility registry", 10)
        yield
    finally:
        for process in [daemon, bus]:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def run(package, output):
    output.mkdir(parents=True, exist_ok=True)
    session = output / "session"
    session.mkdir(exist_ok=True)
    (session / "water.xyz").write_text("3\nwater\nO 0 0 0\nH 0 0 0.96\nH 0.92 0 -0.24\n")
    (session / "manifest.json").write_text(json.dumps({"structure": {"path": "water.xyz", "format": "xyz"}, "cubes": []}))
    env = {**os.environ, "GDK_BACKEND": "x11", "GSETTINGS_BACKEND": "memory", "LC_ALL": "C.UTF-8"}
    env.pop("NO_AT_BRIDGE", None)
    env.pop("WEBKIT_DISABLE_COMPOSITING_MODE", None)
    # Compositing must remain enabled for the real 3D scene to render.
    command = [str(package / "resources/tools/matterviz-desktop"),
               "--frontend", str(package / "resources/frontend/matterviz-viewer/dist"),
               "--session", str(session), "--manifest", str(session / "manifest.json"),
               "--port", "0", "--startup-timeout", "120"]
    records = []
    with (output / "host.log").open("w") as log:
        process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            wait(lambda: find("Structure loaded"), "native viewer startup", 90)
            capture(output, "startup")
            target = output / "export.png"
            for mode in ["cancel", "save", "refuse-overwrite", "overwrite"]:
                before = target.read_bytes() if target.exists() else None
                if mode == "overwrite":
                    target.write_bytes(b"MWFN overwrite sentinel\n")
                    before = target.read_bytes()
                    (output / "before-overwrite.bin").write_bytes(before)
                click("Save")
                click("PNG image")
                dialog = wait(lambda: find("Save viewer export", role="file chooser"), "native save dialog")
                capture(output, f"{mode}-dialog")
                if mode == "cancel":
                    click("Cancel", dialog)
                    wait(lambda: find("Save cancelled"), "cancel status")
                    assert not target.exists()
                else:
                    entry = wait(lambda: filename_entry(dialog), "save filename")
                    assert entry.get_editable_text_iface().set_text_contents(str(target))
                    click("Save", dialog)
                    if mode in ["refuse-overwrite", "overwrite"]:
                        replace = wait(lambda: find("Replace"), "overwrite confirmation")
                        capture(output, f"{mode}-confirmation")
                        if mode == "refuse-overwrite":
                            click("Cancel", replace.get_parent())
                            wait(lambda: not find("Replace"), "dismiss replacement")
                            click("Cancel", dialog)
                            wait(lambda: find("Save cancelled"), "cancel status")
                            assert target.read_bytes() == before
                        else:
                            click("Replace")
                    if mode in ["save", "overwrite"]:
                        wait(lambda: find("PNG exported"), "completed write")
                        assert target.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
                        if before is not None:
                            assert target.read_bytes() != before
                        image = GdkPixbuf.Pixbuf.new_from_file(str(target))
                        # The exported scene must contain visible, colored atoms.
                        pixels = image.get_pixels()
                        channels = image.get_n_channels()
                        colors = {pixels[i:i + 3] for i in range(0, len(pixels), channels)}
                        assert image.get_width() > 100 and image.get_height() > 100
                        assert len(colors) > 100, "export is blank"
                        (output / f"{mode}.png").write_bytes(target.read_bytes())
                capture(output, f"{mode}-result")
                assert not list(output.glob(".*.matterviz-*.tmp"))
                records.append({"case": mode, "before": hashlib.sha256(before).hexdigest() if before else None,
                                "after": sha(target) if target.exists() else None, "passed": True})
                (output / "results.json").write_text(json.dumps(records, indent=2))
        except BaseException:
            capture(output, "failure")
            raise
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--atspi-registry", type=Path,
                        help="Path to an extracted at-spi2-registryd for CI without desktop services")
    args = parser.parse_args()
    with accessibility_bus(args.atspi_registry):
        Atspi.init()
        run(args.package.resolve(), args.output.resolve())
