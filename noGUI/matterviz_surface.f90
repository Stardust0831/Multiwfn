! Read-only snapshot of main function 12's improved marching-tetrahedra results.
module matterviz_surface
use iso_c_binding, only: c_double,c_int64_t
use, intrinsic :: ieee_arithmetic, only: ieee_is_finite
implicit none
private
public :: surface_data,capture_surface
type surface_data
    integer :: surface_type=0,mapped_function=0
    logical :: mapped=.false.,confirmed=.false.
    real(c_double) :: isovalue=0,bohr=0,kcal=0,ev=0
    real(c_double),allocatable :: xyz(:),values(:),vertex_ids(:)
    real(c_double),allocatable :: indices(:),areas(:),facet_values(:),facet_ids(:)
    real(c_double),allocatable :: extreme_vertex(:),extreme_kind(:),extreme_id(:)
end type
contains
subroutine capture_surface(data,read_mapping,message)
use defvar, only: b2a,au2kcal,au2ev
use surfvertex
type(surface_data),intent(out) :: data
! Mapping is read only after explicit user confirmation; an unmapped run leaves it undefined.
logical,intent(in) :: read_mapping
character(len=*),intent(out) :: message
integer,allocatable :: remap(:)
integer :: nv,nt,ne,status,i,j,k,idx,kind,nlocal
integer(c_int64_t) :: bytes
message='Surface analysis data are unavailable or invalid'
if (.not.allocated(survtx).or..not.allocated(surtriang)) return
if (.not.allocated(elimvtx).or..not.allocated(elimtri)) return
if (nsurvtx<1.or.nsurtri<1) return
if (nsurvtx>size(survtx).or.nsurvtx>size(elimvtx)) return
if (nsurtri>size(surtriang).or.nsurtri>size(elimtri)) return
if (.not.ieee_is_finite(surfisoval)) return
nv=count(elimvtx(1:nsurvtx)==0);nt=count(elimtri(1:nsurtri)==0);ne=0
if (nv==0.or.nt==0) return
if (read_mapping) then
    if (nsurlocmin<0.or.nsurlocmin>size(surlocminidx)) return
    if (nsurlocmax<0.or.nsurlocmax>size(surlocmaxidx)) return
    ne=count(surlocminidx(1:nsurlocmin)/=0)+count(surlocmaxidx(1:nsurlocmax)/=0)
end if
bytes=8_c_int64_t*(5_c_int64_t*nv+6_c_int64_t*nt+3_c_int64_t*ne)+4_c_int64_t*nsurvtx
if (bytes>256_c_int64_t*1024*1024) then
    message='Surface result exceeds the 256 MiB GUI snapshot budget';return
end if
allocate(remap(nsurvtx),data%xyz(3*nv),data%values(nv),data%vertex_ids(nv), &
    data%indices(3*nt),data%areas(nt),data%facet_values(nt),data%facet_ids(nt), &
    data%extreme_vertex(ne),data%extreme_kind(ne),data%extreme_id(ne),stat=status)
if (status/=0) then
    data=surface_data();message='Unable to allocate surface result snapshot';return
end if
remap=0;j=0
do i=1,nsurvtx
    if (elimvtx(i)/=0) cycle
    j=j+1;remap(i)=j
    data%xyz(3*j-2:3*j)=[survtx(i)%x,survtx(i)%y,survtx(i)%z]
    data%values(j)=0
    if (read_mapping) data%values(j)=survtx(i)%value
    data%vertex_ids(j)=i
end do
j=0
do i=1,nsurtri
    if (elimtri(i)/=0) cycle
    j=j+1
    do k=1,3
        idx=surtriang(i)%idx(k)
        if (idx<1.or.idx>nsurvtx) goto 900
        if (remap(idx)==0) goto 900
        data%indices(3*j-3+k)=remap(idx)-1
    end do
    data%areas(j)=surtriang(i)%area;data%facet_values(j)=0;data%facet_ids(j)=i
    if (read_mapping) data%facet_values(j)=surtriang(i)%value
end do
j=0
if (read_mapping) then
    do kind=-1,1,2
        nlocal=nsurlocmin
        if (kind==1) nlocal=nsurlocmax
        do i=1,nlocal
            idx=surlocminidx(i)
            if (kind==1) idx=surlocmaxidx(i)
            if (idx==0) cycle
            if (idx<1.or.idx>nsurvtx) goto 900
            if (remap(idx)==0) goto 900
            j=j+1;data%extreme_vertex(j)=remap(idx)-1;data%extreme_kind(j)=kind;data%extreme_id(j)=i
        end do
    end do
end if
if (.not.all(ieee_is_finite(data%xyz)).or..not.all(ieee_is_finite(data%values))) goto 900
if (.not.all(ieee_is_finite(data%areas)).or.any(data%areas<0)) goto 900
if (.not.all(ieee_is_finite(data%facet_values))) goto 900
data%mapped=read_mapping
data%isovalue=surfisoval
data%bohr=b2a;data%kcal=au2kcal;data%ev=au2ev
message='';return
900 data=surface_data()
end subroutine
end module
