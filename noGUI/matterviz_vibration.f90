!Extraction of vibrational frequencies and normal-mode displacement vectors for the
!MatterViz vibrational mode animation session. The numerical data are parsed from the
!source program's output file with the same conventions used by the spectrum module
!(PVS normal-coordinate analysis); no frequency or eigenvector algorithm lives here.
module matterviz_vibration
use defvar
use util, only: loclabel,loclabelfinal,outputprog,readmatgau
use, intrinsic :: ieee_arithmetic
implicit none
private
public :: vibration_data,load_vibration_data,release_vibration_data

type :: vibration_data
    integer :: n_modes=0,n_atoms=0,iprog=0
    character(len=16) :: spectrum_kind=''
    real*8,allocatable :: frequencies(:) !cm^-1
    real*8,allocatable :: intensities(:) !IR: km/mol; Raman: A^4/AMU
    logical :: has_intensity=.false.
    !Flat displacement patterns in mode-major [mode][atom][xyz] order, as printed by
    !the source program (normalized Cartesian vectors, not mass weighted)
    real*8,allocatable :: displacements(:)
end type

contains

subroutine release_vibration_data(vib)
type(vibration_data),intent(inout) :: vib
if (allocated(vib%frequencies)) deallocate(vib%frequencies)
if (allocated(vib%intensities)) deallocate(vib%intensities)
if (allocated(vib%displacements)) deallocate(vib%displacements)
vib%n_modes=0;vib%n_atoms=0;vib%iprog=0
vib%spectrum_kind=''
vib%has_intensity=.false.
end subroutine

!Assemble the vibration payload: frequencies/intensities come from the caller (they are
!live in the spectrum menu), displacement vectors are parsed here from filename.
!On failure message is set and vib is released.
subroutine load_vibration_data(ispectrum,numdata,frequencies_in,intensities_in,vib,message)
integer,intent(in) :: ispectrum,numdata
real*8,intent(in) :: frequencies_in(numdata),intensities_in(numdata)
type(vibration_data),intent(out) :: vib
character(len=*),intent(out) :: message
real*8,allocatable :: normmat(:,:,:) !normmat(1:3,1:ncenter,1:numdata), same layout as spectrum PVS
character(len=256) :: g98path
character(len=80) :: c80tmp
integer :: iprog,ios,imode,iatm,idir,ifound,ixtb,vibunit
logical :: alive

message=''
call release_vibration_data(vib)
if (numdata<=0) then
    message='No vibrational transitions are loaded'
    return
end if
if (.not.allocated(a).or.ncenter<=0.or.size(a)<ncenter) then
    message='Vibrational mode animation requires the molecular geometry in memory; &
        &use a Gaussian or ORCA output file as the input'
    return
end if
if (.not.all(ieee_is_finite(frequencies_in))) then
    message='The loaded frequencies contain non-finite values'
    return
end if
if (.not.all(ieee_is_finite(a(1:ncenter)%x)).or. &
    .not.all(ieee_is_finite(a(1:ncenter)%y)).or. &
    .not.all(ieee_is_finite(a(1:ncenter)%z))) then
    message='The loaded geometry contains non-finite coordinates'
    return
end if

vib%n_modes=numdata
vib%n_atoms=ncenter
select case(ispectrum)
case(1); vib%spectrum_kind='ir'
case(2); vib%spectrum_kind='raman'
case(5); vib%spectrum_kind='vcd'
case(6); vib%spectrum_kind='roa'
case default; vib%spectrum_kind=''
end select
allocate(vib%frequencies(numdata))
vib%frequencies=frequencies_in
if ((ispectrum==1.or.ispectrum==2).and.all(ieee_is_finite(intensities_in))) then
    allocate(vib%intensities(numdata))
    vib%intensities=intensities_in
    vib%has_intensity=.true.
end if

open(10,file=filename,status='old',iostat=ios)
if (ios/=0) then
    message='Unable to open the input file: '//trim(filename)
    call release_vibration_data(vib)
    return
end if
call outputprog(10,iprog)
vib%iprog=iprog
rewind(10)
allocate(normmat(3,ncenter,numdata))
vibunit=10
select case(iprog)
case(1,5) !Gaussian or CP2K output: per-atom displacement tables
    if (iprog==1) call read_mode_atom_tables(vibunit,'Atom  AN',ncenter,numdata,normmat,message)
    if (iprog==5) call read_mode_atom_tables(vibunit,'ATOM  EL',ncenter,numdata,normmat,message)
case(2) !ORCA output: full normal-mode matrix
    call read_orca_mode_matrix(vibunit,ncenter,numdata,normmat,message)
case(6) !xTB output: normal modes are recorded in the companion g98.out (Gaussian-style)
    call loclabel(10,'$vibrational spectrum',ixtb,maxline=100)
    if (ixtb==1) then
        write(*,*) 'Input path of the g98.out file produced by xTB, e.g. D:\study\g98.out'
        g98path=''
        do while(.true.)
            read(*,'(a)') g98path
            inquire(file=g98path,exist=alive)
            if (alive) exit
            write(*,*) 'Cannot find the file, input again!'
        end do
        open(11,file=g98path,status='old',iostat=ios)
        if (ios/=0) then
            message='Unable to open the g98.out file: '//trim(g98path)
        else
            vibunit=11
            call read_mode_atom_tables(vibunit,'Atom AN',ncenter,numdata,normmat,message)
            close(11)
        end if
    else
        message='Unable to recognize the xTB vibrational spectrum section in the output file'
    end if
case default
    message='Vibrational mode animation is not supported for this input file; &
        &Gaussian, ORCA, CP2K and xTB output files are supported'
end select
close(10)
if (len_trim(message)==0) then
    if (.not.all(ieee_is_finite(normmat))) then
        message='The normal-mode table contains non-finite values'
    else
        do imode=1,numdata
            if (sum(normmat(:,:,imode)**2)<=0D0) then
                write(message,'(a,i0,a)') 'Mode ',imode,' has a zero displacement vector'
                exit
            end if
        end do
    end if
end if
if (len_trim(message)/=0) then
    deallocate(normmat)
    call release_vibration_data(vib)
    return
end if
allocate(vib%displacements(3*ncenter*numdata))
do imode=1,numdata
    do iatm=1,ncenter
        do idir=1,3
            vib%displacements((imode-1)*3*ncenter+(iatm-1)*3+idir)=normmat(idir,iatm,imode)
        end do
    end do
end do
deallocate(normmat)
end subroutine

!Per-atom normal-mode displacement tables as printed by Gaussian ("Atom  AN"), the
!g98.out file of xTB ("Atom AN") and CP2K ("ATOM  EL"): three modes per block, one row
!per atom. Fixed atoms are not printed by Gaussian, so unfilled entries stay zero.
subroutine read_mode_atom_tables(iu,label,natom,nmodes,normmat,message)
integer,intent(in) :: iu,natom,nmodes
character(len=*),intent(in) :: label
real*8,intent(out) :: normmat(3,natom,nmodes)
character(len=*),intent(out) :: message
character(len=80) :: c80tmp
character(len=200) :: c200tmp
integer :: ifound,ierror,ilackdata,inow,iread,iatm,itmp

message=''
normmat=0D0
ilackdata=nmodes
inow=1
do while(.true.)
    if (ilackdata>3) then
        iread=3
    else
        iread=ilackdata
    end if
    call loclabel(iu,label,ifound,0)
    if (ifound==0) then
        message='Unable to find the normal-mode displacement table ("'//trim(label)// &
            '") in the output file'
        return
    end if
    read(iu,*,iostat=ierror)
    if (ierror/=0) then
        message='Failed to skip the header of the normal-mode displacement table'
        return
    end if
    do while(.true.)
        read(iu,'(a)',iostat=ierror) c80tmp
        if (ierror/=0.or.c80tmp(1:6)==' ') exit
        read(c80tmp,'(i6)',iostat=ierror) iatm
        if (ierror/=0.or.iatm<1.or.iatm>natom) then
            message='Unexpected atom index in the normal-mode displacement table'
            return
        end if
        if (iread==1) read(c80tmp,*,iostat=ierror) itmp,c200tmp,normmat(1:3,iatm,inow)
        if (iread==2) read(c80tmp,*,iostat=ierror) itmp,c200tmp,normmat(1:3,iatm,inow), &
            normmat(1:3,iatm,inow+1)
        if (iread==3) read(c80tmp,*,iostat=ierror) itmp,c200tmp,normmat(1:3,iatm,inow), &
            normmat(1:3,iatm,inow+1),normmat(1:3,iatm,inow+2)
        if (ierror/=0) then
            message='Failed to parse the normal-mode displacement table'
            return
        end if
    end do
    if (ilackdata<=3) exit
    ilackdata=ilackdata-3
    inow=inow+3
end do
end subroutine

!ORCA prints the complete normal-mode matrix (translations and rotations included) in the
!vibrational frequencies section; vibrational modes start after the skipped columns.
!Like the spectrum module's transition loader, the LAST occurrence is used: a restarted
!or repeated frequency run rewrites the modes, and the final section matches both the
!loaded frequencies and the final geometry.
subroutine read_orca_mode_matrix(iu,natom,nmodes,normmat,message)
integer,intent(in) :: iu,natom,nmodes
real*8,intent(out) :: normmat(3,natom,nmodes)
character(len=*),intent(out) :: message
real*8,allocatable :: tmpmat(:,:)
character(len=80) :: c80tmp
integer :: nfound,ierror,iskip,imode,iatm,idir

message=''
normmat=0D0
call loclabelfinal(iu,'The first frequency considered to be a vibration is',nfound)
if (nfound==0) then
    message='Unable to find the vibrational frequencies section in the ORCA output file'
    return
end if
read(iu,'(a)',iostat=ierror) c80tmp
if (ierror/=0) then
    message='Failed to read the ORCA vibrational frequencies section'
    return
end if
read(c80tmp(53:),*,iostat=ierror) iskip
if (ierror/=0.or.iskip<0) then
    message='Failed to locate the first vibrational mode in the ORCA output file'
    return
end if
allocate(tmpmat(3*natom,nmodes+iskip))
call loclabelfinal(iu,'Thus, these vectors are normalized but',nfound)
if (nfound==0) then
    deallocate(tmpmat)
    message='Unable to find the normal-mode matrix in the ORCA output file'
    return
end if
read(iu,*,iostat=ierror)
if (ierror==0) call readmatgau(iu,tmpmat,inform='f11.6',inskipcol=11,inncol=6,iostat=ierror)
if (ierror/=0) then
    deallocate(tmpmat)
    message='Failed to parse the normal-mode matrix in the ORCA output file'
    return
end if
do imode=1,nmodes
    do iatm=1,natom
        do idir=1,3
            normmat(idir,iatm,imode)=tmpmat(3*(iatm-1)+idir,iskip+imode)
        end do
    end do
end do
deallocate(tmpmat)
end subroutine

end module
