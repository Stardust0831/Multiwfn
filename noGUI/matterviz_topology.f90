module matterviz_topology
use defvar
use topo
use functions, only: gencalchessmat
use, intrinsic :: ieee_arithmetic
implicit none
private
public :: aim_options, aim_available, aim_valid_options, aim_begin, aim_finish, topology_data, capture_topology

type :: aim_options
    integer :: seeds=15,cycles=120,path_points=451
    real*8 :: distance=1.5D0,gradient=1D-6,displacement=1D-7,step=0.03D0
end type
type :: topology_data
    integer :: function_id=1,ncp=0,npath=0
    real*8,allocatable :: x(:),y(:),z(:),rho(:),laplacian(:)
    integer,allocatable :: types(:),offsets(:),counts(:),start_cp(:),end_cp(:),path_types(:)
    logical :: has_density=.false.
end type
type :: topology_backup
    integer :: ncp=0,npath=0,function_id=1,cycles=120,method=1,verbosity=0,points=451,tries=30
    real*8 :: gradient=1D-6,displacement=1D-7,distance=1.5D0,step=0.03D0,scale=1D0,trust=0D0,low=0D0,high=0D0
    real*8,allocatable :: cp(:,:),path(:,:)
    integer,allocatable :: types(:),counts(:)
    logical :: active=.false.
end type
type(topology_backup),save :: saved

contains

logical function aim_available(reason)
character(len=*),intent(out) :: reason
aim_available=.false.
reason='AIM calculation is not supported for periodic inputs in this GUI'
if (ifPBC/=0) return
reason='AIM requires atoms, GTF coefficients and orbital occupations'
if (.not.allocated(a).or..not.allocated(b).or..not.allocated(CO).or..not.allocated(MOocc)) return
if (ncenter<=0.or.nprims<=0.or.nmo<=0) return
if (size(a)<ncenter.or.size(b)<nprims.or.size(MOocc)<nmo) return
if (size(CO,1)<nmo.or.size(CO,2)<nprims) return
reason='The loaded wavefunction contains invalid atom or occupation data'
if (any(a(1:ncenter)%index<1).or.any(a(1:ncenter)%index>size(vdwr))) return
if (.not.all(ieee_is_finite(a(1:ncenter)%x)).or..not.all(ieee_is_finite(a(1:ncenter)%y)).or. &
    .not.all(ieee_is_finite(a(1:ncenter)%z))) return
if (.not.all(ieee_is_finite(MOocc(1:nmo))).or..not.any(MOocc(1:nmo)>0D0)) return
reason='The loaded wavefunction contains nonfinite orbital coefficients'
if (.not.all(ieee_is_finite(CO(1:nmo,1:nprims)))) return
reason='The loaded wavefunction contains invalid GTF centers, types or exponents'
if (any(b(1:nprims)%center<1).or.any(b(1:nprims)%center>ncenter)) return
if (any(b(1:nprims)%type<1).or.any(b(1:nprims)%type>56)) return
if (.not.all(ieee_is_finite(b(1:nprims)%exp)).or.any(b(1:nprims)%exp<=0D0)) return
reason=''
aim_available=.true.
end function

logical function aim_valid_options(options)
type(aim_options),intent(in) :: options
aim_valid_options=.false.
if (options%seeds<1.or.options%seeds>15.or.options%cycles<1.or.options%cycles>1000) return
if (options%path_points<3.or.options%path_points>=maxpathpt) return
if (.not.all(ieee_is_finite([options%distance,options%gradient,options%displacement,options%step]))) return
if (options%distance<0.1D0.or.options%distance>5D0) return
if (options%gradient<1D-12.or.options%gradient>1D-2) return
if (options%displacement<1D-12.or.options%displacement>1D-2) return
if (options%step<1D-4.or.options%step>0.2D0) return
aim_valid_options=.true.
end function

subroutine aim_begin(options,message)
type(aim_options),intent(in) :: options
character(len=*),intent(out) :: message
real*8,allocatable :: distances(:,:)
real*8 :: seeds(3,256),center(3)
integer :: i,j,k,l,n,offset,istat,batch_count,mode
logical :: failed

message='Invalid AIM parameters'
if (.not.aim_valid_options(options)) return
if (.not.aim_available(message)) return
if (saved%active) then
    message='A topology transaction is already active'
    return
end if
message='Invalid existing topology array bounds'
if (numcp<0.or.numcp>maxnumcp.or.numpath<0.or.numpath>maxnumpath) return
if (any(pathnumpt(1:numpath)<2).or.any(pathnumpt(1:numpath)>maxpathpt)) return
n=sum(pathnumpt(1:numpath))
if (int(ncenter,8)*int(ncenter,8)>67108864_8) then
    message='AIM atom-distance table exceeds the 512 MiB memory limit'
    return
end if
allocate(saved%cp(3,numcp),saved%types(numcp),saved%path(3,n),saved%counts(numpath), &
    distances(ncenter,ncenter),stat=istat)
if (istat/=0) then
    saved=topology_backup()
    message='Insufficient memory to preserve the previous topology'
    return
end if
saved%ncp=numcp;saved%npath=numpath;saved%cp=CPpos(:,1:numcp);saved%types=CPtype(1:numcp)
saved%counts=pathnumpt(1:numpath);offset=0
do i=1,numpath
    n=pathnumpt(i)
    saved%path(:,offset+1:offset+n)=topopath(:,1:n,i)
    offset=offset+n
end do
saved%function_id=ifunctopo;saved%cycles=topomaxcyc;saved%method=itopomethod
saved%verbosity=ishowsearchlevel;saved%points=maxpathpttry
saved%tries=npathtry
saved%gradient=gradconv;saved%displacement=dispconv;saved%distance=vdwsumcrit;saved%step=pathstepsize
saved%scale=CPstepscale;saved%trust=topotrustrad;saved%low=CPsearchlow;saved%high=CPsearchhigh
saved%active=.true.
numcp=0;numpath=0;ifunctopo=1;itopomethod=1;ishowsearchlevel=0
topomaxcyc=options%cycles;maxpathpttry=options%path_points
gradconv=options%gradient;dispconv=options%displacement
vdwsumcrit=options%distance;pathstepsize=options%step
CPstepscale=1D0;topotrustrad=0D0;CPsearchlow=0D0;CPsearchhigh=0D0
npathtry=2
failed=.false.;batch_count=0
do i=1,ncenter
    do j=1,ncenter
        distances(i,j)=sqrt((a(i)%x-a(j)%x)**2+(a(i)%y-a(j)%y)**2+(a(i)%z-a(j)%z)**2)
    end do
end do
if (btest(options%seeds,0)) then
    gradconv=1D0
    do i=1,ncenter
        call queue_seed([a(i)%x,a(i)%y,a(i)%z])
        if (failed) exit
    end do
    call flush_seeds()
    gradconv=options%gradient
end if
do mode=1,3
if (.not.btest(options%seeds,mode)) cycle
do i=1,ncenter
    if (failed) exit
    do j=i+1,ncenter
        if (.not.near_pair(i,j)) cycle
        center=[a(i)%x+a(j)%x,a(i)%y+a(j)%y,a(i)%z+a(j)%z]
        if (mode==1) call queue_seed(center/2D0)
        if (failed) exit
        if (mode==1) cycle
        do k=j+1,ncenter
            if (.not.near_pair(i,k).or..not.near_pair(j,k)) cycle
            if (mode==2) call queue_seed((center+[a(k)%x,a(k)%y,a(k)%z])/3D0)
            if (failed) exit
            if (mode==2) cycle
            do l=k+1,ncenter
                if (.not.near_pair(i,l).or..not.near_pair(j,l).or..not.near_pair(k,l)) cycle
                call queue_seed((center+[a(k)%x+a(l)%x,a(k)%y+a(l)%y,a(k)%z+a(l)%z])/4D0)
                if (failed) exit
            end do
        end do
    end do
end do
call flush_seeds()
end do
if (failed) then
    message='Critical-point capacity reached; reduce the search range'
    call aim_finish(.false.)
    return
end if
call sortCP(1)
do i=1,numcp
    if (CPtype(i)/=2.and.CPtype(i)/=3) cycle
    if (CPtype(i)==2.and..not.any(CPtype(1:numcp)==1)) cycle
    if (CPtype(i)==3.and..not.any(CPtype(1:numcp)==4)) cycle
    if (numpath>maxnumpath-2) then
        message='Topology path capacity reached'
        call aim_finish(.false.)
        return
    end if
    k=1
    if (CPtype(i)==3) k=2
    call findpath(i,k,1,0)
end do
call sortpath
message=''

contains
logical function near_pair(i,j)
integer,intent(in) :: i,j
near_pair=distances(i,j)<=vdwsumcrit*(vdwr(a(i)%index)+vdwr(a(j)%index))
end function
subroutine queue_seed(point)
real*8,intent(in) :: point(3)
if (failed) return
if (numcp+batch_count>=maxnumcp) call flush_seeds()
if (numcp>=maxnumcp) then
    failed=.true.
    return
end if
batch_count=batch_count+1
seeds(:,batch_count)=point
if (batch_count==size(seeds,2)) call flush_seeds()
end subroutine
subroutine flush_seeds()
integer :: idx
if (failed.or.batch_count==0) return
! Each independent search adds at most one CP. Reserve capacity before parallel work.
if (numcp+batch_count>maxnumcp) then
    failed=.true.
    return
end if
!$OMP PARALLEL DO PRIVATE(idx) SCHEDULE(dynamic) NUM_THREADS(nthreads)
do idx=1,batch_count
    call findcp(seeds(1,idx),seeds(2,idx),seeds(3,idx),1)
end do
!$OMP END PARALLEL DO
batch_count=0
end subroutine
end subroutine

subroutine aim_finish(commit)
logical,intent(in) :: commit
integer :: i,n,offset
if (.not.saved%active) return
topomaxcyc=saved%cycles;itopomethod=saved%method;ishowsearchlevel=saved%verbosity;maxpathpttry=saved%points
npathtry=saved%tries
gradconv=saved%gradient;dispconv=saved%displacement;vdwsumcrit=saved%distance;pathstepsize=saved%step
CPstepscale=saved%scale;topotrustrad=saved%trust;CPsearchlow=saved%low;CPsearchhigh=saved%high
if (commit) then
    ifunctopo=1
    numbassurf=0;nple3n1path=0;cp2surf=0;cp2ple3n1path=0
    if (allocated(bassurpath)) deallocate(bassurpath)
    if (allocated(ple3n1path)) deallocate(ple3n1path)
else
    ifunctopo=saved%function_id;numcp=saved%ncp;numpath=saved%npath
    CPpos(:,1:numcp)=saved%cp;CPtype(1:numcp)=saved%types
    pathnumpt(1:numpath)=saved%counts;offset=0
    do i=1,numpath
        n=pathnumpt(i)
        topopath(:,1:n,i)=saved%path(:,offset+1:offset+n)
        offset=offset+n
    end do
end if
saved=topology_backup()
end subroutine

subroutine capture_topology(data,message)
type(topology_data),intent(out) :: data
character(len=*),intent(out) :: message
integer :: n,i,j,offset,istat
real*8 :: value,gradient(3),hessian(3,3)
character(len=160) :: reason
message='Invalid topology array bounds'
if (numcp<0.or.numcp>maxnumcp.or.numpath<0.or.numpath>maxnumpath) return
if (any(pathnumpt(1:numpath)<2).or.any(pathnumpt(1:numpath)>maxpathpt)) return
data%ncp=numcp;data%npath=numpath;data%function_id=ifunctopo
n=numcp+sum(pathnumpt(1:numpath))
allocate(data%x(n),data%y(n),data%z(n),data%types(numcp),data%rho(numcp),data%laplacian(numcp), &
    data%offsets(numpath),data%counts(numpath),data%start_cp(numpath),data%end_cp(numpath), &
    data%path_types(numpath),stat=istat)
if (istat/=0) then
    message='Insufficient memory for topology coordinates'
    return
end if
data%x(1:numcp)=CPpos(1,1:numcp);data%y(1:numcp)=CPpos(2,1:numcp);data%z(1:numcp)=CPpos(3,1:numcp)
data%types=CPtype(1:numcp);data%rho=0D0;data%laplacian=0D0
data%has_density=ifunctopo==1.and.aim_available(reason)
if (data%has_density) then
    do i=1,numcp
        call gencalchessmat(2,1,CPpos(1,i),CPpos(2,i),CPpos(3,i),value,gradient,hessian)
        data%rho(i)=value
        data%laplacian(i)=hessian(1,1)+hessian(2,2)+hessian(3,3)
    end do
end if
offset=numcp
do i=1,numpath
    n=pathnumpt(i);data%offsets(i)=offset;data%counts(i)=n
    data%x(offset+1:offset+n)=topopath(1,1:n,i)
    data%y(offset+1:offset+n)=topopath(2,1:n,i)
    data%z(offset+1:offset+n)=topopath(3,1:n,i)
    data%start_cp(i)=0;data%end_cp(i)=0;data%path_types(i)=0
    if (numcp>0) call path_cp(i,data%start_cp(i),data%end_cp(i),data%path_types(i))
    offset=offset+n
end do
if (.not.all(ieee_is_finite(data%x)).or..not.all(ieee_is_finite(data%y)).or. &
    .not.all(ieee_is_finite(data%z)).or..not.all(ieee_is_finite(data%rho)).or. &
    .not.all(ieee_is_finite(data%laplacian))) then
    message='Nonfinite topology result'
    return
end if
message=''
end subroutine
end module
