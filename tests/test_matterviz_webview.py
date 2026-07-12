import contextlib
from io import StringIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))
import multiwfn_matterviz_webview as adapter  # noqa: E402


class ImmediateThread:
    def __init__(self, *, target, daemon):
        self.target = target

    def start(self):
        self.target()


class FakeProcess:
    def __init__(self, *, poll_result=0):
        self.poll_result = poll_result
        self.terminated = False

    def wait(self, timeout=None):
        return 0

    def poll(self):
        return self.poll_result

    def terminate(self):
        self.terminated = True

    def kill(self):
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

    def run_main(self, *, argv=None, **patches):
        stream = StringIO()
        with contextlib.redirect_stderr(stream), mock.patch.object(sys, "argv", argv or self.argv()):
            with mock.patch.object(adapter, "resolve_shell", return_value=self.shell), mock.patch.object(
                adapter.web, "cleanup_session_files"
            ), mock.patch.object(adapter.web, "make_handler", return_value=object()), mock.patch.object(
                adapter.threading, "Thread", ImmediateThread
            ):
                with contextlib.ExitStack() as stack:
                    for target, value in patches.items():
                        stack.enter_context(mock.patch.object(adapter.web, target, value))
                    result = adapter.main()
        return result, stream.getvalue()

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

    def test_both_bind_attempts_fail(self):
        with mock.patch.object(adapter.web, "ThreadingHTTPServer", side_effect=[OSError("busy"), OSError("still busy")]) as bind, mock.patch.object(
            sys, "argv", self.argv()
        ), mock.patch.object(adapter, "resolve_shell", return_value=self.shell), mock.patch.object(
            adapter.web, "cleanup_session_files"
        ), mock.patch.object(adapter.web, "make_handler", return_value=object()):
            stderr = StringIO()
            with contextlib.redirect_stderr(stderr):
                result = adapter.main()
        self.assertEqual(result, 2)
        self.assertEqual(bind.call_count, 2)
        self.assertIn("Could not bind MatterViz WebView service", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())
        self.assert_flag()

    def test_preferred_bind_failure_falls_back_to_ephemeral_port(self):
        server = FakeServer(port=43210)
        process = FakeProcess()
        bind = mock.Mock(side_effect=[OSError("busy"), server])
        with mock.patch.object(adapter.web, "ThreadingHTTPServer", bind), mock.patch.object(
            adapter.subprocess, "Popen", return_value=process
        ):
            result, stderr = self.run_main()
        self.assertEqual(result, 0)
        self.assertEqual(bind.call_count, 2)
        self.assertEqual(stderr, "")
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()

    def test_popen_failure_closes_server_and_signals(self):
        server = FakeServer()
        with mock.patch.object(adapter.web, "ThreadingHTTPServer", return_value=server), mock.patch.object(
            adapter.subprocess, "Popen", side_effect=OSError("exec failed")
        ):
            result, stderr = self.run_main()
        self.assertEqual(result, 2)
        self.assertTrue(server.server_close_called)
        self.assertIn("Could not launch MatterViz WebView", stderr)
        self.assertNotIn("Traceback", stderr)
        self.assert_flag()

    def test_keyboard_interrupt_closes_server_and_signals(self):
        server = FakeServer(serve_error=KeyboardInterrupt())
        process = FakeProcess()
        with mock.patch.object(adapter.web, "ThreadingHTTPServer", return_value=server), mock.patch.object(
            adapter.subprocess, "Popen", return_value=process
        ):
            result, stderr = self.run_main()
        self.assertEqual(result, 2)
        self.assertTrue(server.server_close_called)
        self.assertIn("MatterViz WebView interrupted.", stderr)
        self.assertNotIn("Traceback", stderr)
        self.assert_flag()

    def test_normal_child_close_signals_and_closes_server(self):
        server = FakeServer()
        process = FakeProcess()
        with mock.patch.object(adapter.web, "ThreadingHTTPServer", return_value=server), mock.patch.object(
            adapter.subprocess, "Popen", return_value=process
        ):
            result, stderr = self.run_main()
        self.assertEqual(result, 0)
        self.assertEqual(stderr, "")
        self.assertTrue(server.shutdown_called)
        self.assertTrue(server.server_close_called)
        self.assert_flag()


if __name__ == "__main__":
    unittest.main()
