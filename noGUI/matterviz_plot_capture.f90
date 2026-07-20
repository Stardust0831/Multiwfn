! MatterViz's DISLIN boundary.  This module records plotting intent; it does
! not attempt to infer a scientific meaning from labels or point coordinates.
module matterviz_plot_capture
use, intrinsic :: ieee_arithmetic, only: ieee_is_finite
implicit none

integer,parameter :: matterviz_plot_max_series=128
integer,parameter :: matterviz_plot_max_labels=20000
integer,parameter :: matterviz_plot_label_length=160
integer,parameter :: matterviz_plot_max_panels=128
integer,parameter :: matterviz_plot_max_layers=512
integer,parameter :: matterviz_plot_max_palette=256

type :: matterviz_captured_series
    integer :: count=0
    real*8,allocatable :: x(:),y(:)
    integer,allocatable :: label_head(:),label_tail(:)
    real*8 :: xlow=0D0,xhigh=1D0,ylow=0D0,yhigh=1D0
    integer :: posx=0,posy=0,lenx=0,leny=0,width=1
    character(len=160) :: xlabel='',ylabel=''
    character(len=160) :: label=''
    character(len=7) :: color='#222222'
    logical :: dashed=.false.,sticks=.false. ! sticks retained only for v1 ABI compatibility
end type

type :: matterviz_plot_panel
    integer :: page_x=0,page_y=0,posx=0,posy=0,lenx=0,leny=0
    real*8 :: xlow=0D0,xhigh=1D0,ylow=0D0,yhigh=1D0
    real*8 :: zlow=0D0,zhigh=1D0
    real*8 :: xstep=0D0,ystep=0D0
    logical :: xlog=.false.,ylog=.false.
    logical :: has_x2=.false.,has_y2=.false.,x2log=.false.,y2log=.false.
    real*8 :: x2low=0D0,x2high=1D0,y2low=0D0,y2high=1D0
    character(len=160) :: x2label='',y2label=''
    character(len=160) :: xlabel='',ylabel=''
    character(len=32) :: labels_x='',labels_y='',digits_x='',digits_y=''
    integer :: layer_first=0,layer_count=0
end type

type :: matterviz_plot_layer
    character(len=16) :: kind=''
    integer :: panel=0,count=0,nx=0,ny=0,nz=0,series=0
    integer :: width=1,marker_interval=0,marker_symbol=0,hsymbol=0,legend=0
    logical :: dashed=.false.,marker=.false.
    logical :: use_x2=.false.,use_y2=.false.
    character(len=7) :: color='#222222'
    real*8,allocatable :: x(:),y(:),z(:),aux1(:),aux2(:),levels(:)
end type

type :: matterviz_plot_annotation
    integer :: panel=0
    real*8 :: x=0D0,y=0D0
    logical :: data_coordinates=.true.
    character(len=matterviz_plot_label_length) :: text=''
end type

logical :: matterviz_plot_interactive=.false.
integer :: matterviz_plot_series_count=0
integer :: matterviz_plot_legend_count=0,matterviz_plot_capture_error=0
integer :: matterviz_plot_label_count=0,matterviz_plot_stick_count=0
integer :: matterviz_plot_posx=0,matterviz_plot_posy=0
integer :: matterviz_plot_lenx=0,matterviz_plot_leny=0
integer :: matterviz_plot_page_x=0,matterviz_plot_page_y=0
integer :: matterviz_plot_width=1
real*8 :: matterviz_plot_xlow=0D0,matterviz_plot_xhigh=1D0
real*8 :: matterviz_plot_ylow=0D0,matterviz_plot_yhigh=1D0
real*8 :: matterviz_plot_zlow=0D0,matterviz_plot_zhigh=1D0
real*8 :: matterviz_plot_xstep=0D0,matterviz_plot_ystep=0D0
character(len=160) :: matterviz_plot_xlabel='',matterviz_plot_ylabel=''
character(len=160) :: matterviz_plot_title='',matterviz_plot_file=''
character(len=7) :: matterviz_plot_color='#222222'
logical :: matterviz_plot_dashed=.false.,matterviz_plot_xlog=.false.,matterviz_plot_ylog=.false.
logical :: matterviz_plot_legend_initialized=.false.
integer :: matterviz_plot_marker_interval=0,matterviz_plot_marker_symbol=0
integer :: matterviz_plot_hsymbol=0
logical :: matterviz_plot_marker_enabled=.false.
logical :: matterviz_plot_current_x2=.false.,matterviz_plot_current_y2=.false.
character(len=32) :: matterviz_plot_labels_x='',matterviz_plot_labels_y=''
character(len=32) :: matterviz_plot_digits_x='',matterviz_plot_digits_y=''
integer :: matterviz_plot_panel_count=0,matterviz_plot_layer_count=0
integer :: matterviz_plot_current_panel=0
type(matterviz_plot_panel) :: matterviz_plot_panels(matterviz_plot_max_panels)
type(matterviz_plot_layer),target :: matterviz_plot_layers(matterviz_plot_max_layers)
type(matterviz_plot_annotation) :: matterviz_plot_annotations(matterviz_plot_max_labels)
character(len=160) :: matterviz_plot_legends(matterviz_plot_max_series)
character(len=7) :: matterviz_plot_legend_colors(matterviz_plot_max_series)
integer :: matterviz_plot_legend_indices(matterviz_plot_max_series)
integer :: matterviz_plot_label_series(matterviz_plot_max_labels)
integer :: matterviz_plot_label_point(matterviz_plot_max_labels)
integer :: matterviz_plot_label_next(matterviz_plot_max_labels)
character(len=matterviz_plot_label_length) :: matterviz_plot_labels(matterviz_plot_max_labels)
real*8 :: matterviz_plot_palette_r(matterviz_plot_max_palette)
real*8 :: matterviz_plot_palette_g(matterviz_plot_max_palette)
real*8 :: matterviz_plot_palette_b(matterviz_plot_max_palette)
integer :: matterviz_plot_palette_count=0
character(len=160) :: matterviz_plot_palette_name=''

! Compatibility aliases used by the v1 GUI/tests.
type(matterviz_captured_series) :: matterviz_plot_series(matterviz_plot_max_series)

contains

subroutine matterviz_capture_reset()
integer :: i
matterviz_plot_series_count=0
matterviz_plot_legend_count=0; matterviz_plot_capture_error=0
matterviz_plot_label_count=0; matterviz_plot_stick_count=0
matterviz_plot_panel_count=0; matterviz_plot_layer_count=0; matterviz_plot_current_panel=0
matterviz_plot_current_x2=.false.; matterviz_plot_current_y2=.false.
matterviz_plot_legends=''; matterviz_plot_legend_colors=''; matterviz_plot_legend_indices=0
matterviz_plot_label_series=0; matterviz_plot_label_point=0; matterviz_plot_label_next=0; matterviz_plot_labels=''
matterviz_plot_annotations=matterviz_plot_annotation()
matterviz_plot_panels=matterviz_plot_panel(); matterviz_plot_layers=matterviz_plot_layer()
matterviz_plot_page_x=0; matterviz_plot_page_y=0; matterviz_plot_title=''; matterviz_plot_file=''
matterviz_plot_posx=0; matterviz_plot_posy=0; matterviz_plot_lenx=0; matterviz_plot_leny=0
matterviz_plot_width=1; matterviz_plot_xlow=0D0; matterviz_plot_xhigh=1D0
matterviz_plot_ylow=0D0; matterviz_plot_yhigh=1D0; matterviz_plot_zlow=0D0; matterviz_plot_zhigh=1D0
matterviz_plot_xstep=0D0; matterviz_plot_ystep=0D0; matterviz_plot_xlabel=''; matterviz_plot_ylabel=''
matterviz_plot_color='#222222'; matterviz_plot_dashed=.false.; matterviz_plot_xlog=.false.; matterviz_plot_ylog=.false.
matterviz_plot_labels_x=''; matterviz_plot_labels_y=''; matterviz_plot_digits_x=''; matterviz_plot_digits_y=''
matterviz_plot_legend_initialized=.false.; matterviz_plot_marker_interval=0; matterviz_plot_marker_symbol=0
matterviz_plot_hsymbol=0; matterviz_plot_marker_enabled=.false.; matterviz_plot_palette_count=0
matterviz_plot_palette_name=''
matterviz_plot_palette_r=0D0; matterviz_plot_palette_g=0D0; matterviz_plot_palette_b=0D0
do i=1,matterviz_plot_max_series
    if (allocated(matterviz_plot_series(i)%x)) deallocate(matterviz_plot_series(i)%x)
    if (allocated(matterviz_plot_series(i)%y)) deallocate(matterviz_plot_series(i)%y)
    if (allocated(matterviz_plot_series(i)%label_head)) deallocate(matterviz_plot_series(i)%label_head)
    if (allocated(matterviz_plot_series(i)%label_tail)) deallocate(matterviz_plot_series(i)%label_tail)
    matterviz_plot_series(i)=matterviz_captured_series()
end do
end subroutine

subroutine free_layer(layer)
type(matterviz_plot_layer),intent(inout) :: layer
if (allocated(layer%x)) deallocate(layer%x)
if (allocated(layer%y)) deallocate(layer%y)
if (allocated(layer%z)) deallocate(layer%z)
if (allocated(layer%aux1)) deallocate(layer%aux1)
if (allocated(layer%aux2)) deallocate(layer%aux2)
if (allocated(layer%levels)) deallocate(layer%levels)
layer=matterviz_plot_layer()
end subroutine

subroutine matterviz_capture_metafl(value)
character(len=*),intent(in) :: value
matterviz_plot_interactive=trim(adjustl(value))=='xwin'
end subroutine
subroutine matterviz_capture_page(nx,ny)
integer,intent(in) :: nx,ny
matterviz_plot_page_x=nx; matterviz_plot_page_y=ny
end subroutine
subroutine matterviz_capture_window_size(nx,ny)
integer,intent(in) :: nx,ny
matterviz_plot_page_x=nx; matterviz_plot_page_y=ny
end subroutine
subroutine matterviz_capture_window_title(value)
character(len=*),intent(in) :: value
matterviz_plot_title=trim(adjustl(value))
end subroutine
subroutine matterviz_capture_setfile(value)
character(len=*),intent(in) :: value
matterviz_plot_file=trim(adjustl(value))
end subroutine

subroutine matterviz_capture_legend_init()
matterviz_plot_legend_initialized=.true.
end subroutine
subroutine matterviz_capture_legend(value,index)
character(len=*),intent(in) :: value
integer,intent(in),optional :: index
if (matterviz_plot_capture_error/=0) return
if (matterviz_plot_legend_count>=matterviz_plot_max_series) then
    matterviz_plot_capture_error=3; return
end if
matterviz_plot_legend_count=matterviz_plot_legend_count+1
matterviz_plot_legends(matterviz_plot_legend_count)=trim(adjustl(value))
matterviz_plot_legend_colors(matterviz_plot_legend_count)=matterviz_plot_color
if (present(index)) then
    matterviz_plot_legend_indices(matterviz_plot_legend_count)=index
else
    matterviz_plot_legend_indices(matterviz_plot_legend_count)=matterviz_plot_legend_count
end if
end subroutine
subroutine matterviz_capture_resolve_legends()
integer :: i,j,k
do i=1,matterviz_plot_series_count
    matterviz_plot_series(i)%label=''
end do
do i=1,matterviz_plot_legend_count
    j=matterviz_plot_legend_indices(i)
    if (j>=1.and.j<=matterviz_plot_series_count) matterviz_plot_series(j)%label=trim(matterviz_plot_legends(i))
    do k=1,matterviz_plot_layer_count
        if (matterviz_plot_layers(k)%legend==0.and.j==matterviz_plot_layers(k)%series) then
            matterviz_plot_layers(k)%legend=i
        end if
    end do
end do
end subroutine

subroutine matterviz_capture_axis_length(xlen,ylen)
integer,intent(in) :: xlen,ylen
matterviz_plot_lenx=xlen; matterviz_plot_leny=ylen
end subroutine
subroutine matterviz_capture_axis_position(xpos,ypos)
integer,intent(in) :: xpos,ypos
matterviz_plot_posx=xpos; matterviz_plot_posy=ypos
end subroutine
subroutine matterviz_capture_name(value,axis)
character(len=*),intent(in) :: value,axis
if (index(axis,'X')>0.or.index(axis,'x')>0) matterviz_plot_xlabel=matterviz_plain_label(value)
if (index(axis,'Y')>0.or.index(axis,'y')>0) matterviz_plot_ylabel=matterviz_plain_label(value)
call sync_panel()
end subroutine
subroutine matterviz_capture_axis_scale(option,axis)
character(len=*),intent(in) :: option,axis
if (index(axis,'X')>0.or.index(axis,'x')>0) then
    matterviz_plot_xlog=index(trim(adjustl(option)),'LOG')>0.or.index(trim(adjustl(option)),'log')>0
    matterviz_plot_labels_x=trim(adjustl(option))
else if (index(axis,'Y')>0.or.index(axis,'y')>0) then
    matterviz_plot_ylog=index(trim(adjustl(option)),'LOG')>0.or.index(trim(adjustl(option)),'log')>0
    matterviz_plot_labels_y=trim(adjustl(option))
end if
call sync_panel()
end subroutine
subroutine matterviz_capture_axis_labels(option,axis)
character(len=*),intent(in) :: option,axis
if (index(axis,'X')>0.or.index(axis,'x')>0) matterviz_plot_labels_x=trim(adjustl(option))
if (index(axis,'Y')>0.or.index(axis,'y')>0) matterviz_plot_labels_y=trim(adjustl(option))
call sync_panel()
end subroutine
subroutine matterviz_capture_label_digits(value,axis)
integer,intent(in) :: value
character(len=*),intent(in) :: axis
if (index(axis,'X')>0.or.index(axis,'x')>0) write(matterviz_plot_digits_x,'(i0)') value
if (index(axis,'Y')>0.or.index(axis,'y')>0) write(matterviz_plot_digits_y,'(i0)') value
call sync_panel()
end subroutine

subroutine sync_panel()
real*8 :: physical_low,physical_high
if (matterviz_plot_current_panel<=0) return
if (matterviz_plot_current_x2) then
    if (matterviz_plot_xlog.and..not.matterviz_log_range_to_physical( &
        matterviz_plot_panels(matterviz_plot_current_panel)%x2low, &
        matterviz_plot_panels(matterviz_plot_current_panel)%x2high, &
        physical_low,physical_high)) then
        matterviz_plot_capture_error=10; return
    end if
    matterviz_plot_panels(matterviz_plot_current_panel)%x2label=matterviz_plot_xlabel
    matterviz_plot_panels(matterviz_plot_current_panel)%x2log=matterviz_plot_xlog
else
    if (matterviz_plot_xlog.and..not.matterviz_log_range_to_physical( &
        matterviz_plot_panels(matterviz_plot_current_panel)%xlow, &
        matterviz_plot_panels(matterviz_plot_current_panel)%xhigh, &
        physical_low,physical_high)) then
        matterviz_plot_capture_error=10; return
    end if
    matterviz_plot_panels(matterviz_plot_current_panel)%xlabel=matterviz_plot_xlabel
    matterviz_plot_panels(matterviz_plot_current_panel)%xlog=matterviz_plot_xlog
end if
if (matterviz_plot_current_y2) then
    if (matterviz_plot_ylog.and..not.matterviz_log_range_to_physical( &
        matterviz_plot_panels(matterviz_plot_current_panel)%y2low, &
        matterviz_plot_panels(matterviz_plot_current_panel)%y2high, &
        physical_low,physical_high)) then
        matterviz_plot_capture_error=10; return
    end if
    matterviz_plot_panels(matterviz_plot_current_panel)%y2label=matterviz_plot_ylabel
    matterviz_plot_panels(matterviz_plot_current_panel)%y2log=matterviz_plot_ylog
else
    if (matterviz_plot_ylog.and..not.matterviz_log_range_to_physical( &
        matterviz_plot_panels(matterviz_plot_current_panel)%ylow, &
        matterviz_plot_panels(matterviz_plot_current_panel)%yhigh, &
        physical_low,physical_high)) then
        matterviz_plot_capture_error=10; return
    end if
    matterviz_plot_panels(matterviz_plot_current_panel)%ylabel=matterviz_plot_ylabel
    matterviz_plot_panels(matterviz_plot_current_panel)%ylog=matterviz_plot_ylog
end if
matterviz_plot_panels(matterviz_plot_current_panel)%labels_x=matterviz_plot_labels_x
matterviz_plot_panels(matterviz_plot_current_panel)%labels_y=matterviz_plot_labels_y
matterviz_plot_panels(matterviz_plot_current_panel)%digits_x=matterviz_plot_digits_x
matterviz_plot_panels(matterviz_plot_current_panel)%digits_y=matterviz_plot_digits_y
end subroutine

function matterviz_plain_label(value) result(plain)
character(len=*),intent(in) :: value
character(len=:),allocatable :: plain
plain=trim(value)
plain=matterviz_replace_all(plain,'$^{-1}$','^-1'); plain=matterviz_replace_all(plain,'$^2$','^2')
plain=matterviz_replace_all(plain,'$^4$','^4'); plain=matterviz_replace_all(plain,'$\epsilon$','epsilon')
end function
function matterviz_replace_all(value,token,replacement) result(output)
character(len=*),intent(in) :: value,token,replacement
character(len=:),allocatable :: output
integer :: found,start
output=''; start=1
do
    if (start>len(value)) exit
    found=index(value(start:),token)
    if (found==0) then; output=output//value(start:); exit; end if
    found=start+found-1; output=output//value(start:found-1)//replacement; start=found+len(token)
end do
end function

subroutine matterviz_capture_graph(xlow,xhigh,ylow,yhigh,xstep,ystep)
real*8,intent(in) :: xlow,xhigh,ylow,yhigh
real*8,intent(in),optional :: xstep,ystep
if (present(xstep)) matterviz_plot_xstep=xstep
if (present(ystep)) matterviz_plot_ystep=ystep
call begin_panel(xlow,xhigh,ylow,yhigh,0D0,1D0,matterviz_plot_xstep,matterviz_plot_ystep)
end subroutine
subroutine matterviz_capture_graph3(xlow,xhigh,ylow,yhigh,zlow,zhigh,xstep,ystep)
real*8,intent(in) :: xlow,xhigh,ylow,yhigh,zlow,zhigh
real*8,intent(in),optional :: xstep,ystep
if (present(xstep)) matterviz_plot_xstep=xstep
if (present(ystep)) matterviz_plot_ystep=ystep
call begin_panel(xlow,xhigh,ylow,yhigh,zlow,zhigh,matterviz_plot_xstep,matterviz_plot_ystep)
end subroutine
subroutine begin_panel(xlow,xhigh,ylow,yhigh,zlow,zhigh,xstep,ystep)
real*8,intent(in) :: xlow,xhigh,ylow,yhigh,zlow,zhigh,xstep,ystep
real*8 :: physical_low,physical_high
integer :: existing
if (matterviz_plot_capture_error/=0) return
if (matterviz_plot_xlog.and..not.matterviz_log_range_to_physical(xlow,xhigh, &
    physical_low,physical_high)) then
    matterviz_plot_capture_error=10; return
end if
if (matterviz_plot_ylog.and..not.matterviz_log_range_to_physical(ylow,yhigh, &
    physical_low,physical_high)) then
    matterviz_plot_capture_error=10; return
end if
existing=0
if (matterviz_plot_panel_count>0) then
    if (matterviz_plot_panels(matterviz_plot_panel_count)%posx==matterviz_plot_posx.and. &
        matterviz_plot_panels(matterviz_plot_panel_count)%posy==matterviz_plot_posy.and. &
        matterviz_plot_panels(matterviz_plot_panel_count)%lenx==matterviz_plot_lenx.and. &
        matterviz_plot_panels(matterviz_plot_panel_count)%leny==matterviz_plot_leny) existing=matterviz_plot_panel_count
end if
if (existing>0) then
    matterviz_plot_current_panel=existing
    matterviz_plot_current_x2=xlow/=matterviz_plot_panels(existing)%xlow.or.xhigh/=matterviz_plot_panels(existing)%xhigh
    matterviz_plot_current_y2=ylow/=matterviz_plot_panels(existing)%ylow.or.yhigh/=matterviz_plot_panels(existing)%yhigh
    if (matterviz_plot_current_x2) then
        if (matterviz_plot_xlog.and..not.matterviz_log_range_to_physical(xlow,xhigh, &
            physical_low,physical_high)) then
            matterviz_plot_capture_error=10; return
        end if
        if (matterviz_plot_panels(existing)%has_x2.and. &
            (xlow/=matterviz_plot_panels(existing)%x2low.or.xhigh/=matterviz_plot_panels(existing)%x2high)) then
            matterviz_plot_capture_error=9; return
        end if
        matterviz_plot_panels(existing)%has_x2=.true.; matterviz_plot_panels(existing)%x2low=xlow
        matterviz_plot_panels(existing)%x2high=xhigh; matterviz_plot_panels(existing)%x2label=matterviz_plot_xlabel
        matterviz_plot_panels(existing)%x2log=matterviz_plot_xlog
    end if
    if (matterviz_plot_current_y2) then
        if (matterviz_plot_ylog.and..not.matterviz_log_range_to_physical(ylow,yhigh, &
            physical_low,physical_high)) then
            matterviz_plot_capture_error=10; return
        end if
        if (matterviz_plot_panels(existing)%has_y2.and. &
            (ylow/=matterviz_plot_panels(existing)%y2low.or.yhigh/=matterviz_plot_panels(existing)%y2high)) then
            matterviz_plot_capture_error=9; return
        end if
        matterviz_plot_panels(existing)%has_y2=.true.; matterviz_plot_panels(existing)%y2low=ylow
        matterviz_plot_panels(existing)%y2high=yhigh; matterviz_plot_panels(existing)%y2label=matterviz_plot_ylabel
        matterviz_plot_panels(existing)%y2log=matterviz_plot_ylog
    end if
    return
end if
if (matterviz_plot_panel_count>=matterviz_plot_max_panels) then; matterviz_plot_capture_error=7; return; end if
matterviz_plot_panel_count=matterviz_plot_panel_count+1; matterviz_plot_current_panel=matterviz_plot_panel_count
matterviz_plot_current_x2=.false.; matterviz_plot_current_y2=.false.
matterviz_plot_xlow=xlow; matterviz_plot_xhigh=xhigh; matterviz_plot_ylow=ylow; matterviz_plot_yhigh=yhigh
matterviz_plot_zlow=zlow; matterviz_plot_zhigh=zhigh
matterviz_plot_panels(matterviz_plot_current_panel)%xlow=xlow; matterviz_plot_panels(matterviz_plot_current_panel)%xhigh=xhigh
matterviz_plot_panels(matterviz_plot_current_panel)%ylow=ylow; matterviz_plot_panels(matterviz_plot_current_panel)%yhigh=yhigh
matterviz_plot_panels(matterviz_plot_current_panel)%zlow=zlow; matterviz_plot_panels(matterviz_plot_current_panel)%zhigh=zhigh
matterviz_plot_panels(matterviz_plot_current_panel)%xstep=xstep; matterviz_plot_panels(matterviz_plot_current_panel)%ystep=ystep
matterviz_plot_panels(matterviz_plot_current_panel)%posx=matterviz_plot_posx
matterviz_plot_panels(matterviz_plot_current_panel)%posy=matterviz_plot_posy
matterviz_plot_panels(matterviz_plot_current_panel)%lenx=matterviz_plot_lenx
matterviz_plot_panels(matterviz_plot_current_panel)%leny=matterviz_plot_leny
matterviz_plot_panels(matterviz_plot_current_panel)%page_x=matterviz_plot_page_x
matterviz_plot_panels(matterviz_plot_current_panel)%page_y=matterviz_plot_page_y
matterviz_plot_panels(matterviz_plot_current_panel)%xlabel=matterviz_plot_xlabel
matterviz_plot_panels(matterviz_plot_current_panel)%ylabel=matterviz_plot_ylabel
matterviz_plot_panels(matterviz_plot_current_panel)%xlog=matterviz_plot_xlog
matterviz_plot_panels(matterviz_plot_current_panel)%ylog=matterviz_plot_ylog
matterviz_plot_panels(matterviz_plot_current_panel)%labels_x=matterviz_plot_labels_x
matterviz_plot_panels(matterviz_plot_current_panel)%labels_y=matterviz_plot_labels_y
matterviz_plot_panels(matterviz_plot_current_panel)%digits_x=matterviz_plot_digits_x
matterviz_plot_panels(matterviz_plot_current_panel)%digits_y=matterviz_plot_digits_y
matterviz_plot_xstep=xstep; matterviz_plot_ystep=ystep
end subroutine
subroutine matterviz_capture_end_graph()
! ENDGRF closes a panel; subsequent GRAF starts a new one.
matterviz_plot_current_panel=0
matterviz_plot_current_x2=.false.; matterviz_plot_current_y2=.false.
end subroutine
subroutine matterviz_capture_axis2graph()
end subroutine

subroutine matterviz_capture_color_name(value)
character(len=*),intent(in) :: value
select case(trim(adjustl(value)))
case('RED'); matterviz_plot_color='#d62728'
case('GREEN'); matterviz_plot_color='#2ca02c'
case('BLUE'); matterviz_plot_color='#1f77b4'
case('CYAN'); matterviz_plot_color='#17becf'
case('YELLOW'); matterviz_plot_color='#bcbd22'
case('ORANGE'); matterviz_plot_color='#ff7f0e'
case('MAGENTA'); matterviz_plot_color='#e377c2'
case('BLACK'); matterviz_plot_color='#000000'
case default; matterviz_plot_color='#222222'
end select
end subroutine
subroutine matterviz_capture_rgb(red,green,blue)
real*8,intent(in) :: red,green,blue
integer :: r,g,b
r=max(0,min(255,nint(red*255D0))); g=max(0,min(255,nint(green*255D0))); b=max(0,min(255,nint(blue*255D0)))
write(matterviz_plot_color,"('#',z2.2,z2.2,z2.2)") r,g,b
end subroutine
subroutine matterviz_capture_line_width(width)
integer,intent(in) :: width
matterviz_plot_width=max(1,width)
end subroutine
subroutine matterviz_capture_dash(enabled)
logical,intent(in) :: enabled
matterviz_plot_dashed=enabled
end subroutine
subroutine matterviz_capture_marker_interval(value)
integer,intent(in) :: value
matterviz_plot_marker_interval=value; matterviz_plot_marker_enabled=value/=0
end subroutine
subroutine matterviz_capture_marker(value)
integer,intent(in) :: value
matterviz_plot_marker_symbol=value
end subroutine
subroutine matterviz_capture_hsymbol(value)
integer,intent(in) :: value
matterviz_plot_hsymbol=value
end subroutine

subroutine append_layer(kind,n,x,y,z,aux1,aux2,nx,ny,nz,levels)
character(len=*),intent(in) :: kind
integer,intent(in) :: n
real*8,intent(in),optional :: x(:),y(:),z(:),aux1(:),aux2(:),levels(:)
integer,intent(in),optional :: nx,ny,nz
type(matterviz_plot_layer),pointer :: layer
integer :: need,allocation_status
if (matterviz_plot_capture_error/=0) return
if (matterviz_plot_current_panel<=0) then; matterviz_plot_capture_error=6; return; end if
if (matterviz_plot_layer_count>=matterviz_plot_max_layers) then; matterviz_plot_capture_error=7; return; end if
need=max(0,n)
matterviz_plot_layer_count=matterviz_plot_layer_count+1; layer=>matterviz_plot_layers(matterviz_plot_layer_count)
layer%kind=trim(kind); layer%panel=matterviz_plot_current_panel; layer%count=need
layer%width=matterviz_plot_width; layer%dashed=matterviz_plot_dashed; layer%color=matterviz_plot_color
layer%marker=matterviz_plot_marker_enabled; layer%marker_interval=matterviz_plot_marker_interval
layer%use_x2=matterviz_plot_current_x2; layer%use_y2=matterviz_plot_current_y2
layer%marker_symbol=matterviz_plot_marker_symbol; layer%hsymbol=matterviz_plot_hsymbol
if (present(nx)) layer%nx=nx; if (present(ny)) layer%ny=ny; if (present(nz)) layer%nz=nz
if (present(x)) then; allocate(layer%x(size(x)),stat=allocation_status); if (allocation_status/=0) goto 900; layer%x=x; end if
if (present(y)) then; allocate(layer%y(size(y)),stat=allocation_status); if (allocation_status/=0) goto 900; layer%y=y; end if
if (present(z)) then; allocate(layer%z(size(z)),stat=allocation_status); if (allocation_status/=0) goto 900; layer%z=z; end if
if (present(aux1)) then
    allocate(layer%aux1(size(aux1)),stat=allocation_status)
    if (allocation_status/=0) goto 900
    layer%aux1=aux1
end if
if (present(aux2)) then
    allocate(layer%aux2(size(aux2)),stat=allocation_status)
    if (allocation_status/=0) goto 900
    layer%aux2=aux2
end if
if (present(levels)) then
    allocate(layer%levels(size(levels)),stat=allocation_status)
    if (allocation_status/=0) goto 900
    layer%levels=levels
end if
matterviz_plot_panels(matterviz_plot_current_panel)%layer_count=matterviz_plot_panels(matterviz_plot_current_panel)%layer_count+1
if (matterviz_plot_panels(matterviz_plot_current_panel)%layer_first==0) then
    matterviz_plot_panels(matterviz_plot_current_panel)%layer_first=matterviz_plot_layer_count
end if
return
900 call free_layer(layer); matterviz_plot_layer_count=matterviz_plot_layer_count-1; matterviz_plot_capture_error=2
end subroutine

subroutine matterviz_capture_curve(x,y,count)
integer,intent(in) :: count
real*8,intent(in) :: x(count),y(count)
integer :: idx,allocation_status
if (.not.matterviz_plot_interactive.or.matterviz_plot_capture_error/=0.or.count<=0) return
if (matterviz_plot_series_count>=matterviz_plot_max_series) then; matterviz_plot_capture_error=1; return; end if
matterviz_plot_series_count=matterviz_plot_series_count+1; idx=matterviz_plot_series_count
allocate(matterviz_plot_series(idx)%x(count),matterviz_plot_series(idx)%y(count), &
    matterviz_plot_series(idx)%label_head(count),matterviz_plot_series(idx)%label_tail(count),stat=allocation_status)
if (allocation_status/=0) then
    matterviz_plot_capture_error=2
    matterviz_plot_series_count=matterviz_plot_series_count-1
    return
end if
matterviz_plot_series(idx)%x=x; matterviz_plot_series(idx)%y=y
matterviz_plot_series(idx)%label_head=0; matterviz_plot_series(idx)%label_tail=0
matterviz_plot_series(idx)%count=count
matterviz_plot_series(idx)%xlow=matterviz_plot_xlow
matterviz_plot_series(idx)%xhigh=matterviz_plot_xhigh
matterviz_plot_series(idx)%ylow=matterviz_plot_ylow
matterviz_plot_series(idx)%yhigh=matterviz_plot_yhigh
matterviz_plot_series(idx)%posx=matterviz_plot_posx
matterviz_plot_series(idx)%posy=matterviz_plot_posy
matterviz_plot_series(idx)%lenx=matterviz_plot_lenx
matterviz_plot_series(idx)%leny=matterviz_plot_leny
matterviz_plot_series(idx)%width=matterviz_plot_width
matterviz_plot_series(idx)%xlabel=matterviz_plot_xlabel
matterviz_plot_series(idx)%ylabel=matterviz_plot_ylabel
matterviz_plot_series(idx)%color=matterviz_plot_color
matterviz_plot_series(idx)%dashed=matterviz_plot_dashed
matterviz_plot_series(idx)%sticks=.false.
if (matterviz_plot_marker_interval<0) then
    call append_layer('scatter',count,x=x,y=y)
else if (matterviz_plot_marker_interval>0) then
    call append_layer('line+scatter',count,x=x,y=y)
else
    call append_layer('line',count,x=x,y=y)
end if
if (matterviz_plot_capture_error/=0) return
matterviz_plot_layers(matterviz_plot_layer_count)%series=idx
end subroutine

subroutine matterviz_capture_bars(x,y1,y2,n)
integer,intent(in) :: n; real*8,intent(inout) :: x(n),y1(n),y2(n)
! DISLIN bars span y1..y2.  Store the visible endpoint as y and the start as baseline.
call append_layer('bars',n,x=x,y=y2,aux1=y1)
end subroutine
subroutine matterviz_capture_fbars(x,y1,y2,y3,y4,n)
integer,intent(in) :: n; real*8,intent(in) :: x(n),y1(n),y2(n),y3(n),y4(n)
call append_layer('fbars',n,x=x,y=y1,aux1=y2,aux2=y3,levels=y4)
end subroutine
subroutine matterviz_capture_errbar(x,y,e1,e2,n)
integer,intent(in) :: n; real*8,intent(in) :: x(n),y(n),e1(n),e2(n)
call append_layer('errorbar',n,x=x,y=y,aux1=e1,aux2=e2)
end subroutine
subroutine matterviz_capture_shdcrv(x1,y1,n1,x2,y2,n2)
integer,intent(in) :: n1,n2; real*8,intent(in) :: x1(n1),y1(n1),x2(n2),y2(n2)
call append_layer('fill',n1+n2,x=x1,y=y1,aux1=x2,aux2=y2)
end subroutine
subroutine matterviz_capture_area(ix,iy,n)
integer,intent(in) :: n; integer,intent(in) :: ix(n),iy(n); real*8 :: x(n),y(n)
x=dble(ix); y=dble(iy); call append_layer('area',n,x=x,y=y)
end subroutine
subroutine matterviz_capture_crvmat(z,ixdim,iydim,ixpts,iypts)
integer,intent(in) :: ixdim,iydim,ixpts,iypts; real*8,intent(in) :: z(ixdim,iydim)
call matterviz_capture_unsupported('crvmat')
end subroutine
subroutine matterviz_capture_conshd(x,n,y,m,z,lev,nlev)
integer,intent(in) :: n,m,nlev; real*8,intent(in) :: x(n),y(m),z(n,m),lev(nlev)
call matterviz_capture_unsupported('conshd')
end subroutine
subroutine matterviz_capture_contur(x,n,y,m,z,lev)
integer,intent(in) :: n,m; real*8,intent(in) :: x(n),y(m),z(n,m),lev
real*8 :: flat(n*m)
flat=reshape(z,(/n*m/)); call append_layer('contour',n*m,x=x,y=y,z=flat,levels=(/lev/),nx=n,ny=m)
end subroutine
subroutine matterviz_capture_stream(xmat,ymat,nx,ny,xp,yp,xs,ys,n)
integer,intent(in) :: nx,ny,n; real*8,intent(in) :: xmat(nx,ny),ymat(nx,ny),xp(nx),yp(ny),xs(n),ys(n)
! STREAM includes seed and integration semantics that the current renderer cannot reproduce.
! Reject the complete scene instead of displaying a plausible but scientifically different plot.
call matterviz_capture_unsupported('stream')
end subroutine
subroutine matterviz_capture_surshd(x,ixdim,y,iydim,z)
integer,intent(in) :: ixdim,iydim; real*8,intent(in) :: x(ixdim),y(iydim),z(ixdim,iydim)
call matterviz_capture_unsupported('surshd')
end subroutine

subroutine matterviz_capture_label(value,x,y)
character(len=*),intent(in) :: value; real*8,intent(in) :: x,y
integer :: idx,point_idx,best_series,best_point
real*8 :: xspan,yspan,score,best_score
if (.not.matterviz_plot_interactive.or.matterviz_plot_capture_error/=0.or.len_trim(value)==0) return
if (matterviz_plot_label_count>=matterviz_plot_max_labels.or. &
    len_trim(value)>matterviz_plot_label_length) then
    matterviz_plot_capture_error=4
    return
end if
matterviz_plot_label_count=matterviz_plot_label_count+1; idx=matterviz_plot_label_count
matterviz_plot_annotations(idx)%panel=matterviz_plot_current_panel
matterviz_plot_annotations(idx)%x=x; matterviz_plot_annotations(idx)%y=y
matterviz_plot_annotations(idx)%data_coordinates=.true.
matterviz_plot_annotations(idx)%text=trim(adjustl(value)); matterviz_plot_label_series(idx)=0; matterviz_plot_label_point(idx)=0
! Keep the v1 nearest-point index solely for compatibility. The new annotation is independent.
best_series=0; best_point=0; best_score=huge(1D0)
do idx=1,matterviz_plot_series_count
    if (matterviz_plot_series(idx)%posx/=matterviz_plot_posx.or.matterviz_plot_series(idx)%posy/=matterviz_plot_posy) cycle
    xspan=max(abs(matterviz_plot_series(idx)%xhigh- &
        matterviz_plot_series(idx)%xlow),tiny(1D0))
    yspan=max(abs(matterviz_plot_series(idx)%yhigh- &
        matterviz_plot_series(idx)%ylow),tiny(1D0))
    do point_idx=1,matterviz_plot_series(idx)%count
        score=abs(matterviz_plot_series(idx)%x(point_idx)-x)/xspan+abs(matterviz_plot_series(idx)%y(point_idx)-y)/yspan
        if (score<best_score) then; best_score=score; best_series=idx; best_point=point_idx; end if
    end do
end do
if (best_series>0) then
    matterviz_plot_label_series(matterviz_plot_label_count)=best_series
    matterviz_plot_label_point(matterviz_plot_label_count)=best_point
    if (matterviz_plot_series(best_series)%label_head(best_point)==0) then
        matterviz_plot_series(best_series)%label_head(best_point)=matterviz_plot_label_count
    else; matterviz_plot_label_next(matterviz_plot_series(best_series)%label_tail(best_point))=matterviz_plot_label_count; end if
    matterviz_plot_series(best_series)%label_tail(best_point)=matterviz_plot_label_count
end if
end subroutine

subroutine matterviz_capture_symbol(value,x,y)
integer,intent(in) :: value; real*8,intent(in) :: x,y
real*8 :: xx(1),yy(1); xx(1)=x; yy(1)=y
call matterviz_capture_marker(value); call append_layer('symbol',1,x=xx,y=yy)
end subroutine
subroutine matterviz_capture_message(value,x,y)
character(len=*),intent(in) :: value; integer,intent(in) :: x,y
if (matterviz_plot_capture_error/=0) return
if (matterviz_plot_label_count>=matterviz_plot_max_labels.or. &
    len_trim(value)>matterviz_plot_label_length) then
    matterviz_plot_capture_error=4
    return
end if
matterviz_plot_label_count=matterviz_plot_label_count+1
matterviz_plot_annotations(matterviz_plot_label_count)%panel=matterviz_plot_current_panel
matterviz_plot_annotations(matterviz_plot_label_count)%x=dble(x); matterviz_plot_annotations(matterviz_plot_label_count)%y=dble(y)
matterviz_plot_annotations(matterviz_plot_label_count)%data_coordinates=.false.
matterviz_plot_annotations(matterviz_plot_label_count)%text=trim(adjustl(value))
end subroutine

subroutine matterviz_capture_setvlt(value)
character(len=*),intent(in) :: value
matterviz_plot_palette_name=trim(adjustl(value))
end subroutine
subroutine matterviz_capture_myvlt(r,g,b,n)
integer,intent(in) :: n; real*8,intent(in) :: r(n),g(n),b(n)
if (n>matterviz_plot_max_palette) then; matterviz_plot_capture_error=8; return; end if
matterviz_plot_palette_count=n; matterviz_plot_palette_r(1:n)=r; matterviz_plot_palette_g(1:n)=g; matterviz_plot_palette_b(1:n)=b
end subroutine
subroutine matterviz_capture_unsupported(name)
character(len=*),intent(in) :: name
if (matterviz_plot_interactive.and.matterviz_plot_capture_error==0) matterviz_plot_capture_error=9
end subroutine

logical function matterviz_capture_supported()
matterviz_capture_supported=matterviz_plot_capture_error==0.and.matterviz_plot_panel_count>0.and.matterviz_plot_layer_count>0
end function
function matterviz_capture_error_message() result(message)
character(len=120) :: message
select case(matterviz_plot_capture_error)
case(1); message='too many curve series (limit 128)'
case(2); message='insufficient memory for plot capture'
case(3); message='too many legend entries (limit 128)'
case(4); message='too many or oversized annotations (limits 20000 and 160 characters)'
case(7); message='too many panels or plot layers (capture aborted)'
case(8); message='palette exceeds capture limit (256 colors)'
case(9); message='unsupported data-bearing 2D DISLIN primitive'
case(10); message='log axis exponent range is not representable as finite positive values'
case default; message='invalid MatterViz plot capture'
end select
end function

logical function matterviz_log_range_to_physical(low,high,physical_low,physical_high)
real*8,intent(in) :: low,high
real*8,intent(out) :: physical_low,physical_high
real*8 :: lower_limit,upper_limit

matterviz_log_range_to_physical=.false.; physical_low=0D0; physical_high=0D0
if (.not.ieee_is_finite(low).or..not.ieee_is_finite(high)) return
lower_limit=log10(tiny(1D0)); upper_limit=log10(huge(1D0))
if (low<lower_limit.or.low>upper_limit.or.high<lower_limit.or.high>upper_limit) return
physical_low=10D0**low; physical_high=10D0**high
if (.not.ieee_is_finite(physical_low).or..not.ieee_is_finite(physical_high)) return
if (physical_low<=0D0.or.physical_high<=0D0) return
matterviz_log_range_to_physical=.true.
end function

real*8 function matterviz_viewport_top(posy,leny,page_y)
integer,intent(in) :: posy,leny
real*8,intent(in) :: page_y
matterviz_viewport_top=max(0D0,min(1D0-1D-6, &
    (dble(posy)-dble(leny)+1D0)/max(1D0,page_y)))
end function

real*8 function matterviz_panel_annotation_y(value,posy,leny)
real*8,intent(in) :: value
integer,intent(in) :: posy,leny
matterviz_panel_annotation_y=(value-dble(posy)+dble(leny)-1D0)/dble(max(1,leny))
end function
end module
