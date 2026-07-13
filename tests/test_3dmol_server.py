import json
import http.client
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))
import multiwfn_3dmol_server as server  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
