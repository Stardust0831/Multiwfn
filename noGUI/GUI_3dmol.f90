module GUI
use defvar
implicit none

real*8 :: aug3D_main0=6D0

contains

subroutine selfilegui
character(len=512) :: envfile
integer :: istat

call get_environment_variable("MULTIWFN_3DMOL_INPUT",envfile,status=istat)
if (istat==0.and.len_trim(envfile)>0) then
    filename=trim(envfile)
else
    call select_file_with_dialog(filename)
    if (len_trim(filename)==0) then
        write(*,"(/,a)") " 3Dmol GUI backend: no file was selected."
        write(*,"(a)") " Input the file path in the console, or set MULTIWFN_3DMOL_INPUT."
    end if
end if
end subroutine

subroutine drawmolgui
GUI_mode=1
idrawmol=1
call launch_3dmol_gui("drawmolgui",1,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawplanegui(init1,end1,init2,end2,init3,end3,idrawtype)
real*8,intent(in) :: init1,end1,init2,end2,init3,end3
integer,intent(in) :: idrawtype
GUI_mode=2
dp_init1=init1
dp_end1=end1
dp_init2=init2
dp_end2=end2
dp_init3=init3
dp_end3=end3
call launch_3dmol_gui("drawplanegui",2,idrawtype,init1,end1,init2,end2,init3,end3)
end subroutine

subroutine drawisosurgui(iallowsetstyle)
integer,intent(in) :: iallowsetstyle
GUI_mode=3
idrawisosur=1
call launch_3dmol_gui("drawisosurgui",3,iallowsetstyle,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawmoltopogui
GUI_mode=4
call launch_3dmol_gui("drawmoltopogui",4,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawsurfanalysis
GUI_mode=5
call launch_3dmol_gui("drawsurfanalysis",5,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawbasinintgui
GUI_mode=6
call launch_3dmol_gui("drawbasinintgui",6,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawdomaingui
GUI_mode=6
call launch_3dmol_gui("drawdomaingui",6,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine setboxGUI
GUI_mode=7
ishowdatarange=1
call launch_3dmol_gui("setboxGUI",7,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine miniGUI
GUI_mode=7
call launch_3dmol_gui("miniGUI",7,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine launch_3dmol_gui(entry,mode,extra,init1,end1,init2,end2,init3,end3)
character(len=*),intent(in) :: entry
integer,intent(in) :: mode,extra
real*8,intent(in) :: init1,end1,init2,end2,init3,end3
character(len=512) :: session,manifest,cmd

call get_session_dir(session)
call ensure_dir(session)

if (allocated(a).and.ncenter>0) call write_structure_xyz(trim(session)//"/structure.xyz")
if (allocated(cubmat)) call write_cube(trim(session)//"/cubmat.cube",cubmat)
if (allocated(cubmattmp)) call write_cube(trim(session)//"/cubmattmp.cube",cubmattmp)

manifest=trim(session)//"/manifest.json"
call write_manifest(manifest,entry,mode,extra,init1,end1,init2,end2,init3,end3)
call build_launch_command(trim(manifest),trim(session),cmd)

write(*,"(/,a)") " 3Dmol GUI backend wrote a visualization session:"
write(*,"(a,a)") "   ",trim(manifest)
write(*,"(a)") " Launching local 3Dmol service..."
call execute_command_line(trim(cmd),wait=.false.)
end subroutine

subroutine get_session_dir(session)
character(len=*),intent(out) :: session
integer :: istat
session="multiwfn_3dmol_session"
call get_environment_variable("MULTIWFN_3DMOL_SESSION",session,status=istat)
if (istat/=0.or.len_trim(session)==0) session="multiwfn_3dmol_session"
end subroutine

subroutine ensure_dir(dirname)
character(len=*),intent(in) :: dirname
character(len=1024) :: cmd
logical :: alive
integer :: istat

inquire(file=trim(dirname),exist=alive)
if (alive) return
cmd='mkdir "'//trim(dirname)//'"'
call execute_command_line(trim(cmd),exitstat=istat)
end subroutine

subroutine build_launch_command(manifest,session,cmd)
character(len=*),intent(in) :: manifest,session
character(len=*),intent(out) :: cmd
character(len=512) :: home,python,tool,frontend
integer :: istat

call get_3dmol_home(home)
call resolve_resource_path(home,"tools/multiwfn_3dmol_server.py",tool)
call resolve_resource_path(home,"frontend/3dmol-viewer",frontend)

#ifdef _WIN32
python="python"
#else
python="python3"
#endif
call get_environment_variable("MULTIWFN_3DMOL_PYTHON",python,status=istat)
if (istat/=0.or.len_trim(python)==0) then
#ifdef _WIN32
    python="python"
#else
    python="python3"
#endif
end if

cmd=trim(python)//' "'//trim(tool)//'" --frontend "'//trim(frontend)//'" --session "'//trim(session)//'" --manifest "'//trim(manifest)//'" --open'
end subroutine

subroutine select_file_with_dialog(selected)
character(len=*),intent(out) :: selected
character(len=512) :: session,home,python,tool,outfile,cmd
integer :: istat,iu

selected=" "
call get_session_dir(session)
call ensure_dir(session)
call get_3dmol_home(home)
call resolve_resource_path(home,"tools/multiwfn_3dmol_file_dialog.py",tool)
outfile=trim(session)//"/selected_file.txt"

#ifdef _WIN32
python="python"
#else
python="python3"
#endif
call get_environment_variable("MULTIWFN_3DMOL_PYTHON",python,status=istat)
if (istat/=0.or.len_trim(python)==0) then
#ifdef _WIN32
    python="python"
#else
    python="python3"
#endif
end if

cmd=trim(python)//' "'//trim(tool)//'" --output "'//trim(outfile)//'"'
call execute_command_line(trim(cmd),exitstat=istat)
if (istat/=0) return

open(newunit=iu,file=trim(outfile),status="old",action="read",iostat=istat)
if (istat/=0) return
read(iu,"(a)",iostat=istat) selected
close(iu)
if (istat/=0) selected=" "
end subroutine

subroutine get_3dmol_home(home)
character(len=*),intent(out) :: home
character(len=512) :: exe,dir,base
integer :: istat

home="."
call get_environment_variable("MULTIWFN_3DMOL_HOME",home,status=istat)
if (istat==0.and.len_trim(home)>0) return

call get_command_argument(0,exe,status=istat)
if (istat/=0.or.len_trim(exe)==0) return

call path_dirname(trim(exe),dir)
if (len_trim(dir)==0) return
call path_basename(trim(dir),base)
if (trim(base)=="bin") then
    call path_dirname(trim(dir),home)
    if (len_trim(home)==0) home=trim(dir)
else
    home=trim(dir)
end if
end subroutine

subroutine resolve_resource_path(home,relpath,fullpath)
character(len=*),intent(in) :: home,relpath
character(len=*),intent(out) :: fullpath
logical :: alive

fullpath=trim(home)//"/"//trim(relpath)
inquire(file=trim(fullpath),exist=alive)
if (alive) return
fullpath=trim(home)//"/resources/"//trim(relpath)
end subroutine

subroutine path_dirname(path,dir)
character(len=*),intent(in) :: path
character(len=*),intent(out) :: dir
integer :: i,last

dir="."
last=0
do i=1,len_trim(path)
    if (path(i:i)=="/".or.path(i:i)=="\") last=i
end do
if (last>1) then
    dir=path(1:last-1)
else if (last==1) then
    dir=path(1:1)
else
    dir="."
end if
end subroutine

subroutine path_basename(path,base)
character(len=*),intent(in) :: path
character(len=*),intent(out) :: base
integer :: i,last

base=trim(path)
last=0
do i=1,len_trim(path)
    if (path(i:i)=="/".or.path(i:i)=="\") last=i
end do
if (last>0.and.last<len_trim(path)) base=path(last+1:len_trim(path))
end subroutine

subroutine write_structure_xyz(path)
character(len=*),intent(in) :: path
integer :: iu,i
open(newunit=iu,file=trim(path),status="replace",action="write")
write(iu,"(i0)") ncenter
write(iu,"(a)") "Generated by Multiwfn 3Dmol GUI backend"
do i=1,ncenter
    write(iu,"(a2,1x,3(f18.10,1x))") adjustl(a(i)%name),a(i)%x*b2a,a(i)%y*b2a,a(i)%z*b2a
end do
close(iu)
end subroutine

subroutine write_cube(path,data)
character(len=*),intent(in) :: path
real*8,intent(in) :: data(:,:,:)
integer :: iu,i,j,k,nline

open(newunit=iu,file=trim(path),status="replace",action="write")
write(iu,"(a)") "Generated by Multiwfn 3Dmol GUI backend"
write(iu,"(a)") "Grid values exported from current Multiwfn memory"
write(iu,"(i5,3f12.6)") ncenter,orgx*b2a,orgy*b2a,orgz*b2a
write(iu,"(i5,3f12.6)") nx,gridv1*b2a
write(iu,"(i5,3f12.6)") ny,gridv2*b2a
write(iu,"(i5,3f12.6)") nz,gridv3*b2a
do i=1,ncenter
    write(iu,"(i5,f12.6,3f12.6)") a(i)%index,a(i)%charge,a(i)%x*b2a,a(i)%y*b2a,a(i)%z*b2a
end do
nline=0
do i=1,nx
    do j=1,ny
        do k=1,nz
            write(iu,"(1pe13.5)",advance="no") data(i,j,k)
            nline=nline+1
            if (mod(nline,6)==0) write(iu,*)
        end do
    end do
end do
if (mod(nline,6)/=0) write(iu,*)
close(iu)
end subroutine

subroutine write_manifest(path,entry,mode,extra,init1,end1,init2,end2,init3,end3)
character(len=*),intent(in) :: path,entry
integer,intent(in) :: mode,extra
real*8,intent(in) :: init1,end1,init2,end2,init3,end3
integer :: iu

open(newunit=iu,file=trim(path),status="replace",action="write")
write(iu,"(a)") "{"
write(iu,"(a)") '  "format": "multiwfn-3dmol-workbench",'
write(iu,"(a)") '  "version": 2,'
write(iu,"(a)") '  "generatedBy": "Multiwfn_3DmolGUI",'
write(iu,"(a)") '  "multiwfnGui": {'
write(iu,"(a,a,a)") '    "entry": "',trim(entry),'",'
write(iu,"(a,i0,a)") '    "guiMode": ',mode,','
write(iu,"(a,i0,a)") '    "allowSetStyle": ',extra,','
write(iu,"(a)") '    "state": {'
write(iu,"(a,1pe16.8,a)") '      "sur_value": ',sur_value,','
write(iu,"(a,1pe16.8,a)") '      "sur_value_orb": ',sur_value_orb,','
write(iu,"(a,i0,a)") '      "orbitalCount": ',nmo,','
write(iu,"(a,i0,a)") '      "homoIndex": ',idxHOMO,','
write(iu,"(a,a,a)") '      "showMolecule": ',trim(json_bool(idrawmol/=0)),','
write(iu,"(a,a,a)") '      "showBothSign": ',trim(json_bool(isosurshowboth/=0)),','
write(iu,"(a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a)") &
    '      "planeBounds": [',init1,',',end1,',',init2,',',end2,',',init3,',',end3,']'
write(iu,"(a)") '    }'
write(iu,"(a)") '  },'
if (allocated(a).and.ncenter>0) then
    write(iu,"(a)") '  "structure": { "path": "structure.xyz", "format": "xyz" },'
else
    write(iu,"(a)") '  "structure": null,'
end if
if (ifPBC>0) then
    write(iu,"(a)") '  "periodic": {'
    write(iu,"(a)") '    "enabled": true,'
    write(iu,"(a)") '    "showUnitCell": true,'
    write(iu,"(a)") '    "cell": {'
    write(iu,"(a,3(1pe16.8,a))") '      "a": [',cellv1(1)*b2a,',',cellv1(2)*b2a,',',cellv1(3)*b2a,'],'
    write(iu,"(a,3(1pe16.8,a))") '      "b": [',cellv2(1)*b2a,',',cellv2(2)*b2a,',',cellv2(3)*b2a,'],'
    write(iu,"(a,3(1pe16.8,a))") '      "c": [',cellv3(1)*b2a,',',cellv3(2)*b2a,',',cellv3(3)*b2a,']'
    write(iu,"(a)") '    }'
    write(iu,"(a)") '  },'
end if
call write_orbital_metadata(iu)
write(iu,"(a)") '  "cubes": ['
if (allocated(cubmat)) then
    if (allocated(cubmattmp)) then
        write(iu,"(a,1pe16.8,a)") '    { "name": "cubmat", "path": "cubmat.cube", "role": "density", "mode": "signed", "isovalue": ',abs(sur_value),' },'
    else
        write(iu,"(a,1pe16.8,a)") '    { "name": "cubmat", "path": "cubmat.cube", "role": "density", "mode": "signed", "isovalue": ',abs(sur_value),' }'
    end if
end if
if (allocated(cubmattmp)) then
    write(iu,"(a,1pe16.8,a)") '    { "name": "cubmattmp", "path": "cubmattmp.cube", "role": "custom", "mode": "signed", "isovalue": ',abs(sur_value),' }'
end if
write(iu,"(a)") '  ]'
write(iu,"(a)") "}"
close(iu)
end subroutine

subroutine write_orbital_metadata(iu)
integer,intent(in) :: iu
integer :: i,imax

write(iu,"(a)") '  "orbitals": {'
write(iu,"(a,i0,a)") '    "count": ',nmo,','
write(iu,"(a,i0,a)") '    "homoIndex": ',idxHOMO,','
write(iu,"(a)") '    "items": ['
if (nmo>0) then
    imax=min(nmo,2000)
    do i=1,imax
        if (allocated(MOene).and.allocated(MOocc)) then
            if (i<imax) then
                write(iu,"(a,i0,a,1pe16.8,a,1pe16.8,a)") '      { "index": ',i,', "energy": ',MOene(i),', "occupation": ',MOocc(i),' },'
            else
                write(iu,"(a,i0,a,1pe16.8,a,1pe16.8,a)") '      { "index": ',i,', "energy": ',MOene(i),', "occupation": ',MOocc(i),' }'
            end if
        else
            if (i<imax) then
                write(iu,"(a,i0,a)") '      { "index": ',i,' },'
            else
                write(iu,"(a,i0,a)") '      { "index": ',i,' }'
            end if
        end if
    end do
end if
write(iu,"(a)") '    ]'
write(iu,"(a)") '  },'
end subroutine

function json_bool(value) result(text)
logical,intent(in) :: value
character(len=5) :: text
if (value) then
    text="true"
else
    text="false"
end if
end function

end module
