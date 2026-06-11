program vmd_bridge_smoke
use defvar
use vmd_bridge
implicit none
character(len=80) cubefiles(2)
character(len=600) command

vmdscenefile=".build-env/vmd-bridge-smoke/test_scene.tcl"
vmdmaterial="Glass1"
ivmdscene=1
ivmdrun=0
isosurshowboth=1

call maybe_write_vmd_cube_scene("sample.cub",0.05D0)

vmdscenefile=".build-env/vmd-bridge-smoke/test source $[1]}.tcl"
call maybe_write_vmd_cube_scene("sample.cub",0.05D0)

cubefiles(1)="sample.cub"
cubefiles(2)="sample dir/a$b[1]}.cub"
vmdscenefile=".build-env/vmd-bridge-smoke/test_multi_scene.tcl"
call maybe_write_vmd_cube_scene_list(cubefiles,2,0.05D0)

vmdscenefile=".build-env/vmd-bridge-smoke/test_dataset_scene.tcl"
call maybe_write_vmd_cube_dataset_scene("multi dataset $[x]}.cub",3,0.05D0)

vmdscenefile=".build-env/vmd-bridge-smoke/missing-dir/test_scene.tcl"
call maybe_write_vmd_cube_scene("sample.cub",0.05D0)

isys=2
vmdpath="/opt/VMD app/vmd$bin"
call build_vmd_run_command("scene dir/a'b$[x].tcl",command)
write(*,"('POSIX command: ',a)") trim(command)

isys=1
vmdpath="C:\Program Files\VMD\vmd.exe"
call build_vmd_run_command("scene dir\test scene.tcl",command)
write(*,"('Windows command: ',a)") trim(command)

end program
