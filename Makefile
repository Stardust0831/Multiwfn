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
SMOKE_POSCAR ?= $(SMOKE_DIR)/water.POSCAR
SMOKE_MWFN ?= tools/fixtures/he_minimal.mwfn
SMOKE_OUT ?= $(SMOKE_DIR)/gnu-noGUI-smoke.out
SMOKE_ERR ?= $(SMOKE_DIR)/gnu-noGUI-smoke.err
SMOKE_CUBE_OUT ?= $(SMOKE_DIR)/gnu-noGUI-cube-smoke.out
SMOKE_CUBE_ERR ?= $(SMOKE_DIR)/gnu-noGUI-cube-smoke.err
SMOKE_MWFN_OUT ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-point-smoke.out
SMOKE_MWFN_ERR ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-point-smoke.err
SMOKE_MULLIKEN_OUT ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-mulliken-smoke.out
SMOKE_MULLIKEN_ERR ?= $(SMOKE_DIR)/gnu-noGUI-mwfn-mulliken-smoke.err
SMOKE_WFN_GRID_DIR ?= $(SMOKE_DIR)/wfn-grid-export
SMOKE_WFN_GRID_EXPORT_CUBE ?= $(SMOKE_WFN_GRID_DIR)/density.cub
SMOKE_WFN_GRID_SCENE ?= $(SMOKE_WFN_GRID_EXPORT_CUBE).vmd.tcl
SMOKE_WFN_GRID_OUT ?= $(SMOKE_WFN_GRID_DIR)/gnu-noGUI-wfn-grid-smoke.out
SMOKE_WFN_GRID_ERR ?= $(SMOKE_WFN_GRID_DIR)/gnu-noGUI-wfn-grid-smoke.err
SMOKE_VMD_DIR ?= $(SMOKE_DIR)/vmd-export
SMOKE_VMD_EXPORT_XYZ ?= $(SMOKE_VMD_DIR)/exported.xyz
SMOKE_VMD_SCENE ?= $(SMOKE_VMD_EXPORT_XYZ).vmd.tcl
SMOKE_VMD_OUT ?= $(SMOKE_VMD_DIR)/gnu-noGUI-vmd-structure-smoke.out
SMOKE_VMD_ERR ?= $(SMOKE_VMD_DIR)/gnu-noGUI-vmd-structure-smoke.err
SMOKE_VMD_EXPORT_PDB ?= $(SMOKE_VMD_DIR)/exported.pdb
SMOKE_VMD_PDB_SCENE ?= $(SMOKE_VMD_EXPORT_PDB).vmd.tcl
SMOKE_VMD_PDB_OUT ?= $(SMOKE_VMD_DIR)/gnu-noGUI-vmd-pdb-smoke.out
SMOKE_VMD_PDB_ERR ?= $(SMOKE_VMD_DIR)/gnu-noGUI-vmd-pdb-smoke.err
SMOKE_VMD_CUBE_DIR ?= $(SMOKE_DIR)/vmd-cube-export
SMOKE_VMD_EXPORT_CUBE ?= $(SMOKE_VMD_CUBE_DIR)/exported.cub
SMOKE_VMD_CUBE_SCENE ?= $(SMOKE_VMD_EXPORT_CUBE).vmd.tcl
SMOKE_VMD_CUBE_OUT ?= $(SMOKE_VMD_CUBE_DIR)/gnu-noGUI-vmd-cube-smoke.out
SMOKE_VMD_CUBE_ERR ?= $(SMOKE_VMD_CUBE_DIR)/gnu-noGUI-vmd-cube-smoke.err
SMOKE_VMD_VASP_DIR ?= $(SMOKE_DIR)/vmd-vasp-export
SMOKE_VMD_EXPORT_CHGCAR ?= $(SMOKE_VMD_VASP_DIR)/exported.CHGCAR
SMOKE_VMD_CHGCAR_SCENE ?= $(SMOKE_VMD_EXPORT_CHGCAR).vmd.tcl
SMOKE_VMD_CHGCAR_OUT ?= $(SMOKE_VMD_VASP_DIR)/gnu-noGUI-vmd-vasp-smoke.out
SMOKE_VMD_CHGCAR_ERR ?= $(SMOKE_VMD_VASP_DIR)/gnu-noGUI-vmd-vasp-smoke.err
SMOKE_VMD_POSCAR_DIR ?= $(SMOKE_DIR)/vmd-poscar-export
SMOKE_VMD_EXPORT_POSCAR ?= $(SMOKE_VMD_POSCAR_DIR)/exported.POSCAR
SMOKE_VMD_POSCAR_SCENE ?= $(SMOKE_VMD_EXPORT_POSCAR).vmd.tcl
SMOKE_VMD_POSCAR_OUT ?= $(SMOKE_VMD_POSCAR_DIR)/gnu-noGUI-vmd-poscar-smoke.out
SMOKE_VMD_POSCAR_ERR ?= $(SMOKE_VMD_POSCAR_DIR)/gnu-noGUI-vmd-poscar-smoke.err

-include Makefile.local

.PHONY: default GUI noGUI gnu-noGUI gnu-noGUI-incremental gnu-noGUI-smoke gnu-clean clean cleanmultiwfn cleanlibreta

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
	$(MAKE) gnu-noGUI-incremental

gnu-noGUI-incremental:
	mkdir -p "$(GNU_MOD_DIR)" "$(GNU_OBJ_DIR)"
	$(MAKE) noGUI OBJ_DIR="$(GNU_OBJ_DIR)" FC="$(FC_GNU)" CC="$(CC_GNU)" OPT="$(OPT_GNU)" OPT1="$(OPT1_GNU)" LIB_noGUI="$(LIB_noGUI_GNU)" LIBRETA_DIAG= DISLIN_EMPTY_DIAG=

gnu-noGUI-smoke: gnu-noGUI
	@GNU_PREFIX="$(GNU_PREFIX)" \
	EXE_noGUI="$(EXE_noGUI)" \
	SMOKE_DIR="$(SMOKE_DIR)" \
	SMOKE_XYZ="$(SMOKE_XYZ)" \
	SMOKE_CUBE="$(SMOKE_CUBE)" \
	SMOKE_POSCAR="$(SMOKE_POSCAR)" \
	SMOKE_MWFN="$(SMOKE_MWFN)" \
	SMOKE_OUT="$(SMOKE_OUT)" \
	SMOKE_ERR="$(SMOKE_ERR)" \
	SMOKE_CUBE_OUT="$(SMOKE_CUBE_OUT)" \
	SMOKE_CUBE_ERR="$(SMOKE_CUBE_ERR)" \
	SMOKE_MWFN_OUT="$(SMOKE_MWFN_OUT)" \
	SMOKE_MWFN_ERR="$(SMOKE_MWFN_ERR)" \
	SMOKE_MULLIKEN_OUT="$(SMOKE_MULLIKEN_OUT)" \
	SMOKE_MULLIKEN_ERR="$(SMOKE_MULLIKEN_ERR)" \
	SMOKE_WFN_GRID_DIR="$(SMOKE_WFN_GRID_DIR)" \
	SMOKE_WFN_GRID_EXPORT_CUBE="$(SMOKE_WFN_GRID_EXPORT_CUBE)" \
	SMOKE_WFN_GRID_SCENE="$(SMOKE_WFN_GRID_SCENE)" \
	SMOKE_WFN_GRID_OUT="$(SMOKE_WFN_GRID_OUT)" \
	SMOKE_WFN_GRID_ERR="$(SMOKE_WFN_GRID_ERR)" \
	SMOKE_VMD_DIR="$(SMOKE_VMD_DIR)" \
	SMOKE_VMD_EXPORT_XYZ="$(SMOKE_VMD_EXPORT_XYZ)" \
	SMOKE_VMD_SCENE="$(SMOKE_VMD_SCENE)" \
	SMOKE_VMD_OUT="$(SMOKE_VMD_OUT)" \
	SMOKE_VMD_ERR="$(SMOKE_VMD_ERR)" \
	SMOKE_VMD_EXPORT_PDB="$(SMOKE_VMD_EXPORT_PDB)" \
	SMOKE_VMD_PDB_SCENE="$(SMOKE_VMD_PDB_SCENE)" \
	SMOKE_VMD_PDB_OUT="$(SMOKE_VMD_PDB_OUT)" \
	SMOKE_VMD_PDB_ERR="$(SMOKE_VMD_PDB_ERR)" \
	SMOKE_VMD_CUBE_DIR="$(SMOKE_VMD_CUBE_DIR)" \
	SMOKE_VMD_EXPORT_CUBE="$(SMOKE_VMD_EXPORT_CUBE)" \
	SMOKE_VMD_CUBE_SCENE="$(SMOKE_VMD_CUBE_SCENE)" \
	SMOKE_VMD_CUBE_OUT="$(SMOKE_VMD_CUBE_OUT)" \
	SMOKE_VMD_CUBE_ERR="$(SMOKE_VMD_CUBE_ERR)" \
	SMOKE_VMD_VASP_DIR="$(SMOKE_VMD_VASP_DIR)" \
	SMOKE_VMD_EXPORT_CHGCAR="$(SMOKE_VMD_EXPORT_CHGCAR)" \
	SMOKE_VMD_CHGCAR_SCENE="$(SMOKE_VMD_CHGCAR_SCENE)" \
	SMOKE_VMD_CHGCAR_OUT="$(SMOKE_VMD_CHGCAR_OUT)" \
	SMOKE_VMD_CHGCAR_ERR="$(SMOKE_VMD_CHGCAR_ERR)" \
	SMOKE_VMD_POSCAR_DIR="$(SMOKE_VMD_POSCAR_DIR)" \
	SMOKE_VMD_EXPORT_POSCAR="$(SMOKE_VMD_EXPORT_POSCAR)" \
	SMOKE_VMD_POSCAR_SCENE="$(SMOKE_VMD_POSCAR_SCENE)" \
	SMOKE_VMD_POSCAR_OUT="$(SMOKE_VMD_POSCAR_OUT)" \
	SMOKE_VMD_POSCAR_ERR="$(SMOKE_VMD_POSCAR_ERR)" \
	tools/gnu-nogui-smoke.sh

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
