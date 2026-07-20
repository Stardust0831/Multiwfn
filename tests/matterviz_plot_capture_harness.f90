module matterviz_capture_harness_state
integer :: launches=0
end module

program matterviz_capture_harness
use matterviz_plot_capture
use matterviz_capture_harness_state
implicit none
character(len=80) :: legend_buffer
real*8 :: x(4)=(/0D0,1D0,2D0,3D0/),y(4)=(/0D0,2D0,1D0,0D0/)
real*8 :: e1(4)=(/0.1D0,0.2D0,0.1D0,0.3D0/),e2(4)=(/0.2D0,0.1D0,0.3D0,0.2D0/)
real*8 :: gridx(2)=(/0D0,1D0/),gridy(3)=(/0D0,1D0,2D0/),z(2,3),levels(2)=(/0.25D0,0.75D0/)
real*8 :: xmat(2,2),ymat(2,2),xp(2),yp(2),xs(2),ys(2),raster(2,2)
real*8 :: physical_low,physical_high
integer :: i

z=reshape((/0D0,1D0,2D0,3D0,4D0,5D0/),(/2,3/)); xmat=reshape((/0D0,1D0,0D0,1D0/),(/2,2/))
ymat=reshape((/0D0,0D0,1D0,1D0/),(/2,2/)); xp=(/0D0,1D0/); yp=(/0D0,1D0/); xs=(/0.2D0,0.8D0/); ys=(/0.2D0,0.8D0/)
raster=reshape((/1D0,2D0,3D0,4D0/),(/2,2/))

! Log GRAF limits are exponents; only finite positive physical ranges are valid.
if (.not.matterviz_log_range_to_physical(-5D0,2D0,physical_low,physical_high)) error stop 41
if (abs(physical_low-1D-5)>1D-15.or.abs(physical_high-1D2)>1D-12) error stop 42
if (.not.matterviz_log_range_to_physical(-5D0,1D0,physical_low,physical_high)) error stop 43
if (physical_low<=0D0.or.physical_high<=0D0) error stop 44
if (matterviz_log_range_to_physical(400D0,401D0,physical_low,physical_high)) error stop 45
if (matterviz_log_range_to_physical(-400D0,-399D0,physical_low,physical_high)) error stop 46
if (abs(matterviz_viewport_top(1640,1500,1800D0)-141D0/1800D0)>1D-12) error stop 50
if (abs(matterviz_panel_annotation_y(141D0,1640,1500))>1D-12) error stop 51
if (abs(matterviz_panel_annotation_y(1640D0,1640,1500)-1499D0/1500D0)>1D-12) error stop 52

! A repeated GRAF can carry a secondary log axis without losing its scale flag.
call metafl('xwin'); call disini(); call axspos(50,60); call axslen(400,300)
call axsscl('LOG','Y'); call graf(0D0,3D0,0D0,1D0,0D0,1D0,0D0,1D0)
call curve(x,y,4); call graf(0D0,3D0,0D0,1D0,1D0,2D0,1D0,1D0)
call curve(x,y+1D0,4)
if (.not.matterviz_plot_panels(1)%has_y2.or..not.matterviz_plot_panels(1)%y2log) error stop 47
if (matterviz_plot_panels(1)%y2low/=1D0.or.matterviz_plot_panels(1)%y2high/=2D0) error stop 48

call metafl('xwin'); call disini(); call axspos(50,60); call axslen(400,300)
call axsscl('LOG','X'); call graf(0D0,1D0,0D0,1D0,0D0,1D0,0D0,1D0)
call curve(x,y,4); call graf(1D0,2D0,1D0,1D0,0D0,1D0,0D0,1D0)
call curve(x+1D0,y,4)
if (.not.matterviz_plot_panels(1)%has_x2.or..not.matterviz_plot_panels(1)%x2log) error stop 53

call metafl('xwin'); call disini(); call axspos(50,60); call axslen(400,300)
call axsscl('LOG','Y'); call graf(0D0,1D0,0D0,1D0,-400D0,-399D0,-400D0,1D0)
if (matterviz_plot_capture_error/=10) error stop 54

! Ordinary curves are line layers, even for triples that resemble sticks.
call begin_plot(3D0,0D0,2D0,-1D0)
call curve(x,y,4); call disfin()
if (launches/=1) error stop 1

! A points-only curve is controlled by marker state, never coordinate heuristics.
call begin_plot(0D0,3D0,0D0,2D0)
call incmrk(-1); call marker(7); call curve(x,y,4)
call incmrk(1); call curve(x,y,4); call disfin()
if (launches/=2) error stop 2

call begin_plot(0D0,3D0,0D0,2D0)
call bars(x,y,e1,4); call color('BLACK'); call incmrk(0); call curve(x,y,4)
call matterviz_capture_legend('curve legend',1); call disfin()
if (launches/=3) error stop 3

call begin_plot(0D0,3D0,0D0,2D0)
call errbar(x,y,e1,e2,4); call disfin()
if (launches/=4) error stop 4

call begin_plot(0D0,3D0,0D0,2D0)
call shdcrv(x,y,4,x,e1,4); call rlmess('annotation',1D0,2D0); call messag('screen note',20,30); call disfin()
if (launches/=5) error stop 5

! Log state and exact reversed ranges survive in the panel record.
call begin_plot(10D0,1D0,100D0,1D0)
call axsscl('LOG','X'); call axsscl('LOG','Y'); call labels('EXP','X'); call labdig(4,'Y'); call curve(x,y,4); call disfin()
if (launches/=6) error stop 6

! ENDGRF separates panels; layers retain order and panel ownership.
call metafl('xwin'); call disini(); call axspos(10,20); call axslen(300,200); call graf(0D0,1D0,0D0,0.5D0,0D0,1D0,0D0,0.5D0)
call curve(x(1:2),y(1:2),2); call endgrf(); call axspos(30,40)
call graf(0D0,2D0,0D0,1D0,0D0,2D0,0D0,1D0)
call curve(x,y,4); call disfin()
if (launches/=7) error stop 7

! Repeated GRAF at the same geometry is a secondary-axis overlay, not a new panel.
call metafl('xwin'); call disini(); call axspos(50,60); call axslen(400,300)
call name('primary','Y'); call graf(0D0,3D0,0D0,1D0,0D0,2D0,0D0,1D0); call curve(x,y,4); call endgrf()
call name('secondary','Y'); call graf(0D0,3D0,0D0,1D0,10D0,20D0,10D0,5D0); call curve(x,y+10D0,4); call disfin()
if (launches/=8) error stop 13

! A third distinct range at the same geometry exceeds the four-axis model.
call metafl('xwin'); call disini(); call axspos(50,60); call axslen(400,300)
call graf(0D0,3D0,0D0,1D0,0D0,2D0,0D0,1D0); call curve(x,y,4); call endgrf()
call graf(0D0,3D0,0D0,1D0,10D0,20D0,10D0,5D0); call curve(x,y+10D0,4); call endgrf()
call graf(0D0,3D0,0D0,1D0,-2D0,2D0,-2D0,1D0); call curve(x,y,4); call disfin()
if (launches/=8.or.matterviz_plot_capture_error/=9) error stop 14

call begin_plot(0D0,1D0,0D0,1D0)
call crvmat(raster,2,2,2,2); call disfin()
if (launches/=8.or.matterviz_plot_capture_error/=9) error stop 15

call begin_plot(0D0,1D0,0D0,2D0)
call contur(gridx,2,gridy,3,z,levels(1)); call disfin()
if (launches/=9) error stop 16

call begin_plot(0D0,1D0,0D0,1D0)
call stream(xmat,ymat,2,2,xp,yp,xs,ys,2); call disfin()
if (launches/=9.or.matterviz_plot_capture_error/=9) error stop 17

call begin_plot(0D0,1D0,0D0,1D0)
call surshd(gridx,2,gridy,2,raster); call disfin()
if (launches/=9.or.matterviz_plot_capture_error/=9) error stop 18

! Limits invalidate the entire scene and do not launch a partial plot.
call begin_plot(0D0,1D0,0D0,1D0)
do i=1,matterviz_plot_max_series+1
    call curve(x,y,4)
end do
call disfin()
if (launches/=9.or.matterviz_plot_capture_error/=1) error stop 19

write(*,'(a)') 'MATTERVIZ_CAPTURE_OK'

contains
subroutine begin_plot(xlow,xhigh,ylow,yhigh)
real*8,intent(in) :: xlow,xhigh,ylow,yhigh
call metafl('xwin'); call disini(); call axspos(100,200); call axslen(800,500)
call name('x','X'); call name('y','Y'); call graf(xlow,xhigh,xlow,1D0,ylow,yhigh,ylow,1D0)
end subroutine
end program

subroutine matterviz_show_captured_plot()
use matterviz_plot_capture
use matterviz_capture_harness_state
implicit none
integer :: p
launches=launches+1
select case(launches)
case(1)
    if (matterviz_plot_layer_count/=1.or.trim(matterviz_plot_layers(1)%kind)/='line') error stop 20
    if (matterviz_plot_panels(1)%xlow/=3D0.or.matterviz_plot_panels(1)%xhigh/=0D0) error stop 21
case(2)
    if (trim(matterviz_plot_layers(1)%kind)/='scatter'.or..not.matterviz_plot_layers(1)%marker) error stop 22
    if (trim(matterviz_plot_layers(2)%kind)/='line+scatter'.or. &
        matterviz_plot_layers(2)%marker_interval/=1) error stop 31
case(3)
    if (trim(matterviz_plot_layers(1)%kind)/='bars') error stop 23
    if (any(abs(matterviz_plot_layers(1)%y-(/0.1D0,0.2D0,0.1D0,0.3D0/))>1D-12).or. &
        any(abs(matterviz_plot_layers(1)%aux1-(/0D0,2D0,1D0,0D0/))>1D-12)) error stop 32
    if (trim(matterviz_plot_layers(2)%kind)/='line'.or. &
        trim(matterviz_plot_layers(2)%color)/='#000000') error stop 34
    if (matterviz_plot_layers(1)%legend/=0.or.matterviz_plot_layers(2)%legend/=1) error stop 35
case(4)
    if (trim(matterviz_plot_layers(1)%kind)/='errorbar') error stop 24
case(5)
    if (trim(matterviz_plot_layers(1)%kind)/='fill'.or.matterviz_plot_label_count/=2) error stop 25
    if (matterviz_plot_annotations(1)%x/=1D0.or.matterviz_plot_annotations(2)%x/=20D0) error stop 26
    if (.not.matterviz_plot_annotations(1)%data_coordinates.or. &
        matterviz_plot_annotations(2)%data_coordinates) error stop 38
case(6)
    if (.not.matterviz_plot_panels(1)%xlog.or..not.matterviz_plot_panels(1)%ylog) error stop 27
    if (matterviz_plot_panels(1)%xlow/=10D0.or.matterviz_plot_panels(1)%xhigh/=1D0) error stop 28
case(7)
    if (matterviz_plot_panel_count/=2.or.matterviz_plot_layer_count/=2) error stop 29
    if (matterviz_plot_layers(1)%panel/=1.or.matterviz_plot_layers(2)%panel/=2) error stop 30
case(8)
    if (matterviz_plot_panel_count/=1.or..not.matterviz_plot_panels(1)%has_y2) error stop 39
    if (.not.matterviz_plot_layers(2)%use_y2.or.matterviz_plot_panels(1)%y2low/=10D0) error stop 40
case(9)
    if (trim(matterviz_plot_layers(1)%kind)/='contour'.or.matterviz_plot_layers(1)%nx/=2) error stop 33
case default
    error stop 37
end select
end subroutine
