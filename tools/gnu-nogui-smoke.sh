#!/usr/bin/env sh
set -eu

REPO_ROOT=$(pwd)
GNU_PREFIX=${GNU_PREFIX:-$REPO_ROOT/.build-env/gnu}
EXE_noGUI=${EXE_noGUI:-Multiwfn_noGUI}
SMOKE_DIR=${SMOKE_DIR:-.build-env/smoke}
SMOKE_XYZ=${SMOKE_XYZ:-$SMOKE_DIR/water.xyz}
SMOKE_PQR=${SMOKE_PQR:-$SMOKE_DIR/water.pqr}
SMOKE_CUBE=${SMOKE_CUBE:-$SMOKE_DIR/water-density.cub}
SMOKE_POSCAR=${SMOKE_POSCAR:-$SMOKE_DIR/water.POSCAR}
SMOKE_MWFN=${SMOKE_MWFN:-tools/fixtures/he_minimal.mwfn}
SMOKE_OUT=${SMOKE_OUT:-$SMOKE_DIR/gnu-noGUI-smoke.out}
SMOKE_ERR=${SMOKE_ERR:-$SMOKE_DIR/gnu-noGUI-smoke.err}
SMOKE_CUBE_OUT=${SMOKE_CUBE_OUT:-$SMOKE_DIR/gnu-noGUI-cube-smoke.out}
SMOKE_CUBE_ERR=${SMOKE_CUBE_ERR:-$SMOKE_DIR/gnu-noGUI-cube-smoke.err}
SMOKE_MWFN_OUT=${SMOKE_MWFN_OUT:-$SMOKE_DIR/gnu-noGUI-mwfn-point-smoke.out}
SMOKE_MWFN_ERR=${SMOKE_MWFN_ERR:-$SMOKE_DIR/gnu-noGUI-mwfn-point-smoke.err}
SMOKE_MULLIKEN_OUT=${SMOKE_MULLIKEN_OUT:-$SMOKE_DIR/gnu-noGUI-mwfn-mulliken-smoke.out}
SMOKE_MULLIKEN_ERR=${SMOKE_MULLIKEN_ERR:-$SMOKE_DIR/gnu-noGUI-mwfn-mulliken-smoke.err}
SMOKE_WFN_GRID_DIR=${SMOKE_WFN_GRID_DIR:-$SMOKE_DIR/wfn-grid-export}
SMOKE_WFN_GRID_EXPORT_CUBE=${SMOKE_WFN_GRID_EXPORT_CUBE:-$SMOKE_WFN_GRID_DIR/density.cub}
SMOKE_WFN_GRID_SCENE=${SMOKE_WFN_GRID_SCENE:-$SMOKE_WFN_GRID_EXPORT_CUBE.vmd.tcl}
SMOKE_WFN_GRID_OUT=${SMOKE_WFN_GRID_OUT:-$SMOKE_WFN_GRID_DIR/gnu-noGUI-wfn-grid-smoke.out}
SMOKE_WFN_GRID_ERR=${SMOKE_WFN_GRID_ERR:-$SMOKE_WFN_GRID_DIR/gnu-noGUI-wfn-grid-smoke.err}
SMOKE_VMD_DIR=${SMOKE_VMD_DIR:-$SMOKE_DIR/vmd-export}
SMOKE_VMD_EXPORT_XYZ=${SMOKE_VMD_EXPORT_XYZ:-$SMOKE_VMD_DIR/exported.xyz}
SMOKE_VMD_SCENE=${SMOKE_VMD_SCENE:-$SMOKE_VMD_EXPORT_XYZ.vmd.tcl}
SMOKE_VMD_OUT=${SMOKE_VMD_OUT:-$SMOKE_VMD_DIR/gnu-noGUI-vmd-structure-smoke.out}
SMOKE_VMD_ERR=${SMOKE_VMD_ERR:-$SMOKE_VMD_DIR/gnu-noGUI-vmd-structure-smoke.err}
SMOKE_VMD_EXPORT_PDB=${SMOKE_VMD_EXPORT_PDB:-$SMOKE_VMD_DIR/exported.pdb}
SMOKE_VMD_PDB_SCENE=${SMOKE_VMD_PDB_SCENE:-$SMOKE_VMD_EXPORT_PDB.vmd.tcl}
SMOKE_VMD_PDB_OUT=${SMOKE_VMD_PDB_OUT:-$SMOKE_VMD_DIR/gnu-noGUI-vmd-pdb-smoke.out}
SMOKE_VMD_PDB_ERR=${SMOKE_VMD_PDB_ERR:-$SMOKE_VMD_DIR/gnu-noGUI-vmd-pdb-smoke.err}
SMOKE_VMD_EXPORT_PQR=${SMOKE_VMD_EXPORT_PQR:-$SMOKE_VMD_DIR/exported.pqr}
SMOKE_VMD_PQR_SCENE=${SMOKE_VMD_PQR_SCENE:-$SMOKE_VMD_EXPORT_PQR.vmd.tcl}
SMOKE_VMD_PQR_OUT=${SMOKE_VMD_PQR_OUT:-$SMOKE_VMD_DIR/gnu-noGUI-vmd-pqr-smoke.out}
SMOKE_VMD_PQR_ERR=${SMOKE_VMD_PQR_ERR:-$SMOKE_VMD_DIR/gnu-noGUI-vmd-pqr-smoke.err}
SMOKE_VMD_CUBE_DIR=${SMOKE_VMD_CUBE_DIR:-$SMOKE_DIR/vmd-cube-export}
SMOKE_VMD_EXPORT_CUBE=${SMOKE_VMD_EXPORT_CUBE:-$SMOKE_VMD_CUBE_DIR/exported.cub}
SMOKE_VMD_CUBE_SCENE=${SMOKE_VMD_CUBE_SCENE:-$SMOKE_VMD_EXPORT_CUBE.vmd.tcl}
SMOKE_VMD_CUBE_OUT=${SMOKE_VMD_CUBE_OUT:-$SMOKE_VMD_CUBE_DIR/gnu-noGUI-vmd-cube-smoke.out}
SMOKE_VMD_CUBE_ERR=${SMOKE_VMD_CUBE_ERR:-$SMOKE_VMD_CUBE_DIR/gnu-noGUI-vmd-cube-smoke.err}
SMOKE_VMD_VASP_DIR=${SMOKE_VMD_VASP_DIR:-$SMOKE_DIR/vmd-vasp-export}
SMOKE_VMD_EXPORT_CHGCAR=${SMOKE_VMD_EXPORT_CHGCAR:-$SMOKE_VMD_VASP_DIR/exported.CHGCAR}
SMOKE_VMD_CHGCAR_SCENE=${SMOKE_VMD_CHGCAR_SCENE:-$SMOKE_VMD_EXPORT_CHGCAR.vmd.tcl}
SMOKE_VMD_CHGCAR_OUT=${SMOKE_VMD_CHGCAR_OUT:-$SMOKE_VMD_VASP_DIR/gnu-noGUI-vmd-vasp-smoke.out}
SMOKE_VMD_CHGCAR_ERR=${SMOKE_VMD_CHGCAR_ERR:-$SMOKE_VMD_VASP_DIR/gnu-noGUI-vmd-vasp-smoke.err}
SMOKE_VMD_POSCAR_DIR=${SMOKE_VMD_POSCAR_DIR:-$SMOKE_DIR/vmd-poscar-export}
SMOKE_VMD_EXPORT_POSCAR=${SMOKE_VMD_EXPORT_POSCAR:-$SMOKE_VMD_POSCAR_DIR/exported.POSCAR}
SMOKE_VMD_POSCAR_SCENE=${SMOKE_VMD_POSCAR_SCENE:-$SMOKE_VMD_EXPORT_POSCAR.vmd.tcl}
SMOKE_VMD_POSCAR_OUT=${SMOKE_VMD_POSCAR_OUT:-$SMOKE_VMD_POSCAR_DIR/gnu-noGUI-vmd-poscar-smoke.out}
SMOKE_VMD_POSCAR_ERR=${SMOKE_VMD_POSCAR_ERR:-$SMOKE_VMD_POSCAR_DIR/gnu-noGUI-vmd-poscar-smoke.err}
SMOKE_VMD_GRO_DIR=${SMOKE_VMD_GRO_DIR:-$SMOKE_DIR/vmd-gro-export}
SMOKE_VMD_EXPORT_GRO=${SMOKE_VMD_EXPORT_GRO:-$SMOKE_VMD_GRO_DIR/exported.gro}
SMOKE_VMD_GRO_SCENE=${SMOKE_VMD_GRO_SCENE:-$SMOKE_VMD_EXPORT_GRO.vmd.tcl}
SMOKE_VMD_GRO_OUT=${SMOKE_VMD_GRO_OUT:-$SMOKE_VMD_GRO_DIR/gnu-noGUI-vmd-gro-smoke.out}
SMOKE_VMD_GRO_ERR=${SMOKE_VMD_GRO_ERR:-$SMOKE_VMD_GRO_DIR/gnu-noGUI-vmd-gro-smoke.err}

allowed_stderr='Note: The following floating-point exceptions are signalling: IEEE_INVALID_FLAG'

case $SMOKE_MWFN in
    /*) SMOKE_MWFN_ABS=$SMOKE_MWFN ;;
    *) SMOKE_MWFN_ABS=$REPO_ROOT/$SMOKE_MWFN ;;
esac

case $EXE_noGUI in
    /*) EXE_noGUI_ABS=$EXE_noGUI ;;
    *) EXE_noGUI_ABS=$REPO_ROOT/$EXE_noGUI ;;
esac

run_multiwfn() {
    lib_path=$GNU_PREFIX/lib
    if [ "${LD_LIBRARY_PATH:-}" ]; then
        lib_path=$lib_path:$LD_LIBRARY_PATH
    fi
    LD_LIBRARY_PATH=$lib_path timeout 12s "$EXE_noGUI_ABS" "$@"
}

run_multiwfn_in_dir() {
    run_dir=$1
    shift
    (
        cd "$run_dir"
        run_multiwfn "$@"
    )
}

check_stderr() {
    errfile=$1
    label=$2
    if [ -s "$errfile" ] && grep -Fvx "$allowed_stderr" "$errfile" >/dev/null; then
        printf '%s\n' "Unexpected $label stderr:"
        cat "$errfile"
        exit 1
    fi
}

restore_settings() {
    if [ -f "$SMOKE_DIR/settings.ini.before" ]; then
        cp "$SMOKE_DIR/settings.ini.before" settings.ini
    fi
}

mkdir -p "$SMOKE_DIR" "$SMOKE_VMD_DIR" "$SMOKE_VMD_CUBE_DIR" "$SMOKE_VMD_VASP_DIR" "$SMOKE_VMD_POSCAR_DIR" "$SMOKE_VMD_GRO_DIR" "$SMOKE_WFN_GRID_DIR"

printf '%s\n%s\n%s\n%s\n%s\n' \
    '3' \
    'water smoke test' \
    'O 0.000000 0.000000 0.000000' \
    'H 0.758602 0.000000 0.504284' \
    'H -0.758602 0.000000 0.504284' > "$SMOKE_XYZ"

printf '%s\n%s\n%s\n%s\n' \
    'ATOM      1  O   MOL     1       0.000   0.000   0.000  -0.8340 1.5200' \
    'ATOM      2  H1  MOL     1       0.759   0.000   0.504   0.4170 1.2000' \
    'ATOM      3  H2  MOL     1      -0.759   0.000   0.504   0.4170 1.2000' \
    'END' > "$SMOKE_PQR"

printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    'Water density smoke test' \
    'Generated by gnu-noGUI-smoke' \
    '    3    0.000000    0.000000    0.000000' \
    '    2    0.500000    0.000000    0.000000' \
    '    2    0.000000    0.500000    0.000000' \
    '    2    0.000000    0.000000    0.500000' \
    '    8    0.000000    0.000000    0.000000    0.000000' \
    '    1    0.000000    0.758602    0.000000    0.504284' \
    '    1    0.000000   -0.758602    0.000000    0.504284' > "$SMOKE_CUBE"
printf '%s\n%s\n' \
    '  0.120000E+00  0.080000E+00  0.080000E+00  0.040000E+00  0.080000E+00  0.040000E+00' \
    '  0.040000E+00  0.020000E+00' >> "$SMOKE_CUBE"

printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    'Water smoke POSCAR' \
    '1.0' \
    '6.0 0.0 0.0' \
    '0.0 6.0 0.0' \
    '0.0 0.0 6.0' \
    'O H' \
    '1 2' \
    'Cartesian' \
    '0.000000 0.000000 0.000000' \
    '0.758602 0.000000 0.504284' \
    '-0.758602 0.000000 0.504284' > "$SMOKE_POSCAR"

cp settings.ini "$SMOKE_DIR/settings.ini.before"
trap restore_settings EXIT HUP INT TERM

printf '%s\nq\n' "$SMOKE_XYZ" | run_multiwfn > "$SMOKE_OUT" 2> "$SMOKE_ERR"
grep -q 'Loaded .*water.xyz successfully' "$SMOKE_OUT"
grep -q 'Main function menu' "$SMOKE_OUT"
check_stderr "$SMOKE_ERR" "GNU noGUI XYZ smoke"

printf '%s\n%s\n%s\n' 'xyz' "$SMOKE_VMD_EXPORT_XYZ" 'q' |
    run_multiwfn "$SMOKE_XYZ" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_OUT" 2> "$SMOKE_VMD_ERR"
grep -q 'Loaded .*water.xyz successfully' "$SMOKE_VMD_OUT"
grep -q 'Exporting xyz file finished!' "$SMOKE_VMD_OUT"
grep -q 'VMD scene script has been written to .*exported.xyz.vmd.tcl' "$SMOKE_VMD_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_OUT"
test -s "$SMOKE_VMD_EXPORT_XYZ"
test -s "$SMOKE_VMD_SCENE"
grep -Fq "# Structure file: $SMOKE_VMD_EXPORT_XYZ" "$SMOKE_VMD_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.xyz"] type "xyz" waitfor all' "$SMOKE_VMD_SCENE"
grep -Fq 'mol color Element' "$SMOKE_VMD_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_SCENE"
check_stderr "$SMOKE_VMD_ERR" "GNU noGUI VMD structure export smoke"

printf '%s\n%s\n%s\n' 'pdb' "$SMOKE_VMD_EXPORT_PDB" 'q' |
    run_multiwfn "$SMOKE_XYZ" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_PDB_OUT" 2> "$SMOKE_VMD_PDB_ERR"
grep -q 'Loaded .*water.xyz successfully' "$SMOKE_VMD_PDB_OUT"
grep -q 'Exporting pdb file finished!' "$SMOKE_VMD_PDB_OUT"
grep -q 'VMD scene script has been written to .*exported.pdb.vmd.tcl' "$SMOKE_VMD_PDB_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_PDB_OUT"
test -s "$SMOKE_VMD_EXPORT_PDB"
test -s "$SMOKE_VMD_PDB_SCENE"
grep -Fq "# Structure file: $SMOKE_VMD_EXPORT_PDB" "$SMOKE_VMD_PDB_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.pdb"] type "pdb" waitfor all' "$SMOKE_VMD_PDB_SCENE"
grep -Fq 'mol color Element' "$SMOKE_VMD_PDB_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_PDB_SCENE"
check_stderr "$SMOKE_VMD_PDB_ERR" "GNU noGUI VMD PDB structure export smoke"

printf '%s\n%s\n%s\n%s\n%s\n%s\n' '100' '2' '1' "$SMOKE_VMD_EXPORT_PQR" '0' 'q' |
    run_multiwfn "$SMOKE_PQR" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_PQR_OUT" 2> "$SMOKE_VMD_PQR_ERR"
grep -q 'Loaded .*water.pqr successfully' "$SMOKE_VMD_PQR_OUT"
grep -q 'Sum of atomic charges:' "$SMOKE_VMD_PQR_OUT"
grep -q 'Exporting pqr file finished!' "$SMOKE_VMD_PQR_OUT"
grep -q 'VMD scene script has been written to .*exported.pqr.vmd.tcl' "$SMOKE_VMD_PQR_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_PQR_OUT"
test -s "$SMOKE_VMD_EXPORT_PQR"
test -s "$SMOKE_VMD_PQR_SCENE"
grep -Fq "# Structure file: $SMOKE_VMD_EXPORT_PQR" "$SMOKE_VMD_PQR_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.pqr"] type "pqr" waitfor all' "$SMOKE_VMD_PQR_SCENE"
grep -Fq 'mol color Charge' "$SMOKE_VMD_PQR_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_PQR_SCENE"
check_stderr "$SMOKE_VMD_PQR_ERR" "GNU noGUI VMD PQR structure export smoke"

printf '%s\nq\n' "$SMOKE_CUBE" | run_multiwfn > "$SMOKE_CUBE_OUT" 2> "$SMOKE_CUBE_ERR"
grep -q 'Loaded .*water-density.cub successfully' "$SMOKE_CUBE_OUT"
grep -q 'Main function menu' "$SMOKE_CUBE_OUT"
check_stderr "$SMOKE_CUBE_ERR" "GNU noGUI cube smoke"

printf '%s\n%s\n%s\n%s\n%s\n' '13' '0' "$SMOKE_VMD_EXPORT_CUBE" '-1' 'q' |
    run_multiwfn "$SMOKE_CUBE" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_CUBE_OUT" 2> "$SMOKE_VMD_CUBE_ERR"
grep -q 'Loaded .*water-density.cub successfully' "$SMOKE_VMD_CUBE_OUT"
grep -q 'Process grid data' "$SMOKE_VMD_CUBE_OUT"
grep -q 'Done, cube file has been outputted' "$SMOKE_VMD_CUBE_OUT"
grep -q 'VMD scene script has been written to .*exported.cub.vmd.tcl' "$SMOKE_VMD_CUBE_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_CUBE_OUT"
test -s "$SMOKE_VMD_EXPORT_CUBE"
test -s "$SMOKE_VMD_CUBE_SCENE"
grep -Fq "# Cube file: $SMOKE_VMD_EXPORT_CUBE" "$SMOKE_VMD_CUBE_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.cub"] type cube waitfor all' "$SMOKE_VMD_CUBE_SCENE"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$SMOKE_VMD_CUBE_SCENE"
grep -Fq 'mol representation Isosurface -0.05000000 0 0 0 1 1' "$SMOKE_VMD_CUBE_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_CUBE_SCENE"
check_stderr "$SMOKE_VMD_CUBE_ERR" "GNU noGUI VMD cube export smoke"

printf '%s\n%s\n%s\n%s\n%s\n%s\n' '100' '2' '37' "$SMOKE_VMD_EXPORT_CHGCAR" '0' 'q' |
    run_multiwfn "$SMOKE_CUBE" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_CHGCAR_OUT" 2> "$SMOKE_VMD_CHGCAR_ERR"
grep -q 'Loaded .*water-density.cub successfully' "$SMOKE_VMD_CHGCAR_OUT"
grep -q 'Export system to various formats of files' "$SMOKE_VMD_CHGCAR_OUT"
grep -q 'Done, the grid data has been exported in VASP grid data format' "$SMOKE_VMD_CHGCAR_OUT"
grep -q 'VMD scene script has been written to .*exported.CHGCAR.vmd.tcl' "$SMOKE_VMD_CHGCAR_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_CHGCAR_OUT"
test -s "$SMOKE_VMD_EXPORT_CHGCAR"
test -s "$SMOKE_VMD_CHGCAR_SCENE"
grep -Fq "# Volumetric map file: $SMOKE_VMD_EXPORT_CHGCAR" "$SMOKE_VMD_CHGCAR_SCENE"
grep -Fq '# VMD file type: CHGCAR' "$SMOKE_VMD_CHGCAR_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.CHGCAR"] type "CHGCAR" waitfor all' "$SMOKE_VMD_CHGCAR_SCENE"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$SMOKE_VMD_CHGCAR_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_CHGCAR_SCENE"
check_stderr "$SMOKE_VMD_CHGCAR_ERR" "GNU noGUI VMD VASP grid export smoke"

printf '%s\n%s\n%s\n%s\n%s\n%s\n' '100' '2' '27' "$SMOKE_VMD_EXPORT_POSCAR" '0' 'q' |
    run_multiwfn "$SMOKE_POSCAR" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_POSCAR_OUT" 2> "$SMOKE_VMD_POSCAR_ERR"
grep -q 'Loaded .*water.POSCAR successfully' "$SMOKE_VMD_POSCAR_OUT"
grep -q 'Export system to various formats of files' "$SMOKE_VMD_POSCAR_OUT"
grep -q 'VASP POSCAR file has been exported to .*exported.POSCAR' "$SMOKE_VMD_POSCAR_OUT"
grep -q 'VMD scene script has been written to .*exported.POSCAR.vmd.tcl' "$SMOKE_VMD_POSCAR_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_POSCAR_OUT"
test -s "$SMOKE_VMD_EXPORT_POSCAR"
test -s "$SMOKE_VMD_POSCAR_SCENE"
grep -Fq "# Structure file: $SMOKE_VMD_EXPORT_POSCAR" "$SMOKE_VMD_POSCAR_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.POSCAR"] type "POSCAR" waitfor all' "$SMOKE_VMD_POSCAR_SCENE"
grep -Fq 'mol color Element' "$SMOKE_VMD_POSCAR_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_POSCAR_SCENE"
check_stderr "$SMOKE_VMD_POSCAR_ERR" "GNU noGUI VMD POSCAR structure export smoke"

printf '%s\n%s\n%s\n%s\n%s\n%s\n' '100' '2' '34' "$SMOKE_VMD_EXPORT_GRO" '0' 'q' |
    run_multiwfn "$SMOKE_POSCAR" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_VMD_GRO_OUT" 2> "$SMOKE_VMD_GRO_ERR"
grep -q 'Loaded .*water.POSCAR successfully' "$SMOKE_VMD_GRO_OUT"
grep -q 'Export system to various formats of files' "$SMOKE_VMD_GRO_OUT"
grep -q 'Exporting gro file finished!' "$SMOKE_VMD_GRO_OUT"
grep -q 'VMD scene script has been written to .*exported.gro.vmd.tcl' "$SMOKE_VMD_GRO_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_VMD_GRO_OUT"
test -s "$SMOKE_VMD_EXPORT_GRO"
test -s "$SMOKE_VMD_GRO_SCENE"
grep -Fq "# Structure file: $SMOKE_VMD_EXPORT_GRO" "$SMOKE_VMD_GRO_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "exported.gro"] type "gro" waitfor all' "$SMOKE_VMD_GRO_SCENE"
grep -Fq 'mol color Element' "$SMOKE_VMD_GRO_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_VMD_GRO_SCENE"
check_stderr "$SMOKE_VMD_GRO_ERR" "GNU noGUI VMD GRO structure export smoke"

printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$SMOKE_MWFN" '1' '0.2,0.0,0.0' '1' 'q' 'q' |
    run_multiwfn > "$SMOKE_MWFN_OUT" 2> "$SMOKE_MWFN_ERR"
grep -q 'Loaded .*he_minimal.mwfn successfully' "$SMOKE_MWFN_OUT"
grep -q 'Density of all electrons:' "$SMOKE_MWFN_OUT"
grep -q 'Lagrangian kinetic energy G(r):' "$SMOKE_MWFN_OUT"
grep -q 'Wavefunction value for orbital' "$SMOKE_MWFN_OUT"
check_stderr "$SMOKE_MWFN_ERR" "GNU noGUI mwfn point smoke"

printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$SMOKE_MWFN" '7' '5' '1' 'n' '0' '0' 'q' |
    run_multiwfn > "$SMOKE_MULLIKEN_OUT" 2> "$SMOKE_MULLIKEN_ERR"
grep -q 'Loaded .*he_minimal.mwfn successfully' "$SMOKE_MULLIKEN_OUT"
grep -q 'Mulliken population analysis' "$SMOKE_MULLIKEN_OUT"
grep -q 'Population of basis functions:' "$SMOKE_MULLIKEN_OUT"
grep -q 'Atom     1(He)    Population:  2.00000000    Net charge:  0.00000000' "$SMOKE_MULLIKEN_OUT"
grep -q 'Total net charge:    0.00000000' "$SMOKE_MULLIKEN_OUT"
check_stderr "$SMOKE_MULLIKEN_ERR" "GNU noGUI mwfn Mulliken smoke"

cp settings.ini "$SMOKE_WFN_GRID_DIR/settings.ini"
printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    '5' \
    '1' \
    '5' \
    '-1,-1,-1' \
    '1,1,1' \
    '3,3,3' \
    '2' \
    '0' \
    'q' |
    run_multiwfn_in_dir "$SMOKE_WFN_GRID_DIR" "$SMOKE_MWFN_ABS" -vmdrun -vmdpath none -vmdscene auto > "$SMOKE_WFN_GRID_OUT" 2> "$SMOKE_WFN_GRID_ERR"
grep -q 'Loaded .*he_minimal.mwfn successfully' "$SMOKE_WFN_GRID_OUT"
grep -q 'Available real space functions' "$SMOKE_WFN_GRID_OUT"
grep -q 'Calculation of grid data took up wall clock time' "$SMOKE_WFN_GRID_OUT"
grep -q 'Grid data has been exported to density.cub' "$SMOKE_WFN_GRID_OUT"
grep -q 'VMD scene script has been written to density.cub.vmd.tcl' "$SMOKE_WFN_GRID_OUT"
grep -q 'VMD was not launched because vmdpath is empty or none' "$SMOKE_WFN_GRID_OUT"
test -s "$SMOKE_WFN_GRID_EXPORT_CUBE"
test -s "$SMOKE_WFN_GRID_SCENE"
grep -Fq '# Cube file: density.cub' "$SMOKE_WFN_GRID_SCENE"
grep -Fq 'mol new [multiwfn_resolve_path "density.cub"] type cube waitfor all' "$SMOKE_WFN_GRID_SCENE"
grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$SMOKE_WFN_GRID_SCENE"
tools/vmd-scene-source-check.sh "$SMOKE_WFN_GRID_SCENE"
check_stderr "$SMOKE_WFN_GRID_ERR" "GNU noGUI wavefunction grid export smoke"

cat "$SMOKE_ERR"
cat "$SMOKE_VMD_ERR"
cat "$SMOKE_VMD_PDB_ERR"
cat "$SMOKE_VMD_PQR_ERR"
cat "$SMOKE_CUBE_ERR"
cat "$SMOKE_VMD_CUBE_ERR"
cat "$SMOKE_VMD_CHGCAR_ERR"
cat "$SMOKE_VMD_POSCAR_ERR"
cat "$SMOKE_VMD_GRO_ERR"
cat "$SMOKE_MWFN_ERR"
cat "$SMOKE_MULLIKEN_ERR"
cat "$SMOKE_WFN_GRID_ERR"
