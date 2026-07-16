module GUI
use defvar
use iso_c_binding, only: c_char,c_int,c_int32_t,c_int64_t,c_intptr_t,c_double,c_null_char
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
integer(c_intptr_t) :: gui_volume_write=-1_c_intptr_t,gui_ack_read=-1_c_intptr_t
integer(c_intptr_t) :: gui_request_read=-1_c_intptr_t,gui_response_write=-1_c_intptr_t
integer(c_int64_t) :: gui_volume_serial=0_c_int64_t
integer*8 :: gui_cubmat_volume_id=-1,gui_cubmattmp_volume_id=-1

type :: matterviz_json_sink
    integer :: unit=0
    integer(c_intptr_t) :: buffer=-1_c_intptr_t
    integer :: status=0
end type

interface
    integer(c_int) function multiwfn_matterviz_spawn(executable,frontend,session,manifest, &
        volume_write,ack_read,request_read,response_write,transport_error) &
        bind(C,name="multiwfn_matterviz_spawn")
    import :: c_char,c_int,c_intptr_t
    character(kind=c_char),intent(in) :: executable(*),frontend(*),session(*),manifest(*)
    integer(c_intptr_t),intent(out) :: volume_write,ack_read,request_read,response_write
    integer(c_int),intent(out) :: transport_error
    end function

    integer(c_int) function multiwfn_matterviz_select_file(executable,result_utf8,result_capacity, &
        result_bytes,picker_status) &
        bind(C,name="multiwfn_matterviz_select_file")
    import :: c_char,c_int,c_int32_t,c_int64_t
    character(kind=c_char),intent(in) :: executable(*)
    character(kind=c_char),intent(out) :: result_utf8(*)
    integer(c_int64_t),value :: result_capacity
    integer(c_int64_t),intent(out) :: result_bytes
    integer(c_int32_t),intent(out) :: picker_status
    end function

    integer(c_int) function multiwfn_matterviz_publish_volume(volume_write,ack_read,request_id, &
        volume_id,nx_arg,ny_arg,nz_arg,data_order,periodic_axes,coordinate_unit,quantity_kind, &
        value_unit,origin,voxel_axes,lattice,samples,sample_count,publish_timeout_ms) &
        bind(C,name="multiwfn_matterviz_publish_volume")
    import :: c_int,c_int32_t,c_int64_t,c_intptr_t,c_double
    integer(c_intptr_t),value :: volume_write,ack_read
    integer(c_int64_t),value :: request_id,volume_id,sample_count
    integer(c_int32_t),value :: nx_arg,ny_arg,nz_arg,data_order,periodic_axes
    integer(c_int32_t),value :: coordinate_unit,quantity_kind,value_unit
    real(c_double),intent(in) :: origin(3),voxel_axes(9),lattice(9),samples(*)
    integer(c_int32_t),value :: publish_timeout_ms
    end function

    integer(c_int) function multiwfn_matterviz_publish_volume_stream(volume_write,ack_read,request_id, &
        volume_id,nx_arg,ny_arg,nz_arg,data_order,periodic_axes,coordinate_unit,quantity_kind, &
        value_unit,origin,voxel_axes,lattice,samples,sample_count,publish_timeout_ms) &
        bind(C,name="multiwfn_matterviz_publish_volume_stream")
    import :: c_int,c_int32_t,c_int64_t,c_intptr_t,c_double
    integer(c_intptr_t),value :: volume_write,ack_read
    integer(c_int64_t),value :: request_id,volume_id,sample_count
    integer(c_int32_t),value :: nx_arg,ny_arg,nz_arg,data_order,periodic_axes
    integer(c_int32_t),value :: coordinate_unit,quantity_kind,value_unit
    real(c_double),intent(in) :: origin(3),voxel_axes(9),lattice(9),samples(*)
    integer(c_int32_t),value :: publish_timeout_ms
    end function

    subroutine multiwfn_matterviz_transport_close(volume_write,ack_read) &
        bind(C,name="multiwfn_matterviz_transport_close")
    import :: c_intptr_t
    integer(c_intptr_t),intent(inout) :: volume_write,ack_read
    end subroutine

    subroutine multiwfn_matterviz_control_close(request_read,response_write) &
        bind(C,name="multiwfn_matterviz_control_close")
    import :: c_intptr_t
    integer(c_intptr_t),intent(inout) :: request_read,response_write
    end subroutine

    integer(c_intptr_t) function multiwfn_matterviz_control_buffer_create() &
        bind(C,name="multiwfn_matterviz_control_buffer_create")
    import :: c_intptr_t
    end function

    integer(c_int) function multiwfn_matterviz_control_buffer_append(buffer,bytes,length) &
        bind(C,name="multiwfn_matterviz_control_buffer_append")
    import :: c_char,c_int,c_int64_t,c_intptr_t
    integer(c_intptr_t),value :: buffer
    character(kind=c_char),intent(in) :: bytes(*)
    integer(c_int64_t),value :: length
    end function

    integer(c_int) function multiwfn_matterviz_control_buffer_send(buffer,response_write, &
        message_type,request_id,timeout_ms) &
        bind(C,name="multiwfn_matterviz_control_buffer_send")
    import :: c_int,c_int32_t,c_int64_t,c_intptr_t
    integer(c_intptr_t),value :: buffer,response_write
    integer(c_int32_t),value :: message_type
    integer(c_int64_t),value :: request_id
    integer(c_int32_t),value :: timeout_ms
    end function

    integer(c_int) function multiwfn_matterviz_control_receive(request_read,message_type, &
        request_id,body,body_capacity,body_bytes,timeout_ms) &
        bind(C,name="multiwfn_matterviz_control_receive")
    import :: c_char,c_int,c_int32_t,c_int64_t,c_intptr_t
    integer(c_intptr_t),value :: request_read
    integer(c_int32_t),intent(out) :: message_type
    integer(c_int64_t),intent(out) :: request_id,body_bytes
    character(kind=c_char),intent(out) :: body(*)
    integer(c_int64_t),value :: body_capacity
    integer(c_int32_t),value :: timeout_ms
    end function

    subroutine multiwfn_matterviz_control_buffer_destroy(buffer) &
        bind(C,name="multiwfn_matterviz_control_buffer_destroy")
    import :: c_intptr_t
    integer(c_intptr_t),intent(inout) :: buffer
    end subroutine
end interface

contains

subroutine emit_matterviz_json(sink,line)
type(matterviz_json_sink),intent(inout) :: sink
character(len=*),intent(in) :: line
character(kind=c_char),allocatable :: c_line(:)
integer(c_int) :: c_status
integer(c_int64_t) :: byte_count

if (sink%status/=0) return
if (sink%unit/=0) write(sink%unit,"(a)") trim(line)
if (sink%buffer<=0_c_intptr_t) return
call matterviz_c_string(trim(line)//new_line("a"),c_line)
byte_count=int(len_trim(line)+1,kind=c_int64_t)
c_status=multiwfn_matterviz_control_buffer_append(sink%buffer,c_line,byte_count)
sink%status=int(c_status)
deallocate(c_line)
end subroutine

logical function matterviz_cube_fallback_enabled()
character(len=32) :: value
integer :: status

value=""
call get_environment_variable("MULTIWFN_MATTERVIZ_ALLOW_CUBE_FALLBACK",value,status=status)
matterviz_cube_fallback_enabled=status==0.and.trim(value)=="1"
end function

subroutine selfilegui
character(len=512) :: envfile
integer :: istat

call get_environment_variable("MULTIWFN_MATTERVIZ_INPUT",envfile,status=istat)
if (istat==0.and.len_trim(envfile)>0) then
    filename=trim(envfile)
else
    call select_file_with_dialog(filename)
    if (len_trim(filename)==0) then
        write(*,"(/,a)") " MatterViz GUI backend: no file was selected."
        write(*,"(a)") " Input the file path in the console, or set MULTIWFN_MATTERVIZ_INPUT."
    end if
end if
end subroutine

subroutine drawmolgui
GUI_mode=1
idrawmol=1
if (ifPBC>0) aug3D_main0=-1
call launch_matterviz_gui("drawmolgui",1,0,0D0,0D0,0D0,0D0,0D0,0D0)
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
call launch_matterviz_gui("drawplanegui",2,idrawtype,init1,end1,init2,end2,init3,end3)
end subroutine

subroutine drawisosurgui(iallowsetstyle)
integer,intent(in) :: iallowsetstyle
GUI_mode=3
idrawisosur=1
call launch_matterviz_gui("drawisosurgui",3,iallowsetstyle,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawmoltopogui
GUI_mode=4
call launch_matterviz_gui("drawmoltopogui",4,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawsurfanalysis
GUI_mode=5
call launch_matterviz_gui("drawsurfanalysis",5,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawbasinintgui
GUI_mode=6
call launch_matterviz_gui("drawbasinintgui",6,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine drawdomaingui
GUI_mode=6
call launch_matterviz_gui("drawdomaingui",6,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine setboxGUI
GUI_mode=7
ishowdatarange=1
call launch_matterviz_gui("setboxGUI",7,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine miniGUI
GUI_mode=7
call launch_matterviz_gui("miniGUI",7,0,0D0,0D0,0D0,0D0,0D0,0D0)
end subroutine

subroutine launch_matterviz_gui(entry,mode,extra,init1,end1,init2,end2,init3,end3)
character(len=*),intent(in) :: entry
integer,intent(in) :: mode,extra
real*8,intent(in) :: init1,end1,init2,end2,init3,end3
character(len=512) :: session,manifest
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
character(len=1024) :: cmd
#else
character(len=512) :: frontend,native
#endif
integer :: launch_status,iu,bootstrap_status
integer :: transport_error
logical :: session_ok,diagnostic_cube_fallback,memory_session

call reset_generated_orbitals()
call reset_bond_analysis_cache()
call close_matterviz_transport()
gui_volume_serial=0_c_int64_t
gui_cubmat_volume_id=-1
gui_cubmattmp_volume_id=-1
gui_has_cubmat_file=.false.
gui_has_cubmattmp_file=.false.
diagnostic_cube_fallback=matterviz_cube_fallback_enabled()
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
memory_session=.false.
#else
memory_session=.not.diagnostic_cube_fallback
#endif
if (memory_session) then
    call get_session_identity(session,session_ok)
else
    call get_session_dir(session,session_ok)
end if
if (.not.session_ok) return
if (.not.memory_session) then
    call remove_session_file(trim(session)//"/gui_stop.flag")
    call remove_session_file(trim(session)//"/gui_request.txt")
    if (trim(entry)=="drawmolgui") then
        call remove_session_file(trim(session)//"/cubmat.cube")
        call remove_session_file(trim(session)//"/cubmattmp.cube")
    end if
end if
call prepare_gui_structure_topology()

if (.not.memory_session) then
    if (allocated(a).and.ncenter>0) call write_structure_json(trim(session)//"/structure.json")
    if (allocated(cubmat).and.trim(entry)/="drawmolgui") then
        call write_cube(trim(session)//"/cubmat.cube",cubmat)
        gui_has_cubmat_file=.true.
    end if
    if (allocated(cubmattmp)) then
        call write_cube(trim(session)//"/cubmattmp.cube",cubmattmp)
        gui_has_cubmattmp_file=.true.
    end if
    call write_orbital_preview_cubes(entry,trim(session))
end if

manifest=trim(session)//"/manifest.json"
if (.not.memory_session) then
    call write_manifest(manifest,entry,mode,extra,init1,end1,init2,end2,init3,end3)
    write(*,"(/,a)") " MatterViz GUI backend wrote a visualization session:"
    write(*,"(a,a)") "   ",trim(manifest)
else
    write(*,"(/,a)") " MatterViz GUI backend prepared an in-memory visualization session"
end if
write(*,"(a)") " Launching visualization GUI..."
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
call build_launch_command(trim(manifest),trim(session),cmd)
#ifdef MULTIWFN_WINDOWS
! MinGW execute_command_line(wait=.false.) may still block until the child
! exits.  Use the native Windows process adapter so the request loop starts
! while the visualization host remains alive.
launch_status=launch_matterviz_process(trim(cmd))
if (launch_status/=0) then
    write(*,"(a,i0)") " MatterViz GUI launch failed with status ",launch_status
    return
end if
#else
call execute_command_line(trim(cmd),wait=.false.)
#endif
#else
call resolve_matterviz_launch_paths(frontend,native)
call launch_matterviz_native(trim(native),trim(frontend),trim(session),trim(manifest), &
    launch_status,transport_error)
if (launch_status/=0) then
    write(*,"(a,i0)") " MatterViz GUI launch failed with status ",launch_status
    if (transport_error/=0) then
        write(*,"(a,i0,a)") " MatterViz binary transport startup failed (",transport_error,")"
    end if
    return
end if
if (transport_error/=0) then
    if (diagnostic_cube_fallback) then
        write(*,"(a,i0,a)") " MatterViz binary transport unavailable (",transport_error, &
            "); explicit diagnostic Cube fallback enabled"
    else
        write(*,"(a,i0,a)") " MatterViz binary transport unavailable (",transport_error, &
            "); the visualization session is invalid"
        if (.not.memory_session) then
            open(newunit=iu,file=trim(session)//"/gui_stop.flag",status="replace",action="write")
            write(iu,"(a)") "return"
            close(iu)
        end if
        call close_matterviz_transport()
        return
    end if
end if
if (memory_session) then
    call publish_matterviz_initial_volumes(entry,bootstrap_status)
    if (bootstrap_status/=0) then
        write(*,"(a,i0,a)") " MatterViz initial volume transfer failed (", &
            bootstrap_status,")"
        call close_matterviz_transport()
        return
    end if
end if
if (gui_response_write>=0_c_intptr_t) then
    call send_matterviz_session_init(entry,mode,extra,init1,end1,init2,end2,init3,end3, &
        bootstrap_status)
    if (bootstrap_status/=0) then
        write(*,"(a,i0,a)") " MatterViz in-memory session bootstrap failed (", &
            bootstrap_status,")"
        call close_matterviz_transport()
        return
    end if
end if
#endif
if (memory_session) then
    call run_matterviz_control_loop(trim(session))
else if (trim(entry)=="drawmolgui") then
    call run_matterviz_gui_loop(trim(session))
else
    call close_matterviz_transport()
end if
end subroutine

subroutine run_matterviz_control_loop(session)
character(len=*),intent(in) :: session
character(kind=c_char) :: c_body(4096)
character(len=4095) :: body,command
character(len=32) :: action,method
integer(c_int32_t) :: message_type
integer(c_int64_t) :: request_id,body_bytes
integer(c_int) :: c_status
integer :: istat,iorb,quality,iatm1,iatm2
real*8 :: isoval
type(matterviz_json_sink) :: sink
character(len=1024) :: line

do
    c_status=multiwfn_matterviz_control_receive(gui_request_read,message_type,request_id, &
        c_body,int(size(c_body),c_int64_t),body_bytes,250_c_int32_t)
    if (c_status==-1003_c_int) cycle
    if (c_status/=0_c_int) exit
    if (message_type==6_c_int32_t) exit
    if (message_type/=3_c_int32_t.or.request_id<=0_c_int64_t) exit
    call matterviz_control_body_to_string(c_body,body_bytes,body)
    call extract_matterviz_command(body,request_id,command,istat)
    if (istat/=0) exit

    sink=matterviz_json_sink()
    sink%buffer=multiwfn_matterviz_control_buffer_create()
    if (sink%buffer<=0_c_intptr_t) exit
    call emit_matterviz_json(sink,"{")
    call emit_matterviz_json(sink,'  "format": "multiwfn-matterviz-control",')
    call emit_matterviz_json(sink,'  "version": 1,')
    call emit_matterviz_json(sink,'  "kind": "response",')
    write(line,"(a,i0,a)") '  "request_id": ',request_id,','
    call emit_matterviz_json(sink,line)
    call emit_matterviz_json(sink,'  "result":')
    read(command,*,iostat=istat) action
    if (istat==0.and.trim(action)=="orbital") then
        read(command,*,iostat=istat) action,iorb,quality,isoval
        if (istat==0) then
            call handle_orbital_request(session,sink,int(request_id,8),iorb,quality,isoval)
        else
            call write_gui_json_error(sink,"Malformed orbital request")
        end if
    else if (istat==0.and.trim(action)=="bond") then
        read(command,*,iostat=istat) action,iatm1,iatm2,method
        if (istat==0) then
            call handle_bond_request(sink,iatm1,iatm2,trim(method))
        else
            call write_gui_json_error(sink,"Malformed bond request")
        end if
    else if (istat==0.and.trim(action)=="esp") then
        read(command,*,iostat=istat) action,quality,isoval
        if (istat==0) then
            call handle_esp_request(session,sink,int(request_id,8),quality,isoval)
        else
            call write_gui_json_error(sink,"Malformed ESP request")
        end if
    else
        call write_gui_json_error(sink,"Unknown GUI request")
    end if
    call emit_matterviz_json(sink,"}")
    if (sink%status==0) then
        c_status=multiwfn_matterviz_control_buffer_send(sink%buffer,gui_response_write, &
            4_c_int32_t,request_id,30000_c_int32_t)
    else
        c_status=int(sink%status,c_int)
    end if
    call multiwfn_matterviz_control_buffer_destroy(sink%buffer)
    if (c_status/=0_c_int) exit
end do
call close_matterviz_transport()
end subroutine

subroutine matterviz_control_body_to_string(c_body,body_bytes,body)
character(kind=c_char),intent(in) :: c_body(*)
integer(c_int64_t),intent(in) :: body_bytes
character(len=*),intent(out) :: body
integer :: i,count

body=""
count=min(len(body),int(body_bytes))
do i=1,count
    body(i:i)=achar(iachar(c_body(i)))
end do
end subroutine

subroutine extract_matterviz_command(body,request_id,command,status)
character(len=*),intent(in) :: body
integer(c_int64_t),intent(in) :: request_id
character(len=*),intent(out) :: command
integer,intent(out) :: status
character(len=*),parameter :: marker='"command":"'
integer :: first,last
character(len=len(body)) :: expected

command=""
status=1
first=index(body,marker)
if (first<=0) return
first=first+len(marker)
last=index(body(first:),'"')
if (last<=1.or.last-1>len(command)) return
command=body(first:first+last-2)
write(expected,"(a,i0,3a)") &
    '{"format":"multiwfn-matterviz-control","version":1,"kind":"request","request_id":', &
    request_id,',"command":"',trim(command),'"}'
if (trim(body)/=trim(expected)) return
status=0
end subroutine

subroutine publish_matterviz_initial_volumes(entry,status)
character(len=*),intent(in) :: entry
integer,intent(out) :: status
integer :: volume_status
logical :: published

status=0
if (allocated(cubmat).and.trim(entry)/="drawmolgui") then
    published=publish_matterviz_volume(cubmat,1_8,4,4,gui_cubmat_volume_id,1,volume_status)
    if (.not.published) then
        status=volume_status
        return
    end if
end if
if (allocated(cubmattmp)) then
    published=publish_matterviz_volume(cubmattmp,2_8,4,4,gui_cubmattmp_volume_id,1,volume_status)
    if (.not.published) status=volume_status
end if
end subroutine

subroutine send_matterviz_session_init(entry,mode,extra,init1,end1,init2,end2,init3,end3,status)
character(len=*),intent(in) :: entry
integer,intent(in) :: mode,extra
real*8,intent(in) :: init1,end1,init2,end2,init3,end3
integer,intent(out) :: status
type(matterviz_json_sink) :: sink
integer(c_int) :: c_status

status=-1
sink%buffer=multiwfn_matterviz_control_buffer_create()
if (sink%buffer<=0_c_intptr_t) return
call emit_matterviz_json(sink,"{")
call emit_matterviz_json(sink,'  "format": "multiwfn-matterviz-control",')
call emit_matterviz_json(sink,'  "version": 1,')
call emit_matterviz_json(sink,'  "kind": "session_init",')
call emit_matterviz_json(sink,'  "manifest":')
call emit_manifest_json(sink,entry,mode,extra,init1,end1,init2,end2,init3,end3)
call emit_matterviz_json(sink,',')
call emit_matterviz_json(sink,'  "structure":')
if (allocated(a).and.ncenter>0) then
    call emit_structure_json(sink)
else
    call emit_matterviz_json(sink,"null")
end if
call emit_matterviz_json(sink,',')
call emit_matterviz_json(sink,'  "state": null')
call emit_matterviz_json(sink,"}")
if (sink%status==0) then
    c_status=multiwfn_matterviz_control_buffer_send(sink%buffer,gui_response_write, &
        2_c_int32_t,0_c_int64_t,30000_c_int32_t)
    status=int(c_status)
else
    status=sink%status
end if
call multiwfn_matterviz_control_buffer_destroy(sink%buffer)
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
integer :: iu,ifound,ierror,mxbond,nval,i,k,k2,idx,idx2,j,itype,reciprocal_type,iedge,candidate_bond_count
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
candidate_bond_count=0
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
        if (i<j) candidate_bond_count=candidate_bond_count+1
    end do
    if (.not.valid) exit
end do
if (.not.valid) goto 900

allocate(gui_bond_atom1(candidate_bond_count),gui_bond_atom2(candidate_bond_count),gui_bond_order(candidate_bond_count))
gui_bond_count=candidate_bond_count
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
write(*,"(' MatterViz GUI loaded',i8,' explicit bonds from formatted checkpoint connectivity')") gui_bond_count

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

subroutine get_session_identity(session,ok)
character(len=*),intent(out) :: session
logical,intent(out) :: ok
character(len=512) :: requested
integer :: istat,values(8)
integer*8 :: clock_count

session=""
ok=.false.
requested=""
call get_environment_variable("MULTIWFN_MATTERVIZ_SESSION",requested,status=istat)
if (istat==2) then
    write(*,"(/,a)") " MatterViz GUI backend: session identity exceeds the 512-character limit."
    return
else if (istat==0.and.len_trim(requested)>0) then
    session=trim(requested)
else
    call date_and_time(values=values)
    call system_clock(clock_count)
    gui_session_serial=gui_session_serial+1
    write(session,"('multiwfn_matterviz_memory_',i4.4,2i2.2,'_',3i2.2,'.',i3.3,'_',i0,'_',i0)") &
        values(1),values(2),values(3),values(5),values(6),values(7),values(8), &
        clock_count,gui_session_serial
end if
ok=len_trim(session)>0
end subroutine

subroutine get_session_dir(session,ok)
character(len=*),intent(out) :: session
logical,intent(out) :: ok
integer :: istat
character(len=512) :: requested

session=" "
ok=.false.
requested=" "
call get_environment_variable("MULTIWFN_MATTERVIZ_SESSION",requested,status=istat)
if (istat==2) then
    write(*,"(/,a)") " MatterViz GUI backend: session path exceeds the 512-character path limit."
    return
else if (istat==0.and.len_trim(requested)>0) then
    session=trim(requested)
    call ensure_dir(trim(session),ok)
else
    call create_default_session_dir(session,ok)
end if

if (.not.ok) then
    write(*,"(/,a)") " MatterViz GUI backend: unable to create the requested session directory."
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
    write(candidate,"('multiwfn_matterviz_session_',i4.4,2i2.2,'_',3i2.2,'.',i3.3,'_',i0,'_',i0,'_',i0)") &
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
call get_environment_variable("MULTIWFN_MATTERVIZ_ORBITAL_PREVIEW",env,status=istat)
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

subroutine run_matterviz_gui_loop(session)
character(len=*),intent(in) :: session
character(len=1024) :: reqfile,stopfile,respfile,line
character(len=32) :: action,method
integer :: iu,istat,iorb,quality,iatm1,iatm2
integer*8 :: reqid,lastid
real*8 :: isoval
logical :: alive
type(matterviz_json_sink) :: sink

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
                open(newunit=iu,file=trim(respfile),status="replace",action="write",iostat=istat)
                if (istat/=0) cycle
                sink=matterviz_json_sink(unit=iu)
                if (trim(action)=="orbital") then
                    read(line,*,iostat=istat) reqid,action,iorb,quality,isoval
                    if (istat==0) then
                        call handle_orbital_request(trim(session),sink,reqid,iorb,quality,isoval)
                    else
                        call write_gui_json_error(sink,"Malformed orbital request")
                    end if
                else if (trim(action)=="bond") then
                    read(line,*,iostat=istat) reqid,action,iatm1,iatm2,method
                    if (istat==0) then
                        call handle_bond_request(sink,iatm1,iatm2,trim(method))
                    else
                        call write_gui_json_error(sink,"Malformed bond request")
                    end if
                else if (trim(action)=="esp") then
                    read(line,*,iostat=istat) reqid,action,quality,isoval
                    if (istat==0) then
                        call handle_esp_request(trim(session),sink,reqid,quality,isoval)
                    else
                        call write_gui_json_error(sink,"Malformed ESP request")
                    end if
                else
                    call write_gui_json_error(sink,"Unknown GUI request")
                end if
                close(iu)
                lastid=reqid
            end if
        end if
    end if
    call sleep(1)
end do
call close_matterviz_transport()
end subroutine

subroutine handle_orbital_request(session,sink,reqid,iorb,quality,isoval)
character(len=*),intent(in) :: session
type(matterviz_json_sink),intent(inout) :: sink
integer*8,intent(in) :: reqid
integer,intent(in) :: iorb,quality
real*8,intent(in) :: isoval
character(len=512) :: cubefile,cuberel,layerpath
integer :: functype,orbtotal,volume_status
integer*8 :: volume_id
logical :: native_volume,allow_cube
character(len=1024) :: line

orbtotal=gui_orbital_total()
if (iorb<0.or.iorb>orbtotal) then
    call write_gui_json_error(sink,"Orbital index out of range")
    return
end if

if (quality>0) nprevorbgrid=quality
if (isoval>0D0) sur_value_orb=isoval
iorbvis=iorb

if (iorb==0) then
    idrawisosur=0
    if (allocated(cubmat)) deallocate(cubmat)
    call emit_matterviz_json(sink,'{ "ok": true, "clear": true }')
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

if (functype==44) then
    native_volume=publish_matterviz_volume(cubmat,reqid,2,2,volume_id,2,volume_status)
else
    native_volume=publish_matterviz_volume(cubmat,reqid,1,1,volume_id,2,volume_status)
end if
if (native_volume) then
    write(layerpath,"('/api/volume/',i0)") volume_id
else
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
    allow_cube=.true.
#else
    allow_cube=matterviz_cube_fallback_enabled()
#endif
    if (allow_cube) then
        write(cuberel,"('orbital_',i0,'_',i0,'.cube')") iorb,nprevorbgrid
        cubefile=trim(session)//"/"//trim(cuberel)
        call write_cube(trim(cubefile),cubmat)
        layerpath=trim(cuberel)
    else
        if (volume_status==-1005) then
            call write_gui_json_error(sink,"MatterViz rejected the volume request; reduce grid size or retry")
        else
            call write_gui_json_error(sink,"MatterViz v2 volume transport failed; reopen menu 0")
        end if
        return
    end if
end if

call emit_matterviz_json(sink,"{")
call emit_matterviz_json(sink,'  "ok": true,')
write(line,"(a,i0,a)") '  "orbitalIndex": ',iorb,','
call emit_matterviz_json(sink,line)
write(line,"(a,i0,a)") '  "quality": ',nprevorbgrid,','
call emit_matterviz_json(sink,line)
write(line,"(a,1pe16.8,a)") '  "isovalue": ',sur_value_orb,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'  "layer": {')
write(line,"(a,i0,a)") '    "name": "Orbital ',iorb,'",'
call emit_matterviz_json(sink,line)
write(line,"(a,a,a)") '    "path": "',trim(layerpath),'",'
call emit_matterviz_json(sink,line)
if (native_volume) call emit_matterviz_json(sink,'    "format": "mwfn-volume-v2",')
call emit_matterviz_json(sink,'    "role": "orbital",')
write(line,"(a,i0,a)") '    "orbitalIndex": ',iorb,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "mode": "signed",')
write(line,"(a,1pe16.8,a)") '    "isovalue": ',sur_value_orb,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "visible": true')
call emit_matterviz_json(sink,'  }')
call emit_matterviz_json(sink,"}")
end subroutine

subroutine handle_esp_request(session,sink,reqid,quality,isoval)
character(len=*),intent(in) :: session
type(matterviz_json_sink),intent(inout) :: sink
integer*8,intent(in) :: reqid
integer,intent(in) :: quality
real*8,intent(in) :: isoval
character(len=512) :: densityfile,densityrel,espfile,esprel,densitypath,esppath
integer :: nprevorbgrid_org,nx_org,ny_org,nz_org,iorbsel_org,density_status,potential_status
integer*8 :: density_volume_id,esp_volume_id
real*8 :: esprhoiso_org,orgx_org,orgy_org,orgz_org,endx_org,endy_org,endz_org
real*8 :: dx_org,dy_org,dz_org,gridv1_org(3),gridv2_org(3),gridv3_org(3)
real*8 :: nelec_org,naelec_org,nbelec_org
real*8,allocatable :: cubmat_org(:,:,:),densitymat(:,:,:)
logical :: cubmat_was_allocated,density_native,potential_native,native_pair,allow_cube
character(len=1024) :: line

if (ifPBC>0) then
    call write_gui_json_error(sink,"ESP visualization is not supported for periodic systems")
    return
end if
if (.not.allocated(a).or.ncenter<=0.or..not.allocated(b).or.nprims<=0.or. &
    .not.allocated(CO).or.nmo<=0) then
    call write_gui_json_error(sink,"Wavefunction and GTF information is unavailable for ESP calculation")
    return
end if
if (quality<25000.or.quality>1500000) then
    call write_gui_json_error(sink,"ESP grid quality is out of range")
    return
end if
if (isoval<=0D0.or.isoval>0.1D0) then
    call write_gui_json_error(sink,"ESP density isovalue is out of range")
    return
end if
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
allow_cube=.true.
#else
allow_cube=matterviz_cube_fallback_enabled()
#endif
density_status=-1
potential_status=-1

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

    density_native=publish_matterviz_volume(cubmat,reqid,2,2,density_volume_id,1,density_status)
if (density_native) then
    allocate(densitymat(nx,ny,nz))
    densitymat=cubmat
else
    if (allow_cube) then
        write(densityrel,"('esp_density_',i0,'.cube')") quality
        densityfile=trim(session)//"/"//trim(densityrel)
        call write_cube(trim(densityfile),cubmat)
        densitypath=trim(densityrel)
    end if
end if

ESPrhoiso=isoval
call savecubmat(12,1,0)

potential_native=.false.
if (density_native) then
    potential_native=publish_matterviz_volume(cubmat,reqid,3,3,esp_volume_id,1,potential_status)
end if
native_pair=density_native.and.potential_native
if (native_pair) then
    write(densitypath,"('/api/volume/',i0)") density_volume_id
    write(esppath,"('/api/volume/',i0)") esp_volume_id
else if (allow_cube) then
    if (density_native) then
        write(densityrel,"('esp_density_',i0,'.cube')") quality
        densityfile=trim(session)//"/"//trim(densityrel)
        call write_cube(trim(densityfile),densitymat)
        densitypath=trim(densityrel)
    end if
    write(esprel,"('esp_potential_',i0,'.cube')") quality
    espfile=trim(session)//"/"//trim(esprel)
    call write_cube(trim(espfile),cubmat)
    esppath=trim(esprel)
end if
if (allocated(densitymat)) deallocate(densitymat)

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

if (.not.native_pair.and..not.allow_cube) then
    if (density_status==-1005.or.potential_status==-1005) then
        call write_gui_json_error(sink,"MatterViz rejected the ESP volume request; reduce grid size or retry")
    else
        call write_gui_json_error(sink,"MatterViz ESP volume transport failed; reopen menu 0")
    end if
    return
end if

call emit_matterviz_json(sink,"{")
call emit_matterviz_json(sink,'  "ok": true,')
write(line,"(a,i0,a)") '  "quality": ',quality,','
call emit_matterviz_json(sink,line)
write(line,"(a,es24.16,a)") '  "isovalue": ',isoval,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'  "densityLayer": {')
call emit_matterviz_json(sink,'    "name": "ESP on electron density",')
write(line,"(a,a,a)") '    "path": "',trim(densitypath),'",'
call emit_matterviz_json(sink,line)
if (native_pair) call emit_matterviz_json(sink,'    "format": "mwfn-volume-v1",')
call emit_matterviz_json(sink,'    "role": "density",')
call emit_matterviz_json(sink,'    "analysisKind": "esp-density",')
write(line,"(a,i0,a)") '    "gridQuality": ',quality,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "mode": "positive",')
write(line,"(a,es24.16,a)") '    "isovalue": ',isoval,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "opacity": 0.88,')
call emit_matterviz_json(sink,'    "visible": true')
call emit_matterviz_json(sink,'  },')
call emit_matterviz_json(sink,'  "espLayer": {')
call emit_matterviz_json(sink,'    "name": "Electrostatic potential",')
write(line,"(a,a,a)") '    "path": "',trim(esppath),'",'
call emit_matterviz_json(sink,line)
if (native_pair) call emit_matterviz_json(sink,'    "format": "mwfn-volume-v1",')
call emit_matterviz_json(sink,'    "role": "esp",')
call emit_matterviz_json(sink,'    "analysisKind": "esp-potential",')
write(line,"(a,i0,a)") '    "gridQuality": ',quality,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "mode": "signed",')
call emit_matterviz_json(sink,'    "isovalue": 0.02,')
call emit_matterviz_json(sink,'    "visible": false')
call emit_matterviz_json(sink,'  }')
call emit_matterviz_json(sink,"}")
end subroutine

subroutine handle_bond_request(sink,iatm1,iatm2,method)
type(matterviz_json_sink),intent(inout) :: sink
character(len=*),intent(in) :: method
integer,intent(in) :: iatm1,iatm2
integer :: ierror,radpot_org,sphpot_org
real*8 :: value,total,alpha,beta,mixed
logical :: openshell
character(len=1024) :: line

if (iatm1<1.or.iatm1>ncenter.or.iatm2<1.or.iatm2>ncenter.or.iatm1==iatm2) then
    call write_gui_json_error(sink,"Invalid atom indices")
    return
end if
if (ifPBC>0) then
    call write_gui_json_error(sink,"Periodic bond-order calculations are not supported")
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
        call write_gui_json_error(sink,"GWBO is only distinct for open-shell wavefunctions")
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
        call write_gui_json_error(sink,"GTF wavefunction information is unavailable")
        return
    end if
    if (.not.gui_fbo_ready) then
        radpot_org=radpot
        sphpot_org=sphpot
        call fuzzyana(11)
        radpot=radpot_org
        sphpot=sphpot_org
        if (.not.allocated(bndordmat)) then
            call write_gui_json_error(sink,"FBO calculation did not return a result")
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
    call write_gui_json_error(sink,"Unsupported bond-order method")
    return
end if

if (ierror/=0) then
    if (ierror==3) then
        call write_gui_json_error(sink,"Selected atom has no basis functions")
    else
        call write_gui_json_error(sink,"Basis-function and density information is unavailable")
    end if
    return
end if

call emit_matterviz_json(sink,"{")
call emit_matterviz_json(sink,'  "ok": true,')
write(line,"(a,i0,a,i0,a)") '  "bond": { "atom1": ',iatm1,', "atom2": ',iatm2,' },'
call emit_matterviz_json(sink,line)
write(line,"(a,a,a)") '  "method": "',trim(method),'",'
call emit_matterviz_json(sink,line)
write(line,"(a,es24.16,a)") '  "value": ',value,','
call emit_matterviz_json(sink,line)
if (openshell.and.(method=="mayer".or.method=="gwbo")) then
    write(line,"(a,es24.16,a,es24.16,a,es24.16,a,es24.16,a)") &
        '  "components": { "alpha": ',alpha,', "beta": ',beta,', "total": ',total,', "gwbo": ',mixed,' }'
else if (openshell.and.method=="wiberg_lowdin") then
    write(line,"(a,es24.16,a,es24.16,a,es24.16,a,es24.16,a)") &
        '  "components": { "alpha": ',alpha,', "beta": ',beta,', "total": ',total,', "mixed": ',mixed,' }'
else if (openshell.and.method=="mulliken") then
    write(line,"(a,es24.16,a,es24.16,a,es24.16,a)") &
        '  "components": { "alpha": ',alpha,', "beta": ',beta,', "total": ',total,' }'
else
    write(line,"(a,es24.16,a)") '  "components": { "total": ',total,' }'
end if
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,"}")
end subroutine

subroutine write_gui_json_error(sink,message)
type(matterviz_json_sink),intent(inout) :: sink
character(len=*),intent(in) :: message
character(len=1024) :: line
write(line,"(a,a,a)") '{ "ok": false, "message": "',trim(message),'" }'
call emit_matterviz_json(sink,line)
end subroutine

subroutine write_orbital_cube(session,idx,data)
character(len=*),intent(in) :: session
integer,intent(in) :: idx
real*8,intent(in) :: data(:,:,:)
character(len=512) :: path

write(path,"(a,'/orb',i6.6,'.cube')") trim(session),idx
call write_cube(trim(path),data)
end subroutine

subroutine resolve_matterviz_launch_paths(frontend,native)
character(len=*),intent(out) :: frontend,native
character(len=512) :: home

call get_matterviz_home(home)
call resolve_resource_path(home,"frontend/matterviz-viewer/dist",frontend)
call resolve_matterviz_desktop_launcher(home,native)
end subroutine

subroutine launch_matterviz_native(native,frontend,session,manifest,launch_status,transport_error)
character(len=*),intent(in) :: native,frontend,session,manifest
integer,intent(out) :: launch_status,transport_error
character(kind=c_char),allocatable :: c_native(:),c_frontend(:),c_session(:),c_manifest(:)
integer(c_int) :: c_status,c_transport_error

call matterviz_c_string(native,c_native)
call matterviz_c_string(frontend,c_frontend)
call matterviz_c_string(session,c_session)
call matterviz_c_string(manifest,c_manifest)
c_status=multiwfn_matterviz_spawn(c_native,c_frontend,c_session,c_manifest, &
    gui_volume_write,gui_ack_read,gui_request_read,gui_response_write,c_transport_error)
launch_status=int(c_status)
transport_error=int(c_transport_error)
deallocate(c_native,c_frontend,c_session,c_manifest)
end subroutine

subroutine matterviz_c_string(value,c_value)
character(len=*),intent(in) :: value
character(kind=c_char),allocatable,intent(out) :: c_value(:)
integer :: idx,length

length=len_trim(value)
allocate(c_value(length+1))
do idx=1,length
    c_value(idx)=char(iachar(value(idx:idx)),kind=c_char)
end do
c_value(length+1)=c_null_char
end subroutine

subroutine close_matterviz_transport()
call multiwfn_matterviz_transport_close(gui_volume_write,gui_ack_read)
call multiwfn_matterviz_control_close(gui_request_read,gui_response_write)
end subroutine

logical function publish_matterviz_volume(data,reqid,quantity_kind,value_unit,volume_id,protocol_major,status_out)
real*8,intent(in) :: data(:,:,:)
integer*8,intent(in) :: reqid
integer,intent(in) :: quantity_kind,value_unit,protocol_major
integer*8,intent(out) :: volume_id
integer,intent(out) :: status_out
real(c_double) :: origin(3),voxel_axes(9),lattice(9)
integer(c_int32_t) :: periodic_axes
integer(c_int64_t) :: sample_count
integer(c_int32_t) :: data_nx,data_ny,data_nz

publish_matterviz_volume=.false.
volume_id=-1
status_out=-1001
if (gui_volume_write<0_c_intptr_t.or.gui_ack_read<0_c_intptr_t) return
if (reqid<=0) return
data_nx=int(size(data,1),c_int32_t)
data_ny=int(size(data,2),c_int32_t)
data_nz=int(size(data,3),c_int32_t)
if (ifPBC==1.or.ifPBC==2) then
    call close_matterviz_transport()
    return
end if

gui_volume_serial=gui_volume_serial+1_c_int64_t
if (gui_volume_serial<=0_c_int64_t) then
    call close_matterviz_transport()
    return
end if
volume_id=int(gui_volume_serial,kind=8)
origin=[real(orgx,c_double),real(orgy,c_double),real(orgz,c_double)]
voxel_axes=[real(gridv1(1),c_double),real(gridv1(2),c_double),real(gridv1(3),c_double), &
    real(gridv2(1),c_double),real(gridv2(2),c_double),real(gridv2(3),c_double), &
    real(gridv3(1),c_double),real(gridv3(2),c_double),real(gridv3(3),c_double)]
if (ifPBC==3) then
    periodic_axes=7_c_int32_t
    lattice=[real(cellv1(1),c_double),real(cellv1(2),c_double),real(cellv1(3),c_double), &
        real(cellv2(1),c_double),real(cellv2(2),c_double),real(cellv2(3),c_double), &
        real(cellv3(1),c_double),real(cellv3(2),c_double),real(cellv3(3),c_double)]
else
    periodic_axes=0_c_int32_t
    lattice=[real(gridv1(1)*data_nx,c_double),real(gridv1(2)*data_nx,c_double), &
        real(gridv1(3)*data_nx,c_double),real(gridv2(1)*data_ny,c_double), &
        real(gridv2(2)*data_ny,c_double),real(gridv2(3)*data_ny,c_double), &
        real(gridv3(1)*data_nz,c_double),real(gridv3(2)*data_nz,c_double), &
        real(gridv3(3)*data_nz,c_double)]
end if
sample_count=int(data_nx,c_int64_t)*int(data_ny,c_int64_t)*int(data_nz,c_int64_t)
if (protocol_major==2) then
    status_out=multiwfn_matterviz_publish_volume_stream(gui_volume_write,gui_ack_read, &
        int(reqid,c_int64_t),gui_volume_serial,data_nx,data_ny,data_nz, &
        1_c_int32_t,periodic_axes,1_c_int32_t, &
        int(quantity_kind,c_int32_t),int(value_unit,c_int32_t),origin,voxel_axes,lattice, &
        data,sample_count,300000_c_int32_t)
else
    status_out=multiwfn_matterviz_publish_volume(gui_volume_write,gui_ack_read, &
        int(reqid,c_int64_t),gui_volume_serial,data_nx,data_ny,data_nz, &
        1_c_int32_t,periodic_axes,1_c_int32_t, &
        int(quantity_kind,c_int32_t),int(value_unit,c_int32_t),origin,voxel_axes,lattice, &
        data,sample_count,30000_c_int32_t)
end if
if (status_out/=0) then
    write(*,"(a,i0,a)") " MatterViz binary volume publish failed (",status_out,")"
    ! A consumer-side memory/admission rejection is request-local. Protocol,
    ! pipe and timeout failures invalidate the transport for this session.
    if (status_out/=-1005) call close_matterviz_transport()
    return
end if
publish_matterviz_volume=.true.
end function

subroutine build_launch_command(manifest,session,cmd)
character(len=*),intent(in) :: manifest,session
character(len=*),intent(out) :: cmd
character(len=512) :: home,frontend,native
character(len=1024) :: launchcmd
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
character(len=512) :: python,tool,shell
integer :: istat
#endif

call get_matterviz_home(home)
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
call resolve_resource_path(home,"frontend/3dmol-viewer",frontend)
#else
call resolve_resource_path(home,"frontend/matterviz-viewer/dist",frontend)
call resolve_matterviz_desktop_launcher(home,native)
launchcmd='"'//trim(native)//'" --frontend "'//trim(frontend)// &
    '" --session "'//trim(session)//'" --manifest "'//trim(manifest)//'"'
cmd=trim(launchcmd)
return
#endif
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
#ifdef MULTIWFN_MATTERVIZ_DEFAULT_SHELL_QT
shell="qt"
#elif defined(MULTIWFN_MATTERVIZ_DEFAULT_SHELL_WEBVIEW)
shell="webview"
#else
shell="browser"
#endif
call get_environment_variable("MULTIWFN_MATTERVIZ_SHELL",shell,status=istat)
if (istat/=0.or.len_trim(shell)==0) then
#ifdef MULTIWFN_MATTERVIZ_DEFAULT_SHELL_QT
    shell="qt"
#elif defined(MULTIWFN_MATTERVIZ_DEFAULT_SHELL_WEBVIEW)
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
    call resolve_resource_path(home,"tools/multiwfn_matterviz_server.py",tool)
end if

#ifdef MULTIWFN_WINDOWS
python="python"
#else
python="python3"
#endif
call get_environment_variable("MULTIWFN_MATTERVIZ_PYTHON",python,status=istat)
if (istat/=0.or.len_trim(python)==0) then
#ifdef MULTIWFN_WINDOWS
    python="python"
#else
    python="python3"
#endif
end if

if (trim(shell)=="qt") then
    launchcmd='"'//trim(python)//'" "'//trim(tool)//'" --manifest "'//trim(manifest)//'" --frontend "'//trim(frontend)//'"'
else if (trim(shell)=="webview") then
    launchcmd='"'//trim(python)//'" "'//trim(tool)//'" --frontend "'//trim(frontend)// &
        '" --session "'//trim(session)//'" --manifest "'//trim(manifest)//'"'
else
    launchcmd='"'//trim(python)//'" "'//trim(tool)//'" --frontend "'//trim(frontend)// &
        '" --session "'//trim(session)//'" --manifest "'//trim(manifest)//'" --open'
end if
cmd=trim(launchcmd)
#endif
end subroutine

integer function launch_matterviz_process(command)
use iso_c_binding, only: c_char,c_int,c_null_char
character(len=*),intent(in) :: command
character(kind=c_char),allocatable :: c_command(:)
integer :: idx,length
interface
    integer(c_int) function multiwfn_spawn_async(command_arg) bind(C,name="multiwfn_spawn_async")
    import :: c_char,c_int
    character(kind=c_char),intent(in) :: command_arg(*)
    end function
end interface

length=len_trim(command)
allocate(c_command(length+1))
do idx=1,length
    c_command(idx)=char(iachar(command(idx:idx)),kind=c_char)
end do
c_command(length+1)=c_null_char
launch_matterviz_process=int(multiwfn_spawn_async(c_command))
deallocate(c_command)
end function

subroutine resolve_native_qt_launcher(home,native)
character(len=*),intent(in) :: home
character(len=*),intent(out) :: native

call resolve_resource_path(home,"tools/multiwfn_qt_gui.exe",native)
if (path_exists(native)) return
call resolve_resource_path(home,"tools/multiwfn_qt_gui",native)
end subroutine

subroutine resolve_matterviz_desktop_launcher(home,native)
character(len=*),intent(in) :: home
character(len=*),intent(out) :: native

call resolve_resource_path(home,"tools/matterviz-desktop.exe",native)
if (path_exists(native)) return
call resolve_resource_path(home,"tools/matterviz-desktop",native)
end subroutine

logical function path_exists(path)
character(len=*),intent(in) :: path
inquire(file=trim(path),exist=path_exists)
end function

subroutine select_file_with_dialog(selected)
character(len=*),intent(out) :: selected
character(len=512) :: home,native
#ifdef MULTIWFN_LEGACY_3DMOL_BACKEND
character(len=512) :: session,outfile,cmd
integer :: istat,iu
logical :: session_ok
character(len=512) :: python,tool
#else
character(kind=c_char),allocatable :: c_native(:)
character(kind=c_char) :: c_result(len(selected)+1)
integer(c_int) :: c_status
integer(c_int32_t) :: picker_status
integer(c_int64_t) :: result_bytes
integer :: idx,result_count
#endif

selected=" "
call get_matterviz_home(home)

#ifndef MULTIWFN_LEGACY_3DMOL_BACKEND
call resolve_matterviz_desktop_launcher(home,native)
if (.not.path_exists(native)) return
! Launch the Rust file chooser and receive its versioned result directly over an inherited pipe.
call matterviz_c_string(native,c_native)
c_result=c_null_char
c_status=multiwfn_matterviz_select_file(c_native,c_result, &
    int(size(c_result),c_int64_t),result_bytes,picker_status)
deallocate(c_native)
if (c_status/=0_c_int) return
if (picker_status/=1_c_int32_t.or.result_bytes<=0_c_int64_t) return
result_count=min(len(selected),int(result_bytes))
do idx=1,result_count
    selected(idx:idx)=achar(iachar(c_result(idx)))
end do
return
#else
call get_session_dir(session,session_ok)
if (.not.session_ok) return
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

#ifdef MULTIWFN_WINDOWS
python="python"
#else
python="python3"
#endif
call get_environment_variable("MULTIWFN_MATTERVIZ_PYTHON",python,status=istat)
if (istat/=0.or.len_trim(python)==0) then
#ifdef MULTIWFN_WINDOWS
    python="python"
#else
    python="python3"
#endif
end if

call resolve_resource_path(home,"tools/multiwfn_matterviz_file_dialog.py",tool)
cmd=trim(python)//' "'//trim(tool)//'" --output "'//trim(outfile)//'"'
call execute_command_line(trim(cmd),exitstat=istat)
if (istat/=0) return

open(newunit=iu,file=trim(outfile),status="old",action="read",iostat=istat)
if (istat/=0) return
read(iu,"(a)",iostat=istat) selected
close(iu)
if (istat/=0) selected=" "
#endif
end subroutine

subroutine get_matterviz_home(home)
character(len=*),intent(out) :: home
character(len=512) :: exe,dir,base
integer :: istat

home="."
call get_environment_variable("MULTIWFN_MATTERVIZ_HOME",home,status=istat)
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

subroutine write_structure_json(path)
character(len=*),intent(in) :: path
integer :: iu
type(matterviz_json_sink) :: sink

open(newunit=iu,file=trim(path),status="replace",action="write")
sink%unit=iu
call emit_structure_json(sink)
close(iu)
end subroutine

subroutine emit_structure_json(sink)
type(matterviz_json_sink),intent(inout) :: sink
integer :: i,ibond
character(len=2) :: element
character(len=24) :: label
character(len=1024) :: line

call emit_matterviz_json(sink,"{")
call emit_matterviz_json(sink,'  "sites": [')
do i=1,ncenter
    if (i>1) call emit_matterviz_json(sink,",")
    element=ind2name(a(i)%index)
    write(label,"(a,i0)") trim(element),i
    write(line,"(a,a,a)") '    { "species": [{ "element": "',trim(element), &
        '", "occu": 1, "oxidation_state": 0 }],'
    call emit_matterviz_json(sink,line)
    call emit_matterviz_json(sink,'      "abc": [0, 0, 0],')
    write(line,"(a,3(1pe20.12,a))") '      "xyz": [',a(i)%x*b2a,',',a(i)%y*b2a,',',a(i)%z*b2a,'],'
    call emit_matterviz_json(sink,line)
    write(line,"(a,a,a)") '      "label": "',trim(label),'",'
    call emit_matterviz_json(sink,line)
    if (a(i)%index==0) then
        call emit_matterviz_json(sink,'      "properties": { "multiwfnGhost": true } }')
    else
        call emit_matterviz_json(sink,'      "properties": {} }')
    end if
end do
call emit_matterviz_json(sink,"  ],")
call emit_matterviz_json(sink,'  "charge": 0,')
call emit_matterviz_json(sink,'  "properties": { "bonds": [')
do ibond=1,gui_bond_count
    if (ibond>1) call emit_matterviz_json(sink,",")
    if (gui_bond_order(ibond)==4) then
        write(line,"(a,i0,a,i0,a)") '    { "site_idx_1": ',gui_bond_atom1(ibond)-1, &
            ', "site_idx_2": ',gui_bond_atom2(ibond)-1,', "order": "aromatic" }'
    else
        write(line,"(a,i0,a,i0,a,i0,a)") '    { "site_idx_1": ',gui_bond_atom1(ibond)-1, &
            ', "site_idx_2": ',gui_bond_atom2(ibond)-1,', "order": ',gui_bond_order(ibond),' }'
    end if
    call emit_matterviz_json(sink,line)
end do
call emit_matterviz_json(sink,"  ] }")
call emit_matterviz_json(sink,"}")
end subroutine

subroutine write_cube(path,data)
character(len=*),intent(in) :: path
real*8,intent(in) :: data(:,:,:)
integer :: iu,i,j,k,nline

open(newunit=iu,file=trim(path),status="replace",action="write")
write(iu,"(a)") "Generated by Multiwfn MatterViz GUI backend"
write(iu,"(a)") "Grid values exported from current Multiwfn memory"
! Positive voxel counts in Gaussian cube files declare coordinates in Bohr.
! Keep the grid and embedded atoms in Multiwfn's native Bohr coordinates;
! MatterViz converts them to Angstrom when parsing the cube.
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
integer :: iu
type(matterviz_json_sink) :: sink

open(newunit=iu,file=trim(path),status="replace",action="write")
sink%unit=iu
call emit_manifest_json(sink,entry,mode,extra,init1,end1,init2,end2,init3,end3)
close(iu)
end subroutine

subroutine emit_manifest_json(sink,entry,mode,extra,init1,end1,init2,end2,init3,end3)
type(matterviz_json_sink),intent(inout) :: sink
character(len=*),intent(in) :: entry
integer,intent(in) :: mode,extra
real*8,intent(in) :: init1,end1,init2,end2,init3,end3
integer :: ncube,orbtotal,homo
character(len=1024) :: line

orbtotal=gui_orbital_total()
homo=gui_homo_index()
call emit_matterviz_json(sink,"{")
call emit_matterviz_json(sink,'  "format": "multiwfn-matterviz-workbench",')
call emit_matterviz_json(sink,'  "version": 2,')
call emit_matterviz_json(sink,'  "generatedBy": "Multiwfn_MatterViz",')
call emit_matterviz_json(sink,'  "multiwfnGui": {')
write(line,"(a,a,a)") '    "entry": "',trim(entry),'",'
call emit_matterviz_json(sink,line)
write(line,"(a,i0,a)") '    "guiMode": ',mode,','
call emit_matterviz_json(sink,line)
write(line,"(a,i0,a)") '    "allowSetStyle": ',extra,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "state": {')
write(line,"(a,1pe16.8,a)") '      "sur_value": ',sur_value,','
call emit_matterviz_json(sink,line)
write(line,"(a,1pe16.8,a)") '      "sur_value_orb": ',sur_value_orb,','
call emit_matterviz_json(sink,line)
write(line,"(a,i0,a)") '      "orbitalCount": ',orbtotal,','
call emit_matterviz_json(sink,line)
write(line,"(a,i0,a)") '      "homoIndex": ',homo,','
call emit_matterviz_json(sink,line)
write(line,"(a,a,a)") '      "showMolecule": ',trim(json_bool(idrawmol/=0)),','
call emit_matterviz_json(sink,line)
write(line,"(a,a,a)") '      "showBothSign": ',trim(json_bool(isosurshowboth/=0)),','
call emit_matterviz_json(sink,line)
write(line,"(a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a,1pe16.8,a)") &
    '      "planeBounds": [',init1,',',end1,',',init2,',',end2,',',init3,',',end3,']'
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    }')
call emit_matterviz_json(sink,'  },')
if (allocated(a).and.ncenter>0) then
    call emit_matterviz_json(sink,'  "structure": { "path": "structure.json", "format": "json" },')
else
    call emit_matterviz_json(sink,'  "structure": null,')
end if
call emit_bond_analysis_manifest(sink)
call emit_esp_analysis_manifest(sink)
if (ifPBC>0) then
    call emit_matterviz_json(sink,'  "periodic": {')
    call emit_matterviz_json(sink,'    "enabled": true,')
    call emit_matterviz_json(sink,'    "showUnitCell": true,')
    call emit_matterviz_json(sink,'    "cell": {')
    write(line,"(a,3(1pe16.8,a))") '      "a": [',cellv1(1)*b2a,',',cellv1(2)*b2a,',',cellv1(3)*b2a,'],'
    call emit_matterviz_json(sink,line)
    write(line,"(a,3(1pe16.8,a))") '      "b": [',cellv2(1)*b2a,',',cellv2(2)*b2a,',',cellv2(3)*b2a,'],'
    call emit_matterviz_json(sink,line)
    write(line,"(a,3(1pe16.8,a))") '      "c": [',cellv3(1)*b2a,',',cellv3(2)*b2a,',',cellv3(3)*b2a,']'
    call emit_matterviz_json(sink,line)
    call emit_matterviz_json(sink,'    }')
    call emit_matterviz_json(sink,'  },')
end if
call emit_orbital_metadata(sink)
call emit_matterviz_json(sink,'  "cubes": [')
ncube=0
if (gui_cubmat_volume_id>0) then
    call emit_native_cube_entry(sink,ncube,"cubmat",gui_cubmat_volume_id,"density",abs(sur_value))
else if (gui_has_cubmat_file) then
    call emit_cube_entry(sink,ncube,"cubmat","cubmat.cube","density",0,abs(sur_value))
end if
if (gui_cubmattmp_volume_id>0) then
    call emit_native_cube_entry(sink,ncube,"cubmattmp",gui_cubmattmp_volume_id,"custom",abs(sur_value))
else if (gui_has_cubmattmp_file) then
    call emit_cube_entry(sink,ncube,"cubmattmp","cubmattmp.cube","custom",0,abs(sur_value))
end if
call emit_orbital_cube_manifest(sink,ncube)
call emit_matterviz_json(sink,'  ]')
call emit_matterviz_json(sink,"}")
end subroutine

subroutine emit_native_cube_entry(sink,ncube,name,volume_id,role,isoval)
type(matterviz_json_sink),intent(inout) :: sink
integer,intent(inout) :: ncube
integer*8,intent(in) :: volume_id
character(len=*),intent(in) :: name,role
real*8,intent(in) :: isoval
character(len=1024) :: line

if (ncube>0) call emit_matterviz_json(sink,",")
ncube=ncube+1
write(line,"(a,a,a,i0,a,a,a,1pe16.8,a)") '    { "name": "',trim(name), &
    '", "path": "/api/volume/',volume_id,'", "format": "mwfn-volume-v1", "role": "', &
    trim(role),'", "mode": "signed", "isovalue": ',isoval,' }'
call emit_matterviz_json(sink,line)
end subroutine

subroutine emit_bond_analysis_manifest(sink)
type(matterviz_json_sink),intent(inout) :: sink
logical :: basisok,fbook,openshell
character(len=96) :: basisreason,fboreason,gwreason
character(len=1024) :: line

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

call emit_matterviz_json(sink,'  "bondAnalysis": {')
call emit_matterviz_json(sink,'    "periodicSupported": false,')
write(line,"(a,a,a)") '    "openShell": ',trim(json_bool(openshell)),','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "methods": {')
call emit_bond_method_capability(sink,"mayer",basisok,basisreason,.true.)
call emit_bond_method_capability(sink,"gwbo",basisok.and.openshell,gwreason,.true.)
call emit_bond_method_capability(sink,"wiberg_lowdin",basisok,basisreason,.true.)
call emit_bond_method_capability(sink,"mulliken",basisok,basisreason,.true.)
call emit_bond_method_capability(sink,"fbo",fbook,fboreason,.false.)
call emit_matterviz_json(sink,'    }')
call emit_matterviz_json(sink,'  },')
end subroutine

subroutine emit_esp_analysis_manifest(sink)
type(matterviz_json_sink),intent(inout) :: sink
logical :: available
character(len=96) :: reason
character(len=1024) :: line

available=ifPBC==0.and.allocated(a).and.ncenter>0.and.allocated(b).and.nprims>0.and. &
    allocated(CO).and.nmo>0
if (ifPBC>0) then
    reason="ESP visualization is not supported for periodic systems"
else
    reason="Wavefunction and GTF information is unavailable for ESP calculation"
end if

call emit_matterviz_json(sink,'  "espAnalysis": {')
call emit_matterviz_json(sink,'    "periodicSupported": false,')
write(line,"(a,a,a)") '    "available": ',trim(json_bool(available)),','
call emit_matterviz_json(sink,line)
if (.not.available) then
    write(line,"(a,a,a)") '    "reason": "',trim(reason),'",'
    call emit_matterviz_json(sink,line)
end if
call emit_matterviz_json(sink,'    "defaultIsovalue": 0.001')
call emit_matterviz_json(sink,'  },')
end subroutine

subroutine emit_bond_method_capability(sink,method,available,reason,appendcomma)
type(matterviz_json_sink),intent(inout) :: sink
character(len=*),intent(in) :: method,reason
logical,intent(in) :: available,appendcomma
character(len=1) :: comma
character(len=1024) :: line

comma=" "
if (appendcomma) comma=","
if (available) then
    write(line,"(a,a,a,a)") '      "',trim(method),'": { "available": true }',comma
else
    write(line,"(a,a,a,a,a,a)") '      "',trim(method),'": { "available": false, "reason": "',trim(reason),'" }',comma
end if
call emit_matterviz_json(sink,line)
end subroutine

subroutine emit_cube_entry(sink,ncube,name,path,role,orbidx,isoval)
type(matterviz_json_sink),intent(inout) :: sink
integer,intent(in) :: orbidx
integer,intent(inout) :: ncube
character(len=*),intent(in) :: name,path,role
real*8,intent(in) :: isoval
character(len=1024) :: line

if (ncube>0) call emit_matterviz_json(sink,",")
ncube=ncube+1
if (orbidx>0) then
    write(line,"(a,a,a,a,a,a,a,i0,a,1pe16.8,a)") '    { "name": "',trim(name),'", "path": "',trim(path),&
        '", "role": "',trim(role),'", "orbitalIndex": ',orbidx,', "mode": "signed", "isovalue": ',isoval,' }'
else
    write(line,"(a,a,a,a,a,a,a,1pe16.8,a)") '    { "name": "',trim(name),'", "path": "',trim(path),&
        '", "role": "',trim(role),'", "mode": "signed", "isovalue": ',isoval,' }'
end if
call emit_matterviz_json(sink,line)
end subroutine

subroutine emit_orbital_cube_manifest(sink,ncube)
type(matterviz_json_sink),intent(inout) :: sink
integer,intent(inout) :: ncube
integer :: i,idx
character(len=64) :: name,path

if (gui_orbital_count<=0) return
do i=1,gui_orbital_count
    idx=gui_orbital_indices(i)
    write(name,"('Orbital ',i0)") idx
    write(path,"('orb',i6.6,'.cube')") idx
    call emit_cube_entry(sink,ncube,trim(name),trim(path),"orbital",idx,abs(sur_value_orb))
end do
end subroutine

subroutine emit_orbital_metadata(sink)
type(matterviz_json_sink),intent(inout) :: sink
integer :: i,imax,orbtotal,homo,maxvalues
character(len=1024) :: line

orbtotal=gui_orbital_total()
homo=gui_homo_index()
maxvalues=0
if (allocated(MOene).and.allocated(MOocc)) maxvalues=min(size(MOene),size(MOocc))
call emit_matterviz_json(sink,'  "orbitals": {')
write(line,"(a,i0,a)") '    "count": ',orbtotal,','
call emit_matterviz_json(sink,line)
write(line,"(a,i0,a)") '    "homoIndex": ',homo,','
call emit_matterviz_json(sink,line)
call emit_matterviz_json(sink,'    "items": [')
if (orbtotal>0) then
    imax=min(orbtotal,2000)
    do i=1,imax
        if (i<=maxvalues) then
            if (i<imax) then
                write(line,"(a,i0,a,1pe16.8,a,1pe16.8,a)") &
                    '      { "index": ',i,', "energy": ',MOene(i),', "occupation": ',MOocc(i),' },'
            else
                write(line,"(a,i0,a,1pe16.8,a,1pe16.8,a)") &
                    '      { "index": ',i,', "energy": ',MOene(i),', "occupation": ',MOocc(i),' }'
            end if
        else
            if (i<imax) then
                write(line,"(a,i0,a)") '      { "index": ',i,' },'
            else
                write(line,"(a,i0,a)") '      { "index": ',i,' }'
            end if
        end if
        call emit_matterviz_json(sink,line)
    end do
end if
call emit_matterviz_json(sink,'    ]')
call emit_matterviz_json(sink,'  },')
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
