# MatterViz test fixtures

`matterviz-real-orbital-Co5Cr.fch.gz` is a deterministic gzip copy of the
`(CO)5Cr.fch` wavefunction distributed with the earlier Multiwfn 3Dmol GUI demo
prerelease. It contains 11 atoms, 223 basis functions and a closed-shell
84-electron wavefunction. The packaged MatterViz regression requests orbital
43 so the test exercises a real uncached Multiwfn calculation rather than the
index-0 control path or a synthetic external-output parser.

The fixture is test-only and is not copied into MatterViz release packages.
Its compressed SHA-256 is
`01c69afc1ffef37ac42338ae1b1d8c809f373727eaedf33b3003cc99c1de6f07`.
