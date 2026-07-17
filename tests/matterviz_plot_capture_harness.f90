module matterviz_capture_harness_state
integer :: launches=0
end module

program matterviz_capture_harness
use matterviz_plot_capture
use matterviz_capture_harness_state
implicit none
character(len=80) :: legend_buffer
real*8 :: line_x(4)=(/0D0,1D0,2D0,3D0/),line_y(4)=(/0D0,2D0,1D0,0D0/)
real*8 :: reference_x(2)=(/1.5D0,1.5D0/),reference_y(2)=(/0D0,3D0/)
real*8,allocatable :: stick_x(:),stick_y(:)
integer :: idx

! LDOS uses the DOS axis name but does not initialize the DOS legend block.
call begin_plot('Energy (eV)','Density-of-states')
call curve(line_x,line_y,4)
call disfin()
if (launches/=0) error stop 1

! Vibrational DOS initializes legends, but its exact axis name remains excluded.
call begin_plot('Wavenumber (cm$^{-1}$)','Vibrational density-of-states (arb. unit)')
call legini(legend_buffer,1,80)
call curve(line_x,line_y,4)
call name('IR intensities (km mol$^{-1}$)','Y')
call graf(4D0,0D0,4D0,-0.5D0,0D0,5D0,0D0,0.5D0)
call curve(line_x,line_y,4)
call disfin()
if (launches/=0) error stop 2

! The native DOS ordering associates LEGLIN with curves of the active color.
call begin_plot('Energy (eV)','Density-of-states')
call legini(legend_buffer,1,80)
call color('RED')
call curve(line_x,line_y,4)
call leglin(legend_buffer,'TDOS',1)
call myline((/10,20/),2)
call curve(reference_x,reference_y,2)
call solid()
call disfin()
if (launches/=1) error stop 3

! Native RLMESS labels are attached to original points, not recomputed.
call begin_plot('Wavenumber (cm$^{-1}$)','IR intensities (km mol$^{-1}$)')
call legini(legend_buffer,1,80)
call curve(line_x,line_y,4)
call rlmess('1000',1D0,2D0)
call rlmess('C1',1D0,2D0)
call disfin()
if (launches/=2) error stop 4

! Reused colors make legend identity ambiguous and must remain generic.
call begin_plot('Chemical shift (ppm)','Signal strength')
call legini(legend_buffer,3,80)
call color('RED')
call curve(line_x,line_y,4)
call color('BLUE')
call curve(line_x,line_y,4)
call color('RED')
call curve(line_x,line_y,4)
call color('RED')
call leglin(legend_buffer,'System 1',1)
call color('BLUE')
call leglin(legend_buffer,'System 2',2)
call color('RED')
call leglin(legend_buffer,'System 15',3)
call disfin()
if (launches/=3) error stop 5

! Oversized individual labels invalidate the capture instead of truncating.
call begin_plot('Wavenumber (cm$^{-1}$)','IR intensities (km mol$^{-1}$)')
call curve(line_x,line_y,4)
call rlmess(repeat('A',161),1D0,2D0)
call disfin()
if (launches/=3.or.matterviz_plot_capture_error/=4) error stop 6

! Exceeding a resource limit invalidates the entire capture.
call begin_plot('Energy (eV)','Density-of-states')
call legini(legend_buffer,1,80)
do idx=1,matterviz_plot_max_series+1
    call curve(line_x,line_y,4)
end do
call disfin()
if (launches/=3.or.matterviz_plot_capture_error/=1) error stop 7

allocate(stick_x(300003),stick_y(300003))
do idx=1,100001
    stick_x(3*idx-2:3*idx)=dble(idx)
    stick_y(3*idx-2:3*idx)=(/0D0,1D0,0D0/)
end do
call begin_plot('Chemical shift (ppm)','Degeneracy')
call curve(stick_x,stick_y,size(stick_x))
call disfin()
if (launches/=3.or.matterviz_plot_capture_error/=5) error stop 8

write(*,'(a)') 'MATTERVIZ_CAPTURE_OK'

contains

subroutine begin_plot(xlabel,ylabel)
character(len=*),intent(in) :: xlabel,ylabel
call metafl('xwin')
call disini()
call axspos(100,200)
call axslen(800,500)
call name(xlabel,'X')
call name(ylabel,'Y')
call graf(4D0,0D0,4D0,-0.5D0,0D0,5D0,0D0,0.5D0)
end subroutine

end program

subroutine matterviz_show_captured_plot()
use matterviz_plot_capture
use matterviz_capture_harness_state
implicit none

launches=launches+1
select case(launches)
case(1)
    if (matterviz_plot_series_count/=2) error stop 10
    if (trim(matterviz_plot_series(1)%label)/='TDOS') error stop 11
    if (.not.matterviz_plot_series(2)%dashed.or. &
        matterviz_plot_series(2)%x(1)/=matterviz_plot_series(2)%x(2)) error stop 12
case(2)
    if (trim(matterviz_plot_series(1)%xlabel)/='Wavenumber (cm^-1)') error stop 13
    if (trim(matterviz_plot_series(1)%ylabel)/='IR intensities (km mol^-1)') error stop 14
    if (matterviz_plot_label_count/=2) error stop 15
    if (any(matterviz_plot_label_series(1:2)/=1).or. &
        any(matterviz_plot_label_point(1:2)/=2)) error stop 16
case(3)
    if (len_trim(matterviz_plot_series(1)%label)/=0.or. &
        trim(matterviz_plot_series(2)%label)/='System 2'.or. &
        len_trim(matterviz_plot_series(3)%label)/=0) error stop 17
case default
    error stop 18
end select
end subroutine
