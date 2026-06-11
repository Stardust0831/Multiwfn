program vmd_bridge_smoke
use defvar
use vmd_bridge
implicit none
character(len=20) cubefiles(2)

vmdscenefile=".build-env/vmd-bridge-smoke/test_scene.tcl"
vmdmaterial="Glass1"
ivmdscene=1
ivmdrun=0
isosurshowboth=1

call maybe_write_vmd_cube_scene("sample.cub",0.05D0)

cubefiles(1)="sample.cub"
cubefiles(2)="sample2.cub"
vmdscenefile=".build-env/vmd-bridge-smoke/test_multi_scene.tcl"
call maybe_write_vmd_cube_scene_list(cubefiles,2,0.05D0)

end program
