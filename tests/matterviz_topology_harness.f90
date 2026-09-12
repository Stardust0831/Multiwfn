program topology_harness
use defvar
use topo
use matterviz_topology
use functions, only: gencalchessmat
implicit none
type(aim_options) :: options
type(topology_data) :: result,reference
character(len=200) :: input
character(len=160) :: message
real*8,allocatable :: co_before(:,:),occ_before(:)
real*8 :: v,g(3),h(3,3),grid_before(2,3,4),cp_before(3)
integer :: i,j,k,l,ncp_before,npath_before,expected(4),caseidx

nthreads=1
call get_command_argument(1,input)
if (len_trim(input)>0) then
    filename=input
    call readinfile(input,1)
    call check_case()
else
    do caseidx=1,3
        if (caseidx==1) then
            ncenter=2;nmo=2
        else
            ncenter=8;nmo=8
        end if
        nprims=ncenter
        allocate(a(ncenter),b(nprims),CO(nmo,nprims),MOocc(nmo))
        CO=0D0;MOocc=2D0
        if (caseidx==3) then
            wfntype=1;MOocc(1)=1D0;nthreads=4
        end if
        do i=1,ncenter
            a(i)%index=1;a(i)%name='H';a(i)%charge=1D0
            a(i)%x=merge(1D0,-1D0,btest(i-1,0))
            a(i)%y=0D0;a(i)%z=0D0
            if (ncenter==8) then
                a(i)%y=merge(1D0,-1D0,btest(i-1,1))
                a(i)%z=merge(1D0,-1D0,btest(i-1,2))
            end if
            b(i)%center=i;b(i)%type=1;b(i)%exp=2D0;CO(i,i)=1D0
        end do
        call check_case()
        if (caseidx==1) then
            expected=[2,1,0,0]
        else if (caseidx==2) then
            expected=[8,12,6,1]
        else
            expected=[8,12,6,1]
        end if
        do i=1,4
            if (count(result%types==i)/=expected(i)) error stop 'unexpected synthetic CP count'
        end do
        deallocate(a,b,CO,MOocc)
    end do
end if
numcp=0;numpath=1;pathnumpt(1)=2
topopath(:,1,1)=[0D0,0D0,0D0];topopath(:,2,1)=[1D0,0D0,0D0]
call capture_topology(result,message)
if (message/=''.or.result%start_cp(1)/=0.or.result%end_cp(1)/=0.or.result%path_types(1)/=0) &
    error stop 'paths without CPs must retain unknown endpoints'
write(*,*) 'TOPOLOGY_HARNESS_OK'

contains
subroutine check_case()
integer :: i,j,k,l,kind
real*8 :: center(3),point(3),oldgrad
real*8,allocatable :: distance(:,:)
co_before=CO;occ_before=MOocc
if (allocated(cubmat)) deallocate(cubmat)
allocate(cubmat(2,3,4));cubmat=7D0;grid_before=cubmat
nx=2;ny=3;nz=4;orgx=-3D0;iorbsel=1
numcp=1;CPpos(:,1)=[8D0,9D0,10D0];CPtype(1)=4;numpath=0
cp_before=CPpos(:,1)
if (.not.aim_available(message)) then
    write(*,*) message
    error stop 'capability unexpectedly unavailable'
end if
call aim_begin(options,message)
if (message/='') then
    write(*,*) message
    error stop 'AIM failed'
end if
call capture_topology(result,message)
if (message/='') error stop 'capture failed'
call aim_finish(.false.)
if (numcp/=1.or.any(CPpos(:,1)/=cp_before).or.CPtype(1)/=4) error stop 'rollback failed'
if (topomaxcyc/=120.or.maxpathpttry/=451.or.pathstepsize/=0.03D0.or.gradconv/=1D-6.or.dispconv/=1D-7) error stop 'parameters not restored'
if (any(CO/=co_before).or.any(MOocc/=occ_before)) error stop 'wavefunction changed'
if (any(cubmat/=grid_before).or.nx/=2.or.ny/=3.or.nz/=4.or.orgx/=-3D0.or.iorbsel/=1) error stop 'grid changed'
deallocate(cubmat)
call aim_begin(options,message)
if (message/='') error stop 'second AIM failed'
call aim_finish(.true.)
if (allocated(cubmat)) error stop 'unallocated grid not restored'
if (numcp/=result%ncp.or.numpath/=result%npath.or.ifunctopo/=1) error stop 'commit failed'

! Independent serial orchestration of CLI modes 2/3/4/5/8/9, with unchanged core routines.
allocate(distance(ncenter,ncenter))
do i=1,ncenter
    do j=1,ncenter
        distance(i,j)=sqrt((a(i)%x-a(j)%x)**2+(a(i)%y-a(j)%y)**2+(a(i)%z-a(j)%z)**2)
    end do
end do
numcp=0;numpath=0;itopomethod=1;ishowsearchlevel=0
oldgrad=gradconv;gradconv=1D0
do i=1,ncenter
    call findcp(a(i)%x,a(i)%y,a(i)%z,1)
end do
gradconv=oldgrad
do kind=2,4
    do i=1,ncenter
        do j=i+1,ncenter
            if (distance(i,j)>vdwsumcrit*(vdwr(a(i)%index)+vdwr(a(j)%index))) cycle
            center=[a(i)%x+a(j)%x,a(i)%y+a(j)%y,a(i)%z+a(j)%z]
            if (kind==2) then
                call findcp(center(1)/2,center(2)/2,center(3)/2,1)
                cycle
            end if
            do k=j+1,ncenter
                if (distance(i,k)>vdwsumcrit*(vdwr(a(i)%index)+vdwr(a(k)%index))) cycle
                if (distance(j,k)>vdwsumcrit*(vdwr(a(j)%index)+vdwr(a(k)%index))) cycle
                point=center+[a(k)%x,a(k)%y,a(k)%z]
                if (kind==3) then
                    call findcp(point(1)/3,point(2)/3,point(3)/3,1)
                    cycle
                end if
                do l=k+1,ncenter
                    if (distance(i,l)>vdwsumcrit*(vdwr(a(i)%index)+vdwr(a(l)%index))) cycle
                    if (distance(j,l)>vdwsumcrit*(vdwr(a(j)%index)+vdwr(a(l)%index))) cycle
                    if (distance(k,l)>vdwsumcrit*(vdwr(a(k)%index)+vdwr(a(l)%index))) cycle
                    call findcp((point(1)+a(l)%x)/4,(point(2)+a(l)%y)/4,(point(3)+a(l)%z)/4,1)
                end do
            end do
        end do
    end do
end do
call sortCP(1)
do i=1,numcp
    if (CPtype(i)==2) call findpath(i,1,1,0)
    if (CPtype(i)==3.and.any(CPtype(1:numcp)==4)) call findpath(i,2,1,0)
end do
call sortpath
call capture_topology(reference,message)
if (message/='') error stop 'reference capture failed'
if (result%ncp/=reference%ncp.or.result%npath/=reference%npath) error stop 'CLI count mismatch'
if (any(result%types/=reference%types)) error stop 'CLI type mismatch'
if (any(abs(result%x(1:numcp)-reference%x(1:numcp))>1D-6).or. &
    any(abs(result%y(1:numcp)-reference%y(1:numcp))>1D-6).or. &
    any(abs(result%z(1:numcp)-reference%z(1:numcp))>1D-6)) error stop 'CLI coordinate mismatch'
if (any(abs(result%rho-reference%rho)>1D-6*max(1D0,abs(reference%rho)))) error stop 'CLI density mismatch'
if (any(abs(result%laplacian-reference%laplacian)>1D-6*max(1D0,abs(reference%laplacian)))) error stop 'CLI Laplacian mismatch'
if (any(result%start_cp/=reference%start_cp).or.any(result%end_cp/=reference%end_cp)) error stop 'CLI path endpoint mismatch'
if (size(result%x)/=size(reference%x)) error stop 'CLI path size mismatch'
if (maxval(abs(result%x-reference%x))>1D-6.or.maxval(abs(result%y-reference%y))>1D-6.or. &
    maxval(abs(result%z-reference%z))>1D-6) error stop 'CLI path geometry mismatch'
write(*,'(a,4i6,a,i6)') 'CP_COUNTS ',(count(result%types==i),i=1,4),' PATHS ',result%npath
ifPBC=1
if (aim_available(message)) error stop 'periodic capability enabled'
ifPBC=0
deallocate(distance)
call check_rejected_inputs()
end subroutine

subroutine check_rejected_inputs()
type(aim_options) :: invalid
real*8,allocatable :: oldco(:,:),oldocc(:)
integer :: previous
invalid=options;invalid%path_points=maxpathpt
call aim_begin(invalid,message)
if (message=='') error stop 'path capacity accepted'
invalid=options;invalid%seeds=0
call aim_begin(invalid,message)
if (message=='') error stop 'empty search accepted'
previous=numcp;numcp=maxnumcp+1
call aim_begin(options,message)
if (message==''.or.numcp/=maxnumcp+1) error stop 'CP capacity check changed state'
numcp=previous
previous=pathnumpt(1);pathnumpt(1)=maxpathpt+1
call aim_begin(options,message)
if (message=='') error stop 'invalid existing path accepted'
pathnumpt(1)=previous
call move_alloc(CO,oldco)
if (aim_available(message)) error stop 'missing coefficients accepted'
call move_alloc(oldco,CO)
call move_alloc(MOocc,oldocc)
if (aim_available(message)) error stop 'missing occupations accepted'
call move_alloc(oldocc,MOocc)
previous=b(1)%center;b(1)%center=ncenter+1
if (aim_available(message)) error stop 'invalid GTF accepted'
b(1)%center=previous
end subroutine
end program
