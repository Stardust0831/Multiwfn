program vmd_bridge_smoke
use defvar
use vmd_bridge
implicit none
character(len=80) cubefiles(2)
character(len=80) structfiles(3)
character(len=600) command
character(len=600) scene_dir

call get_environment_variable("VMD_SMOKE_DIR",scene_dir)
if (len_trim(scene_dir)==0) scene_dir=".build-env/vmd-bridge-smoke"

vmdscenefile=trim(scene_dir)//"/test_structure_scene.tcl"
vmdmaterial="Glass $1[x]"
ivmdscene=1
ivmdrun=0
isosurshowboth=1

call maybe_write_vmd_structure_scene("structure dir/a$b[1]}.pdb","pdb")

vmdscenefile=trim(scene_dir)//"/test_beta_structure_scene.tcl"
call maybe_write_vmd_structure_scene_colored("structure dir/beta values.pdb","pdb","Beta")

vmdscenefile=trim(scene_dir)//"/test_pqr_structure_scene.tcl"
call maybe_write_vmd_structure_scene("charge dir/a$b[1]}.pqr","pqr")

structfiles(1)="charge dir/a$b[1]}.pqr"
structfiles(2)="charge dir/batch second.pqr"
structfiles(3)="charge dir/batch_third.pqr"
vmdscenefile=trim(scene_dir)//"/test_multi_structure_scene.tcl"
call maybe_write_vmd_structure_scene_list(structfiles,3,"pqr")

vmdscenefile=trim(scene_dir)//"/test_gro_structure_scene.tcl"
call maybe_write_vmd_structure_scene("traj dir/a$b[1]}.gro","gro")

vmdscenefile=trim(scene_dir)//"/test_poscar_structure_scene.tcl"
call maybe_write_vmd_structure_scene("vasp dir/POS$[1]}.vasp","POSCAR")

vmdscenefile=trim(scene_dir)//"/test_molden_structure_scene.tcl"
call maybe_write_vmd_structure_scene_autotype("wavefunction dir/a$b[1]}.molden")

vmdscenefile="auto"
call maybe_write_vmd_structure_scene(trim(scene_dir)//"/auto_structure.xyz","xyz")

vmdscenefile=trim(scene_dir)//"/test_scene.tcl"

call maybe_write_vmd_cube_scene("win path C:\tmp\a$b[1]}.cub",0.05D0)

vmdscenefile=trim(scene_dir)//"/test source $[1]}.tcl"
call maybe_write_vmd_cube_scene("sample.cub",0.05D0)

cubefiles(1)="sample.cub"
cubefiles(2)="sample dir/a$b[1]}.cub"
vmdscenefile=trim(scene_dir)//"/test_multi_scene.tcl"
call maybe_write_vmd_cube_scene_list(cubefiles,2,0.05D0)

vmdscenefile=trim(scene_dir)//"/test_dataset_scene.tcl"
call maybe_write_vmd_cube_dataset_scene("multi dataset $[x]}.cub",3,0.05D0)

vmdscenefile=trim(scene_dir)//"/test_vasp_grid_scene.tcl"
call maybe_write_vmd_volumetric_scene("vasp grid/CHG$[1]}.vasp","CHGCAR",0.05D0)

vmdscenefile=trim(scene_dir)//"/missing-dir/test_scene.tcl"
call maybe_write_vmd_cube_scene("sample.cub",0.05D0)

isys=2
vmdpath="/opt/VMD app/vmd$bin"
call build_vmd_run_command("scene dir/a'b$[x].tcl",command)
write(*,"('POSIX command: ',a)") trim(command)

isys=1
vmdpath="C:\Program Files\VMD\vmd.exe"
call build_vmd_run_command("scene dir\test scene.tcl",command)
write(*,"('Windows command: ',a)") trim(command)

vmdpath="NONE"
call run_vmd_scene("disabled scene.tcl")

end program
