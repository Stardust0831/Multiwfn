import io
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import multiwfn_analysis as analysis_module  # noqa: E402
from multiwfn_analysis import (  # noqa: E402
    AnalysisStore,
    detect_output_capabilities,
    parse_cp2k_bs,
    parse_cp2k_kpoint_dos,
    parse_gaussian_ir,
    parse_nmr,
    parse_vasp_band,
    parse_vasp_doscar,
)


GAUSSIAN_IR = """Entering Gaussian System
 Frequencies --   500.0000  750.0000  1000.0000
 Red. masses --     1.0000    1.0000     1.0000
 IR Inten    --    10.0000   20.0000    30.0000
"""


class AnalysisDetectionTests(unittest.TestCase):
    def test_gaussian_ir_is_detected_and_parsed(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "calculation.out"
            output.write_text(GAUSSIAN_IR, encoding="utf-8")
            capabilities, metadata = detect_output_capabilities([output])
            self.assertTrue(capabilities["ir"]["available"])
            self.assertFalse(capabilities["nmr"]["available"])
            self.assertEqual(metadata["format"], "gaussian")
        parsed = parse_gaussian_ir(GAUSSIAN_IR)
        self.assertEqual(parsed["metadata"]["counts"]["harmonic"], 3)
        self.assertEqual(parsed["series"]["harmonic"][1]["frequency"], 750.0)

    def test_vasp_band_requires_line_mode_kpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            eigenval = root / "EIGENVAL"
            kpoints = root / "KPOINTS"
            eigenval.write_text("VASP eigenvalues\n", encoding="utf-8")
            capabilities, _ = detect_output_capabilities([eigenval])
            self.assertFalse(capabilities["band"]["available"])
            self.assertIn("KPOINTS", capabilities["band"]["reason"])
            kpoints.write_text("path\n20\nLine-mode\nreciprocal\n0 0 0 ! Gamma\n", encoding="utf-8")
            capabilities, metadata = detect_output_capabilities([eigenval, kpoints])
            self.assertTrue(capabilities["band"]["available"])
            self.assertEqual(metadata["format"], "vasp")

    def test_gaussian_nmr_shielding_is_parsed(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "nmr.log"
            output.write_text(
                "Gaussian, Inc.\nMagnetic shielding tensor (ppm)\n"
                " 1 C Isotropic = 145.5000 Anisotropy = 10.0\n"
                " 2 H Isotropic = 31.2500 Anisotropy = 1.0\n",
                encoding="utf-8",
            )
            parsed = parse_nmr(output)
            self.assertEqual(parsed["metadata"]["elements"], ["C", "H"])
            self.assertEqual(parsed["series"]["atoms"][0]["shielding"], 145.5)

    def test_orca_bdf_and_cp2k_nmr_outputs_are_parsed(self):
        fixtures = {
            "orca.out": (
                "O   R   C   A\nCHEMICAL SHIELDING SUMMARY\n"
                " 0 C 145.500\n 1 H 31.250\n\n",
                "ORCA", [(1, "C", 145.5), (2, "H", 31.25)],
            ),
            "bdf.out": (
                "Nuclear Magnetic shielding result in PPM\n"
                "NMR shielding tensor and constant of nucleus atom C\n"
                "NMR shielding tensor and constant of nucleus atom H\n"
                "Isotropic/anisotropic constant by atom order\n"
                "145.500 10.0\n31.250 1.0\n\n",
                "BDF", [(1, "C", 145.5), (2, "H", 31.25)],
            ),
            "cp2k.out": (
                "Shielding atom at atomic positions 1 C\nISOTROPY = 145.500\n"
                "Shielding atom at atomic positions 2 H\nISOTROPY = 31.250\n",
                "CP2K", [(1, "C", 145.5), (2, "H", 31.25)],
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, (text, program, expected) in fixtures.items():
                output = root / name
                output.write_text(text, encoding="utf-8")
                capabilities, _metadata = detect_output_capabilities([output])
                self.assertTrue(capabilities["nmr"]["available"], name)
                parsed = parse_nmr(output)
                self.assertEqual(parsed["metadata"]["program"], program)
                self.assertEqual(
                    [(atom["index"], atom["element"], atom["shielding"])
                     for atom in parsed["series"]["atoms"]],
                    expected,
                )

    def test_vasp_band_and_dos_extract_normalized_series(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            eigenval = root / "EIGENVAL"
            eigenval.write_text(
                "header\n" * 5
                + "2 2 2\n\n"
                + "0.0 0.0 0.0 0.5\n1 -2.0 1.0\n2 1.0 0.0\n\n"
                + "0.5 0.0 0.0 0.5\n1 -1.5 1.0\n2 1.5 0.0\n",
                encoding="utf-8",
            )
            kpoints = root / "KPOINTS"
            kpoints.write_text(
                "path\n2\nLine-mode\nreciprocal\n"
                "0.0 0.0 0.0 ! Gamma\n0.5 0.0 0.0 ! X\n",
                encoding="utf-8",
            )
            outcar = root / "OUTCAR"
            outcar.write_text(" E-fermi : 0.2500 eV\n", encoding="utf-8")
            band = parse_vasp_band(eigenval, kpoints, outcar)
            self.assertEqual(band["metadata"]["reference"], "fermi")
            self.assertEqual(band["series"]["alpha"][0], [-2.25, 0.75])
            self.assertEqual([tick["label"] for tick in band["markers"]["ticks"]], ["Γ", "X"])

            doscar = root / "DOSCAR"
            doscar.write_text(
                "1\nheader\nheader\nheader\nheader\n"
                "5 -5 3 0.5 0\n"
                "-1 1 0\n0 2 1\n1 1 2\n"
                "5 -5 3 0.5 0\n"
                "-1 0.1 0.2 0.3\n0 0.2 0.3 0.4\n1 0.1 0.2 0.3\n",
                encoding="utf-8",
            )
            poscar = root / "POSCAR"
            poscar.write_text("test\n1\n1 0 0\n0 1 0\n0 0 1\nC\n1\nDirect\n0 0 0\n", encoding="utf-8")
            dos = parse_vasp_doscar(doscar, poscar)
            self.assertEqual(dos["series"]["sampled"][0]["energy"], [-1.5, -0.5, 0.5])
            self.assertEqual({series["orbital"] for series in dos["series"]["projections"]}, {"s", "p", "d"})
            renamed = []
            for source, target_name in ((eigenval, "bands.dat"), (kpoints, "path.dat"),
                                        (doscar, "density.dat"), (poscar, "structure.dat")):
                target = root / target_name
                source.rename(target)
                renamed.append(target)
            capabilities, _ = detect_output_capabilities(renamed)
            self.assertTrue(capabilities["band"]["available"])
            self.assertTrue(capabilities["dos"]["available"])
            self.assertTrue(capabilities["dos"]["features"]["pdos"])

    def test_cp2k_band_parser_preserves_special_points_and_occupations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bands.bs"
            prefix23 = " " * 23
            prefix24 = " " * 24
            path.write_text(
                "# Set 1: 2 special points, 2 k-points, 3 bands\n"
                f"{prefix23}0.0 0.0 0.0 GAMMA\n"
                f"{prefix23}0.5 0.0 0.0 X\n"
                f"{prefix24}0.0 0.0 0.0\n#   Band Energy Occupation\n"
                "1 -2.0 1.0\n2 -0.5 1.0\n3 1.0 0.0\n"
                f"{prefix24}0.5 0.0 0.0\n#   Band Energy Occupation\n"
                "1 -1.5 1.0\n2 -0.2 1.0\n3 1.2 0.0\n",
                encoding="utf-8",
            )
            band = parse_cp2k_bs(path)
            self.assertEqual(band["metadata"]["nkpoints"], 2)
            self.assertEqual(band["markers"]["vbm"], 0.0)
            self.assertAlmostEqual(band["markers"]["cbm"], 1.2)
            self.assertEqual([tick["label"] for tick in band["markers"]["ticks"]], ["GAMMA", "X"])

    def test_cp2k_all_kpoint_output_generates_weighted_dos_levels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp2k.out"
            path.write_text(
                "List of Kpoints\nnumber of k-points 2\n\n"
                "KPOINT 1 0.25\nKPOINT 2 0.75\n\n"
                "EIGENVALUES AND OCCUPATION NUMBERS FOR K POINT 1\nheader\nheader\nheader\n"
                "MO 1 1.0 -2.0\nMO 2 0.0 1.0\n\n"
                "EIGENVALUES AND OCCUPATION NUMBERS FOR K POINT 2\nheader\nheader\nheader\n"
                "MO 1 1.0 -1.5\nMO 2 0.0 1.5\n",
                encoding="utf-8",
            )
            dos = parse_cp2k_kpoint_dos(path)
            self.assertEqual(len(dos["series"]["levels"]), 4)
            self.assertEqual(dos["metadata"]["hoco"], -1.5)
            self.assertAlmostEqual(dos["series"]["levels"][0]["weight"], 0.25)
            self.assertEqual(dos["series"]["levels"][2]["energy"], 0.0)

    def test_cp2k_open_shell_dos_uses_the_highest_occupied_spin_as_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cp2k-open-shell.out"
            path.write_text(
                "Spin 1\nList of Kpoints\nnumber of k-points 1\n\nKPOINT 1 1.0\n\n"
                "EIGENVALUES AND OCCUPATION NUMBERS FOR K POINT 1\nheader\nheader\nheader\n"
                "MO 1 1.0 -2.0\nMO 2 0.0 1.0\n\n"
                "Spin 2\nEIGENVALUES AND OCCUPATION NUMBERS FOR K POINT 1\nheader\nheader\nheader\n"
                "MO 1 1.0 -1.0\nMO 2 0.0 2.0\n",
                encoding="utf-8",
            )
            dos = parse_cp2k_kpoint_dos(path)
            self.assertEqual(dos["metadata"]["hoco"], -1.0)
            beta_occupied = next(level for level in dos["series"]["levels"]
                                 if level["spin"] == "beta" and level["occupation"] > 0)
            self.assertEqual(beta_occupied["energy"], 0.0)


class AnalysisStoreTests(unittest.TestCase):
    def test_upload_inspect_extract_and_restore_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            store = AnalysisStore(session, {})
            dataset = store.create_dataset("IR output")
            payload = GAUSSIAN_IR.encode("utf-8")
            uploaded = store.upload_file(dataset["id"], "../../calculation.out", io.BytesIO(payload), len(payload))
            self.assertEqual(uploaded["name"], "calculation.out")
            inspected = store.inspect(dataset["id"])["dataset"]
            self.assertTrue(inspected["capabilities"]["ir"]["available"])
            extracted = store.extract(dataset["id"], "ir")
            artifact = session / extracted["path"]
            self.assertTrue(artifact.is_file())
            self.assertEqual(json.loads(artifact.read_text())["kind"], "ir")
            restored = AnalysisStore(session, {})
            self.assertEqual(len(restored.list_datasets()), 2)

    def test_upload_rejects_binary_partial_and_over_limit_files_without_residue(self):
        with tempfile.TemporaryDirectory() as directory:
            session = Path(directory)
            store = AnalysisStore(session, {})
            dataset = store.create_dataset("Upload limits")
            dataset_id = dataset["id"]
            with self.assertRaisesRegex(ValueError, "text analysis outputs"):
                store.upload_file(dataset_id, "archive.zip", io.BytesIO(b"PK\x03\x04binary"), 10)
            with self.assertRaisesRegex(ValueError, "ended before"):
                store.upload_file(dataset_id, "partial.out", io.BytesIO(b"one"), 8)
            self.assertEqual(list((session / "analysis_inputs" / dataset_id).iterdir()), [])
            with self.assertRaisesRegex(ValueError, "512 MiB"):
                store.upload_file(dataset_id, "huge.out", io.BytesIO(), analysis_module.MAX_ANALYSIS_FILE_BYTES + 1)
            original_limit = analysis_module.MAX_ANALYSIS_SESSION_BYTES
            analysis_module.MAX_ANALYSIS_SESSION_BYTES = 3
            try:
                with self.assertRaisesRegex(ValueError, "1 GiB"):
                    store.upload_file(dataset_id, "session.out", io.BytesIO(b"four"), 4)
            finally:
                analysis_module.MAX_ANALYSIS_SESSION_BYTES = original_limit
            self.assertEqual(store.list_datasets()[1]["files"], [])

    def test_primary_manifest_orbitals_enable_molecular_dos(self):
        manifest = {
            "orbitals": {
                "items": [
                    {"index": 1, "energy": -0.5, "occupation": 2},
                    {"index": 2, "energy": 0.1, "occupation": 0},
                ]
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisStore(Path(directory), manifest)
            primary = store.list_datasets()[0]
            self.assertTrue(primary["capabilities"]["dos"]["available"])
            result = store.extract("primary", "dos")
            artifact = json.loads((Path(directory) / result["path"]).read_text())
            self.assertEqual(len(artifact["series"]["levels"]), 2)

    def test_periodic_manifest_orbitals_do_not_masquerade_as_kpoint_dos(self):
        manifest = {
            "periodic": {"enabled": True},
            "orbitals": {"items": [{"index": 1, "energy": -0.5, "occupation": 2}]},
            "analysis": {"capabilities": {"dos": {"available": True, "format": "multiwfn-orbitals"}}},
        }
        with tempfile.TemporaryDirectory() as directory:
            primary = AnalysisStore(Path(directory), manifest).list_datasets()[0]
            self.assertFalse(primary["capabilities"]["dos"]["available"])
            self.assertIn("k-point", primary["capabilities"]["dos"]["reason"])


if __name__ == "__main__":
    unittest.main()
