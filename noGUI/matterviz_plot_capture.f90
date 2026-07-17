module matterviz_plot_capture
implicit none

integer,parameter :: matterviz_plot_max_series=128
integer,parameter :: matterviz_plot_max_points=2000000
integer,parameter :: matterviz_plot_max_labels=20000
integer,parameter :: matterviz_plot_label_length=160

type :: matterviz_captured_series
    integer :: count=0
    real*8,allocatable :: x(:),y(:)
    integer,allocatable :: label_head(:),label_tail(:)
    real*8 :: xlow=0D0,xhigh=1D0,ylow=0D0,yhigh=1D0
    integer :: posx=0,posy=0,lenx=0,leny=0,width=1
    character(len=160) :: xlabel='',ylabel=''
    character(len=160) :: label=''
    character(len=7) :: color='#222222'
    logical :: dashed=.false.,sticks=.false.
end type

logical :: matterviz_plot_interactive=.false.
integer :: matterviz_plot_series_count=0,matterviz_plot_point_count=0
integer :: matterviz_plot_legend_count=0
integer :: matterviz_plot_capture_error=0
integer :: matterviz_plot_label_count=0
integer :: matterviz_plot_stick_count=0
integer :: matterviz_plot_posx=0,matterviz_plot_posy=0
integer :: matterviz_plot_lenx=0,matterviz_plot_leny=0
integer :: matterviz_plot_width=1
real*8 :: matterviz_plot_xlow=0D0,matterviz_plot_xhigh=1D0
real*8 :: matterviz_plot_ylow=0D0,matterviz_plot_yhigh=1D0
character(len=160) :: matterviz_plot_xlabel='',matterviz_plot_ylabel=''
character(len=7) :: matterviz_plot_color='#222222'
logical :: matterviz_plot_dashed=.false.
logical :: matterviz_plot_legend_initialized=.false.
type(matterviz_captured_series) :: matterviz_plot_series(matterviz_plot_max_series)
character(len=160) :: matterviz_plot_legends(matterviz_plot_max_series)
character(len=7) :: matterviz_plot_legend_colors(matterviz_plot_max_series)
integer :: matterviz_plot_label_series(matterviz_plot_max_labels)
integer :: matterviz_plot_label_point(matterviz_plot_max_labels)
integer :: matterviz_plot_label_next(matterviz_plot_max_labels)
character(len=matterviz_plot_label_length) :: matterviz_plot_labels(matterviz_plot_max_labels)

contains

subroutine matterviz_capture_metafl(value)
character(len=*),intent(in) :: value
matterviz_plot_interactive=trim(adjustl(value))=='xwin'
end subroutine

subroutine matterviz_capture_reset()
integer :: idx
matterviz_plot_series_count=0
matterviz_plot_point_count=0
matterviz_plot_legend_count=0
matterviz_plot_capture_error=0
matterviz_plot_label_count=0
matterviz_plot_stick_count=0
matterviz_plot_legends=''
matterviz_plot_legend_colors=''
matterviz_plot_label_series=0
matterviz_plot_label_point=0
matterviz_plot_label_next=0
matterviz_plot_labels=''
matterviz_plot_posx=0
matterviz_plot_posy=0
matterviz_plot_lenx=0
matterviz_plot_leny=0
matterviz_plot_width=1
matterviz_plot_xlow=0D0
matterviz_plot_xhigh=1D0
matterviz_plot_ylow=0D0
matterviz_plot_yhigh=1D0
matterviz_plot_xlabel=''
matterviz_plot_ylabel=''
matterviz_plot_color='#222222'
matterviz_plot_dashed=.false.
matterviz_plot_legend_initialized=.false.
do idx=1,matterviz_plot_max_series
    if (allocated(matterviz_plot_series(idx)%x)) deallocate(matterviz_plot_series(idx)%x)
    if (allocated(matterviz_plot_series(idx)%y)) deallocate(matterviz_plot_series(idx)%y)
    if (allocated(matterviz_plot_series(idx)%label_head)) deallocate(matterviz_plot_series(idx)%label_head)
    if (allocated(matterviz_plot_series(idx)%label_tail)) deallocate(matterviz_plot_series(idx)%label_tail)
    matterviz_plot_series(idx)=matterviz_captured_series()
end do
end subroutine

subroutine matterviz_capture_legend(value)
character(len=*),intent(in) :: value
if (matterviz_plot_capture_error/=0) return
if (matterviz_plot_legend_count>=matterviz_plot_max_series) then
    matterviz_plot_capture_error=3
    return
end if
matterviz_plot_legend_count=matterviz_plot_legend_count+1
matterviz_plot_legends(matterviz_plot_legend_count)=trim(adjustl(value))
matterviz_plot_legend_colors(matterviz_plot_legend_count)=matterviz_plot_color
end subroutine

subroutine matterviz_capture_resolve_legends()
integer :: legend_idx,series_idx,matches

do series_idx=1,matterviz_plot_series_count
    matterviz_plot_series(series_idx)%label=''
end do
do legend_idx=1,matterviz_plot_legend_count
    matches=count(matterviz_plot_legend_colors(1:matterviz_plot_legend_count)== &
        matterviz_plot_legend_colors(legend_idx))
    if (matches/=1) cycle
    do series_idx=1,matterviz_plot_series_count
        if (matterviz_plot_series(series_idx)%color==matterviz_plot_legend_colors(legend_idx)) &
            matterviz_plot_series(series_idx)%label=trim(matterviz_plot_legends(legend_idx))
    end do
end do
end subroutine

subroutine matterviz_capture_legend_init()
matterviz_plot_legend_initialized=.true.
end subroutine

subroutine matterviz_capture_axis_length(xlen,ylen)
integer,intent(in) :: xlen,ylen
matterviz_plot_lenx=xlen
matterviz_plot_leny=ylen
end subroutine

subroutine matterviz_capture_axis_position(xpos,ypos)
integer,intent(in) :: xpos,ypos
matterviz_plot_posx=xpos
matterviz_plot_posy=ypos
end subroutine

subroutine matterviz_capture_name(value,axis)
character(len=*),intent(in) :: value,axis
if (index(axis,'X')>0.or.index(axis,'x')>0) matterviz_plot_xlabel=matterviz_plain_label(value)
if (index(axis,'Y')>0.or.index(axis,'y')>0) matterviz_plot_ylabel=matterviz_plain_label(value)
end subroutine

function matterviz_plain_label(value) result(plain)
character(len=*),intent(in) :: value
character(len=:),allocatable :: plain

plain=trim(value)
plain=matterviz_replace_all(plain,'$^{-1}$','^-1')
plain=matterviz_replace_all(plain,'$^2$','^2')
plain=matterviz_replace_all(plain,'$^4$','^4')
plain=matterviz_replace_all(plain,'$\epsilon$','epsilon')
end function

function matterviz_replace_all(value,token,replacement) result(output)
character(len=*),intent(in) :: value,token,replacement
character(len=:),allocatable :: output
integer :: found,start

output=''
start=1
do
    found=index(value(start:),token)
    if (found==0) then
        output=output//value(start:)
        exit
    end if
    found=start+found-1
    output=output//value(start:found-1)//replacement
    start=found+len(token)
    if (start>len(value)) exit
end do
end function

subroutine matterviz_capture_graph(xlow,xhigh,ylow,yhigh)
real*8,intent(in) :: xlow,xhigh,ylow,yhigh
matterviz_plot_xlow=xlow
matterviz_plot_xhigh=xhigh
matterviz_plot_ylow=ylow
matterviz_plot_yhigh=yhigh
end subroutine

subroutine matterviz_capture_color_name(value)
character(len=*),intent(in) :: value
select case(trim(adjustl(value)))
case('RED')
    matterviz_plot_color='#d62728'
case('GREEN')
    matterviz_plot_color='#2ca02c'
case('BLUE')
    matterviz_plot_color='#1f77b4'
case('CYAN')
    matterviz_plot_color='#17becf'
case('YELLOW')
    matterviz_plot_color='#bcbd22'
case('ORANGE')
    matterviz_plot_color='#ff7f0e'
case('MAGENTA')
    matterviz_plot_color='#e377c2'
case('BLACK')
    matterviz_plot_color='#f5f5f5'
case default
    matterviz_plot_color='#222222'
end select
end subroutine

subroutine matterviz_capture_rgb(red,green,blue)
real*8,intent(in) :: red,green,blue
integer :: r,g,b
r=max(0,min(255,nint(red*255D0)))
g=max(0,min(255,nint(green*255D0)))
b=max(0,min(255,nint(blue*255D0)))
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

subroutine matterviz_capture_curve(x,y,count)
integer,intent(in) :: count
real*8,intent(in) :: x(count),y(count)
integer :: idx,out_count,source
logical :: sticks

if (.not.matterviz_plot_interactive.or.count<=0) return
if (matterviz_plot_capture_error/=0) return
if (matterviz_plot_series_count>=matterviz_plot_max_series) then
    matterviz_plot_capture_error=1
    return
end if
sticks=mod(count,3)==0
if (sticks) then
    do idx=1,count,3
        if (abs(x(idx)-x(idx+1))>1D-10.or.abs(x(idx+1)-x(idx+2))>1D-10.or. &
            abs(y(idx))>1D-10.or.abs(y(idx+2))>1D-10) then
            sticks=.false.
            exit
        end if
    end do
end if
if (sticks) then
    out_count=count/3
else
    out_count=count
end if
if (sticks.and.out_count>100000-matterviz_plot_stick_count) then
    matterviz_plot_capture_error=5
    return
end if
if (out_count>matterviz_plot_max_points-matterviz_plot_point_count) then
    matterviz_plot_capture_error=2
    return
end if
matterviz_plot_series_count=matterviz_plot_series_count+1
idx=matterviz_plot_series_count
allocate(matterviz_plot_series(idx)%x(out_count),matterviz_plot_series(idx)%y(out_count), &
    matterviz_plot_series(idx)%label_head(out_count),matterviz_plot_series(idx)%label_tail(out_count))
matterviz_plot_series(idx)%label_head=0
matterviz_plot_series(idx)%label_tail=0
if (sticks) then
    do source=1,out_count
        matterviz_plot_series(idx)%x(source)=x(3*source-1)
        matterviz_plot_series(idx)%y(source)=y(3*source-1)
    end do
else
    matterviz_plot_series(idx)%x=x
    matterviz_plot_series(idx)%y=y
end if
matterviz_plot_series(idx)%count=out_count
matterviz_plot_series(idx)%sticks=sticks
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
matterviz_plot_point_count=matterviz_plot_point_count+out_count
if (sticks) matterviz_plot_stick_count=matterviz_plot_stick_count+out_count
end subroutine

subroutine matterviz_capture_label(value,x,y)
character(len=*),intent(in) :: value
real*8,intent(in) :: x,y
integer :: idx,point_idx,best_series,best_point
real*8 :: xspan,yspan,score,best_score

if (.not.matterviz_plot_interactive.or.matterviz_plot_capture_error/=0) return
if (len_trim(value)==0) return
if (matterviz_plot_label_count>=matterviz_plot_max_labels.or. &
    len_trim(value)>matterviz_plot_label_length) then
    matterviz_plot_capture_error=4
    return
end if
best_series=0
best_point=0
best_score=huge(1D0)
do idx=1,matterviz_plot_series_count
    if (matterviz_plot_series(idx)%posx/=matterviz_plot_posx.or. &
        matterviz_plot_series(idx)%posy/=matterviz_plot_posy.or. &
        matterviz_plot_series(idx)%lenx/=matterviz_plot_lenx.or. &
        matterviz_plot_series(idx)%leny/=matterviz_plot_leny) cycle
    if (abs(matterviz_plot_series(idx)%ylow-matterviz_plot_ylow)>1D-12.or. &
        abs(matterviz_plot_series(idx)%yhigh-matterviz_plot_yhigh)>1D-12) cycle
    xspan=max(abs(matterviz_plot_series(idx)%xhigh-matterviz_plot_series(idx)%xlow),tiny(1D0))
    yspan=max(abs(matterviz_plot_series(idx)%yhigh-matterviz_plot_series(idx)%ylow),tiny(1D0))
    do point_idx=1,matterviz_plot_series(idx)%count
        score=abs(matterviz_plot_series(idx)%x(point_idx)-x)/xspan+ &
            abs(matterviz_plot_series(idx)%y(point_idx)-y)/yspan
        if (score<best_score) then
            best_score=score
            best_series=idx
            best_point=point_idx
        end if
    end do
end do
if (best_series==0) return
matterviz_plot_label_count=matterviz_plot_label_count+1
matterviz_plot_label_series(matterviz_plot_label_count)=best_series
matterviz_plot_label_point(matterviz_plot_label_count)=best_point
matterviz_plot_labels(matterviz_plot_label_count)=trim(adjustl(value))
if (matterviz_plot_series(best_series)%label_head(best_point)==0) then
    matterviz_plot_series(best_series)%label_head(best_point)=matterviz_plot_label_count
else
    matterviz_plot_label_next(matterviz_plot_series(best_series)%label_tail(best_point))= &
        matterviz_plot_label_count
end if
matterviz_plot_series(best_series)%label_tail(best_point)=matterviz_plot_label_count
end subroutine

logical function matterviz_capture_supported()
integer :: idx
character(len=320) :: labels
matterviz_capture_supported=.false.
if (matterviz_plot_capture_error/=0) return
do idx=1,matterviz_plot_series_count
    if (index(trim(matterviz_plot_series(idx)%ylabel),'Vibrational density-of-states')==1) return
end do
do idx=1,matterviz_plot_series_count
    labels=trim(matterviz_plot_series(idx)%xlabel)//' '//trim(matterviz_plot_series(idx)%ylabel)
    if ((trim(matterviz_plot_series(idx)%ylabel)=='Density-of-states'.and. &
        matterviz_plot_legend_initialized).or.index(labels,'Wavelength')>0.or. &
        index(labels,'Excitation energy')>0.or.index(labels,'Raman')>0.or. &
        index(labels,'IR intensities')>0.or.index(labels,'Molar absorption')>0.or. &
        index(labels,'Chemical shift')>0.or.index(labels,'Shielding (ppm)')>0) then
        matterviz_capture_supported=.true.
        return
    end if
end do
end function

function matterviz_capture_error_message() result(message)
character(len=96) :: message

select case(matterviz_plot_capture_error)
case(1)
    message='too many curve series (limit 128)'
case(2)
    message='too many curve points (limit 2000000)'
case(3)
    message='too many legend entries (limit 128)'
case(4)
    message='too many or oversized point labels (limits 20000 and 160 characters)'
case(5)
    message='too many discrete sticks (limit 100000)'
case default
    message='unknown capture error'
end select
end function

end module
