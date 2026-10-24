# Frequency fixtures

Unmodified CJSON exports produced with **cclib 1.8.1**, `ccread` followed by
`ccwrite(data, outputtype="cjson")`. No frequency/geometry/displacement values
were edited. These are real producer outputs, not handwritten mode tables.

Source repository: [cclib-data](https://github.com/cclib/cclib-data), fixed commit
`127b2229d584d54fb84a74e383edb18a271fc283`.

| Fixture | Source path | Producer | Atoms / modes | First frequencies (cm⁻¹) |
| --- | --- | --- | --- | --- |
| `gaussian16-water.cjson` | `Gaussian/Gaussian16/water_neutral_nbo_opt_freq.out` | Gaussian 16 A.03 | 3 / 3 | 2169.7613, 4141.3837, 4392.5759 |
| `orca42-dvb.cjson` | `ORCA/ORCA4.2/dvb_ir.out` | ORCA 4.2.0 | 20 / 54 | 45.75, 78.4, 150.6 |

SHA-256 of the original output files, in table order:

```text
9493d24655fb261a2c945d292ad517567f3024996594a25f678199df74017519
e053a2b3a24ac425f816263420782b542e8058b7ddd49aab443de21417c5ce4f
```

SHA-256 of the CJSON exports, in table order:

```text
3f13d7f2d0f06f7f50de6301c92a961bff906bdad7ad0cda4342605553a1d18b
b40c74e12ce654465378dfdbd0bf2a913db3291c35fad4f4791417d0b027b3a6
```

Reproduce using cclib's existing command (in a separate environment, not a
Multiwfn build dependency):

```sh
python -m pip install cclib==1.8.1
ccwrite cjson water_neutral_nbo_opt_freq.out
ccwrite cjson dvb_ir.out
```

The mode order is cclib's exported order. In particular, ORCA's removed
translation/rotation modes are not reinserted or renumbered as raw ORCA modes.
Water's first vector has O z = −0.07 and H z = 0.54. The rendering test checks
this unequal-element ratio to detect accidental extra mass-unweighting.
Imaginary frequencies, incomplete arrays and invalid values are separate test
mutations; those variants are not represented as original producer output.
