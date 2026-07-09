module GUI
use defvar
implicit none

real*8 :: aug3D_main0=6D0
integer,allocatable :: gui_orbital_indices(:)
integer :: gui_orbital_count=0
logical :: gui_has_cubmat_file=.false.,gui_has_cubmattmp_file=.false.

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
if (ifPBC>0) aug3D_main0=-1
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

call reset_generated_orbitals()
gui_has_cubmat_file=.false.
gui_has_cubmattmp_file=.false.
call get_session_dir(session)
call ensure_dir(session)
call remove_session_file(trim(session)//"/gui_stop.flag")
call remove_session_file(trim(session)//"/gui_request.txt")

if (allocated(a).and.ncenter>0) call write_structure_xyz(trim(session)//"/structure.xyz")
if (allocated(cubmat)) then
    call write_cube(trim(session)//"/cubmat.cube",cubmat)
    gui_has_cubmat_file=.true.
end if
if (allocated(cubmattmp)) then
    call write_cube(trim(session)//"/cubmattmp.cube",cubmattmp)
    gui_has_cubmattmp_file=.true.
end if
call write_orbital_preview_cubes(entry,trim(session))

manifest=trim(session)//"/manifest.json"
call write_manifest(manifest,entry,mode,extra,init1,end1,init2,end2,init3,end3)
call build_launch_command(trim(manifest),trim(session),cmd)

write(*,"(/,a)") " 3Dmol GUI backend wrote a visualization session:"
write(*,"(a,a)") "   ",trim(manifest)
write(*,"(a)") " Launching visualization GUI..."
call execute_command_line(trim(cmd),wait=.false.)
if (trim(entry)=="drawmolgui") call run_3dmol_gui_loop(trim(session))
end subroutine

subroutine reset_generated_orbitals()
if (allocated(gui_orbital_indices)) deallocate(gui_orbital_indices)
allocate(gui_orbital_indices(0))
gui_orbital_count=0
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

subroutine remove_session_file(path)
character(len=*),intent(in) :: path
integer :: iu,istat
logical :: alive

inquire(file=trim(path),exist=alive)
if (.not.alive) return
open(newunit=iu,file=trim(path),status="old",iostat=istat)
if (istat==0) close(iu,status="delete")
end subroutine

subroutine write_orbital_preview_cubes(entry,session)
character(len=*),intent(in) :: entry,session
integer :: i,idx,limit,istat
integer,allocatable :: indices(:)
character(len=512) :: env

if (trim(entry)/="drawmolgui") return
if (nmo<=0.or..not.allocated(a).or.ncenter<=0) return
if (.not.allocated(MOene).or..not.allocated(MOocc)) return

limit=-1
call get_environment_variable("MULTIWFN_3DMOL_ORBITAL_PREVIEW",env,status=istat)
if (istat==0.and.len_trim(env)>0) read(env,*,iostat=istat) limit
if (limit<0) return
if (limit==0) then
    if (nmo<=24) then
        limit=nmo
    else
        limit=12
    end if
end if
limit=min(limit,nmo)
if (limit<=0) return

call select_preview_orbitals(limit,indices)
if (.not.allocated(indices)) return
call setup_orbital_grid()
if (allocated(cubmat)) deallocate(cubmat)
allocate(cubmat(nx,ny,nz))

if (allocated(gui_orbital_indices)) deallocate(gui_orbital_indices)
allocate(gui_orbital_indices(size(indices)))
gui_orbital_count=size(indices)
do i=1,gui_orbital_count
    idx=indices(i)
    gui_orbital_indices(i)=idx
    iorbvis=idx
    call savecubmat(4,1,idx)
    if (ifixorbsign==1.and.sum(cubmat)<0) cubmat=-cubmat
    call write_orbital_cube(session,idx,cubmat)
end do
deallocate(indices)
end subroutine

subroutine select_preview_orbitals(limit,indices)
integer,intent(in) :: limit
integer,allocatable,intent(out) :: indices(:)
integer :: startidx,endidx,homo,i,count,iout

if (limit>=nmo) then
    allocate(indices(nmo))
    do i=1,nmo
        indices(i)=i
    end do
    return
end if

homo=idxHOMO
if (homo<=0.or.homo>nmo) then
    homo=0
    if (allocated(MOocc)) then
        do i=1,nmo
            if (MOocc(i)>1D-8) homo=i
        end do
    end if
    if (homo<=0) homo=max(1,min(nmo,limit/2))
end if

startidx=max(1,homo-limit/2+1)
endidx=min(nmo,startidx+limit-1)
startidx=max(1,endidx-limit+1)
count=endidx-startidx+1
allocate(indices(count))
iout=0
do i=startidx,endidx
    iout=iout+1
    indices(iout)=i
end do
end subroutine

subroutine setup_orbital_grid()
real*8 :: molxlen,molylen,molzlen

if (aug3D_main0>=0) then
    molxlen=(maxval(a%x)-minval(a%x))+2*aug3D_main0
    molylen=(maxval(a%y)-minval(a%y))+2*aug3D_main0
    molzlen=(maxval(a%z)-minval(a%z))+2*aug3D_main0
    orgx=minval(a%x)-aug3D_main0
    orgy=minval(a%y)-aug3D_main0
    orgz=minval(a%z)-aug3D_main0
else
    orgx=0
    orgy=0
    orgz=0
    molxlen=cellv1(1)
    molylen=cellv2(2)
    molzlen=cellv3(3)
end if
endx=orgx+molxlen
endy=orgy+molylen
endz=orgz+molzlen
dx=(molxlen*molylen*molzlen/dfloat(nprevorbgrid))**(1D0/3D0)
dy=dx
dz=dx
gridv1=0
gridv2=0
gridv3=0
gridv1(1)=dx
gridv2(2)=dy
gridv3(3)=dz
nx=nint(molxlen/dx)+1
ny=nint(molylen/dy)+1
nz=nint(molzlen/dz)+1
end subroutine

subroutine run_3dmol_gui_loop(session)
character(len=*),intent(in) :: session
character(len=512) :: reqfile,stopfile,respfile
character(len=32) :: action
integer :: iu,istat,iorb,quality
integer*8 :: reqid,lastid
real*8 :: isoval
logical :: alive

reqfile=trim(session)//"/gui_request.txt"
stopfile=trim(session)//"/gui_stop.flag"
lastid=-1
do
    inquire(file=trim(stopfile),exist=alive)
    if (alive) exit

    inquire(file=trim(reqfile),exist=alive)
    if (alive) then
        open(newunit=iu,file=trim(reqfile),status="old",action="read",iostat=istat)
        if (istat==0) then
            read(iu,*,iostat=istat) reqid,action,iorb,quality,isoval
            close(iu,status="delete")
            if (istat==0.and.reqid/=lastid) then
                write(respfile,"(a,'/response_',i0,'.json')") trim(session),reqid
                if (trim(action)=="orbital") call handle_orbital_request(trim(session),trim(respfile),iorb,quality,isoval)
                lastid=reqid
            end if
        end if
    end if
    call sleep(1)
end do
end subroutine

subroutine handle_orbital_request(session,respfile,iorb,quality,isoval)
character(len=*),intent(in) :: session,respfile
integer,intent(in) :: iorb,quality
real*8,intent(in) :: isoval
character(len=512) :: cubefile,cuberel
integer :: iu,functype

if (iorb<0.or.iorb>nmo) then
    open(newunit=iu,file=trim(respfile),status="replace",action="write")
    write(iu,"(a)") '{ "ok": false, "message": "Orbital index out of range" }'
    close(iu)
    return
end if

if (quality>0) nprevorbgrid=quality
if (isoval>0D0) sur_value_orb=isoval
iorbvis=iorb

if (iorb==0) then
    idrawisosur=0
    if (allocated(cubmat)) deallocate(cubmat)
    open(newunit=iu,file=trim(respfile),status="replace",action="write")
    write(iu,"(a)") '{ "ok": true, "clear": true }'
    close(iu)
    return
end if

idrawisosur=1
call setup_orbital_grid()
if (allocated(cubmat)) deallocate(cubmat)
allocate(cubmat(nx,ny,nz))
functype=4
if (iplotwfndens==2) functype=44
call savecubmat(functype,1,iorb)
if (ifixorbsign==1.and.sum(cubmat)<0) cubmat=-cubmat

write(cuberel,"('orbital_',i0,'_',i0,'.cube')") iorb,nprevorbgrid
cubefile=trim(session)//"/"//trim(cuberel)
call write_cube(trim(cubefile),cubmat)

open(newunit=iu,file=trim(respfile),status="replace",action="write")
write(iu,"(a)") "{"
write(iu,"(a)") '  "ok": true,'
write(iu,"(a,i0,a)") '  "orbitalIndex": ',iorb,','
write(iu,"(a,i0,a)") '  "quality": ',nprevorbgrid,','
write(iu,"(a,1pe16.8,a)") '  "isovalue": ',sur_value_orb,','
write(iu,"(a)") '  "layer": {'
write(iu,"(a,i0,a)") '    "name": "Orbital ',iorb,'",'
write(iu,"(a,a,a)") '    "path": "',trim(cuberel),'",'
write(iu,"(a)") '    "role": "orbital",'
write(iu,"(a,i0,a)") '    "orbitalIndex": ',iorb,','
write(iu,"(a)") '    "mode": "signed",'
write(iu,"(a,1pe16.8,a)") '    "isovalue": ',sur_value_orb,','
write(iu,"(a)") '    "visible": true'
write(iu,"(a)") '  }'
write(iu,"(a)") "}"
close(iu)
end subroutine

subroutine write_orbital_cube(session,idx,data)
character(len=*),intent(in) :: session
integer,intent(in) :: idx
real*8,intent(in) :: data(:,:,:)
character(len=512) :: path

write(path,"(a,'/orb',i6.6,'.cube')") trim(session),idx
call write_cube(trim(path),data)
end subroutine

subroutine build_launch_command(manifest,session,cmd)
character(len=*),intent(in) :: manifest,session
character(len=*),intent(out) :: cmd
character(len=512) :: home,python,tool,frontend,shell,native
integer :: istat

call get_3dmol_home(home)
call resolve_resource_path(home,"frontend/3dmol-viewer",frontend)
#ifdef MULTIWFN_3DMOL_DEFAULT_SHELL_QT
shell="qt"
#else
shell="browser"
#endif
call get_environment_variable("MULTIWFN_3DMOL_SHELL",shell,status=istat)
if (istat/=0.or.len_trim(shell)==0) then
#ifdef MULTIWFN_3DMOL_DEFAULT_SHELL_QT
    shell="qt"
#else
    shell="browser"
#endif
end if

if (trim(shell)=="qt") then
    call resolve_native_qt_launcher(home,native)
    if (path_exists(native)) then
        tool=trim(native)
#ifdef MULTIWFN_WINDOWS
        cmd='cmd /d /c start "" "'//trim(tool)//'" --manifest "'//trim(manifest)//'" --frontend "'//trim(frontend)//'"'
#else
        cmd='"'//trim(tool)//'" --manifest "'//trim(manifest)//'" --frontend "'//trim(frontend)//'"'
#endif
        return
    end if
    call resolve_resource_path(home,"tools/multiwfn_qt_gui.py",tool)
else
    call resolve_resource_path(home,"tools/multiwfn_3dmol_server.py",tool)
end if

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

if (trim(shell)=="qt") then
    cmd=trim(python)//' "'//trim(tool)//'" --manifest "'//trim(manifest)//'" --frontend "'//trim(frontend)//'"'
else
    cmd=trim(python)//' "'//trim(tool)//'" --frontend "'//trim(frontend)//'" --session "'//trim(session)//'" --manifest "'//trim(manifest)//'" --open'
end if
end subroutine

subroutine resolve_native_qt_launcher(home,native)
character(len=*),intent(in) :: home
character(len=*),intent(out) :: native

call resolve_resource_path(home,"tools/multiwfn_qt_gui.exe",native)
if (path_exists(native)) return
call resolve_resource_path(home,"tools/multiwfn_qt_gui",native)
end subroutine

logical function path_exists(path)
character(len=*),intent(in) :: path
inquire(file=trim(path),exist=path_exists)
end function

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
integer :: iu,ncube

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
ncube=0
if (gui_has_cubmat_file) then
    call write_cube_entry(iu,ncube,"cubmat","cubmat.cube","density",0,abs(sur_value))
end if
if (gui_has_cubmattmp_file) then
    call write_cube_entry(iu,ncube,"cubmattmp","cubmattmp.cube","custom",0,abs(sur_value))
end if
call write_orbital_cube_manifest(iu,ncube)
write(iu,"(a)") '  ]'
write(iu,"(a)") "}"
close(iu)
end subroutine

subroutine write_cube_entry(iu,ncube,name,path,role,orbidx,isoval)
integer,intent(in) :: iu,orbidx
integer,intent(inout) :: ncube
character(len=*),intent(in) :: name,path,role
real*8,intent(in) :: isoval

if (ncube>0) write(iu,"(a)") ","
ncube=ncube+1
if (orbidx>0) then
    write(iu,"(a,a,a,a,a,a,a,i0,a,1pe16.8,a)") '    { "name": "',trim(name),'", "path": "',trim(path),&
        '", "role": "',trim(role),'", "orbitalIndex": ',orbidx,', "mode": "signed", "isovalue": ',isoval,' }'
else
    write(iu,"(a,a,a,a,a,a,a,1pe16.8,a)") '    { "name": "',trim(name),'", "path": "',trim(path),&
        '", "role": "',trim(role),'", "mode": "signed", "isovalue": ',isoval,' }'
end if
end subroutine

subroutine write_orbital_cube_manifest(iu,ncube)
integer,intent(in) :: iu
integer,intent(inout) :: ncube
integer :: i,idx
character(len=64) :: name,path

if (gui_orbital_count<=0) return
do i=1,gui_orbital_count
    idx=gui_orbital_indices(i)
    write(name,"('Orbital ',i0)") idx
    write(path,"('orb',i6.6,'.cube')") idx
    call write_cube_entry(iu,ncube,trim(name),trim(path),"orbital",idx,abs(sur_value_orb))
end do
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
