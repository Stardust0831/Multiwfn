SIMD = -msse3
DISDIAG = -diag-disable 8290,8291,6371,10316,6178,6916,7416,5268,7342,7373,5120,5144,5082,5112,2554,5183,6182,7352
OPT = -O2 -qopenmp -qopenmp-link=static -threads -qopt-matmul $(SIMD) $(DISDIAG) -fpscomp logicals -fpp -mkl -static-intel -DINTEL_MKL -stand f08
OPT1 = -O1 -qopenmp -qopenmp-link=static -threads $(SIMD) $(DISDIAG) -fpscomp logicals -fpp -mkl -static-intel -DINTEL_MKL -stand f08
#Options in the next line is for debugging purpose
#OPT = -O0 -qopenmp -qopenmp-link=static -threads $(DISDIAG) -fpscomp logicals -fpp -mkl -static-intel -DINTEL_MKL -stand f08 -debug all -g -traceback -check all -fstack-protector

LIB_base = 
LIB_GUI = $(LIB_base) ./dislin_d-11.0.a -lXm -lXt -lX11 -lGL
LIB_noGUI = $(LIB_base)
INCLUDE = -I./ -I./ext
FC = ifort
CC = gcc
EXE = Multiwfn
EXE_noGUI = Multiwfn_noGUI
LIBRETAPATH = ./libreta_hybrid
LIBRETA_DIAG = -diag-disable 6843
DISLIN_EMPTY_DIAG = -diag-disable 6178,6843

GNU_PREFIX ?= $(CURDIR)/.build-env/gnu
GNU_MOD_DIR ?= $(CURDIR)/.build-env/gnu-mod
GNU_OBJ_DIR ?= $(CURDIR)/.build-env/gnu-obj
FC_GNU ?= $(GNU_PREFIX)/bin/x86_64-conda-linux-gnu-gfortran
CC_GNU ?= $(GNU_PREFIX)/bin/x86_64-conda-linux-gnu-gcc
OPT_GNU ?= -O2 -fopenmp -cpp -ffree-line-length-none -fallow-argument-mismatch -fallow-invalid-boz -std=legacy -J$(GNU_MOD_DIR) -I$(GNU_MOD_DIR)
OPT1_GNU ?= -O1 -fopenmp -cpp -ffree-line-length-none -fallow-argument-mismatch -fallow-invalid-boz -std=legacy -J$(GNU_MOD_DIR) -I$(GNU_MOD_DIR)
LIB_noGUI_GNU ?= -L$(GNU_PREFIX)/lib -lopenblas
SMOKE_DIR ?= .build-env/smoke
SMOKE_XYZ ?= $(SMOKE_DIR)/water.xyz
SMOKE_CUBE ?= $(SMOKE_DIR)/water-density.cub
SMOKE_MWFN ?= tools/fixtures/he_minimal.mwfn
SMOKE_OUT ?= $(SMOKE_DIR)/gnu-noGUI-smoke.out
SMOKE_ERR ?= $(SMOKE_DIR)/gnu-noGUI-smoke.err
SMOKE_CUBE_OUT ?= $(SMOKE_DIR)/gnu-noGUI-cube-smoke.out
SMOKE_CUBE_ERR ?= $(SMOKE_DIR)/gnu-noGUI-cube-smoke.err
SMOKE_MWFN_OUT ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-point-smoke.out
SMOKE_MWFN_ERR ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-point-smoke.err
SMOKE_MULLIKEN_OUT ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-mulliken-smoke.out
SMOKE_MULLIKEN_ERR ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-mulliken-smoke.err
SMOKE_VMD_DIR ?= $(SMOKE_DIR)/vmd-export
SMOKE_VMD_EXPORT_XYZ ?= $(SMOKE_VMD_DIR)/exported.xyz
SMOKE_VMD_SCENE ?= $(SMOKE_VMD_EXPORT_XYZ).vmd.tcl
SMOKE_VMD_OUT ?= $(SMOKE_VMD_DIR)/gnu-noGUI-vmd-structure-smoke.out
SMOKE_VMD_ERR ?= $(SMOKE_VMD_DIR)/gnu-noGUI-vmd-structure-smoke.err
SMOKE_VMD_CUBE_DIR ?= $(SMOKE_DIR)/vmd-cube-export
SMOKE_VMD_EXPORT_CUBE ?= $(SMOKE_VMD_CUBE_DIR)/exported.cub
SMOKE_VMD_CUBE_SCENE ?= $(SMOKE_VMD_EXPORT_CUBE).vmd.tcl
SMOKE_VMD_CUBE_OUT ?= $(SMOKE_VMD_CUBE_DIR)/gnu-noGUI-vmd-cube-smoke.out
SMOKE_VMD_CUBE_ERR ?= $(SMOKE_VMD_CUBE_DIR)/gnu-noGUI-vmd-cube-smoke.err

-include Makefile.local

.PHONY: default GUI noGUI gnu-noGUI gnu-noGUI-smoke gnu-clean clean cleanmultiwfn cleanlibreta

obj = $(if $(OBJ_DIR),$(OBJ_DIR)/$(1),$(1))

objects_common = $(call obj,define.o) $(call obj,util.o) $(call obj,vmd_bridge.o) $(call obj,plot.o) $(call obj,Bspline.o) $(call obj,sym.o) $(call obj,libreta.o) $(call obj,function.o) $(call obj,sub.o) $(call obj,integral.o) $(call obj,Lebedev-Laikov.o) \
$(call obj,DFTxclib.o) $(call obj,edflib.o) $(call obj,fparser.o) $(call obj,fileIO.o) $(call obj,spectrum.o) $(call obj,DOS.o) $(call obj,Multiwfn.o) $(call obj,0123dim.o) $(call obj,LSB.o) \
$(call obj,population.o) $(call obj,frj.o) $(call obj,orbcomp.o) $(call obj,bondorder.o) $(call obj,topology.o) $(call obj,excittrans.o) $(call obj,otherfunc.o) \
$(call obj,otherfunc2.o) $(call obj,otherfunc3.o) $(call obj,O1.o) $(call obj,surfana.o) $(call obj,procgriddata.o) $(call obj,AdNDP.o) $(call obj,fuzzy.o) $(call obj,CDA.o) $(call obj,basin.o) \
$(call obj,orbloc.o) $(call obj,visweak.o) $(call obj,EDA.o) $(call obj,CDFT.o) $(call obj,ETS_NOCV.o) $(call obj,atmraddens.o) $(call obj,NAONBO.o) $(call obj,grid.o) $(call obj,PBC.o) $(call obj,hyper_polar.o) $(call obj,deloc_aromat.o) $(call obj,cp2kmate.o)\
$(call obj,minpack.o) $(call obj,blockhrr_012345.o) $(call obj,ean.o) $(call obj,hrr_012345.o) $(call obj,eanvrr_012345.o) $(call obj,boysfunc.o) $(call obj,naiveeri.o) $(call obj,ryspoly.o) $(call obj,2F2.f90.o)

objects = $(objects_common) $(call obj,GUI.o)

objects_noGUI = $(call obj,noGUI/dislin_mod_empty.o) $(call obj,noGUI/GUI_empty.o) $(call obj,noGUI/plot_external_empty.o) $(call obj,noGUI/dislin_d_empty.o) $(call obj,noGUI/mouse_rotate_empty.o) #Dummy modules/subroutines for noGUI version

ifeq ($(WITH_FD),1)
  objects_common += $(call obj,2F2.c.o)
  ifeq ($(OS),Ubuntu) # for Ubuntu
    LIB_base += -lflint -lflint-arb
  else ifeq ($(OS),RHEL) # for Fedora, CentOS, RHEL
    INCLUDE += -I/usr/include/arb
    LIB_base += -lflint -larb
  endif
else
  objects_common += $(call obj,no2F2.c.o)
endif

default: $(objects)
	$(MAKE) noGUI
	$(MAKE) GUI
	@echo " ------------------------------------------------------ "
	@echo "          Multiwfn has been successfully built!"
	@echo " ------------------------------------------------------ "

GUI: dislin.mod $(objects) $(call obj,mouse_rotate.o) $(call obj,xlib.o)
	$(FC) $(OPT) $(objects) $(call obj,mouse_rotate.o) $(call obj,xlib.o) $(LIB_GUI) -o $(EXE)

noGUI: $(objects_noGUI) $(objects_common)
	$(FC) $(OPT) $(objects_common) $(objects_noGUI) $(LIB_noGUI) -o $(EXE_noGUI)

gnu-noGUI:
	$(MAKE) gnu-clean
	rm -rf "$(GNU_MOD_DIR)" "$(GNU_OBJ_DIR)"
	mkdir -p "$(GNU_MOD_DIR)" "$(GNU_OBJ_DIR)"
	$(MAKE) noGUI OBJ_DIR="$(GNU_OBJ_DIR)" FC="$(FC_GNU)" CC="$(CC_GNU)" OPT="$(OPT_GNU)" OPT1="$(OPT1_GNU)" LIB_noGUI="$(LIB_noGUI_GNU)" LIBRETA_DIAG= DISLIN_EMPTY_DIAG=

gnu-noGUI-smoke: gnu-noGUI
	@mkdir -p "$(SMOKE_DIR)" "$(SMOKE_VMD_DIR)" "$(SMOKE_VMD_CUBE_DIR)"
	@printf '%s\n%s\n%s\n%s\n%s\n' '3' 'water smoke test' 'O 0.000000 0.000000 0.000000' 'H 0.758602 0.000000 0.504284' 'H -0.758602 0.000000 0.504284' > "$(SMOKE_XYZ)"
	@printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' 'Water density smoke test' 'Generated by gnu-noGUI-smoke' '    3    0.000000    0.000000    0.000000' '    2    0.500000    0.000000    0.000000' '    2    0.000000    0.500000    0.000000' '    2    0.000000    0.000000    0.500000' '    8    0.000000    0.000000    0.000000    0.000000' '    1    0.000000    0.758602    0.000000    0.504284' '    1    0.000000   -0.758602    0.000000    0.504284' > "$(SMOKE_CUBE)"
	@printf '%s\n%s\n' '  0.120000E+00  0.080000E+00  0.080000E+00  0.040000E+00  0.080000E+00  0.040000E+00' '  0.040000E+00  0.020000E+00' >> "$(SMOKE_CUBE)"
	@cp settings.ini "$(SMOKE_DIR)/settings.ini.before"
	@set -e; \
	allowed_stderr='Note: The following floating-point exceptions are signalling: IEEE_INVALID_FLAG'; \
	check_stderr() { \
		errfile=$$1; \
		label=$$2; \
		if [ -s "$$errfile" ] && grep -Fvx "$$allowed_stderr" "$$errfile" >/dev/null; then \
			printf '%s\n' "Unexpected $$label stderr:"; \
			cat "$$errfile"; \
			exit 1; \
		fi; \
	}; \
	trap 'cp "$(SMOKE_DIR)/settings.ini.before" settings.ini' EXIT; \
	printf '%s\nq\n' "$(SMOKE_XYZ)" | LD_LIBRARY_PATH="$(GNU_PREFIX)/lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}" timeout 12s ./$(EXE_noGUI) > "$(SMOKE_OUT)" 2> "$(SMOKE_ERR)"; \
	grep -q 'Loaded .*water.xyz successfully' "$(SMOKE_OUT)"; \
	grep -q 'Main function menu' "$(SMOKE_OUT)"; \
	check_stderr "$(SMOKE_ERR)" "GNU noGUI XYZ smoke"; \
	printf '%s\n%s\n%s\n' 'xyz' "$(SMOKE_VMD_EXPORT_XYZ)" 'q' | LD_LIBRARY_PATH="$(GNU_PREFIX)/lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}" timeout 12s ./$(EXE_noGUI) "$(SMOKE_XYZ)" -vmdrun -vmdpath none -vmdscene auto > "$(SMOKE_VMD_OUT)" 2> "$(SMOKE_VMD_ERR)"; \
	grep -q 'Loaded .*water.xyz successfully' "$(SMOKE_VMD_OUT)"; \
	grep -q 'Exporting xyz file finished!' "$(SMOKE_VMD_OUT)"; \
	grep -q 'VMD scene script has been written to .*exported.xyz.vmd.tcl' "$(SMOKE_VMD_OUT)"; \
	grep -q 'VMD was not launched because vmdpath is empty or none' "$(SMOKE_VMD_OUT)"; \
	test -s "$(SMOKE_VMD_EXPORT_XYZ)"; \
	test -s "$(SMOKE_VMD_SCENE)"; \
	grep -Fq '# Structure file: $(SMOKE_VMD_EXPORT_XYZ)' "$(SMOKE_VMD_SCENE)"; \
	grep -Fq 'mol new [multiwfn_resolve_path "$(SMOKE_VMD_EXPORT_XYZ)"] type "xyz" waitfor all' "$(SMOKE_VMD_SCENE)"; \
	grep -Fq 'mol color Element' "$(SMOKE_VMD_SCENE)"; \
	tools/vmd-scene-source-check.sh "$(SMOKE_VMD_SCENE)"; \
	check_stderr "$(SMOKE_VMD_ERR)" "GNU noGUI VMD structure export smoke"; \
	printf '%s\nq\n' "$(SMOKE_CUBE)" | LD_LIBRARY_PATH="$(GNU_PREFIX)/lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}" timeout 12s ./$(EXE_noGUI) > "$(SMOKE_CUBE_OUT)" 2> "$(SMOKE_CUBE_ERR)"; \
	grep -q 'Loaded .*water-density.cub successfully' "$(SMOKE_CUBE_OUT)"; \
	grep -q 'Main function menu' "$(SMOKE_CUBE_OUT)"; \
	check_stderr "$(SMOKE_CUBE_ERR)" "GNU noGUI cube smoke"; \
	printf '%s\n%s\n%s\n%s\n%s\n' '13' '0' "$(SMOKE_VMD_EXPORT_CUBE)" '-1' 'q' | LD_LIBRARY_PATH="$(GNU_PREFIX)/lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}" timeout 12s ./$(EXE_noGUI) "$(SMOKE_CUBE)" -vmdrun -vmdpath none -vmdscene auto > "$(SMOKE_VMD_CUBE_OUT)" 2> "$(SMOKE_VMD_CUBE_ERR)"; \
	grep -q 'Loaded .*water-density.cub successfully' "$(SMOKE_VMD_CUBE_OUT)"; \
	grep -q 'Process grid data' "$(SMOKE_VMD_CUBE_OUT)"; \
	grep -q 'Done, cube file has been outputted' "$(SMOKE_VMD_CUBE_OUT)"; \
	grep -q 'VMD scene script has been written to .*exported.cub.vmd.tcl' "$(SMOKE_VMD_CUBE_OUT)"; \
	grep -q 'VMD was not launched because vmdpath is empty or none' "$(SMOKE_VMD_CUBE_OUT)"; \
	test -s "$(SMOKE_VMD_EXPORT_CUBE)"; \
	test -s "$(SMOKE_VMD_CUBE_SCENE)"; \
	grep -Fq '# Cube file: $(SMOKE_VMD_EXPORT_CUBE)' "$(SMOKE_VMD_CUBE_SCENE)"; \
	grep -Fq 'mol new [multiwfn_resolve_path "$(SMOKE_VMD_EXPORT_CUBE)"] type cube waitfor all' "$(SMOKE_VMD_CUBE_SCENE)"; \
	grep -Fq 'mol representation Isosurface 0.05000000 0 0 0 1 1' "$(SMOKE_VMD_CUBE_SCENE)"; \
	grep -Fq 'mol representation Isosurface -0.05000000 0 0 0 1 1' "$(SMOKE_VMD_CUBE_SCENE)"; \
	tools/vmd-scene-source-check.sh "$(SMOKE_VMD_CUBE_SCENE)"; \
	check_stderr "$(SMOKE_VMD_CUBE_ERR)" "GNU noGUI VMD cube export smoke"; \
	printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$(SMOKE_MWFN)" '1' '0.2,0.0,0.0' '1' 'q' 'q' | LD_LIBRARY_PATH="$(GNU_PREFIX)/lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}" timeout 12s ./$(EXE_noGUI) > "$(SMOKE_MWFN_OUT)" 2> "$(SMOKE_MWFN_ERR)"; \
	grep -q 'Loaded .*he_minimal.mwfn successfully' "$(SMOKE_MWFN_OUT)"; \
	grep -q 'Density of all electrons:' "$(SMOKE_MWFN_OUT)"; \
	grep -q 'Lagrangian kinetic energy G(r):' "$(SMOKE_MWFN_OUT)"; \
	grep -q 'Wavefunction value for orbital' "$(SMOKE_MWFN_OUT)"; \
	check_stderr "$(SMOKE_MWFN_ERR)" "GNU noGUI mwfn point smoke"; \
	printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' "$(SMOKE_MWFN)" '7' '5' '1' 'n' '0' '0' 'q' | LD_LIBRARY_PATH="$(GNU_PREFIX)/lib$${LD_LIBRARY_PATH:+:$$LD_LIBRARY_PATH}" timeout 12s ./$(EXE_noGUI) > "$(SMOKE_MULLIKEN_OUT)" 2> "$(SMOKE_MULLIKEN_ERR)"; \
	grep -q 'Loaded .*he_minimal.mwfn successfully' "$(SMOKE_MULLIKEN_OUT)"; \
	grep -q 'Mulliken population analysis' "$(SMOKE_MULLIKEN_OUT)"; \
	grep -q 'Population of basis functions:' "$(SMOKE_MULLIKEN_OUT)"; \
	grep -q 'Atom     1(He)    Population:  2.00000000    Net charge:  0.00000000' "$(SMOKE_MULLIKEN_OUT)"; \
	grep -q 'Total net charge:    0.00000000' "$(SMOKE_MULLIKEN_OUT)"; \
	check_stderr "$(SMOKE_MULLIKEN_ERR)" "GNU noGUI mwfn Mulliken smoke"
	@cat "$(SMOKE_ERR)"
	@cat "$(SMOKE_VMD_ERR)"
	@cat "$(SMOKE_CUBE_ERR)"
	@cat "$(SMOKE_VMD_CUBE_ERR)"
	@cat "$(SMOKE_MWFN_ERR)"
	@cat "$(SMOKE_MULLIKEN_ERR)"

gnu-clean:
	$(MAKE) clean
	rm -rf "$(GNU_MOD_DIR)" "$(GNU_OBJ_DIR)" "$(SMOKE_DIR)" .build-env/nogui-build-audit.* .build-env/vmd-bridge-smoke.* .build-env/vmd-doctor-smoke.*

clean:
	rm -f $(EXE) $(EXE_noGUI) *.o *.mod noGUI/*.o

#Only clean Multiwfn files, compiled libreta files are not affected
cleanmultiwfn:
	mkdir tmplib
	mv libreta.o ean.o hrr_012345.o blockhrr_012345.o eanvrr_012345.o boysfunc.o \
	libreta.mod hrr.mod blockhrr.mod ean.mod eanvrr.mod boysfunc.mod tmplib
	rm -f $(EXE) *.o *.mod
	mv tmplib/* ./
	rm -r tmplib

#Only clean libreta files, Multiwfn libreta files are not affected
cleanlibreta:
	rm -f $(EXE) libreta.o ean.o hrr_012345.o blockhrr_012345.o eanvrr_012345.o \
	boysfunc.o libreta.mod hrr.mod blockhrr.mod ean.mod eanvrr.mod boysfunc.mod


#Define modules that used by other files

dislin.mod : dislin_d.f90
	$(FC) $(OPT) -c dislin_d.f90

$(call obj,define.o) : define.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c define.f90 -o $@

$(call obj,Bspline.o) : Bspline.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c Bspline.f90 -o $@

$(call obj,util.o) : util.f90 $(call obj,define.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c util.f90 -o $@

$(call obj,vmd_bridge.o) : vmd_bridge.f90 $(call obj,define.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c vmd_bridge.f90 -o $@

$(call obj,function.o) : function.f90 $(call obj,define.o) $(call obj,util.o) $(call obj,Bspline.o) $(call obj,libreta.o) $(call obj,2F2.f90.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c function.f90 -o $@

$(call obj,plot.o) : plot.f90 $(call obj,function.o) $(call obj,define.o) $(call obj,util.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c plot.f90 -o $@

$(call obj,GUI.o) : GUI.f90 $(call obj,define.o) $(call obj,plot.o) $(call obj,function.o) $(call obj,mouse_rotate.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c GUI.f90 -o $@

$(call obj,mouse_rotate.o) : mouse_rotate.f90 $(call obj,xlib.o) $(call obj,define.o) $(call obj,plot.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c mouse_rotate.f90 -o $@

$(call obj,noGUI/mouse_rotate_empty.o) : noGUI/mouse_rotate_empty.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c noGUI/mouse_rotate_empty.f90 -o $@

$(call obj,noGUI/GUI_empty.o) : noGUI/GUI_empty.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c noGUI/GUI_empty.f90 -o $@

$(call obj,noGUI/plot_external_empty.o) : noGUI/plot_external_empty.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c noGUI/plot_external_empty.f90 -o $@

$(call obj,2F2.f90.o) : ext/2F2.f90 $(call obj,util.o) $(call obj,Bspline.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ext/2F2.f90 -o $@

modules = $(call obj,define.o) $(call obj,util.o) $(call obj,vmd_bridge.o) $(call obj,function.o) $(call obj,plot.o) $(call obj,libreta.o) $(call obj,2F2.f90.o)


#Library or adpated third-part codes

$(call obj,DFTxclib.o) : DFTxclib.F
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c DFTxclib.F -o $@

$(call obj,Lebedev-Laikov.o) : Lebedev-Laikov.F
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c Lebedev-Laikov.F -o $@

$(call obj,sym.o) : sym.F
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c sym.F -o $@

$(call obj,edflib.o) : edflib.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c edflib.f90 -o $@

$(call obj,atmraddens.o) : atmraddens.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c atmraddens.f90 -o $@

$(call obj,minpack.o) : minpack.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c minpack.f90 -o $@
	
$(call obj,fparser.o) : fparser.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c fparser.f90 -o $@
	
$(call obj,2F2.c.o) : ext/2F2.c
	@mkdir -p "$(dir $@)"
	$(CC) $(INCLUDE) -c ext/2F2.c -o $@

$(call obj,no2F2.c.o) : ext/no2F2.c
	@mkdir -p "$(dir $@)"
	$(CC) -c ext/no2F2.c -o $@

$(call obj,noGUI/dislin_d_empty.o) : noGUI/dislin_d_empty.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c noGUI/dislin_d_empty.f90 -o $@ $(DISLIN_EMPTY_DIAG)

$(call obj,noGUI/dislin_mod_empty.o) : noGUI/dislin_mod_empty.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c noGUI/dislin_mod_empty.f90 -o $@

#Others

$(call obj,sub.o) : sub.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c sub.f90 -o $@

$(call obj,integral.o) : integral.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c integral.f90 -o $@

$(call obj,fileIO.o) : fileIO.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c fileIO.f90 -o $@

$(call obj,spectrum.o) : spectrum.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c spectrum.f90 -o $@

$(call obj,DOS.o) : DOS.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c DOS.f90 -o $@

$(call obj,Multiwfn.o) : Multiwfn.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c Multiwfn.f90 -o $@

$(call obj,0123dim.o) : 0123dim.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c 0123dim.f90 -o $@

$(call obj,LSB.o) : LSB.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c LSB.f90 -o $@

$(call obj,population.o) : population.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c population.f90 -o $@

$(call obj,frj.o) : ext/frj.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ext/frj.f90 -o $@

$(call obj,orbcomp.o) : orbcomp.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c orbcomp.f90 -o $@

$(call obj,bondorder.o) : bondorder.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c bondorder.f90 -o $@

$(call obj,topology.o) : topology.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c topology.f90 -o $@

$(call obj,excittrans.o) : excittrans.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c excittrans.f90 -o $@

$(call obj,otherfunc.o) : otherfunc.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c otherfunc.f90 -o $@

$(call obj,otherfunc2.o) : otherfunc2.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c otherfunc2.f90 -o $@

$(call obj,otherfunc3.o) : otherfunc3.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c otherfunc3.f90 -o $@
	
$(call obj,O1.o) : O1.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT1) -c O1.f90 -o $@

$(call obj,surfana.o) : surfana.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c surfana.f90 -o $@

$(call obj,procgriddata.o) : procgriddata.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c procgriddata.f90 -o $@

$(call obj,AdNDP.o) : AdNDP.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c AdNDP.f90 -o $@

$(call obj,fuzzy.o) : fuzzy.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c fuzzy.f90 -o $@

$(call obj,CDA.o) : CDA.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c CDA.f90 -o $@

$(call obj,basin.o) : basin.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c basin.f90 -o $@

$(call obj,orbloc.o) : orbloc.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c orbloc.f90 -o $@

$(call obj,visweak.o) : visweak.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c visweak.f90 -o $@

$(call obj,EDA.o) : EDA.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c EDA.f90 -o $@

$(call obj,CDFT.o) : CDFT.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c CDFT.f90 -o $@

$(call obj,ETS_NOCV.o) : ETS_NOCV.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ETS_NOCV.f90 -o $@

$(call obj,NAONBO.o) : NAONBO.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c NAONBO.f90 -o $@

$(call obj,grid.o) : grid.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c grid.f90 -o $@

$(call obj,PBC.o) : PBC.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c PBC.f90 -o $@

$(call obj,hyper_polar.o) : hyper_polar.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c hyper_polar.f90 -o $@
	
$(call obj,deloc_aromat.o) : deloc_aromat.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c deloc_aromat.f90 -o $@
	
$(call obj,cp2kmate.o) : cp2kmate.f90 $(modules)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c cp2kmate.f90 -o $@


# Interfaces of libreta-ESP to Multiwfn

$(call obj,libreta.o): ${LIBRETAPATH}/libreta.f90 $(call obj,hrr_012345.o) $(call obj,blockhrr_012345.o) $(call obj,ean.o) $(call obj,eanvrr_012345.o) $(call obj,boysfunc.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ${LIBRETAPATH}/libreta.f90 -o $@


# Pure libreta files for ESP

$(call obj,hrr_012345.o): ${LIBRETAPATH}/hrr_012345.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) $(LIBRETA_DIAG) $(SIMD) -c ${LIBRETAPATH}/hrr_012345.f90 -o $@

$(call obj,blockhrr_012345.o): ${LIBRETAPATH}/blockhrr_012345.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT1) $(LIBRETA_DIAG) -c ${LIBRETAPATH}/blockhrr_012345.f90 -o $@

$(call obj,ean.o): ${LIBRETAPATH}/ean.f90 $(call obj,hrr_012345.o) $(call obj,eanvrr_012345.o) $(call obj,boysfunc.o) ${LIBRETAPATH}/ean_data1.h ${LIBRETAPATH}/ean_data2.h
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ${LIBRETAPATH}/ean.f90 -o $@

$(call obj,eanvrr_012345.o): ${LIBRETAPATH}/eanvrr_012345.f90 $(call obj,boysfunc.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ${LIBRETAPATH}/eanvrr_012345.f90 -o $@

$(call obj,boysfunc.o): ${LIBRETAPATH}/boysfunc.f90 ${LIBRETAPATH}/boysfunc_data1.h ${LIBRETAPATH}/boysfunc_data2.h
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ${LIBRETAPATH}/boysfunc.f90 -o $@


# libreta-ERI

$(call obj,naiveeri.o): ${LIBRETAPATH}/naiveeri.f90 $(call obj,ryspoly.o)
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ${LIBRETAPATH}/naiveeri.f90 -o $@
	
$(call obj,ryspoly.o): ${LIBRETAPATH}/ryspoly.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -c ${LIBRETAPATH}/ryspoly.f90 -o $@


# Fortran-xlib interface
$(call obj,xlib.o): ext/xlib.f90
	@mkdir -p "$(dir $@)"
	$(FC) $(OPT) -fpscomp logicals -c ext/xlib.f90 -o $@
