#!/usr/bin/env python3
"""Exercise a packaged Linux MatterViz launch through a real orbital request.

This is a CI-only integration test.  It intentionally uses only Python's
standard library; the packaged executable, Rust host, and WebView frontend are
the runtime under test.  CI invokes it from ``dbus-run-session`` and
``xvfb-run`` so this script can launch the native WebView directly.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[1] / "fixtures" / "matterviz-real-orbital-Co5Cr.fch.gz"
)
HOST_PORT = 18767
STARTUP_TIMEOUT = 60.0
REQUEST_TIMEOUT = 60.0
SHUTDOWN_TIMEOUT = 30.0
HOST_SHUTDOWN_TIMEOUT = 15.0
TAIL_LINES = 120
FORMAL_SESSION_BANNER = (
    "MatterViz GUI backend prepared an in-memory visualization session"
)
FORBIDDEN_ARTIFACT_PART = re.compile(
    r"(?:session|control|request|response|stop|manifest|structure|cube|cub|volume|staged)",
    re.IGNORECASE,
)


class RegressionError(RuntimeError):
    """An expected integration assertion failed."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):  # noqa: D401
        return None


HTTP_OPENER = build_opener(ProxyHandler({}), NoRedirect)


def now() -> float:
    return time.monotonic()


def wait_for(condition, timeout: float, description: str, interval: float = 0.2):
    deadline = now() + timeout
    while now() < deadline:
        value = condition()
        if value:
            return value
        time.sleep(interval)
    raise RegressionError(f"timed out after {timeout:g}s waiting for {description}")


def wait_for_formal_startup(
    process: subprocess.Popen[str], stdout: list[str], stderr: list[str]
) -> None:
    def ready() -> bool:
        return any(FORMAL_SESSION_BANNER in line for line in stdout) and process.poll() is None

    try:
        wait_for(ready, STARTUP_TIMEOUT, "Multiwfn in-memory MatterViz session")
    except RegressionError as exc:
        if process.poll() is not None:
            output = "\n".join((stdout + stderr)[-20:])
            raise RegressionError(
                f"Multiwfn exited before the in-memory session was prepared "
                f"(status {process.returncode}); output tail:\n{output}"
            ) from exc
        raise


def read_stream(stream, lines: list[str]) -> None:
    try:
        for line in iter(stream.readline, ""):
            lines.append(line.rstrip("\n"))
            if len(lines) > TAIL_LINES:
                del lines[: len(lines) - TAIL_LINES]
    finally:
        stream.close()


def proc_records() -> dict[int, dict[str, object]]:
    """Return a best-effort Linux process snapshot keyed by PID."""
    records: dict[int, dict[str, object]] = {}
    proc = Path("/proc")
    if not proc.is_dir():
        return records
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            stat = (entry / "stat").read_text(encoding="ascii")
            # The comm field may contain spaces and ')' characters.  The final
            # ')' terminates it; field 4 after that is the parent PID.
            suffix = stat.rsplit(")", 1)[1].split()
            ppid = int(suffix[1])
            cmdline = (entry / "cmdline").read_bytes().split(b"\0")
            argv = [part.decode("utf-8", "replace") for part in cmdline if part]
            try:
                executable = os.readlink(entry / "exe")
            except OSError:
                executable = ""
            records[pid] = {"ppid": ppid, "argv": argv, "exe": executable}
        except (OSError, ValueError, UnicodeError, IndexError):
            continue
    return records


def descendants(root_pid: int) -> dict[int, dict[str, object]]:
    records = proc_records()
    children: dict[int, list[int]] = {}
    for pid, record in records.items():
        children.setdefault(int(record["ppid"]), []).append(pid)
    found: dict[int, dict[str, object]] = {}
    pending = list(children.get(root_pid, []))
    while pending:
        pid = pending.pop()
        if pid in found:
            continue
        record = records.get(pid)
        if record is None:
            continue
        found[pid] = record
        pending.extend(children.get(pid, []))
    return found


def matching_host_pids(root_pid: int, host: Path) -> list[int]:
    expected = str(host.resolve())
    result = []
    for pid, record in descendants(root_pid).items():
        executable = str(record.get("exe", ""))
        argv = record.get("argv", [])
        first = argv[0] if isinstance(argv, list) and argv else ""
        if executable == expected or first == expected:
            result.append(pid)
    return sorted(result)


def all_matching_host_pids(host: Path) -> list[int]:
    expected = str(host.resolve())
    result = []
    for pid, record in proc_records().items():
        executable = str(record.get("exe", ""))
        argv = record.get("argv", [])
        first = argv[0] if isinstance(argv, list) and argv else ""
        if executable == expected or first == expected:
            result.append(pid)
    return sorted(result)


def http_get(url: str, timeout: float) -> tuple[int, dict[str, str], bytes]:
    request = Request(url, method="GET")
    try:
        response = HTTP_OPENER.open(request, timeout=timeout)
    except HTTPError as error:
        return error.code, dict(error.headers.items()), error.read()
    with response:
        return response.status, dict(response.headers.items()), response.read()


def wait_for_service(base_url: str, timeout: float) -> None:
    def ready() -> bool:
        try:
            status, headers, _ = http_get(f"{base_url}/", 2.0)
            return status in (301, 302, 303, 307, 308) and bool(headers.get("Location"))
        except (OSError, HTTPError, URLError):
            return False

    wait_for(ready, timeout, "Rust MatterViz session service")


def tree_snapshot(root: Path) -> set[Path]:
    """Capture names below a controlled writable root without reading contents."""
    if not root.exists():
        return set()
    return {Path(".")} | {path.relative_to(root) for path in root.rglob("*")}


def forbidden_artifact_additions(before: set[Path], after: set[Path]) -> list[Path]:
    additions = sorted(after - before, key=lambda path: path.as_posix())
    return [
        path
        for path in additions
        if any(FORBIDDEN_ARTIFACT_PART.search(part) for part in path.parts)
    ]


def advertised_service_base(stdout: list[str], stderr: list[str]) -> str | None:
    prefix = "Multiwfn MatterViz GUI service: "
    for line in list(stderr) + list(stdout):
        if prefix not in line:
            continue
        advertised = line.split(prefix, 1)[1].strip()
        parsed = urlsplit(advertised)
        try:
            port = parsed.port
        except ValueError as exc:
            raise RegressionError(
                f"Rust MatterViz host advertised an invalid service URL: {advertised}"
            ) from exc
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or port is None
            or port <= 0
        ):
            raise RegressionError(
                f"Rust MatterViz host advertised an invalid service URL: {advertised}"
            )
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        return f"http://{host}:{port}"
    return None


def get_capability(base_url: str) -> str:
    status, headers, _ = http_get(f"{base_url}/", 5.0)
    if status not in (301, 302, 303, 307, 308):
        raise RegressionError(f"Rust host root did not redirect (HTTP {status})")
    location = headers.get("Location", "")
    values = parse_qs(urlsplit(location).query, keep_blank_values=True).get("cap", [])
    if len(values) != 1 or re.fullmatch(r"[0-9a-f]{64}", values[0]) is None:
        raise RegressionError(
            f"Rust host redirect did not advertise exactly one 256-bit capability: {location!r}"
        )
    return values[0]


def request_json(url: str, timeout: float) -> dict[str, object]:
    status, _, body = http_get(url, timeout)
    if status != 200:
        detail = body.decode("utf-8", "replace")[:500]
        raise RegressionError(f"HTTP {status} from {url}: {detail}")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RegressionError(f"invalid JSON from {url}: {exc}") from exc
    if not isinstance(value, dict):
        raise RegressionError(f"JSON response from {url} was not an object")
    return value


def crc32c(data: bytes) -> int:
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
    return (~crc) & 0xFFFFFFFF


def validate_stream_volume(headers: dict[str, str], body: bytes) -> None:
    if headers.get("Content-Type") != "application/vnd.multiwfn.volume; version=2":
        raise RegressionError(
            f"native orbital response had invalid content type: {headers.get('Content-Type')!r}"
        )
    if len(body) < 304:
        raise RegressionError(f"native orbital stream was truncated ({len(body)} bytes)")
    header = body[:304]
    if header[:8] != b"MWFNVOL\0":
        raise RegressionError("native orbital stream had invalid magic")
    major, minor, message_type, flags, header_bytes = struct.unpack_from("<HHHHI", header, 8)
    if (major, minor, message_type, flags, header_bytes) != (2, 0, 4, 3, 304):
        raise RegressionError(
            "native orbital stream had invalid v2 header "
            f"(major={major}, minor={minor}, type={message_type}, flags={flags}, bytes={header_bytes})"
        )
    header_for_crc = bytearray(header)
    expected_header_crc = struct.unpack_from("<I", header, 36)[0]
    header_for_crc[36:40] = b"\0\0\0\0"
    if crc32c(header_for_crc) != expected_header_crc:
        raise RegressionError("native orbital stream header CRC32C mismatch")
    request_id, body_bytes = struct.unpack_from("<QQ", header, 20)
    volume_id = struct.unpack_from("<Q", header, 48)[0]
    dimensions = struct.unpack_from("<III", header, 56)
    if request_id == 0 or volume_id == 0 or any(dimension == 0 for dimension in dimensions):
        raise RegressionError("native orbital stream had invalid identity or dimensions")
    sample_count = dimensions[0] * dimensions[1] * dimensions[2]
    if body_bytes != sample_count * 8 or len(body) != 304 + body_bytes:
        raise RegressionError(
            f"native orbital stream length mismatch (declared={body_bytes}, actual={len(body) - 304}, dims={dimensions})"
        )
    expected_body_crc = struct.unpack_from("<I", header, 40)[0]
    payload = body[304:]
    if crc32c(payload) != expected_body_crc:
        raise RegressionError("native orbital stream body CRC32C mismatch")
    values = struct.unpack(f"<{sample_count}d", payload)
    if not all(value == value and abs(value) != float("inf") for value in values):
        raise RegressionError("native orbital stream contained a nonfinite sample")
    minimum, maximum, mean, abs_max = struct.unpack_from("<dddd", header, 264)
    if not all(value == value and abs(value) != float("inf") for value in (minimum, maximum, mean, abs_max)):
        raise RegressionError("native orbital stream had nonfinite statistics")
    if min(values) != minimum or max(values) != maximum or max(abs(value) for value in values) != abs_max:
        raise RegressionError("native orbital stream statistics did not match samples")


def terminate_pids(pids: set[int]) -> None:
    for signal_number in (signal.SIGTERM, signal.SIGKILL):
        for pid in sorted(pids, reverse=True):
            try:
                os.kill(pid, signal_number)
            except ProcessLookupError:
                pass
            except OSError:
                pass
        if signal_number == signal.SIGTERM:
            deadline = now() + 2.0
            while now() < deadline and any(Path(f"/proc/{pid}").exists() for pid in pids):
                time.sleep(0.1)


def terminate_tree(root_pid: int) -> None:
    terminate_pids(set(descendants(root_pid)) | {root_pid})
    remaining = set(descendants(root_pid))
    if remaining:
        terminate_pids(remaining)


def diagnostics(
    root: Path,
    process: subprocess.Popen[str] | None,
    stdout: list[str],
    stderr: list[str],
    host: Path | None,
) -> str:
    chunks = [f"MatterViz Linux real-orbital regression diagnostics:\n  root: {root}"]
    if process is not None:
        chunks.append(f"  Multiwfn PID: {process.pid}  returncode: {process.poll()}")
        if host is not None:
            chunks.append(
                f"  Rust host descendants: {matching_host_pids(process.pid, host)}; "
                f"all matching processes: {all_matching_host_pids(host)}"
            )
    if stdout:
        chunks.append("--- Multiwfn stdout (tail) ---\n" + "\n".join(stdout))
    if stderr:
        chunks.append("--- Multiwfn stderr (tail) ---\n" + "\n".join(stderr))
    return "\n".join(chunks)


def run(executable: Path, fixture: Path) -> None:
    if os.name != "posix" or not Path("/proc").is_dir():
        raise RegressionError("this regression requires Linux /proc process inspection")
    executable = executable.expanduser().resolve()
    fixture = fixture.expanduser().resolve()
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise RegressionError(f"packaged Multiwfn executable is not executable: {executable}")
    if not fixture.is_file():
        raise RegressionError(f"packaged orbital fixture was not found: {fixture}")

    package_home = executable.parent
    packaged_host = package_home / "resources" / "tools" / "matterviz-desktop"
    packaged_frontend = package_home / "resources" / "frontend" / "matterviz-viewer" / "dist"
    if not packaged_host.is_file() or not os.access(packaged_host, os.X_OK):
        raise RegressionError(f"packaged Rust MatterViz host was not found: {packaged_host}")
    if not packaged_frontend.is_dir() or not (packaged_frontend / "index.html").is_file():
        raise RegressionError(f"packaged MatterViz frontend was not found: {packaged_frontend}")

    root = Path(tempfile.mkdtemp(prefix="multiwfn matterviz linux "))
    work = root / "work area"
    session = root / "in-memory session identity"
    fake_home = root / "fake matterviz home"
    fake_tools = fake_home / "tools"
    fake_frontend = fake_home / "frontend" / "matterviz-viewer" / "dist"
    work.mkdir(parents=True)
    fake_tools.mkdir(parents=True)
    fake_frontend.mkdir(parents=True)
    input_path = work / "Co5Cr input.fch"
    with gzip.open(fixture, "rb") as source, input_path.open("wb") as target:
        shutil.copyfileobj(source, target)
    fake_host = fake_tools / "matterviz-desktop"
    expected_host = fake_host
    shutil.copy2(packaged_host, fake_host)
    fake_host.chmod(fake_host.stat().st_mode | 0o111)
    shutil.copytree(packaged_frontend, fake_frontend, dirs_exist_ok=True)

    env = os.environ.copy()
    env.pop("MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK", None)
    env.update(
        {
            "MULTIWFN_MATTERVIZ_SESSION": str(session),
            "MULTIWFN_MATTERVIZ_HOME": str(fake_home),
            "MULTIWFN_MATTERVIZ_PORT": str(HOST_PORT),
            "GDK_BACKEND": "x11",
            "NO_AT_BRIDGE": "1",
            "WEBKIT_DISABLE_COMPOSITING_MODE": "1",
        }
    )
    process: subprocess.Popen[str] | None = None
    stdout: list[str] = []
    stderr: list[str] = []
    output_threads: list[threading.Thread] = []
    service_base: str | None = None
    capability: str | None = None
    observed_runtime_pids: set[int] = set()
    before_runtime = tree_snapshot(root)
    success = False
    try:
        process = subprocess.Popen(
            [str(executable), str(input_path)],
            cwd=work,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        for stream, lines in ((process.stdout, stdout), (process.stderr, stderr)):
            assert stream is not None
            thread = threading.Thread(target=read_stream, args=(stream, lines), daemon=True)
            thread.start()
            output_threads.append(thread)
        assert process.stdin is not None
        process.stdin.write("0\nq\n")
        process.stdin.flush()
        wait_for_formal_startup(process, stdout, stderr)
        service_base = wait_for(
            lambda: advertised_service_base(stdout, stderr),
            STARTUP_TIMEOUT,
            "Rust MatterViz advertised service URL",
        )
        wait_for_service(service_base, STARTUP_TIMEOUT)
        host_pids = wait_for(
            lambda: matching_host_pids(process.pid, expected_host),
            10.0,
            "Rust MatterViz descendant",
        )
        if len(host_pids) != 1:
            raise RegressionError(f"expected one Rust host descendant, found {host_pids}")
        capability = get_capability(service_base)
        orbital_url = (
            f"{service_base}/api/orbital?index=43&quality=25000&isovalue=0.05&cap={capability}"
        )
        status, volume_headers, volume_bytes = http_get(orbital_url, REQUEST_TIMEOUT)
        if status != 200:
            raise RegressionError(f"native orbital stream failed with HTTP {status}")
        validate_stream_volume(volume_headers, volume_bytes)
        if process.poll() is not None:
            raise RegressionError("Multiwfn exited before the native orbital response completed")

        observed_runtime_pids = set(descendants(process.pid))
        returned = request_json(f"{service_base}/api/return?cap={capability}", REQUEST_TIMEOUT)
        if returned != {"ok": True}:
            raise RegressionError(f"Rust MatterViz Return request failed: {returned}")
        try:
            process.wait(timeout=SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            raise RegressionError("Multiwfn did not exit after the Rust host Return request") from exc
        if process.returncode != 0:
            raise RegressionError(f"Multiwfn exited with status {process.returncode}")
        wait_for(lambda: not all_matching_host_pids(expected_host), HOST_SHUTDOWN_TIMEOUT,
                 "Rust MatterViz descendant shutdown")
        wait_for(
            lambda: not any(Path(f"/proc/{pid}").exists() for pid in observed_runtime_pids),
            HOST_SHUTDOWN_TIMEOUT,
            "MatterViz WebView process-tree shutdown",
        )
        thread_deadline = now() + 10.0
        for thread in output_threads:
            thread.join(timeout=max(0.0, thread_deadline - now()))
        if any(thread.is_alive() for thread in output_threads):
            raise RegressionError("MatterViz descendants retained inherited output handles")
        after_runtime = tree_snapshot(root)
        forbidden = forbidden_artifact_additions(before_runtime, after_runtime)
        if forbidden:
            rendered = ", ".join(path.as_posix() for path in forbidden[:20])
            suffix = " ..." if len(forbidden) > 20 else ""
            raise RegressionError(
                "formal MatterViz session created forbidden runtime artifacts: "
                f"{rendered}{suffix}"
            )
        success = True
    finally:
        if (
            not success
            and capability is not None
            and service_base is not None
            and process is not None
            and process.poll() is None
        ):
            try:
                request_json(f"{service_base}/api/return?cap={capability}", 5.0)
            except (OSError, HTTPError, URLError, RegressionError):
                pass
        if process is not None and process.poll() is None:
            terminate_tree(process.pid)
        if not success:
            terminate_pids(observed_runtime_pids | set(all_matching_host_pids(expected_host)))
        if process is not None:
            try:
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
        for thread in output_threads:
            thread.join(timeout=2)
        if success:
            shutil.rmtree(root, ignore_errors=True)
        else:
            print(diagnostics(root, process, stdout, stderr, expected_host), file=sys.stderr)
            print(f"retaining temporary diagnostics at: {root}", file=sys.stderr)
    if not success:
        raise RegressionError("MatterViz Linux real-orbital regression did not complete")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True, type=Path, help="packaged Multiwfn_MatterVizGUI")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE, help="gzipped formatted checkpoint fixture")
    args = parser.parse_args(argv)
    try:
        run(args.executable, args.fixture)
    except (OSError, RegressionError, subprocess.SubprocessError) as exc:
        print(f"MatterViz Linux real-orbital regression failed: {exc}", file=sys.stderr)
        return 1
    print("MatterViz Linux real-orbital regression passed (native volume)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
