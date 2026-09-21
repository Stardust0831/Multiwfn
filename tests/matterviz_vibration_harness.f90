!Harness for the MatterViz vibration adapter: loads normal-mode displacement data from
!Gaussian and ORCA output fixtures, checks the emitted manifest JSON, and verifies
!rejection paths. Prints VIBRATION_HARNESS_OK when every check passes.
program vibration_harness
use defvar
use GUI, only: matterviz_json_sink,emit_vibration_manifest_json
use matterviz_vibration
implicit none
type(vibration_data) :: vib
type(matterviz_json_sink) :: sink
character(len=512) :: fixture_dir,path
character(len=256) :: message
real*8 :: freqs(3),intens(3)
integer :: iu,ios
logical :: manifest_written

call get_command_argument(1,fixture_dir)
if (len_trim(fixture_dir)==0) fixture_dir='.'
freqs=[1650D0,3820D0,3935D0]
intens=[61.5D0,4.2D0,0.9D0]

!! Case 1: Gaussian output, water, three vibrational modes
ncenter=3
allocate(a(ncenter))
a(1)%index=8;a(1)%x=0D0;a(1)%y=0D0;a(1)%z=0.1173D0
a(2)%index=1;a(2)%x=0D0;a(2)%y=0.7572D0;a(2)%z=-0.4692D0
a(3)%index=1;a(3)%x=0D0;a(3)%y=-0.7572D0;a(3)%z=-0.4692D0
filename=trim(fixture_dir)//'/h2o_freq_gaussian.out'
call load_vibration_data(1,3,freqs,intens,vib,message)
if (len_trim(message)/=0) then
    write(*,*) trim(message)
    error stop 'Gaussian fixture rejected'
end if
if (vib%n_modes/=3.or.vib%n_atoms/=3) error stop 'Gaussian mode or atom count mismatch'
if (trim(vib%spectrum_kind)/='ir') error stop 'spectrum kind mismatch'
if (.not.vib%has_intensity) error stop 'IR intensities missing'
if (vib%iprog/=1) error stop 'program detection mismatch'
if (any(abs(vib%frequencies-freqs)>1D-12)) error stop 'frequency mismatch'
if (any(abs(vib%intensities-intens)>1D-12)) error stop 'intensity mismatch'
!Mode-major layout: displacements((imode-1)*9+(iatm-1)*3+idir)
call check_disp(vib,1,2,3,-0.56D0) !mode 1, atom 2, z
call check_disp(vib,2,3,2,-0.43D0) !mode 2, atom 3, y
call check_disp(vib,3,3,3,-0.47D0) !mode 3, atom 3, z
call check_disp(vib,1,1,3,0.07D0)  !mode 1, atom 1, z
!Emit the manifest document and check it parses as JSON (done by the Python driver)
open(newunit=iu,file='vibration_manifest_check.json',status='replace',action='write',iostat=ios)
if (ios/=0) error stop 'cannot open manifest output'
sink=matterviz_json_sink()
sink%unit=iu
call emit_vibration_manifest_json(sink,vib,7_8)
close(iu)
inquire(file='vibration_manifest_check.json',exist=manifest_written)
if (.not.manifest_written) error stop 'manifest was not written'
call release_vibration_data(vib)
if (vib%n_modes/=0.or.allocated(vib%displacements)) error stop 'release failed'

!! Case 2: ORCA output, two atoms, modes after one skipped translation column
deallocate(a)
ncenter=2
allocate(a(ncenter))
a(1)%index=1;a(1)%x=0D0;a(1)%y=0D0;a(1)%z=0D0
a(2)%index=1;a(2)%x=0D0;a(2)%y=0D0;a(2)%z=1.4D0
filename=trim(fixture_dir)//'/h2_freq_orca.out'
call load_vibration_data(1,2,freqs(1:2),intens(1:2),vib,message)
if (len_trim(message)/=0) then
    write(*,*) trim(message)
    error stop 'ORCA fixture rejected'
end if
if (vib%n_modes/=2.or.vib%n_atoms/=2) error stop 'ORCA mode or atom count mismatch'
if (vib%iprog/=2) error stop 'ORCA program detection mismatch'
call check_disp(vib,1,1,1,0.1D0)  !mode 1, atom 1, x
call check_disp(vib,1,1,3,0.3D0)  !mode 1, atom 1, z
call check_disp(vib,1,2,1,-0.5D0) !mode 1, atom 2, x
call check_disp(vib,2,2,2,1D0)    !mode 2, atom 2, y
call release_vibration_data(vib)

!! Case 2b: ORCA output with two frequency sections must use the LAST one,
!! matching the spectrum module's transition loader and the final geometry
filename=trim(fixture_dir)//'/h2_freq_orca_twice.out'
call load_vibration_data(1,2,freqs(1:2),intens(1:2),vib,message)
if (len_trim(message)/=0) then
    write(*,*) trim(message)
    error stop 'ORCA two-section fixture rejected'
end if
call check_disp(vib,1,1,2,-0.4D0) !mode 1, atom 1, y (second section)
call check_disp(vib,1,2,2,-1.0D0) !mode 1, atom 2, y (second section)
call check_disp(vib,2,2,3,0.30D0) !mode 2, atom 2, z (second section)
call release_vibration_data(vib)

!! Case 3: unsupported program (plain text) must be rejected
filename=trim(fixture_dir)//'/plain_text.txt'
call load_vibration_data(1,3,freqs,intens,vib,message)
if (len_trim(message)==0) error stop 'plain text input accepted'
if (allocated(vib%displacements)) error stop 'rejected input retained data'

!! Case 4: missing structure must be rejected
deallocate(a)
ncenter=0
filename=trim(fixture_dir)//'/h2o_freq_gaussian.out'
call load_vibration_data(1,3,freqs,intens,vib,message)
if (len_trim(message)==0) error stop 'structureless input accepted'

write(*,*) 'VIBRATION_HARNESS_OK'

contains
subroutine check_disp(vib,imode,iatm,idir,expected)
type(vibration_data),intent(in) :: vib
integer,intent(in) :: imode,iatm,idir
real*8,intent(in) :: expected
integer :: flat
flat=(imode-1)*3*vib%n_atoms+(iatm-1)*3+idir
if (abs(vib%displacements(flat)-expected)>1D-12) then
    write(*,"(' mode ',i0,' atom ',i0,' dir ',i0,': got ',f12.6,' expected ',f12.6)") &
        imode,iatm,idir,vib%displacements(flat),expected
    error stop 'displacement mismatch'
end if
end subroutine
end program
