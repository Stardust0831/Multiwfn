"""Standalone MatterViz vibration launcher regression tests.

Pure-stdlib unittest suite for tools/multiwfn_vibration_viewer.py: output
parsing against the committed fixtures (assertion values mirror
tests/matterviz_vibration_harness.f90), MWFNP2D framing against the JavaScript
reference layout in frontend/matterviz-viewer/tests/vibration.test.ts,
manifest validation equivalent to the viewer's parse_vibration_manifest, the
loopback HTTP session service, and the external batch engine queue.
"""
from __future__ import annotations

import http.client
import json
import math
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = ROOT / "tools"
sys.path.insert(0, str(TOOLS_DIR))

import multiwfn_vibration_viewer as viewer  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"


def flat(data_values, mode, atom, direction, natom):
    """1-based (mode, atom, direction) into the mode-major flat displacement list."""
    return data_values[(mode - 1) * 3 * natom + (atom - 1) * 3 + (direction - 1)]


def decode_plot_dataset(frame: bytes):
    """Decode an MWFNP2D v1 frame mirroring decode_plot_dataset in plot.ts."""
    assert len(frame) >= 80, "plot dataset is truncated"
    magic = frame[0:8]
    major, minor, dtype, flags = struct.unpack_from("<HHHH", frame, 8)
    header_bytes = struct.unpack_from("<I", frame, 16)[0]
    assert magic == b"MWFNP2D\x00" and (major, minor, dtype, flags) == (1, 0, 1, 1)
    assert header_bytes == 80
    dataset_id = struct.unpack_from("<Q", frame, 20)[0]
    count = struct.unpack_from("<I", frame, 28)[0]
    entry_bytes = struct.unpack_from("<I", frame, 32)[0]
    directory_bytes = struct.unpack_from("<Q", frame, 36)[0]
    body_bytes = struct.unpack_from("<Q", frame, 44)[0]
    total_elements = struct.unpack_from("<Q", frame, 52)[0]
    header_crc = struct.unpack_from("<I", frame, 60)[0]
    body_crc = struct.unpack_from("<I", frame, 64)[0]
    reserved = struct.unpack_from("<I", frame, 68)[0]
    total_bytes = struct.unpack_from("<Q", frame, 72)[0]
    assert 1 <= count <= 8 and entry_bytes == 32
    assert directory_bytes == count * entry_bytes
    assert body_bytes == total_elements * 8
    assert total_bytes == len(frame) == 80 + directory_bytes + body_bytes
    assert reserved == 0
    zeroed = bytearray(frame[:80])
    struct.pack_into("<I", zeroed, 60, 0)
    assert viewer.crc32c(bytes(zeroed)) == header_crc, "header CRC mismatch"
    body_start = 80 + directory_bytes
    assert viewer.crc32c(frame[body_start:]) == body_crc, "body CRC mismatch"
    arrays = {}
    expected_offset = 0
    for index in range(count):
        entry = 80 + index * 32
        role = frame[entry]
        assert frame[entry + 1:entry + 8] == b"\x00" * 7
        elements = struct.unpack_from("<Q", frame, entry + 8)[0]
        offset = struct.unpack_from("<Q", frame, entry + 16)[0]
        array_bytes = struct.unpack_from("<Q", frame, entry + 24)[0]
        assert offset == expected_offset and array_bytes == elements * 8
        values = list(struct.unpack_from(f"<{elements}d", frame, body_start + offset))
        assert all(math.isfinite(value) for value in values)
        arrays[role] = values
        expected_offset += array_bytes
    assert expected_offset == body_bytes
    return dataset_id, arrays


def validate_manifest_like_viewer(manifest):
    """Python equivalent of parse_vibration_manifest in src/vibration.ts."""
    assert manifest["format"] == "multiwfn-matterviz-vibration"
    assert manifest["version"] == 1
    vibrations = manifest["vibrations"]
    assert isinstance(vibrations["atomCount"], int) and vibrations["atomCount"] > 0
    assert isinstance(vibrations["modeCount"], int) and vibrations["modeCount"] > 0
    assert vibrations["coordinateUnit"] == "angstrom"
    assert vibrations["frequencyUnit"] == "cm^-1"
    modes = vibrations["modes"]
    assert len(modes) == vibrations["modeCount"]
    for mode in modes:
        assert math.isfinite(mode["frequency"])
        assert mode["intensity"] is None or math.isfinite(mode["intensity"])
    displacements = vibrations["displacements"]
    assert isinstance(displacements["datasetId"], int) and displacements["datasetId"] > 0
    assert displacements["format"] == "mwfn-plot-data-v1"
    assert displacements["role"] == "u"
    assert displacements["layout"] == "mode-major-atom-xyz"
    assert displacements["shape"] == [vibrations["modeCount"], vibrations["atomCount"], 3]


def validate_structure_like_viewer(structure, atom_count):
    """Python equivalent of parse_vibration_structure in src/vibration.ts."""
    assert isinstance(structure["sites"], list)
    assert len(structure["sites"]) == atom_count
    for site in structure["sites"]:
        assert len(site["xyz"]) == 3 and all(math.isfinite(value) for value in site["xyz"])
        assert isinstance(site["species"][0]["element"], str) and site["species"][0]["element"]


class GaussianFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = viewer.parse_gaussian_output(FIXTURES / "h2o_freq_gaussian.out")

    def test_frequencies_and_intensities(self):
        self.assertEqual(self.data.source_program, "gaussian")
        self.assertEqual(self.data.spectrum_kind, "ir")
        self.assertEqual(self.data.intensity_unit, "km/mol")
        self.assertEqual(self.data.natom, 3)
        self.assertEqual(self.data.nmode, 3)
        self.assertEqual(self.data.frequencies, [1650.0, 3820.0, 3935.0])
        self.assertEqual(self.data.intensities, [61.5, 4.2, 0.9])

    def test_geometry_from_standard_orientation(self):
        atoms = [(site.element, site.x, site.y, site.z_coord) for site in self.data.atoms]
        self.assertEqual(
            atoms,
            [("O", 0.0, 0.0, 0.1173), ("H", 0.0, 0.7572, -0.4692), ("H", 0.0, -0.7572, -0.4692)],
        )

    def test_displacement_components_match_harness(self):
        disp, natom = self.data.displacements, self.data.natom
        self.assertEqual(len(disp), 3 * 3 * 3)
        self.assertAlmostEqual(flat(disp, 1, 2, 3, natom), -0.56)  # mode 1, atom 2, z
        self.assertAlmostEqual(flat(disp, 2, 3, 2, natom), -0.43)  # mode 2, atom 3, y
        self.assertAlmostEqual(flat(disp, 3, 3, 3, natom), -0.47)  # mode 3, atom 3, z
        self.assertAlmostEqual(flat(disp, 1, 1, 3, natom), 0.07)   # mode 1, atom 1, z


class OrcaFixtureTests(unittest.TestCase):
    """The ORCA fixtures carry no geometry block; the displacement core is
    exercised with an explicit atom count exactly like the Fortran harness."""

    def _parse_modes(self, name):
        lines = viewer._read_lines(FIXTURES / name)
        iskip = viewer._orca_first_vibration(lines)
        frequencies, intensities = viewer._orca_frequencies(lines, iskip)
        norm = viewer._orca_mode_matrix(lines, 2, len(frequencies), iskip)
        return frequencies, intensities, viewer._flatten_modes(norm)

    def test_single_section(self):
        frequencies, intensities, disp = self._parse_modes("h2_freq_orca.out")
        self.assertEqual(frequencies, [3650.0, 3820.0])
        self.assertEqual(intensities, [10.25, 4.2])
        self.assertAlmostEqual(flat(disp, 1, 1, 1, 2), 0.1)   # mode 1, atom 1, x
        self.assertAlmostEqual(flat(disp, 1, 1, 3, 2), 0.3)   # mode 1, atom 1, z
        self.assertAlmostEqual(flat(disp, 1, 2, 1, 2), -0.5)  # mode 1, atom 2, x
        self.assertAlmostEqual(flat(disp, 2, 2, 2, 2), 1.0)   # mode 2, atom 2, y

    def test_repeated_frequency_run_uses_last_section(self):
        frequencies, _, disp = self._parse_modes("h2_freq_orca_twice.out")
        self.assertEqual(frequencies, [3650.0, 3820.0])
        self.assertAlmostEqual(flat(disp, 1, 1, 2, 2), -0.4)  # mode 1, atom 1, y
        self.assertAlmostEqual(flat(disp, 1, 2, 2, 2), -1.0)  # mode 1, atom 2, y
        self.assertAlmostEqual(flat(disp, 2, 2, 3, 2), 0.30)  # mode 2, atom 2, z

    def test_full_parse_with_constructed_geometry(self):
        sample = (
            "                                 O   R   C   A\n"
            "\n"
            "CARTESIAN COORDINATES (ANGSTROEM)\n"
            "---------------------------------\n"
            "  H      0.000000      0.000000      0.000000\n"
            "  H      0.000000      0.000000      1.400000\n"
            "\n"
            + (FIXTURES / "h2_freq_orca.out").read_text(encoding="utf-8").split("O   R   C   A", 1)[1]
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "h2_freq_orca_geom.out"
            path.write_text(sample, encoding="utf-8")
            data = viewer.load_vibration_input(path)
        self.assertEqual(data.source_program, "orca")
        self.assertEqual(data.natom, 2)
        self.assertEqual([site.element for site in data.atoms], ["H", "H"])
        self.assertAlmostEqual(data.atoms[1].z_coord, 1.4)
        self.assertEqual(data.nmode, 2)
        self.assertEqual(data.spectrum_kind, "ir")
        self.assertAlmostEqual(flat(data.displacements, 2, 2, 2, 2), 1.0)


class UnsupportedInputTests(unittest.TestCase):
    def test_plain_text_is_rejected(self):
        with self.assertRaises(viewer.UnsupportedFormatError):
            viewer.load_vibration_input(FIXTURES / "plain_text.txt")

    def test_missing_displacement_table_raises_compute_trigger(self):
        sample = (
            " Entering Gaussian System, Link 0=g16\n"
            " Standard orientation:\n"
            " ---------------------------------------------------------------------\n"
            " Center     Atomic      Atomic             Coordinates (Angstroms)\n"
            " Number     Number       Type             X           Y           Z\n"
            " ---------------------------------------------------------------------\n"
            "      1          8           0        0.000000    0.000000    0.117300\n"
            " ---------------------------------------------------------------------\n"
            "                      1\n"
            "                     A\n"
            " Frequencies --  1650.0000\n"
            " IR Inten    --     61.5000\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gaussian_no_modes.out"
            path.write_text(sample, encoding="utf-8")
            with self.assertRaises(viewer.MissingDisplacementError):
                viewer.load_vibration_input(path)

    def test_zero_displacement_mode_is_rejected(self):
        sample = (
            " Entering Gaussian System, Link 0=g16\n"
            " Standard orientation:\n"
            " ---------------------------------------------------------------------\n"
            " Center     Atomic      Atomic             Coordinates (Angstroms)\n"
            " Number     Number       Type             X           Y           Z\n"
            " ---------------------------------------------------------------------\n"
            "      1          8           0        0.000000    0.000000    0.117300\n"
            " ---------------------------------------------------------------------\n"
            "                      1\n"
            "                     A\n"
            " Frequencies --  1650.0000\n"
            " IR Inten    --     61.5000\n"
            " Atom  AN      X      Y      Z\n"
            "    1   8     0.00   0.00   0.00\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gaussian_zero_mode.out"
            path.write_text(sample, encoding="utf-8")
            with self.assertRaisesRegex(viewer.VibrationError, "zero displacement vector"):
                viewer.load_vibration_input(path)


XTB_OUTPUT_SAMPLE = """\
                    x T B
   (constructed sample for the launcher tests)

$vibrational spectrum
# mode     symmetry  wave number   IR intensity
#                          cm-1         km/mol
 1                   -0.00        0.00
 2                   -0.00        0.00
 3         a       3650.00       10.25
 4         a       3820.00        4.20
$end
"""

XTB_G98_SAMPLE = """\
 Entering Gaussian System, Link 0=g98 (xtb --g98 companion, constructed)
 Standard orientation:
 ---------------------------------------------------------------------
 Center     Atomic      Atomic             Coordinates (Angstroms)
 Number     Number       Type             X           Y           Z
 ---------------------------------------------------------------------
      1          1           0        0.000000    0.000000    0.000000
      2          1           0        0.000000    0.000000    1.400000
 ---------------------------------------------------------------------
                      1                      2                      3
                     A                      A                      A
 Frequencies --    -0.0000              -0.0000            3650.0000
 IR Inten    --      0.0000               0.0000              10.2500
 Atom AN      X      Y      Z        X      Y      Z        X      Y      Z
    1   1     0.00   0.00   0.07    0.00   0.00  -0.07    0.10   0.20   0.30
    2   1     0.00   0.00  -0.07    0.00   0.00   0.07   -0.50   0.00   0.00
                      4
                     A
 Frequencies --  3820.0000
 IR Inten    --      4.2000
 Atom AN      X      Y      Z
    1   1     0.00   0.00   0.00
    2   1     0.00   1.00   0.00
"""


class XtbFlowTests(unittest.TestCase):
    def _write_pair(self, directory):
        output = Path(directory) / "xtb_vib.out"
        g98 = Path(directory) / "g98.out"
        output.write_text(XTB_OUTPUT_SAMPLE, encoding="utf-8")
        g98.write_text(XTB_G98_SAMPLE, encoding="utf-8")
        return output, g98

    def test_g98_out_is_required_before_any_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            output, _ = self._write_pair(directory)
            with self.assertRaisesRegex(viewer.VibrationError, "--g98-out"):
                viewer.load_vibration_input(output)

    def test_geometry_and_displacements_share_g98_atom_order(self):
        with tempfile.TemporaryDirectory() as directory:
            output, g98 = self._write_pair(directory)
            data = viewer.load_vibration_input(output, g98_out=str(g98))
        self.assertEqual(data.source_program, "xtb")
        self.assertEqual(data.natom, 2)
        self.assertEqual(data.nmode, 4)
        self.assertEqual(data.frequencies, [-0.0, -0.0, 3650.0, 3820.0])
        self.assertEqual(data.intensities, [0.0, 0.0, 10.25, 4.2])
        self.assertEqual([site.element for site in data.atoms], ["H", "H"])
        self.assertAlmostEqual(data.atoms[1].z_coord, 1.4)
        # mode 3 (first real vibration): atom 1 = (0.10, 0.20, 0.30), atom 2 x = -0.50
        self.assertAlmostEqual(flat(data.displacements, 3, 1, 1, 2), 0.10)
        self.assertAlmostEqual(flat(data.displacements, 3, 2, 1, 2), -0.50)
        # mode 4 comes from the second single-mode table block
        self.assertAlmostEqual(flat(data.displacements, 4, 2, 2, 2), 1.00)


CP2K_OUTPUT_SAMPLE = """\
  CP2K| version 2024.1 (constructed sample for the launcher tests)

 &FORCE_EVAL
   &SUBSYS
     &COORD
         O    0.000000    0.000000    0.117300
         H    0.000000    0.757200   -0.469200
         H    0.000000   -0.757200   -0.469200
     &END COORD
   &END SUBSYS
 &END FORCE_EVAL

 VIB|                         1                      2
 VIB|Frequency (cm^-1)       1650.0000             3820.0000
 VIB|Intensities               61.5000                4.2000
 VIB|ATOM  EL      X      Y      Z        X      Y      Z
    1   O     0.00   0.00   0.07    0.00   0.00  -0.06
    2   H     0.00   0.00  -0.56    0.00   0.43   0.47
    3   H     0.00   0.00  -0.56    0.00  -0.43   0.47
"""


class Cp2kFlowTests(unittest.TestCase):
    def test_constructed_cp2k_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "h2o_freq_cp2k.out"
            path.write_text(CP2K_OUTPUT_SAMPLE, encoding="utf-8")
            data = viewer.load_vibration_input(path)
        self.assertEqual(data.source_program, "cp2k")
        self.assertEqual(data.natom, 3)
        self.assertEqual(data.nmode, 2)
        self.assertEqual(data.frequencies, [1650.0, 3820.0])
        self.assertEqual(data.intensities, [61.5, 4.2])
        self.assertEqual(data.spectrum_kind, "ir")
        self.assertEqual([site.element for site in data.atoms], ["O", "H", "H"])
        self.assertAlmostEqual(flat(data.displacements, 1, 2, 3, 3), -0.56)
        self.assertAlmostEqual(flat(data.displacements, 2, 3, 2, 3), -0.43)


class PlotDataEncodingTests(unittest.TestCase):
    def test_crc32c_reference_vector(self):
        self.assertEqual(viewer.crc32c(b"123456789"), 0xE3069283)

    def test_frame_roundtrip_against_js_layout(self):
        values = [0.0, -0.56, 0.43, 1e-12, -1e12, math.pi]
        frame = viewer.encode_plot_dataset(7, values)
        dataset_id, arrays = decode_plot_dataset(frame)
        self.assertEqual(dataset_id, 7)
        self.assertEqual(set(arrays), {4})  # role u
        self.assertEqual(arrays[4], values)

    def test_dataset_id_must_be_positive(self):
        with self.assertRaises(ValueError):
            viewer.encode_plot_dataset(0, [1.0])


class ManifestAndStructureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = viewer.parse_gaussian_output(FIXTURES / "h2o_freq_gaussian.out")

    def test_manifest_passes_viewer_equivalent_validation(self):
        manifest = viewer.build_manifest(self.data, dataset_id=7)
        validate_manifest_like_viewer(manifest)
        self.assertNotIn("multiwfnGui", manifest)
        vibrations = manifest["vibrations"]
        self.assertEqual(vibrations["sourceProgram"], "gaussian")
        self.assertEqual(vibrations["spectrumKind"], "ir")
        self.assertEqual(vibrations["intensityUnit"], "km/mol")
        self.assertEqual(vibrations["displacements"]["datasetId"], 7)
        self.assertEqual(vibrations["modes"][0], {"index": 1, "frequency": 1650.0, "intensity": 61.5})

    def test_structure_matches_pymatgen_site_shape(self):
        structure = viewer.build_structure(self.data)
        validate_structure_like_viewer(structure, self.data.natom)
        first = structure["sites"][0]
        self.assertEqual(first["species"], [{"element": "O", "occu": 1, "oxidation_state": 0}])
        self.assertEqual(first["abc"], [0, 0, 0])
        self.assertEqual(first["label"], "O1")
        self.assertEqual(structure["charge"], 0)
        self.assertEqual(structure["properties"]["bonds"], [])

    def test_write_session_emits_parseable_files(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory) / "session"
            manifest = viewer.write_session(self.data, session)
            on_disk = json.loads((session / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(on_disk, manifest)
            validate_manifest_like_viewer(on_disk)
            validate_structure_like_viewer(
                json.loads((session / "structure.json").read_text(encoding="utf-8")),
                self.data.natom,
            )


class HttpServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = viewer.parse_gaussian_output(FIXTURES / "h2o_freq_gaussian.out")

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.session = root / "session"
        self.export = root / "export"
        viewer.write_session(self.data, self.session)
        self.frame = viewer.encode_plot_dataset(1, self.data.displacements)
        handler = viewer.make_vibration_handler(self.session, {1: self.frame}, self.export)
        handler.log_message = lambda *args: None  # type: ignore[method-assign]
        self.server = viewer.bind_vibration_server("127.0.0.1", 0, handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop)

    def _stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.directory.cleanup()

    def _request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        return response, payload

    def test_session_files_are_served(self):
        response, payload = self._request("GET", "/session/manifest.json")
        self.assertEqual(response.status, 200)
        validate_manifest_like_viewer(json.loads(payload))
        response, payload = self._request("GET", "/session/structure.json")
        self.assertEqual(response.status, 200)
        validate_structure_like_viewer(json.loads(payload), self.data.natom)

    def test_plot_data_content_type_and_frame(self):
        response, payload = self._request("GET", "/api/plot-data/1")
        self.assertEqual(response.status, 200)
        self.assertEqual(
            response.getheader("Content-Type"),
            "application/vnd.multiwfn.matterviz-plot-data-v1",
        )
        dataset_id, arrays = decode_plot_dataset(payload)
        self.assertEqual(dataset_id, 1)
        self.assertEqual(arrays[4], self.data.displacements)

    def test_plot_data_with_capability_query(self):
        response, _ = self._request("GET", "/api/plot-data/1?cap=testcap")
        self.assertEqual(response.status, 200)

    def test_unknown_dataset_is_404(self):
        response, _ = self._request("GET", "/api/plot-data/999")
        self.assertEqual(response.status, 404)

    def test_session_path_traversal_is_blocked(self):
        secret = Path(self.directory.name) / "secret.txt"
        secret.write_text("top secret", encoding="utf-8")
        response, _ = self._request("GET", "/session/../secret.txt")
        self.assertIn(response.status, (403, 404))
        response, _ = self._request("GET", "/session/%2e%2e/secret.txt")
        self.assertIn(response.status, (403, 404))

    def test_ready_accepts_post(self):
        response, payload = self._request("POST", "/api/ready")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(payload), {"ok": True})

    def test_save_file_sanitizes_name(self):
        response, payload = self._request(
            "POST", "/api/save-file?name=../../evil.webm", body=b"webm-bytes"
        )
        self.assertEqual(response.status, 200)
        result = json.loads(payload)
        self.assertTrue(result["ok"])
        self.assertEqual(Path(result["path"]).parent, self.export)
        self.assertEqual((self.export / "evil.webm").read_bytes(), b"webm-bytes")
        self.assertFalse((Path(self.directory.name) / "evil.webm").exists())

    def test_return_stops_the_service(self):
        response, payload = self._request("GET", "/api/return")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(payload), {"ok": True})
        self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive())
        self.assertTrue((self.session / "gui_stop.flag").is_file())


def make_fake_engine(directory: Path, stdout_file: Path) -> Path:
    script = Path(directory) / "fake_multiwfn.sh"
    script.write_text(
        "#!/bin/sh\n"
        'record="$(dirname "$0")/engine_record.txt"\n'
        'echo "ARG:$1" >> "$record"\n'
        "cat >> \"$record.stdin\"\n"
        f'cat "{stdout_file}"\n',
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return script


@unittest.skipIf(os.name == "nt", "the fake engine is a POSIX shell script")
class ExternalEngineTests(unittest.TestCase):
    def test_run_multiwfn_tasks_feeds_stdin_and_queues_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = make_fake_engine(Path(directory), FIXTURES / "h2o_freq_gaussian.out")
            tasks = [
                ("first.out", ["11", "1", "-2", "0", "q"]),
                ("second.out", ["11", "2"]),
            ]
            results = viewer.run_multiwfn_tasks(engine, tasks)
            self.assertEqual([result.returncode for result in results], [0, 0])
            self.assertEqual([str(result.input_file) for result in results], ["first.out", "second.out"])
            self.assertIn("Frequencies --", results[0].output)
            record = (Path(directory) / "engine_record.txt").read_text(encoding="utf-8")
            self.assertEqual(record.splitlines(), ["ARG:first.out", "ARG:second.out"])
            stdin_log = (Path(directory) / "engine_record.txt.stdin").read_text(encoding="utf-8")
            self.assertEqual(stdin_log, "11\n1\n-2\n0\nq\n11\n2\n")

    def test_compute_fallback_regenerates_displacement_data(self):
        sample = (
            " Entering Gaussian System, Link 0=g16\n"
            " Standard orientation:\n"
            " ---------------------------------------------------------------------\n"
            " Center     Atomic      Atomic             Coordinates (Angstroms)\n"
            " Number     Number       Type             X           Y           Z\n"
            " ---------------------------------------------------------------------\n"
            "      1          8           0        0.000000    0.000000    0.117300\n"
            "      2          1           0        0.000000    0.757200   -0.469200\n"
            "      3          1           0        0.000000   -0.757200   -0.469200\n"
            " ---------------------------------------------------------------------\n"
            "                      1                      2                      3\n"
            "                     A                      A                      A\n"
            " Frequencies --  1650.0000            3820.0000            3935.0000\n"
            " IR Inten    --     61.5000               4.2000               0.9000\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gaussian_no_modes.out"
            path.write_text(sample, encoding="utf-8")
            with self.assertRaises(viewer.MissingDisplacementError):
                viewer.load_vibration_input(path)
            engine = make_fake_engine(Path(directory), FIXTURES / "h2o_freq_gaussian.out")
            data = viewer.prepare_vibration_data(
                path,
                g98_out=None,
                compute=True,
                multiwfn=str(engine),
                spectrum="ir",
                compute_menu=viewer.DEFAULT_COMPUTE_MENU,
                work_root=Path(directory),
            )
            self.assertEqual(data.nmode, 3)
            self.assertAlmostEqual(flat(data.displacements, 1, 2, 3, 3), -0.56)
            stdin_log = (Path(directory) / "engine_record.txt.stdin").read_text(encoding="utf-8")
            self.assertEqual(stdin_log, "11\n1\n-2\n0\nq\n")
            log = Path(directory) / "compute" / "gaussian_no_modes.compute.log"
            self.assertIn("Frequencies --", log.read_text(encoding="utf-8"))


class NoLaunchCliTests(unittest.TestCase):
    def test_no_launch_builds_session_and_prints_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory) / "vib_session"
            code = viewer.main(
                [str(FIXTURES / "h2o_freq_gaussian.out"), "--no-launch", "--session-dir", str(session)]
            )
            self.assertEqual(code, 0)
            manifest = json.loads((session / "manifest.json").read_text(encoding="utf-8"))
            validate_manifest_like_viewer(manifest)
            self.assertNotIn("multiwfnGui", manifest)
            structure = json.loads((session / "structure.json").read_text(encoding="utf-8"))
            validate_structure_like_viewer(structure, 3)


@unittest.skipUnless(
    os.environ.get("MULTIWFN_VIBRATION_E2E"),
    "set MULTIWFN_VIBRATION_E2E=1 to run the desktop shell end-to-end launch test",
)
class DesktopLaunchE2ETests(unittest.TestCase):
    def test_desktop_shell_opens_and_returns(self):
        if viewer.resolve_desktop() is None:
            self.skipTest("matterviz-desktop executable not found")
        data = viewer.parse_gaussian_output(FIXTURES / "h2o_freq_gaussian.out")
        with tempfile.TemporaryDirectory() as directory:
            code = viewer.serve_vibration_session(
                data,
                session_dir=Path(directory) / "session",
                export_dir=Path(directory),
                port=0,
                launch=True,
            )
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
