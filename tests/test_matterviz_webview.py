import contextlib
from io import StringIO
import http.server
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.request
from unittest import mock


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))
import multiwfn_matterviz_webview as adapter  # noqa: E402


class ImmediateThread:
    def __init__(self, *, target, daemon):
        self.target = target

    def start(self):
        self.target()

    def join(self, timeout=None):
        return None

    def is_alive(self):
        return False


class StartFailureThread(ImmediateThread):
    def start(self):
        raise RuntimeError("thread unavailable")


class FakeProcess:
    def __init__(self, *, poll_result=None):
        self.poll_result = poll_result
        self.terminated = False
        self.killed = False

    def wait(self, timeout=None):
        if self.poll_result is None:
            self.poll_result = 0
        return self.poll_result

    def poll(self):
        return self.poll_result

    def terminate(self):
        self.terminated = True
        self.poll_result = 0

    def kill(self):
        self.killed = True
        self.poll_result = -9


class FakeServer:
    def __init__(self, port=8765, serve_error=None):
        self.server_address = ("127.0.0.1", port)
        self.serve_error = serve_error
        self.shutdown_called = False
        self.server_close_called = False

    def serve_forever(self):
        if self.serve_error is not None:
            raise self.serve_error

    def shutdown(self):
        self.shutdown_called = True

    def server_close(self):
        self.server_close_called = True


class BlockingServer(FakeServer):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.stop_event = threading.Event()

    def serve_forever(self):
        self.started.set()
        self.stop_event.wait(timeout=5)

    def shutdown(self):
        super().shutdown()
        self.stop_event.set()


class MatterVizWebViewTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        self.session = root / "session"
        self.session.mkdir()
        self.frontend = root / "frontend"
        self.frontend.mkdir()
        self.manifest = root / "manifest.json"
        self.manifest.write_text("{}", encoding="utf-8")
        self.shell = root / "matterviz-desktop"
        self.shell.touch()

    def tearDown(self):
        self.tempdir.cleanup()

    def argv(self, **overrides):
        args = {
            "frontend": self.frontend,
            "session": self.session,
            "manifest": self.manifest,
        }
        args.update(overrides)
        values = ["multiwfn_matterviz_webview.py"]
        for name, value in args.items():
            if value is not None:
                values.extend((f"--{name}", str(value)))
        return values

    def run_main(
        self,
        *,
        argv=None,
        process=None,
        status=None,
        server=None,
        bind=None,
        launch_error=None,
        before_status=None,
        thread_cls=ImmediateThread,
    ):
        process = process or FakeProcess()
        server = server or FakeServer()
        bind = bind or mock.Mock(return_value=server)

        def launch(_command, *, env):
            if launch_error is not None:
                raise launch_error
            if before_status is not None:
                before_status(env)
            if status is not None:
                status_line = status.format(token=env[adapter.STARTUP_TOKEN_ENV])
                Path(env[adapter.STARTUP_STATUS_ENV]).write_text(status_line, encoding="utf-8")
            return process

        stream = StringIO()
        with contextlib.redirect_stderr(stream), mock.patch.object(sys, "argv", argv or self.argv()):
            with mock.patch.object(adapter, "resolve_shell", return_value=self.shell), mock.patch.object(
                adapter.web, "cleanup_session_files"
            ), mock.patch.object(adapter.web, "make_handler", return_value=object()), mock.patch.object(
                adapter.web, "ThreadingHTTPServer", bind
            ), mock.patch.object(adapter.web, "build_workbench_url", return_value="http://127.0.0.1:8765/"), mock.patch.object(
                adapter.subprocess, "Popen", side_effect=launch
            ), mock.patch.object(adapter.threading, "Thread", thread_cls):
                result = adapter.main()
        return result, stream.getvalue(), process, server

    def assert_flag(self):
        flag = self.session / "gui_stop.flag"
        self.assertTrue(flag.is_file())
        self.assertEqual(flag.read_text(encoding="utf-8"), "return\n")

    def test_signal_return_is_idempotent(self):
        adapter.signal_return(self.session)
        flag = self.session / "gui_stop.flag"
        flag.write_text("return\n", encoding="utf-8")
        adapter.signal_return(self.session)
        self.assertEqual(flag.read_text(encoding="utf-8"), "return\n")

    def test_missing_inputs_signal_return_with_rc2(self):
        cases = (
            (mock.patch.object(adapter, "resolve_shell", return_value=None), self.argv()),
            (mock.patch.object(adapter, "resolve_shell", return_value=self.shell), self.argv(frontend=self.frontend / "missing")),
            (mock.patch.object(adapter, "resolve_shell", return_value=self.shell), self.argv(manifest=self.manifest / "missing")),
            (mock.patch.object(adapter, "resolve_shell", return_value=self.shell), self.argv(state=self.manifest / "missing-state")),
        )
        for shell_patch, argv in cases:
            with self.subTest(argv=argv), shell_patch, mock.patch.object(sys, "argv", argv):
                with contextlib.redirect_stderr(StringIO()):
                    result = adapter.main()
            self.assertEqual(result, 2)
            self.assert_flag()
            (self.session / "gui_stop.flag").unlink()

    def test_ready_status_preserves_normal_close_behavior(self):
        result, stderr, process, server = self.run_main(status="ready {token}\n")
        self.assertEqual(result, 0)
        self.assertEqual(stderr, "")
        self.assertFalse(process.terminated)
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()

    def test_shell_receives_exact_stop_file_path(self):
        received = {}

        def capture_stop_file(env):
            received[adapter.STOP_FILE_ENV] = env[adapter.STOP_FILE_ENV]

        result, stderr, _, _ = self.run_main(
            status="ready {token}\n",
            before_status=capture_stop_file,
        )
        self.assertEqual(result, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(received[adapter.STOP_FILE_ENV], str(self.session.resolve() / "gui_stop.flag"))

    def test_service_is_running_before_startup_handshake(self):
        server = BlockingServer()

        def assert_service_started(_env):
            self.assertTrue(server.started.wait(timeout=1), "service thread did not start before shell launch")

        result, stderr, _, server = self.run_main(
            server=server,
            status="ready {token}\n",
            before_status=assert_service_started,
            thread_cls=threading.Thread,
        )
        self.assertEqual(result, 0)
        self.assertEqual(stderr, "")
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()

    def test_bound_service_is_reachable_before_ready_status(self):
        class ProbeHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *_args):
                return None

        server = adapter.web.ThreadingHTTPServer(("127.0.0.1", 0), ProbeHandler)
        probe_url = f"http://127.0.0.1:{server.server_address[1]}/probe"

        def probe_before_ready(_env):
            with urllib.request.urlopen(probe_url, timeout=1) as response:
                self.assertEqual(response.read(), b"ok")

        result, stderr, _, _ = self.run_main(
            server=server,
            bind=mock.Mock(return_value=server),
            status="ready {token}\n",
            before_status=probe_before_ready,
            thread_cls=threading.Thread,
        )
        self.assertEqual(result, 0)
        self.assertEqual(stderr, "")
        self.assert_flag()

    def test_stale_status_is_removed_before_launch(self):
        status_path = self.session / adapter.STARTUP_STATUS_NAME
        status_path.write_text("ready stale-token\n", encoding="utf-8")
        result, stderr, _, _ = self.run_main(status="ready {token}\n")
        self.assertEqual(result, 0)
        self.assertEqual(stderr, "")
        self.assertTrue(status_path.is_file())
        self.assertNotIn("stale-token", status_path.read_text(encoding="utf-8"))

    def test_startup_status_requires_the_current_token(self):
        status_path = self.session / adapter.STARTUP_STATUS_NAME
        status_path.write_text("ready\n", encoding="utf-8")
        self.assertIsNone(adapter.read_startup_status(status_path, "current-token"))
        status_path.write_text("ready stale-token\n", encoding="utf-8")
        self.assertIsNone(adapter.read_startup_status(status_path, "current-token"))
        status_path.write_text("ready current-token\n", encoding="utf-8")
        self.assertEqual(adapter.read_startup_status(status_path, "current-token"), ("ready", None))

    def test_early_child_exit_reports_once_and_reaps(self):
        result, stderr, process, server = self.run_main(process=FakeProcess(poll_result=17))
        self.assertEqual(result, 2)
        self.assertEqual(stderr.count("\n"), 1)
        self.assertIn("exited before startup readiness", stderr)
        self.assertFalse(process.terminated)
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()

    def test_explicit_startup_error_reports_status_message(self):
        server = BlockingServer()
        result, stderr, process, server = self.run_main(
            status="error {token} window creation failed\n",
            server=server,
            thread_cls=threading.Thread,
        )
        self.assertEqual(result, 2)
        self.assertEqual(stderr.count("\n"), 1)
        self.assertIn("startup error: window creation failed", stderr)
        self.assertTrue(process.terminated)
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()

    def test_startup_timeout_is_finite_and_configurable(self):
        server = BlockingServer()
        result, stderr, process, server = self.run_main(
            argv=self.argv(**{"startup-timeout": "0.01"}),
            server=server,
            thread_cls=threading.Thread,
        )
        self.assertEqual(result, 2)
        self.assertEqual(stderr.count("\n"), 1)
        self.assertIn("startup timed out", stderr)
        self.assertTrue(process.terminated)
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()

    def test_both_bind_attempts_fail(self):
        bind = mock.Mock(side_effect=[OSError("busy"), OSError("still busy")])
        result, stderr, _, server = self.run_main(bind=bind)
        self.assertEqual(result, 2)
        self.assertEqual(bind.call_count, 2)
        self.assertIn("Could not bind MatterViz WebView service", stderr)
        self.assertNotIn("Traceback", stderr)
        self.assert_flag()

    def test_popen_failure_closes_server_and_signals(self):
        server = FakeServer()
        result, stderr, _, server = self.run_main(server=server, launch_error=OSError("exec failed"))
        self.assertEqual(result, 2)
        self.assertTrue(server.server_close_called)
        self.assertIn("Could not launch MatterViz WebView", stderr)
        self.assertNotIn("Traceback", stderr)
        self.assert_flag()

    def test_thread_start_failure_closes_without_shutdown_deadlock(self):
        server = FakeServer()
        result, stderr, process, server = self.run_main(server=server, thread_cls=StartFailureThread)
        self.assertEqual(result, 2)
        self.assertIn("startup failed: thread unavailable", stderr)
        self.assertFalse(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assertFalse(process.terminated)
        self.assert_flag()

    def test_keyboard_interrupt_closes_server_and_signals(self):
        server = FakeServer(serve_error=KeyboardInterrupt())
        result, stderr, _, server = self.run_main(status="ready {token}\n", server=server)
        self.assertEqual(result, 2)
        self.assertTrue(server.server_close_called)
        self.assertIn("MatterViz WebView interrupted.", stderr)
        self.assertNotIn("Traceback", stderr)
        self.assert_flag()


if __name__ == "__main__":
    unittest.main()
