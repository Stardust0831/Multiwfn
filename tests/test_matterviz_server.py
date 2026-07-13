import json
import http.client
import http.server
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))
import multiwfn_matterviz_server as server  # noqa: E402


class QuietHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


class PortBindingTests(unittest.TestCase):
    def test_server_disables_live_address_reuse(self):
        self.assertFalse(server.ThreadingHTTPServer.allow_reuse_address)
        self.assertFalse(server.ThreadingHTTPServer.allow_reuse_port)

    def test_busy_preferred_port_falls_back_to_an_os_assigned_port(self):
        first = server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        second = None
        try:
            preferred = int(first.server_address[1])
            second = server.bind_http_server("127.0.0.1", preferred, QuietHandler)
            self.assertNotEqual(int(second.server_address[1]), preferred)
        finally:
            if second is not None:
                second.server_close()
            first.server_close()

    def test_concurrent_services_keep_their_session_manifests_isolated(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            servers = []
            threads = []
            try:
                for marker in ("older", "newer"):
                    frontend = root / f"frontend-{marker}"
                    session = root / f"session-{marker}"
                    frontend.mkdir()
                    session.mkdir()
                    manifest = session / "manifest.json"
                    manifest.write_text(json.dumps({"marker": marker}), encoding="utf-8")
                    handler = server.make_handler(frontend, session, manifest)
                    preferred = int(servers[0].server_address[1]) if servers else 0
                    httpd = server.bind_http_server("127.0.0.1", preferred, handler)
                    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
                    thread.start()
                    servers.append(httpd)
                    threads.append(thread)

                self.assertNotEqual(servers[0].server_address[1], servers[1].server_address[1])
                for marker, httpd in zip(("older", "newer"), servers, strict=True):
                    connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
                    connection.request("GET", "/session/manifest.json")
                    response = connection.getresponse()
                    payload = json.loads(response.read())
                    connection.close()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(payload, {"marker": marker})
            finally:
                for httpd in servers:
                    httpd.shutdown()
                    httpd.server_close()
                for thread in threads:
                    thread.join(timeout=2)

    @unittest.skipUnless(hasattr(server.socket, "SO_EXCLUSIVEADDRUSE"), "Windows socket option")
    def test_windows_server_uses_exclusive_address_binding(self):
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        try:
            value = httpd.socket.getsockopt(server.socket.SOL_SOCKET, server.socket.SO_EXCLUSIVEADDRUSE)
            self.assertEqual(value, 1)
        finally:
            httpd.server_close()


class OrbitalRequestTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.session = root / "session"
        self.session.mkdir()
        self.manifest = root / "manifest.json"
        self.manifest.write_text(json.dumps({"orbitals": {"count": 8}}), encoding="utf-8")

    def tearDown(self):
        self.tempdir.cleanup()

    def request(self, **values):
        return {name: [str(value)] for name, value in values.items()}

    def test_valid_request_is_forwarded(self):
        with mock.patch.object(server, "request_backend", return_value={"ok": True}) as backend:
            result = server.request_orbital(
                self.session,
                self.request(index=3, quality=120000, isovalue=0.02),
                manifest=self.manifest,
            )
        self.assertEqual(result, {"ok": True})
        backend.assert_called_once_with(
            self.session,
            "orbital 3 120000 0.02",
            timeout=server.ORBITAL_REQUEST_TIMEOUT,
            timeout_message="Timed out waiting for Multiwfn orbital grid",
        )

    def test_nonfinite_values_are_rejected_before_backend(self):
        for name, value in (("isovalue", "nan"), ("isovalue", "inf"), ("isovalue", "-inf")):
            with self.subTest(name=name, value=value), mock.patch.object(server, "request_backend") as backend:
                with self.assertRaises(server.OrbitalRequestError):
                    server.request_orbital(self.session, self.request(index=3, quality=120000, **{name: value}))
                backend.assert_not_called()
            self.assertFalse((self.session / "gui_request.txt").exists())

    def test_quality_must_stay_within_native_grid_bounds(self):
        for quality in (1, server.ORBITAL_GRID_MIN - 1, server.ORBITAL_GRID_MAX + 1):
            with self.subTest(quality=quality), mock.patch.object(server, "request_backend") as backend:
                with self.assertRaises(server.OrbitalRequestError):
                    server.request_orbital(self.session, self.request(index=3, quality=quality, isovalue=0.02))
                backend.assert_not_called()

    def test_noninteger_quality_and_index_are_rejected(self):
        for values in (
            {"index": "3.0", "quality": "120000", "isovalue": "0.02"},
            {"index": "3", "quality": "120000.5", "isovalue": "0.02"},
        ):
            with self.subTest(values=values), mock.patch.object(server, "request_backend") as backend:
                with self.assertRaises(server.OrbitalRequestError):
                    server.request_orbital(self.session, values, manifest=self.manifest)
                backend.assert_not_called()

    def test_duplicate_parameters_are_rejected(self):
        query = self.request(index=3, quality=120000, isovalue=0.02)
        query["quality"].append("500000")
        with mock.patch.object(server, "request_backend") as backend:
            with self.assertRaisesRegex(server.OrbitalRequestError, "provided once"):
                server.request_orbital(self.session, query, manifest=self.manifest)
        backend.assert_not_called()
        self.assertFalse((self.session / "gui_request.txt").exists())

    def test_index_is_checked_against_manifest_count(self):
        with mock.patch.object(server, "request_backend") as backend:
            with self.assertRaises(server.OrbitalRequestError):
                server.request_orbital(
                    self.session,
                    self.request(index=9, quality=120000, isovalue=0.02),
                    manifest=self.manifest,
                )
        backend.assert_not_called()

    def test_isovalue_must_stay_within_gui_range(self):
        for isovalue in (-0.001, 1.001):
            with self.subTest(isovalue=isovalue), mock.patch.object(server, "request_backend") as backend:
                with self.assertRaises(server.OrbitalRequestError):
                    server.request_orbital(self.session, self.request(index=3, quality=120000, isovalue=isovalue))
                backend.assert_not_called()

    def test_http_rejection_is_a_concise_400_json_error(self):
        frontend = Path(self.tempdir.name) / "frontend"
        frontend.mkdir()
        handler = server.make_handler(frontend, self.session, self.manifest)
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            with mock.patch.object(server, "request_backend") as backend:
                connection = http.client.HTTPConnection(*httpd.server_address)
                connection.request("GET", "/api/orbital?index=3&quality=120000&isovalue=nan")
                response = connection.getresponse()
                body = json.loads(response.read())
                connection.close()
            self.assertEqual(response.status, 400)
            self.assertEqual(body["ok"], False)
            self.assertIn("isovalue", body["message"])
            backend.assert_not_called()
            self.assertFalse((self.session / "gui_request.txt").exists())
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

    def test_return_route_writes_stop_flag_and_shuts_down_server(self):
        frontend = Path(self.tempdir.name) / "frontend"
        frontend.mkdir()
        handler = server.make_handler(frontend, self.session, self.manifest)
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
            connection.request("GET", "/api/return")
            response = connection.getresponse()
            body = json.loads(response.read())
            connection.close()
            thread.join(timeout=2)

            self.assertEqual(response.status, 200)
            self.assertEqual(body, {"ok": True})
            self.assertEqual((self.session / "gui_stop.flag").read_text(encoding="utf-8"), "return\n")
            self.assertFalse(thread.is_alive())
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=2)

    def test_consumed_backend_request_stops_waiting_after_return(self):
        result = {}

        def request():
            result["payload"] = server.request_backend(
                self.session,
                "orbital 3 120000 0.02",
                timeout=5,
                timeout_message="timeout",
            )

        thread = threading.Thread(target=request)
        thread.start()
        request_path = self.session / "gui_request.txt"
        deadline = time.monotonic() + 2
        while not request_path.is_file() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(request_path.is_file())

        request_path.unlink()
        (self.session / "gui_stop.flag").write_text("return\n", encoding="utf-8")
        thread.join(timeout=1)

        self.assertFalse(thread.is_alive())
        self.assertEqual(result["payload"], {"ok": False, "message": server.BACKEND_UNAVAILABLE_MESSAGE})

    def test_unconsumed_backend_request_is_removed_after_return(self):
        result = {}

        def request():
            result["payload"] = server.request_backend(
                self.session,
                "orbital 3 120000 0.02",
                timeout=5,
                timeout_message="timeout",
            )

        thread = threading.Thread(target=request)
        thread.start()
        request_path = self.session / "gui_request.txt"
        deadline = time.monotonic() + 2
        while not request_path.is_file() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(request_path.is_file())

        (self.session / "gui_stop.flag").write_text("return\n", encoding="utf-8")
        thread.join(timeout=1)

        self.assertFalse(thread.is_alive())
        self.assertFalse(request_path.exists())
        self.assertEqual(result["payload"], {"ok": False, "message": server.BACKEND_UNAVAILABLE_MESSAGE})

    def test_return_route_releases_consumed_http_backend_request(self):
        frontend = Path(self.tempdir.name) / "frontend-return"
        frontend.mkdir()
        handler = server.make_handler(frontend, self.session, self.manifest)
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        service_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        service_thread.start()
        orbital_result = {}

        def request_orbital():
            connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
            connection.request("GET", "/api/orbital?index=3&quality=120000&isovalue=0.02")
            response = connection.getresponse()
            orbital_result["status"] = response.status
            orbital_result["body"] = json.loads(response.read())
            connection.close()

        request_thread = threading.Thread(target=request_orbital)
        request_thread.start()
        request_path = self.session / "gui_request.txt"
        deadline = time.monotonic() + 2
        while not request_path.is_file() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(request_path.is_file())
        request_path.unlink()

        try:
            connection = http.client.HTTPConnection(*httpd.server_address, timeout=2)
            connection.request("GET", "/api/return")
            response = connection.getresponse()
            return_body = json.loads(response.read())
            connection.close()
            request_thread.join(timeout=1)
            service_thread.join(timeout=2)

            self.assertEqual(response.status, 200)
            self.assertEqual(return_body, {"ok": True})
            self.assertFalse(request_thread.is_alive())
            self.assertFalse(service_thread.is_alive())
            self.assertEqual(orbital_result["status"], 200)
            self.assertEqual(
                orbital_result["body"],
                {"ok": False, "message": server.BACKEND_UNAVAILABLE_MESSAGE},
            )
        finally:
            httpd.shutdown()
            httpd.server_close()
            request_thread.join(timeout=2)
            service_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
