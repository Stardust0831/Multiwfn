program surface_harness
use defvar
use surfvertex
use matterviz_surface
implicit none
type(surface_data) :: data
character(len=160) :: message
integer :: i
allocate(survtx(6),surtriang(4),elimvtx(6),elimtri(4))
nsurvtx=6;nsurtri=4;elimvtx=[0,1,0,0,1,0];elimtri=[0,1,0,0]
surfisoval=.001D0
do i=1,6
    survtx(i)%x=i;survtx(i)%y=-i;survtx(i)%z=2*i;survtx(i)%value=.01D0*i
end do
do i=1,4
    surtriang(i)%idx=[1,3,6];surtriang(i)%area=i;surtriang(i)%value=.02D0*i
end do
nsurlocmin=3;surlocminidx(1:3)=[1,0,3]
nsurlocmax=1;surlocmaxidx(1)=6
call capture_surface(data,1,1,0,10D0,message)
if (len_trim(message)/=0) stop 1
if (any(data%vertex_ids/=[1D0,3D0,4D0,6D0])) stop 2
if (any(data%indices/=[0D0,1D0,3D0,0D0,1D0,3D0,0D0,1D0,3D0])) stop 3
if (any(data%areas/=[1D0,3D0,4D0])) stop 4
if (any(data%extreme_id/=[1D0,3D0,1D0])) stop 5
if (any(data%extreme_vertex/=[0D0,1D0,3D0])) stop 6
if (data%volume/=10D0.or.data%isovalue/=.001D0) stop 7
! No-mapping analyses never read stale extrema or undefined mapped values.
nsurlocmin=-999;nsurlocmax=-999
call capture_surface(data,10,0,1,10D0,message)
if (len_trim(message)/=0.or.data%mapped) stop 8
if (size(data%extreme_id)/=0.or.any(data%values/=0D0).or.any(data%facet_values/=0D0)) stop 9
surtriang(1)%idx(1)=999
call capture_surface(data,10,0,1,10D0,message)
if (len_trim(message)==0.or.allocated(data%xyz)) stop 10
if (nsurvtx/=6.or.survtx(3)%value/=.03D0.or.elimvtx(2)/=1) stop 11
write(*,*) 'SURFACE_HARNESS_OK'
end program
