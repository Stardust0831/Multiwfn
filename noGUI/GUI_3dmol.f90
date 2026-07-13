module GUI
use defvar
implicit none

real*8 :: aug3D_main0=6D0
integer,allocatable :: gui_orbital_indices(:)
integer :: gui_orbital_count=0
logical :: gui_has_cubmat_file=.false.,gui_has_cubmattmp_file=.false.
real*8,allocatable :: gui_fbo_cache(:,:)
logical :: gui_fbo_ready=.false.
integer,allocatable :: gui_bond_atom1(:),gui_bond_atom2(:)
integer*2,allocatable :: gui_bond_order(:)
integer :: gui_bond_count=0
logical :: gui_has_explicit_topology=.false.
integer*8 :: gui_session_serial=0

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
logical :: session_ok

call reset_generated_orbitals()
call reset_bond_analysis_cache()
gui_has_cubmat_file=.false.
gui_has_cubmattmp_file=.false.
call get_session_dir(session,session_ok)
if (.not.session_ok) return
call remove_session_file(trim(session)//"/gui_stop.flag")
call remove_session_file(trim(session)//"/gui_request.txt")
call prepare_gui_structure_topology()

if (allocated(a).and.ncenter>0) then
    if (gui_has_explicit_topology) then
        call write_structure_mol2(trim(session)//"/structure.mol2")
    else
        call write_structure_xyz(trim(session)//"/structure.xyz")
    end if
end if
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

subroutine reset_bond_analysis_cache()
if (allocated(gui_fbo_cache)) deallocate(gui_fbo_cache)
gui_fbo_ready=.false.
end subroutine

subroutine prepare_gui_structure_topology()
character(len=8) :: extension

gui_has_explicit_topology=.false.
gui_bond_count=0
if (allocated(gui_bond_atom1)) deallocate(gui_bond_atom1)
if (allocated(gui_bond_atom2)) deallocate(gui_bond_atom2)
if (allocated(gui_bond_order)) deallocate(gui_bond_order)
if (.not.allocated(a).or.ncenter<=0) return

call get_filename_extension(filename,extension)
select case(trim(extension))
case("fch","fchk")
    call read_gui_fchk_topology(trim(filename),gui_has_explicit_topology)
case("mol","sdf","mol2")
    if (allocated(connmat)) then
        if (size(connmat,1)==ncenter.and.size(connmat,2)==ncenter) then
            call copy_gui_bonds_from_connmat()
        end if
    end if
end select
end subroutine

subroutine copy_gui_bonds_from_connmat()
integer :: i,j,ibond

gui_bond_count=0
do i=1,ncenter
    do j=i+1,ncenter
        if (connmat(i,j)/=0) gui_bond_count=gui_bond_count+1
    end do
end do
allocate(gui_bond_atom1(gui_bond_count),gui_bond_atom2(gui_bond_count),gui_bond_order(gui_bond_count))
ibond=0
do i=1,ncenter
    do j=i+1,ncenter
        if (connmat(i,j)==0) cycle
        ibond=ibond+1
        gui_bond_atom1(ibond)=i
        gui_bond_atom2(ibond)=j
        gui_bond_order(ibond)=connmat(i,j)
    end do
end do
gui_has_explicit_topology=.true.
end subroutine

subroutine get_filename_extension(path,extension)
character(len=*),intent(in) :: path
character(len=*),intent(out) :: extension
integer :: i,idot,islash,ich,ncopy

extension=" "
idot=0
islash=0
do i=1,len_trim(path)
    if (path(i:i)=="/".or.path(i:i)=="\") islash=i
    if (path(i:i)==".") idot=i
end do
if (idot<=islash.or.idot>=len_trim(path)) return
ncopy=min(len(extension),len_trim(path)-idot)
extension(1:ncopy)=path(idot+1:idot+ncopy)
do i=1,ncopy
    ich=iachar(extension(i:i))
    if (ich>=iachar("A").and.ich<=iachar("Z")) extension(i:i)=achar(ich+32)
end do
end subroutine

subroutine read_gui_fchk_topology(path,found)
use util
implicit none
character(len=*),intent(in) :: path
logical,intent(out) :: found
integer :: iu,ifound,ierror,mxbond,nval,i,k,k2,idx,idx2,j,itype,reciprocal_type,iedge
integer,allocatable :: nbondatm(:),ibondatm(:)
real*8,allocatable :: rbond(:)
logical :: valid

found=.false.
open(newunit=iu,file=path,status="old",action="read",iostat=ierror)
if (ierror/=0) return

call loclabel(iu,'MxBond',ifound)
if (ifound==0) goto 900
read(iu,"(49x,i12)",iostat=ierror) mxbond
if (ierror/=0.or.mxbond<=0) goto 900

call loclabel(iu,'NBond',ifound)
if (ifound==0) goto 900
read(iu,"(49x,i12)",iostat=ierror) nval
if (ierror/=0.or.nval/=ncenter) goto 900
allocate(nbondatm(ncenter))
read(iu,"(6i12)",iostat=ierror) nbondatm
if (ierror/=0.or.any(nbondatm<0).or.any(nbondatm>mxbond)) goto 900

call loclabel(iu,'IBond',ifound)
if (ifound==0) goto 900
read(iu,"(49x,i12)",iostat=ierror) nval
if (ierror/=0.or.nval/=mxbond*ncenter) goto 900
allocate(ibondatm(nval))
read(iu,"(6i12)",iostat=ierror) ibondatm
if (ierror/=0) goto 900

call loclabel(iu,'RBond',ifound)
if (ifound==0) goto 900
read(iu,"(49x,i12)",iostat=ierror) nval
if (ierror/=0.or.nval/=mxbond*ncenter) goto 900
allocate(rbond(nval))
read(iu,"(5(1PE16.8))",iostat=ierror) rbond
if (ierror/=0) goto 900

valid=.true.
gui_bond_count=0
do i=1,ncenter
    do k=1,nbondatm(i)
        idx=(i-1)*mxbond+k
        j=ibondatm(idx)
        if (j<1.or.j>ncenter.or.j==i) then
            valid=.false.
            exit
        end if
        itype=gui_fchk_bond_type(rbond(idx))
        if (itype==0) then
            valid=.false.
            exit
        end if
        do k2=1,k-1
            idx2=(i-1)*mxbond+k2
            if (ibondatm(idx2)==j) then
                valid=.false.
                exit
            end if
        end do
        if (.not.valid) exit
        reciprocal_type=0
        do k2=1,nbondatm(j)
            idx2=(j-1)*mxbond+k2
            if (ibondatm(idx2)/=i) cycle
            if (reciprocal_type/=0) then
                valid=.false.
                exit
            end if
            reciprocal_type=gui_fchk_bond_type(rbond(idx2))
        end do
        if (.not.valid.or.reciprocal_type/=itype) then
            valid=.false.
            exit
        end if
        if (i<j) gui_bond_count=gui_bond_count+1
    end do
    if (.not.valid) exit
end do
if (.not.valid) goto 900

allocate(gui_bond_atom1(gui_bond_count),gui_bond_atom2(gui_bond_count),gui_bond_order(gui_bond_count))
iedge=0
do i=1,ncenter
    do k=1,nbondatm(i)
        idx=(i-1)*mxbond+k
        j=ibondatm(idx)
        if (i>=j) cycle
        iedge=iedge+1
        gui_bond_atom1(iedge)=i
        gui_bond_atom2(iedge)=j
        gui_bond_order(iedge)=gui_fchk_bond_type(rbond(idx))
    end do
end do
found=.true.
write(*,"(' 3Dmol GUI loaded',i8,' explicit bonds from formatted checkpoint connectivity')") gui_bond_count

900 close(iu)
end subroutine

integer function gui_fchk_bond_type(value)
real*8,intent(in) :: value

gui_fchk_bond_type=0
if (abs(value-1D0)<1D-6) then
    gui_fchk_bond_type=1
else if (abs(value-1.5D0)<1D-6) then
    gui_fchk_bond_type=4
else if (abs(value-2D0)<1D-6) then
    gui_fchk_bond_type=2
else if (abs(value-3D0)<1D-6) then
    gui_fchk_bond_type=3
end if
end function

subroutine get_session_dir(session,ok)
character(len=*),intent(out) :: session
logical,intent(out) :: ok
integer :: istat
character(len=512) :: requested

session=" "
ok=.false.
requested=" "
call get_environment_variable("MULTIWFN_3DMOL_SESSION",requested,status=istat)
if (istat==2) then
    write(*,"(/,a)") " 3Dmol GUI backend: MULTIWFN_3DMOL_SESSION exceeds the 512-character path limit."
    return
else if (istat==0.and.len_trim(requested)>0) then
    session=trim(requested)
    call ensure_dir(trim(session),ok)
else
    call create_default_session_dir(session,ok)
end if

if (.not.ok) then
    write(*,"(/,a)") " 3Dmol GUI backend: unable to create the requested session directory."
    if (len_trim(session)>0) write(*,"(a,a)") "   ",trim(session)
    write(*,"(a)") " GUI launch aborted; no shared fallback session will be used."
end if
end subroutine

subroutine create_default_session_dir(session,ok)
character(len=*),intent(out) :: session
logical,intent(out) :: ok
character(len=512) :: candidate
integer :: attempt,istat,values(8)
integer*8 :: clock_count
logical :: alive

session=" "
ok=.false.
call date_and_time(values=values)
call system_clock(clock_count)
gui_session_serial=gui_session_serial+1

! mkdir is an atomic operation on the target platforms.  If another process
! wins a candidate name, the failed mkdir is treated as a collision and the
! next candidate is attempted; no shared fixed-name fallback is used.
do attempt=0,99
    write(candidate,"('multiwfn_3dmol_session_',i4.4,2i2.2,'_',3i2.2,'.',i3.3,'_',i0,'_',i0,'_',i0)") &
        values(1),values(2),values(3),values(5),values(6),values(7),values(8),clock_count,gui_session_serial,attempt
    call mkdir_path(trim(candidate),istat)
    inquire(file=trim(candidate),exist=alive)
    if (istat==0.and.alive) then
        session=trim(candidate)
        ok=.true.
        return
    end if
end do
end subroutine

subroutine ensure_dir(dirname,ok)
character(len=*),intent(in) :: dirname
logical,intent(out) :: ok
character(len=512) :: clean
logical :: alive
integer :: istat

ok=.false.
clean=trim(dirname)
if (len_trim(clean)==0.or.len_trim(clean)>512) return
if (.not.session_path_is_safe(trim(clean))) return
inquire(file=trim(clean),exist=alive)
if (alive) then
    ok=.true.
    return
end if
call mkdir_path(trim(clean),istat)
inquire(file=trim(clean),exist=alive)
ok=(istat==0.and.alive)
end subroutine

logical function session_path_is_safe(path)
character(len=*),intent(in) :: path
integer :: i,code

session_path_is_safe=.false.
if (len_trim(path)==0.or.len_trim(path)>512) return
do i=1,len_trim(path)
    code=iachar(path(i:i))
    if (code<32.or.code==127) return
    select case(code)
    ! mkdir_path and the launch adapters wrap paths in double quotes.  Reject
    ! only characters that can terminate that quote or trigger expansion in
    ! either POSIX shells or cmd.exe; other punctuation is a valid path name.
    case(33,34,36,37,94,96)
        return
    end select
end do
session_path_is_safe=.true.
end function

subroutine mkdir_path(dirname,istat)
character(len=*),intent(in) :: dirname
integer,intent(out) :: istat
character(len=1024) :: cmd

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
integer :: i,idx,limit,istat,orbtotal
integer,allocatable :: indices(:)
character(len=512) :: env

if (trim(entry)/="drawmolgui") return
orbtotal=gui_orbital_total()
if (orbtotal<=0.or..not.allocated(a).or.ncenter<=0) return
if (.not.allocated(MOene).or..not.allocated(MOocc)) return

limit=-1
call get_environment_variable("MULTIWFN_3DMOL_ORBITAL_PREVIEW",env,status=istat)
if (istat==0.and.len_trim(env)>0) read(env,*,iostat=istat) limit
if (limit<0) return
if (limit==0) then
    if (orbtotal<=24) then
        limit=orbtotal
    else
        limit=12
    end if
end if
limit=min(limit,orbtotal)
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
integer :: startidx,endidx,homo,i,count,iout,orbtotal

orbtotal=gui_orbital_total()
if (limit>=orbtotal) then
    allocate(indices(orbtotal))
    do i=1,orbtotal
        indices(i)=i
    end do
    return
end if

homo=gui_homo_index()
if (homo<=0.or.homo>orbtotal) then
    homo=0
    if (allocated(MOocc)) then
        do i=1,orbtotal
            if (MOocc(i)>1D-8) homo=i
        end do
    end if
    if (homo<=0) homo=max(1,min(orbtotal,limit/2))
end if

startidx=max(1,homo-limit/2+1)
endidx=min(orbtotal,startidx+limit-1)
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
character(len=1024) :: reqfile,stopfile,respfile,line
character(len=32) :: action,method
integer :: iu,istat,iorb,quality,iatm1,iatm2
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
            read(iu,"(a)",iostat=istat) line
            close(iu,status="delete")
            if (istat==0) read(line,*,iostat=istat) reqid,action
            if (istat==0.and.reqid/=lastid) then
                write(respfile,"(a,'/response_',i0,'.json')") trim(session),reqid
                if (trim(action)=="orbital") then
                    read(line,*,iostat=istat) reqid,action,iorb,quality,isoval
                    if (istat==0) then
                        call handle_orbital_request(trim(session),trim(respfile),iorb,quality,isoval)
                    else
                        call write_gui_json_error(trim(respfile),"Malformed orbital request")
                    end if
                else if (trim(action)=="bond") then
                    read(line,*,iostat=istat) reqid,action,iatm1,iatm2,method
                    if (istat==0) then
                        call handle_bond_request(trim(respfile),iatm1,iatm2,trim(method))
                    else
                        call write_gui_json_error(trim(respfile),"Malformed bond request")
                    end if
                else if (trim(action)=="esp") then
                    read(line,*,iostat=istat) reqid,action,quality,isoval
                    if (istat==0) then
                        call handle_esp_request(trim(session),trim(respfile),quality,isoval)
                    else
                        call write_gui_json_error(trim(respfile),"Malformed ESP request")
                    end if
                else
                    call write_gui_json_error(trim(respfile),"Unknown GUI request")
                end if
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
integer :: iu,functype,orbtotal

orbtotal=gui_orbital_total()
if (iorb<0.or.iorb>orbtotal) then
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

subroutine handle_esp_request(session,respfile,quality,isoval)
character(len=*),intent(in) :: session,respfile
integer,intent(in) :: quality
real*8,intent(in) :: isoval
character(len=512) :: densityfile,densityrel,espfile,esprel
integer :: iu,nprevorbgrid_org,nx_org,ny_org,nz_org,iorbsel_org
real*8 :: esprhoiso_org,orgx_org,orgy_org,orgz_org,endx_org,endy_org,endz_org
real*8 :: dx_org,dy_org,dz_org,gridv1_org(3),gridv2_org(3),gridv3_org(3)
real*8 :: nelec_org,naelec_org,nbelec_org
real*8,allocatable :: cubmat_org(:,:,:)
logical :: cubmat_was_allocated

if (ifPBC>0) then
    call write_gui_json_error(respfile,"ESP visualization is not supported for periodic systems")
    return
end if
if (.not.allocated(a).or.ncenter<=0.or..not.allocated(b).or.nprims<=0.or. &
    .not.allocated(CO).or.nmo<=0) then
    call write_gui_json_error(respfile,"Wavefunction and GTF information is unavailable for ESP calculation")
    return
end if
if (quality<25000.or.quality>1500000) then
    call write_gui_json_error(respfile,"ESP grid quality is out of range")
    return
end if
if (isoval<=0D0.or.isoval>0.1D0) then
    call write_gui_json_error(respfile,"ESP density isovalue is out of range")
    return
end if

nprevorbgrid_org=nprevorbgrid
nx_org=nx
ny_org=ny
nz_org=nz
iorbsel_org=iorbsel
orgx_org=orgx
orgy_org=orgy
orgz_org=orgz
endx_org=endx
endy_org=endy
endz_org=endz
dx_org=dx
dy_org=dy
dz_org=dz
gridv1_org=gridv1
gridv2_org=gridv2
gridv3_org=gridv3
esprhoiso_org=ESPrhoiso
nelec_org=nelec
naelec_org=naelec
nbelec_org=nbelec
cubmat_was_allocated=allocated(cubmat)
if (cubmat_was_allocated) call move_alloc(cubmat,cubmat_org)

nprevorbgrid=quality
call setup_orbital_grid()
allocate(cubmat(nx,ny,nz))
call savecubmat(1,1,0)

write(densityrel,"('esp_density_',i0,'.cube')") quality
densityfile=trim(session)//"/"//trim(densityrel)
call write_cube(trim(densityfile),cubmat)

ESPrhoiso=isoval
call savecubmat(12,1,0)

write(esprel,"('esp_potential_',i0,'.cube')") quality
espfile=trim(session)//"/"//trim(esprel)
call write_cube(trim(espfile),cubmat)

if (allocated(cubmat)) deallocate(cubmat)
if (cubmat_was_allocated) call move_alloc(cubmat_org,cubmat)
nprevorbgrid=nprevorbgrid_org
nx=nx_org
ny=ny_org
nz=nz_org
iorbsel=iorbsel_org
orgx=orgx_org
orgy=orgy_org
orgz=orgz_org
endx=endx_org
endy=endy_org
endz=endz_org
dx=dx_org
dy=dy_org
dz=dz_org
gridv1=gridv1_org
gridv2=gridv2_org
gridv3=gridv3_org
ESPrhoiso=esprhoiso_org
nelec=nelec_org
naelec=naelec_org
nbelec=nbelec_org

open(newunit=iu,file=trim(respfile),status="replace",action="write")
write(iu,"(a)") "{"
write(iu,"(a)") '  "ok": true,'
write(iu,"(a,i0,a)") '  "quality": ',quality,','
write(iu,"(a,es24.16,a)") '  "isovalue": ',isoval,','
write(iu,"(a)") '  "densityLayer": {'
write(iu,"(a)") '    "name": "ESP on electron density",'
write(iu,"(a,a,a)") '    "path": "',trim(densityrel),'",'
write(iu,"(a)") '    "role": "density",'
write(iu,"(a)") '    "analysisKind": "esp-density",'
write(iu,"(a,i0,a)") '    "gridQuality": ',quality,','
write(iu,"(a)") '    "mode": "positive",'
write(iu,"(a,es24.16,a)") '    "isovalue": ',isoval,','
write(iu,"(a)") '    "opacity": 0.88,'
write(iu,"(a)") '    "visible": true'
write(iu,"(a)") '  },'
write(iu,"(a)") '  "espLayer": {'
write(iu,"(a)") '    "name": "Electrostatic potential",'
write(iu,"(a,a,a)") '    "path": "',trim(esprel),'",'
write(iu,"(a)") '    "role": "esp",'
write(iu,"(a)") '    "analysisKind": "esp-potential",'
write(iu,"(a,i0,a)") '    "gridQuality": ',quality,','
write(iu,"(a)") '    "mode": "signed",'
write(iu,"(a)") '    "isovalue": 0.02,'
write(iu,"(a)") '    "visible": false'
write(iu,"(a)") '  }'
write(iu,"(a)") "}"
close(iu)
end subroutine

subroutine handle_bond_request(respfile,iatm1,iatm2,method)
character(len=*),intent(in) :: respfile,method
integer,intent(in) :: iatm1,iatm2
integer :: iu,ierror,radpot_org,sphpot_org
real*8 :: value,total,alpha,beta,mixed
logical :: openshell

if (iatm1<1.or.iatm1>ncenter.or.iatm2<1.or.iatm2>ncenter.or.iatm1==iatm2) then
    call write_gui_json_error(respfile,"Invalid atom indices")
    return
end if
if (ifPBC>0) then
    call write_gui_json_error(respfile,"Periodic bond-order calculations are not supported")
    return
end if

openshell=wfntype==1.or.wfntype==2.or.wfntype==4
total=0D0
alpha=0D0
beta=0D0
mixed=0D0
ierror=0

if (method=="mayer".or.method=="gwbo") then
    call calc_bond_pair_mayer(iatm1,iatm2,total,alpha,beta,mixed,ierror)
    if (method=="gwbo".and..not.openshell) then
        call write_gui_json_error(respfile,"GWBO is only distinct for open-shell wavefunctions")
        return
    end if
    if (method=="gwbo") then
        value=mixed
    else
        value=total
    end if
else if (method=="wiberg_lowdin") then
    call calc_bond_pair_lowdin(iatm1,iatm2,total,alpha,beta,mixed,ierror)
    value=total
else if (method=="mulliken") then
    call calc_bond_pair_mulliken(iatm1,iatm2,total,alpha,beta,ierror)
    mixed=total
    value=total
else if (method=="fbo") then
    if (.not.allocated(b).or..not.allocated(CObasa)) then
        call write_gui_json_error(respfile,"GTF wavefunction information is unavailable")
        return
    end if
    if (.not.gui_fbo_ready) then
        radpot_org=radpot
        sphpot_org=sphpot
        call fuzzyana(11)
        radpot=radpot_org
        sphpot=sphpot_org
        if (.not.allocated(bndordmat)) then
            call write_gui_json_error(respfile,"FBO calculation did not return a result")
            return
        end if
        if (allocated(gui_fbo_cache)) deallocate(gui_fbo_cache)
        allocate(gui_fbo_cache(ncenter,ncenter))
        gui_fbo_cache=bndordmat
        gui_fbo_ready=.true.
    end if
    value=gui_fbo_cache(iatm1,iatm2)
    total=value
else
    call write_gui_json_error(respfile,"Unsupported bond-order method")
    return
end if

if (ierror/=0) then
    if (ierror==3) then
        call write_gui_json_error(respfile,"Selected atom has no basis functions")
    else
        call write_gui_json_error(respfile,"Basis-function and density information is unavailable")
    end if
    return
end if

open(newunit=iu,file=trim(respfile),status="replace",action="write")
write(iu,"(a)") "{"
write(iu,"(a)") '  "ok": true,'
write(iu,"(a,i0,a,i0,a)") '  "bond": { "atom1": ',iatm1,', "atom2": ',iatm2,' },'
write(iu,"(a,a,a)") '  "method": "',trim(method),'",'
write(iu,"(a,es24.16,a)") '  "value": ',value,','
if (openshell.and.(method=="mayer".or.method=="gwbo")) then
    write(iu,"(a,es24.16,a,es24.16,a,es24.16,a,es24.16,a)") &
        '  "components": { "alpha": ',alpha,', "beta": ',beta,', "total": ',total,', "gwbo": ',mixed,' }'
else if (openshell.and.method=="wiberg_lowdin") then
    write(iu,"(a,es24.16,a,es24.16,a,es24.16,a,es24.16,a)") &
        '  "components": { "alpha": ',alpha,', "beta": ',beta,', "total": ',total,', "mixed": ',mixed,' }'
else if (openshell.and.method=="mulliken") then
    write(iu,"(a,es24.16,a,es24.16,a,es24.16,a)") &
        '  "components": { "alpha": ',alpha,', "beta": ',beta,', "total": ',total,' }'
else
    write(iu,"(a,es24.16,a)") '  "components": { "total": ',total,' }'
end if
write(iu,"(a)") "}"
close(iu)
end subroutine

subroutine write_gui_json_error(respfile,message)
character(len=*),intent(in) :: respfile,message
integer :: iu
open(newunit=iu,file=trim(respfile),status="replace",action="write")
write(iu,"(a,a,a)") '{ "ok": false, "message": "',trim(message),'" }'
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
#ifdef MULTIWFN_WEB_FRONTEND_MATTERVIZ
call resolve_resource_path(home,"frontend/matterviz-viewer/dist",frontend)
#else
call resolve_resource_path(home,"frontend/3dmol-viewer",frontend)
#endif
#ifdef MULTIWFN_3DMOL_DEFAULT_SHELL_QT
shell="qt"
#elif defined(MULTIWFN_3DMOL_DEFAULT_SHELL_WEBVIEW)
shell="webview"
#else
shell="browser"
#endif
call get_environment_variable("MULTIWFN_3DMOL_SHELL",shell,status=istat)
if (istat/=0.or.len_trim(shell)==0) then
#ifdef MULTIWFN_3DMOL_DEFAULT_SHELL_QT
    shell="qt"
#elif defined(MULTIWFN_3DMOL_DEFAULT_SHELL_WEBVIEW)
    shell="webview"
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
else if (trim(shell)=="webview") then
    call resolve_resource_path(home,"tools/multiwfn_matterviz_webview.py",tool)
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
else if (trim(shell)=="webview") then
    cmd=trim(python)//' "'//trim(tool)//'" --frontend "'//trim(frontend)//'" --session "'//trim(session)//'" --manifest "'//trim(manifest)//'"'
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
character(len=512) :: session,home,python,tool,outfile,cmd,native
integer :: istat,iu
logical :: session_ok

selected=" "
call get_session_dir(session,session_ok)
if (.not.session_ok) return
call get_3dmol_home(home)
outfile=trim(session)//"/selected_file.txt"
call remove_session_file(trim(outfile))

call resolve_native_qt_launcher(home,native)
if (path_exists(native)) then
#ifdef MULTIWFN_WINDOWS
    cmd='cmd /d /c start /wait "" "'//trim(native)//'" --select-file --output "'//trim(outfile)//'"'
#else
    cmd='"'//trim(native)//'" --select-file --output "'//trim(outfile)//'"'
#endif
    call execute_command_line(trim(cmd),exitstat=istat)
    if (istat==0) then
        open(newunit=iu,file=trim(outfile),status="old",action="read",iostat=istat)
        if (istat==0) then
            read(iu,"(a)",iostat=istat) selected
            close(iu)
            if (istat/=0) selected=" "
            return
        end if
    end if
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

call resolve_resource_path(home,"tools/multiwfn_3dmol_file_dialog.py",tool)
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

subroutine write_structure_mol2(path)
character(len=*),intent(in) :: path
integer :: iu,i,ibond
character(len=24) :: atomlabel
character(len=8) :: bondtype

open(newunit=iu,file=trim(path),status="replace",action="write")
write(iu,"(a)") "@<TRIPOS>MOLECULE"
write(iu,"(a)") "Generated_by_Multiwfn_3Dmol_GUI_backend"
write(iu,"(2(i0,1x))") ncenter,gui_bond_count
write(iu,"(a)") "SMALL"
write(iu,"(a)") "NO_CHARGES"
write(iu,*)
write(iu,"(a)") "@<TRIPOS>ATOM"
do i=1,ncenter
    write(atomlabel,"(a,i0)") trim(a(i)%name),i
    write(iu,"(i0,1x,a,3(1x,f18.10),1x,a,1x,i0,1x,a,1x,f8.4)") &
        i,trim(atomlabel),a(i)%x*b2a,a(i)%y*b2a,a(i)%z*b2a,trim(a(i)%name),1,"MOL",0D0
end do
write(iu,"(a)") "@<TRIPOS>BOND"
do ibond=1,gui_bond_count
    if (gui_bond_order(ibond)==4) then
        bondtype="ar"
    else
        write(bondtype,"(i0)") gui_bond_order(ibond)
    end if
    write(iu,"(3(i0,1x),a)") ibond,gui_bond_atom1(ibond),gui_bond_atom2(ibond),trim(bondtype)
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
! Positive voxel counts in Gaussian cube files declare coordinates in Bohr.
! Keep the grid and embedded atoms in Multiwfn's native Bohr coordinates;
! 3Dmol converts them to Angstrom when parsing the cube.
write(iu,"(i5,3f12.6)") ncenter,orgx,orgy,orgz
write(iu,"(i5,3f12.6)") nx,gridv1
write(iu,"(i5,3f12.6)") ny,gridv2
write(iu,"(i5,3f12.6)") nz,gridv3
do i=1,ncenter
    write(iu,"(i5,f12.6,3f12.6)") a(i)%index,a(i)%charge,a(i)%x,a(i)%y,a(i)%z
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
integer :: iu,ncube,orbtotal,homo

orbtotal=gui_orbital_total()
homo=gui_homo_index()
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
write(iu,"(a,i0,a)") '      "orbitalCount": ',orbtotal,','
write(iu,"(a,i0,a)") '      "homoIndex": ',homo,','
write(iu,"(a,a,a)") '      "showMolecule": ',trim(json_bool(idrawmol/=0)),','
write(iu,"(a,a,a)") '      "showBothSign": ',trim(json_bool(isosurshowboth/=0)),','
write(iu,"(a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a)") &
    '      "planeBounds": [',init1,',',end1,',',init2,',',end2,',',init3,',',end3,']'
write(iu,"(a)") '    }'
write(iu,"(a)") '  },'
if (allocated(a).and.ncenter>0) then
    if (gui_has_explicit_topology) then
        write(iu,"(a)") '  "structure": { "path": "structure.mol2", "format": "mol2" },'
    else
        write(iu,"(a)") '  "structure": { "path": "structure.xyz", "format": "xyz" },'
    end if
else
    write(iu,"(a)") '  "structure": null,'
end if
call write_bond_analysis_manifest(iu)
call write_esp_analysis_manifest(iu)
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

subroutine write_bond_analysis_manifest(iu)
integer,intent(in) :: iu
logical :: basisok,fbook,openshell
character(len=96) :: basisreason,fboreason,gwreason

openshell=wfntype==1.or.wfntype==2.or.wfntype==4
basisok=ifPBC==0.and.allocated(CObasa).and.allocated(Ptot).and.allocated(Sbas).and. &
    allocated(basstart).and.allocated(basend)
fbook=ifPBC==0.and.allocated(b).and.allocated(CObasa).and.allocated(Ptot)
if (ifPBC>0) then
    basisreason="Periodic bond-order calculations are not supported in this GUI"
    fboreason=basisreason
else
    basisreason="Basis-function and density information is unavailable"
    fboreason="GTF wavefunction information is unavailable"
end if
if (openshell) then
    gwreason=basisreason
else
    gwreason="GWBO is only distinct for open-shell wavefunctions"
end if

write(iu,"(a)") '  "bondAnalysis": {'
write(iu,"(a)") '    "periodicSupported": false,'
write(iu,"(a,a,a)") '    "openShell": ',trim(json_bool(openshell)),','
write(iu,"(a)") '    "methods": {'
call write_bond_method_capability(iu,"mayer",basisok,basisreason,.true.)
call write_bond_method_capability(iu,"gwbo",basisok.and.openshell,gwreason,.true.)
call write_bond_method_capability(iu,"wiberg_lowdin",basisok,basisreason,.true.)
call write_bond_method_capability(iu,"mulliken",basisok,basisreason,.true.)
call write_bond_method_capability(iu,"fbo",fbook,fboreason,.false.)
write(iu,"(a)") '    }'
write(iu,"(a)") '  },'
end subroutine

subroutine write_esp_analysis_manifest(iu)
integer,intent(in) :: iu
logical :: available
character(len=96) :: reason

available=ifPBC==0.and.allocated(a).and.ncenter>0.and.allocated(b).and.nprims>0.and. &
    allocated(CO).and.nmo>0
if (ifPBC>0) then
    reason="ESP visualization is not supported for periodic systems"
else
    reason="Wavefunction and GTF information is unavailable for ESP calculation"
end if

write(iu,"(a)") '  "espAnalysis": {'
write(iu,"(a)") '    "periodicSupported": false,'
write(iu,"(a,a,a)") '    "available": ',trim(json_bool(available)),','
if (.not.available) write(iu,"(a,a,a)") '    "reason": "',trim(reason),'",'
write(iu,"(a)") '    "defaultIsovalue": 0.001'
write(iu,"(a)") '  },'
end subroutine

subroutine write_bond_method_capability(iu,method,available,reason,appendcomma)
integer,intent(in) :: iu
character(len=*),intent(in) :: method,reason
logical,intent(in) :: available,appendcomma
character(len=1) :: comma

comma=" "
if (appendcomma) comma=","
if (available) then
    write(iu,"(a,a,a,a)") '      "',trim(method),'": { "available": true }',comma
else
    write(iu,"(a,a,a,a,a,a)") '      "',trim(method),'": { "available": false, "reason": "',trim(reason),'" }',comma
end if
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
integer :: i,imax,orbtotal,homo,maxvalues

orbtotal=gui_orbital_total()
homo=gui_homo_index()
maxvalues=0
if (allocated(MOene).and.allocated(MOocc)) maxvalues=min(size(MOene),size(MOocc))
write(iu,"(a)") '  "orbitals": {'
write(iu,"(a,i0,a)") '    "count": ',orbtotal,','
write(iu,"(a,i0,a)") '    "homoIndex": ',homo,','
write(iu,"(a)") '    "items": ['
if (orbtotal>0) then
    imax=min(orbtotal,2000)
    do i=1,imax
        if (i<=maxvalues) then
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

integer function gui_orbital_total()
gui_orbital_total=nmo
if (gui_orbital_total<=0) then
    if (allocated(MOene)) gui_orbital_total=size(MOene)
    if (gui_orbital_total<=0.and.allocated(MOocc)) gui_orbital_total=size(MOocc)
end if
end function

integer function gui_homo_index()
integer :: i,orbtotal
gui_homo_index=idxHOMO
orbtotal=gui_orbital_total()
if (gui_homo_index<=0.or.gui_homo_index>orbtotal) then
    gui_homo_index=0
    if (allocated(MOocc)) then
        do i=1,orbtotal
            if (MOocc(i)>1D-8) gui_homo_index=i
        end do
    end if
end if
end function

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
